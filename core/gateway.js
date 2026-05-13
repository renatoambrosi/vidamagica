/* ============================================================
   VIDA MÁGICA — core/gateway.js
   GATEWAY UNIFICADO DE SAÍDA DE WHATSAPP.

   Princípio: TUDO que sai pelo WhatsApp passa por aqui (exceto
   chat aluna ↔ atendimento, que é interno via app).

   Trabalha por ATENDIMENTO (1+ mensagens em sequência pro mesmo
   destinatário, mesmo motivo). Cooldowns separados pra reativos
   e ativos. Categorias pausáveis. Limite diário pra ativas.

   Bancos:
   - poolComunicacao: fila_mensagens, gateway_categorias,
                      gateway_config, templates_mensagens,
                      historico_mensagens
   ============================================================ */

const { randomUUID } = require('crypto');
const { poolComunicacao } = require('../db');
const { enviarTexto } = require('./whatsapp');
const { formatarTelefone } = require('./utils');

// ── CACHE DE CONFIG ─────────────────────────────────────────
// Recarregado a cada 30s pra respeitar mudanças do painel rapidamente.
let configCache = null;
let configCacheExpira = 0;

async function getConfig() {
  const agora = Date.now();
  if (configCache && agora < configCacheExpira) return configCache;
  try {
    const r = await poolComunicacao.query(`SELECT chave, valor FROM gateway_config`);
    const map = {};
    for (const row of r.rows) map[row.chave] = row.valor;
    configCache = {
      cooldown_entre_msgs_atendimento: parseInt(map.cooldown_entre_msgs_atendimento || '2', 10),
      cooldown_atendimentos_reativos:  parseInt(map.cooldown_atendimentos_reativos  || '5', 10),
      cooldown_atendimentos_ativos:    parseInt(map.cooldown_atendimentos_ativos   || '60', 10),
      limite_msgs_dia_ativas:          parseInt(map.limite_msgs_dia_ativas        || '200', 10),
      pausado_geral:                   (map.pausado_geral || 'false') === 'true',
    };
    configCacheExpira = agora + 30000;
    return configCache;
  } catch (err) {
    console.error('[gateway] getConfig:', err.message);
    return {
      cooldown_entre_msgs_atendimento: 2,
      cooldown_atendimentos_reativos: 5,
      cooldown_atendimentos_ativos: 60,
      limite_msgs_dia_ativas: 200,
      pausado_geral: false,
    };
  }
}

function invalidarConfigCache() {
  configCacheExpira = 0;
}

// ── CACHE DE CATEGORIAS PAUSADAS ────────────────────────────
let categoriasPausadasCache = null;
let categoriasPausadasExpira = 0;

async function getCategoriasPausadas() {
  const agora = Date.now();
  if (categoriasPausadasCache && agora < categoriasPausadasExpira) return categoriasPausadasCache;
  try {
    const r = await poolComunicacao.query(`SELECT chave FROM gateway_categorias WHERE pausado=TRUE`);
    categoriasPausadasCache = new Set(r.rows.map(x => x.chave));
    categoriasPausadasExpira = agora + 30000;
    return categoriasPausadasCache;
  } catch (err) {
    console.error('[gateway] getCategoriasPausadas:', err.message);
    return new Set();
  }
}

function invalidarCategoriasCache() {
  categoriasPausadasExpira = 0;
}

// ── RENDERIZADOR DE TEMPLATE ────────────────────────────────
/**
 * Busca um template no banco e renderiza com as variáveis.
 * Placeholders não-substituídos viram string vazia (não dá erro).
 */
async function renderizarTemplate(chave, variaveis = {}) {
  if (!chave) return null;
  try {
    const r = await poolComunicacao.query(
      `SELECT texto FROM templates_mensagens WHERE chave=$1`,
      [chave]
    );
    if (!r.rows.length) {
      console.warn(`[gateway] template '${chave}' não encontrado`);
      return null;
    }
    let texto = r.rows[0].texto;
    // Substitui {nome}, {codigo}, {telefone}, etc.
    texto = texto.replace(/\{(\w+)\}/g, (_, k) => {
      const v = variaveis[k];
      return v !== undefined && v !== null ? String(v) : '';
    });
    return texto;
  } catch (err) {
    console.error('[gateway] renderizarTemplate:', err.message);
    return null;
  }
}

// ── ENFILEIRAR ATENDIMENTO ──────────────────────────────────
/**
 * Enfileira um atendimento (1 ou mais mensagens em sequência) na fila.
 *
 * @param {object} opts
 * @param {string} opts.telefone — telefone canônico (55+DDD+número)
 * @param {string} opts.tipo — 'reativo' ou 'ativo' (padrão 'ativo')
 * @param {string} opts.categoria — chave de gateway_categorias (apenas pra ativos)
 * @param {string} opts.origem — pra log/auditoria (ex: 'auth-magic', 'scheduler-clube')
 * @param {string} opts.nome — primeiro nome (pra log)
 * @param {Array<string|{template, variaveis}|{texto}>} opts.mensagens — lista de msgs em sequência
 *
 * Cada item de `mensagens` pode ser:
 * - string: texto puro
 * - {texto: '...'}: texto puro
 * - {template: 'chave', variaveis: {nome,codigo,...}}: usa template do banco
 *
 * @returns {Promise<{atendimento_id: string, ids: number[]}>}
 */
async function enfileirarAtendimento(opts) {
  const {
    telefone, tipo = 'ativo', categoria = null,
    origem = 'gateway', nome = null, mensagens = [],
  } = opts || {};

  if (!telefone) throw new Error('enfileirarAtendimento: telefone obrigatório');
  if (!Array.isArray(mensagens) || mensagens.length === 0) {
    throw new Error('enfileirarAtendimento: mensagens deve ser array não-vazio');
  }
  if (tipo !== 'reativo' && tipo !== 'ativo') {
    throw new Error('enfileirarAtendimento: tipo deve ser "reativo" ou "ativo"');
  }

  // Reativo = prioridade 1 | Manual admin = 2 | Outras ativas = 3
  const prioridade = tipo === 'reativo' ? 1 : (categoria === 'manual_admin' ? 2 : 3);

  const atendimento_id = randomUUID();
  const telefoneCanonico = formatarTelefone(telefone);

  // Renderiza cada mensagem
  const mensagensRenderizadas = [];
  for (const item of mensagens) {
    if (typeof item === 'string') {
      mensagensRenderizadas.push({ texto: item, template: null });
    } else if (item && item.texto) {
      mensagensRenderizadas.push({ texto: item.texto, template: null });
    } else if (item && item.template) {
      const texto = await renderizarTemplate(item.template, item.variaveis || {});
      if (!texto) throw new Error(`template '${item.template}' inválido ou vazio`);
      mensagensRenderizadas.push({ texto, template: item.template });
    } else {
      throw new Error('mensagem inválida — use string, {texto} ou {template, variaveis}');
    }
  }

  // Insere todas as msgs do atendimento na fila
  const ids = [];
  const c = await poolComunicacao.connect();
  try {
    await c.query('BEGIN');
    for (let i = 0; i < mensagensRenderizadas.length; i++) {
      const m = mensagensRenderizadas[i];
      const r = await c.query(
        `INSERT INTO fila_mensagens
          (telefone, mensagem, nome, origem, status, tentativas,
           atendimento_id, ordem_no_atendimento, categoria, tipo, prioridade, template_chave)
         VALUES ($1, $2, $3, $4, 'pendente', 0, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [telefoneCanonico, m.texto, nome, origem,
         atendimento_id, i + 1, categoria, tipo, prioridade, m.template]
      );
      ids.push(r.rows[0].id);
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }

  console.log(`[gateway] enfileirado atendimento ${atendimento_id.slice(0,8)} (${tipo}/${categoria||'-'}, ${ids.length} msg, prio=${prioridade}, tel=${telefoneCanonico})`);
  return { atendimento_id, ids };
}

// ── WORKER ──────────────────────────────────────────────────
let workerRodando = false;
let workerInterval = null;
let workerProcessando = false;

/**
 * Pega o próximo atendimento pendente respeitando prioridade e categorias pausadas.
 * Retorna null se nada disponível.
 */
async function pegarProximoAtendimento(catsPausadas) {
  // Lista distintos atendimento_id pendentes ordenados por (prioridade, entrou_em)
  // Filtra atendimentos cuja categoria esteja pausada (apenas ativos têm categoria)
  let where = `status='pendente' AND atendimento_id IS NOT NULL`;
  const params = [];
  if (catsPausadas.size > 0) {
    const cats = Array.from(catsPausadas);
    const placeholders = cats.map((_, i) => `$${i + 1}`).join(',');
    where += ` AND (categoria IS NULL OR categoria NOT IN (${placeholders}))`;
    params.push(...cats);
  }
  const r = await poolComunicacao.query(
    `SELECT atendimento_id, prioridade, tipo, categoria, MIN(entrou_em) AS entrou
       FROM fila_mensagens
      WHERE ${where}
   GROUP BY atendimento_id, prioridade, tipo, categoria
   ORDER BY prioridade ASC, entrou ASC
      LIMIT 1`,
    params
  );
  if (!r.rows.length) return null;
  const meta = r.rows[0];

  // Pega todas as mensagens desse atendimento, em ordem
  const r2 = await poolComunicacao.query(
    `SELECT * FROM fila_mensagens
      WHERE atendimento_id=$1 AND status='pendente'
      ORDER BY ordem_no_atendimento ASC`,
    [meta.atendimento_id]
  );
  return { meta, mensagens: r2.rows };
}

/**
 * Quantas mensagens ATIVAS já saíram (sucesso) hoje?
 */
async function contarAtivasHoje() {
  const r = await poolComunicacao.query(
    `SELECT COUNT(*)::int AS qtd
       FROM historico_mensagens
      WHERE sucesso=TRUE
        AND origem NOT LIKE 'auth-%'
        AND origem NOT LIKE 'painel-%'
        AND origem NOT LIKE 'reset-%'
        AND enviado_em >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`
  );
  return r.rows[0]?.qtd || 0;
}

/**
 * Loop do worker. Roda em intervalo, pega 1 atendimento, processa todas as
 * msgs com cooldown_entre_msgs_atendimento, espera cooldown_atendimentos_*
 * conforme tipo, repete.
 */
async function loopWorker() {
  if (workerProcessando) return;       // evita reentrância
  workerProcessando = true;
  try {
    const cfg = await getConfig();

    // Pausa total — não faz nada
    if (cfg.pausado_geral) {
      return;
    }

    const cats = await getCategoriasPausadas();
    const proximo = await pegarProximoAtendimento(cats);
    if (!proximo) return;

    const { meta, mensagens } = proximo;

    // Limite diário só pra ATIVAS — reativas bypassam
    if (meta.tipo === 'ativo') {
      const ativasHoje = await contarAtivasHoje();
      if (ativasHoje >= cfg.limite_msgs_dia_ativas) {
        console.log(`[gateway] limite diário (${cfg.limite_msgs_dia_ativas}) atingido — pausando ativas até virar o dia`);
        return;
      }
    }

    console.log(`[gateway] processando atendimento ${meta.atendimento_id.slice(0,8)} (${mensagens.length} msg, ${meta.tipo}, prio=${meta.prioridade})`);

    // Marca todas como 'enviando'
    await poolComunicacao.query(
      `UPDATE fila_mensagens SET status='enviando' WHERE atendimento_id=$1 AND status='pendente'`,
      [meta.atendimento_id]
    );

    // Processa em sequência com cooldown_entre_msgs_atendimento
    for (let i = 0; i < mensagens.length; i++) {
      const msg = mensagens[i];

      // Delay humano antes da PRIMEIRA mensagem (3-5s aleatório, simula ler+pensar)
      // Subsequentes usam o cooldown_entre_msgs_atendimento (rápido, "digitando")
      let delayMs;
      if (i === 0) {
        delayMs = 3000 + Math.floor(Math.random() * 2000);
      } else {
        delayMs = cfg.cooldown_entre_msgs_atendimento * 1000;
      }
      await new Promise(r => setTimeout(r, delayMs));

      const ok = await enviarTexto(msg.telefone, msg.mensagem);
      const agora = new Date();

      if (ok) {
        await poolComunicacao.query(
          `UPDATE fila_mensagens SET status='enviado', enviado_em=$1 WHERE id=$2`,
          [agora, msg.id]
        );
      } else {
        await poolComunicacao.query(
          `UPDATE fila_mensagens SET status='erro', erro='falha no envio Evolution', tentativas=tentativas+1 WHERE id=$1`,
          [msg.id]
        );
      }

      // Histórico (sempre registra, sucesso ou erro)
      await poolComunicacao.query(
        `INSERT INTO historico_mensagens
          (fila_id, telefone, mensagem, nome, origem, sucesso, erro, enviado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [msg.id, msg.telefone, msg.mensagem, msg.nome, msg.origem,
         ok, ok ? null : 'falha no envio Evolution', agora]
      );

      // Se a msg falhou, aborta o resto do atendimento (evita mandar parte sem contexto)
      if (!ok) {
        // Marca as restantes como erro também
        await poolComunicacao.query(
          `UPDATE fila_mensagens SET status='erro', erro='atendimento abortado por falha anterior'
           WHERE atendimento_id=$1 AND status='enviando'`,
          [meta.atendimento_id]
        );
        break;
      }
    }

    // Cooldown entre atendimentos
    const cooldownEntreAtendimentos = meta.tipo === 'reativo'
      ? cfg.cooldown_atendimentos_reativos
      : cfg.cooldown_atendimentos_ativos;
    await new Promise(r => setTimeout(r, cooldownEntreAtendimentos * 1000));

  } catch (err) {
    console.error('[gateway] loopWorker:', err.message);
  } finally {
    workerProcessando = false;
  }
}

/**
 * Inicia o worker. Chamado uma vez no startup do server.
 * Loop a cada 1 segundo verifica se tem o que fazer.
 */
function iniciarWorker() {
  if (workerRodando) return;
  workerRodando = true;
  console.log('[gateway] worker iniciado');
  workerInterval = setInterval(loopWorker, 1000);
}

function pararWorker() {
  if (workerInterval) clearInterval(workerInterval);
  workerInterval = null;
  workerRodando = false;
  console.log('[gateway] worker parado');
}

module.exports = {
  enfileirarAtendimento,
  renderizarTemplate,
  iniciarWorker,
  pararWorker,
  invalidarConfigCache,
  invalidarCategoriasCache,
};
