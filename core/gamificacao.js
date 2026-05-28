/* === VIDA MÁGICA — core/gamificacao.js ===
   Bancos: poolCore (estado da aluna) + poolComunicacao (config + missões)

   Motor TRANSVERSAL da plataforma. NÃO é do Caderno — é do app inteiro.
   Caderno usa esse motor como UMA das fontes de progresso (escrever no
   caderno conta como missão 'caderno_escrita').

   ── Conceitos ──

   1) "Login" = qualquer GET /api/app/contexto autenticado. Marca o dia da
      aluna como ativo (gam_login_diario). Avança 3 contadores em paralelo:

      a) Ofensiva MENSAL — cumulativa em ciclo de 30 dias.
         Conta dias DISTINTOS que ela apareceu nos últimos 30 dias do ciclo.
         Marcos premiados: 7, 15, 30 (configurados em gam_premios_config).
         Se em 30 dias só logou 7x, ganhou até o marco 7. Depois o ciclo VIRA.

      b) Ofensiva TRIMESTRAL — cumulativa em ciclo de 90 dias.
         Marcos: 30, 60, 90 (sobrepõe o trintenário do mensal).

      c) Ofensiva RÁPIDA — streak CONSECUTIVO (quebra se pular 1 dia).
         Marcos: 3, 7 dias seguidos. Reseta a cada quebra. Dopamina rápida.

   2) Missões — eventos que avançam progresso baseado em ações da aluna:
      - 'caderno_escrita'    → aluna escreveu no Caderno
      - 'tesouro_resgatado'  → aluna abriu o Baú
      - 'video_assistido'    → aluna viu vídeo do feed (a integrar)
      - 'produto_comprado'   → webhook Kiwify (a integrar)
      - 'teste_concluido'    → aluna terminou o Teste do Subconsciente

      Missões podem ser:
      - 'diaria_relampago' — expira no fim do dia (volta no dia seguinte)
      - 'jornada'          — vigente enquanto a aluna está na jornada
      - 'evento'           — campanha temporária com inicia_em/expira_em

   3) Ranking mensal — fechado por job no dia 1 do mês. Top X recebem
      prêmio extra via UNIQUE idempotente em gam_premios_recebidos.

   ── Idempotência ──
   Tudo passa por UNIQUE(usuario_id, tipo, marco, ciclo_id) em
   gam_premios_recebidos. Reexecução não duplica crédito.

   ── Como integrar nas rotas ──

   // No /api/app/contexto (toda vez que aluna abre o app):
   const { registrarLogin } = require('../core/gamificacao');
   const resultadoLogin = await registrarLogin(usuarioId);
   // resultadoLogin = { primeiraVisitaDoDia, premios: [...] }

   // No POST /api/app/caderno/escritas (quando aluna salva escrita):
   const { progressoEvento } = require('../core/gamificacao');
   await progressoEvento(usuarioId, 'caderno_escrita');
   === */

const { poolCore, poolTeste, poolComunicacao } = require('../db');
const { creditarSementes } = require('./sementes');
const { calcularJornadaVigente } = require('./jornadas');

// ── HELPER — DESCOBRIR JORNADA VIGENTE DA ALUNA ────────────

/**
 * Resolve a jornada vigente da aluna a partir do teste mais recente.
 * Retorna o slug da jornada (ou null se não tem teste concluído).
 * Wrapper defensivo — engole erros e devolve null em vez de quebrar
 * a missão. Usado só pra filtrar missões por jornada.
 */
async function resolverJornadaSlug(usuario_id) {
  try {
    // Pega telefone canônico pra cruzar com teste (que pode ter lead antigo)
    const u = await poolCore.query(
      `SELECT telefone FROM usuarios WHERE id = $1`,
      [usuario_id]
    );
    if (!u.rows[0]) return null;
    const tel = u.rows[0].telefone;

    // Teste concluído mais recente
    const tR = await poolTeste.query(
      `SELECT perfil_dominante, percentuais, nivel_prosperidade
         FROM testes
        WHERE (usuario_id = $1 OR telefone_canonico = $2)
        ORDER BY feito_em DESC
        LIMIT 1`,
      [usuario_id, tel]
    );
    if (!tR.rows[0]) return null;
    const t = tR.rows[0];

    // Produtos comprados (pra `calcularJornadaVigente` decidir avanços)
    const pR = await poolCore.query(
      `SELECT p.slug FROM usuario_produtos up
       LEFT JOIN produtos p ON p.id = up.produto_id
       WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2) AND up.ativo = true`,
      [usuario_id, tel]
    );
    const slugsComprados = new Set(pR.rows.map(r => r.slug).filter(Boolean));

    const j = calcularJornadaVigente({
      perfil_dominante: t.perfil_dominante,
      perfil_dominante_bruto: (t.perfil_dominante || '').replace(/_nv\d$/, ''),
      percentuais_exibicao: t.percentuais || {},
      nivel_prosperidade: t.nivel_prosperidade || 0,
      slugsComprados,
    });
    return j?.slug || null;
  } catch (_) {
    return null;
  }
}

// ── HELPERS DE DATA ────────────────────────────────────────

/** Retorna string YYYY-MM-DD da data (UTC pra evitar timezone bug). */
function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Retorna YYYY-MM (mês ISO). */
function isoMonth(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

/** Diferença em dias entre duas datas YYYY-MM-DD (b - a). */
function diasEntre(a, b) {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86400000);
}

/** Soma N dias a uma data YYYY-MM-DD. */
function somarDias(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// ── CONFIG DE PRÊMIOS ──────────────────────────────────────

/**
 * Busca config de prêmio (tipo + marco) em gam_premios_config.
 * Retorna null se não estiver ativo ou não existir.
 */
async function lerConfigPremio(tipo, marco) {
  const r = await poolComunicacao.query(
    `SELECT sementes, rotulo, descricao
       FROM gam_premios_config
      WHERE tipo = $1 AND marco = $2 AND ativo = TRUE
      LIMIT 1`,
    [tipo, marco]
  );
  return r.rows[0] || null;
}

// ── CONCEDER PRÊMIO (com idempotência) ──────────────────────

/**
 * Concede um prêmio. Idempotente: se já recebeu (mesma chave), não credita
 * de novo. Roda dentro da própria transação (abre e fecha aqui).
 *
 * @returns { creditado: bool, sementes, rotulo, ja_recebido }
 */
async function concederPremio({ usuario_id, tipo, marco, ciclo_id, motivo }) {
  const config = await lerConfigPremio(tipo, marco);
  if (!config) return { creditado: false, motivo: 'sem_config' };

  const sementes = Number(config.sementes) || 0;
  if (sementes <= 0) {
    // Marco sem semente ainda assim grava registro de "passagem" pro histórico,
    // mas sem creditar. Útil pra marcos editoriais sem dinheiro.
    try {
      await poolCore.query(
        `INSERT INTO gam_premios_recebidos
           (usuario_id, tipo, marco, ciclo_id, sementes_creditadas)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (usuario_id, tipo, marco, ciclo_id) DO NOTHING`,
        [usuario_id, tipo, marco, ciclo_id]
      );
    } catch (_) {}
    return { creditado: false, sementes: 0, rotulo: config.rotulo };
  }

  const client = await poolCore.connect();
  try {
    await client.query('BEGIN');

    // INSERT idempotente — se já recebeu, não credita
    const ins = await client.query(
      `INSERT INTO gam_premios_recebidos
         (usuario_id, tipo, marco, ciclo_id, sementes_creditadas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id, tipo, marco, ciclo_id) DO NOTHING
       RETURNING id`,
      [usuario_id, tipo, marco, ciclo_id, sementes]
    );

    if (!ins.rows[0]) {
      await client.query('COMMIT');
      return { creditado: false, ja_recebido: true, sementes, rotulo: config.rotulo };
    }

    const premioId = ins.rows[0].id;

    const { movimentacao_id, saldo_atual } = await creditarSementes({
      client,
      usuario_id,
      delta: sementes,
      motivo: motivo || mapearMotivoSemente(tipo),
      origem_tipo: `gam_${tipo}`,
      origem_id: premioId,
    });

    await client.query(
      `UPDATE gam_premios_recebidos SET movimentacao_id = $1 WHERE id = $2`,
      [movimentacao_id, premioId]
    );

    await client.query('COMMIT');
    return {
      creditado: true,
      sementes,
      rotulo: config.rotulo,
      descricao: config.descricao,
      saldo_atual,
      premio_id: premioId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[gamificacao.concederPremio] erro:', err.message);
    return { creditado: false, erro: err.message };
  } finally {
    client.release();
  }
}

/**
 * Mapeia o tipo de prêmio pro motivo de semente correto (MOTIVOS_VALIDOS).
 */
function mapearMotivoSemente(tipo) {
  switch (tipo) {
    case 'streak_30':
    case 'streak_90':
      return 'streak_login';
    case 'rapida':
      return 'ofensiva_rapida';
    case 'ciclo_fechado':
      return 'ciclo_fechado';
    case 'ranking_mensal':
      return 'ranking_mensal';
    case 'missao_diaria':
      return 'missao_diaria';
    case 'missao_jornada':
      return 'missao_jornada';
    default:
      return 'bonus_evento';
  }
}

// ── REGISTRAR LOGIN DA ALUNA ───────────────────────────────

/**
 * Registra que a aluna esteve ativa hoje. Atualiza streaks e concede
 * prêmios elegíveis. Chamar a cada GET /api/app/contexto.
 *
 * @returns {Object} { primeira_visita_do_dia, premios: [...] }
 */
async function registrarLogin(usuario_id) {
  if (!usuario_id) return { primeira_visita_do_dia: false, premios: [] };

  const hoje = isoDate();
  const premios = [];

  try {
    // 1) Marca o dia (idempotente — UNIQUE PK em usuario+dia)
    const r = await poolCore.query(
      `INSERT INTO gam_login_diario (usuario_id, dia)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING dia`,
      [usuario_id, hoje]
    );
    const primeiraVisita = r.rowCount > 0;

    if (!primeiraVisita) {
      return { primeira_visita_do_dia: false, premios: [] };
    }

    // 2) Atualiza streaks e identifica marcos atingidos
    const statusAntes = await lerStreak(usuario_id);
    const statusDepois = await avancarStreaks(usuario_id, hoje, statusAntes);

    // 3) Concede prêmios de cada streak que avançou
    // Mensal (1..30) — credita 1 vez por dia do ciclo + bônus em 7/15/30
    if (statusDepois.ciclo_30_logins !== statusAntes.ciclo_30_logins) {
      const dia = statusDepois.ciclo_30_logins;
      const marco = `dia_${dia}`;
      const cicloId = `mensal_${statusDepois.ciclo_30_inicio}`;
      const p = await concederPremio({
        usuario_id, tipo: 'streak_30', marco, ciclo_id: cicloId,
      });
      if (p.creditado) premios.push({ ...p, tipo: 'streak_30', marco });

      // Marco de fim do ciclo (30 = ciclo fechado, bônus garantido)
      if (dia === 30) {
        const pf = await concederPremio({
          usuario_id, tipo: 'ciclo_fechado', marco: 'mensal',
          ciclo_id: cicloId, motivo: 'ciclo_fechado',
        });
        if (pf.creditado) premios.push({ ...pf, tipo: 'ciclo_fechado', marco: 'mensal' });
      }
    }

    // Trimestral
    if (statusDepois.ciclo_90_logins !== statusAntes.ciclo_90_logins) {
      const dia = statusDepois.ciclo_90_logins;
      // Só premia marcos 30/60/90 (os de baixo já saem pelo mensal)
      if (dia === 30 || dia === 60 || dia === 90) {
        const marco = `dia_${dia}`;
        const cicloId = `trimestral_${statusDepois.ciclo_90_inicio}`;
        const p = await concederPremio({
          usuario_id, tipo: 'streak_90', marco, ciclo_id: cicloId,
        });
        if (p.creditado) premios.push({ ...p, tipo: 'streak_90', marco });
      }
    }

    // Rápida (consecutiva)
    if (statusDepois.rapida_atual !== statusAntes.rapida_atual && statusDepois.rapida_atual > 0) {
      const dia = statusDepois.rapida_atual;
      if (dia === 3 || dia === 7) {
        const marco = `consecutivo_${dia}`;
        // Ciclo da rápida: marca o início da sequência atual
        const inicioRapida = somarDias(hoje, -(dia - 1));
        const cicloId = `rapida_${inicioRapida}`;
        const p = await concederPremio({
          usuario_id, tipo: 'rapida', marco, ciclo_id: cicloId,
        });
        if (p.creditado) premios.push({ ...p, tipo: 'rapida', marco });
      }
    }

    return {
      primeira_visita_do_dia: true,
      premios,
      streak: statusDepois,
    };
  } catch (err) {
    console.error('[gamificacao.registrarLogin] erro:', err.message);
    return { primeira_visita_do_dia: false, premios: [], erro: err.message };
  }
}

/**
 * Lê estado atual dos streaks. Cria linha se não existe.
 */
async function lerStreak(usuario_id) {
  const r = await poolCore.query(
    `INSERT INTO gam_streak_aluna (usuario_id)
     VALUES ($1)
     ON CONFLICT (usuario_id) DO NOTHING
     RETURNING *`,
    [usuario_id]
  );
  if (r.rows[0]) return r.rows[0];
  const sel = await poolCore.query(
    `SELECT * FROM gam_streak_aluna WHERE usuario_id = $1`,
    [usuario_id]
  );
  return sel.rows[0];
}

/**
 * Avança ciclos mensal, trimestral e rápida. Retorna estado pós-update.
 * Implementa toda a lógica:
 *  - Mensal/trimestral: vira automaticamente quando passa 30/90 dias do início,
 *    OU quando atinge 30/90 logins no ciclo.
 *  - Rápida: incrementa se hoje = ontem+1, reseta pra 1 se pulou dia.
 */
async function avancarStreaks(usuario_id, hoje, estadoAntes) {
  const e = { ...estadoAntes };

  // ── MENSAL (30 dias) ──
  if (!e.ciclo_30_inicio) {
    e.ciclo_30_inicio = hoje;
    e.ciclo_30_logins = 1;
  } else {
    const diasDesdeInicio = diasEntre(e.ciclo_30_inicio, hoje);
    if (diasDesdeInicio >= 30 || e.ciclo_30_logins >= 30) {
      // Ciclo virou
      e.ciclo_30_inicio = hoje;
      e.ciclo_30_logins = 1;
    } else {
      e.ciclo_30_logins = (e.ciclo_30_logins || 0) + 1;
    }
  }
  e.ciclo_30_ultimo_dia = hoje;
  if (e.ciclo_30_logins > (e.recorde_30 || 0)) {
    e.recorde_30 = e.ciclo_30_logins;
  }

  // ── TRIMESTRAL (90 dias) ──
  if (!e.ciclo_90_inicio) {
    e.ciclo_90_inicio = hoje;
    e.ciclo_90_logins = 1;
  } else {
    const diasDesdeInicio = diasEntre(e.ciclo_90_inicio, hoje);
    if (diasDesdeInicio >= 90 || e.ciclo_90_logins >= 90) {
      e.ciclo_90_inicio = hoje;
      e.ciclo_90_logins = 1;
    } else {
      e.ciclo_90_logins = (e.ciclo_90_logins || 0) + 1;
    }
  }
  if (e.ciclo_90_logins > (e.recorde_90 || 0)) {
    e.recorde_90 = e.ciclo_90_logins;
  }

  // ── RÁPIDA (consecutiva) ──
  if (!e.rapida_ultimo_dia) {
    e.rapida_atual = 1;
  } else {
    const diff = diasEntre(e.rapida_ultimo_dia, hoje);
    if (diff === 1) {
      e.rapida_atual = (e.rapida_atual || 0) + 1;
    } else if (diff > 1) {
      // Quebrou — reseta pra 1
      e.rapida_atual = 1;
    }
    // diff === 0 não deve acontecer (já tratamos primeira_visita_do_dia)
  }
  e.rapida_ultimo_dia = hoje;
  if (e.rapida_atual > (e.recorde_rapida || 0)) {
    e.recorde_rapida = e.rapida_atual;
  }

  // Persiste
  await poolCore.query(
    `UPDATE gam_streak_aluna SET
        ciclo_30_inicio = $2,
        ciclo_30_logins = $3,
        ciclo_30_ultimo_dia = $4,
        ciclo_90_inicio = $5,
        ciclo_90_logins = $6,
        rapida_atual = $7,
        rapida_ultimo_dia = $8,
        recorde_30 = $9,
        recorde_90 = $10,
        recorde_rapida = $11,
        atualizado_em = NOW()
      WHERE usuario_id = $1`,
    [
      usuario_id,
      e.ciclo_30_inicio, e.ciclo_30_logins, e.ciclo_30_ultimo_dia,
      e.ciclo_90_inicio, e.ciclo_90_logins,
      e.rapida_atual, e.rapida_ultimo_dia,
      e.recorde_30, e.recorde_90, e.recorde_rapida,
    ]
  );

  return e;
}

// ── MISSÕES ────────────────────────────────────────────────

/**
 * Avança progresso de missões elegíveis pra um evento da aluna.
 * Ex: aluna escreveu no caderno → progressoEvento(id, 'caderno_escrita')
 *
 * Busca todas as missões ATIVAS cujo alvo_tipo bate, filtra por jornada
 * (NULL = qualquer, ou a jornada vigente), e incrementa progresso. Se
 * progresso >= alvo_qtd, marca completada e credita semente (idempotente).
 *
 * @param {string} usuario_id
 * @param {string} alvo_tipo - ex: 'caderno_escrita'
 * @param {Object} [contexto] - dados extras pra filtros futuros
 * @returns {Array} missões completadas nesta chamada
 */
async function progressoEvento(usuario_id, alvo_tipo, contexto = {}) {
  if (!usuario_id || !alvo_tipo) return [];

  try {
    const jornadaSlug = await resolverJornadaSlug(usuario_id);

    // Busca missões ativas que batem com o evento + jornada
    const missoesR = await poolComunicacao.query(
      `SELECT id, slug, titulo, alvo_qtd, sementes, tipo, expira_em
         FROM gam_missoes
        WHERE ativa = TRUE
          AND alvo_tipo = $1
          AND (jornada_slug IS NULL OR jornada_slug = $2)
          AND (inicia_em IS NULL OR inicia_em <= NOW())
          AND (expira_em IS NULL OR expira_em > NOW())`,
      [alvo_tipo, jornadaSlug]
    );

    const completadas = [];
    for (const m of missoesR.rows) {
      const r = await avancarMissao(usuario_id, m);
      if (r?.completada_agora) completadas.push(r);
    }
    return completadas;
  } catch (err) {
    console.error('[gamificacao.progressoEvento] erro:', err.message);
    return [];
  }
}

/**
 * Avança 1 missão pra 1 aluna. Idempotente:
 * - Se já completada: não faz nada.
 * - Senão: UPSERT progresso. Se atingiu alvo, marca completada + credita.
 */
async function avancarMissao(usuario_id, missao) {
  const client = await poolCore.connect();
  try {
    await client.query('BEGIN');

    // UPSERT progresso
    const up = await client.query(
      `INSERT INTO gam_missao_progresso
         (usuario_id, missao_id, progresso, alvo)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (usuario_id, missao_id) DO UPDATE
         SET progresso = LEAST(gam_missao_progresso.progresso + 1, gam_missao_progresso.alvo)
       RETURNING id, progresso, alvo, completada_em`,
      [usuario_id, missao.id, missao.alvo_qtd || 1]
    );

    const prog = up.rows[0];

    // Já estava completada — não faz nada
    if (prog.completada_em) {
      await client.query('COMMIT');
      return null;
    }

    // Não atingiu alvo ainda
    if (prog.progresso < prog.alvo) {
      await client.query('COMMIT');
      return { progresso: prog.progresso, alvo: prog.alvo, completada_agora: false };
    }

    // Atingiu alvo — completa e credita
    const sementes = Number(missao.sementes) || 0;
    let movimentacao_id = null;

    if (sementes > 0) {
      const motivo = missao.tipo === 'diaria_relampago' ? 'missao_diaria' : 'missao_jornada';
      const cred = await creditarSementes({
        client,
        usuario_id,
        delta: sementes,
        motivo,
        origem_tipo: `missao_${missao.tipo}`,
        origem_id: missao.id,
      });
      movimentacao_id = cred.movimentacao_id;
    }

    await client.query(
      `UPDATE gam_missao_progresso
          SET completada_em = NOW(),
              sementes_creditadas = $2,
              movimentacao_id = $3
        WHERE id = $1`,
      [prog.id, sementes, movimentacao_id]
    );

    await client.query('COMMIT');
    return {
      completada_agora: true,
      missao_id: missao.id,
      slug: missao.slug,
      titulo: missao.titulo,
      sementes,
      tipo: missao.tipo,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[gamificacao.avancarMissao] erro:', err.message);
    return null;
  } finally {
    client.release();
  }
}

// ── LEITURA — INDICADORES PRO /contexto ────────────────────

/**
 * Versão leve dos dados de gamificação pra incluir no /api/app/contexto.
 * Não puxa lista de missões/prêmios — só números pra UI mostrar badges.
 */
async function lerIndicadoresGamificacao(usuario_id) {
  if (!usuario_id) return null;
  try {
    const s = await lerStreak(usuario_id);
    return {
      ciclo_30_logins: s.ciclo_30_logins || 0,
      ciclo_30_inicio: s.ciclo_30_inicio,
      ciclo_90_logins: s.ciclo_90_logins || 0,
      ciclo_90_inicio: s.ciclo_90_inicio,
      rapida_atual: s.rapida_atual || 0,
      recorde_30: s.recorde_30 || 0,
      recorde_90: s.recorde_90 || 0,
      recorde_rapida: s.recorde_rapida || 0,
    };
  } catch (err) {
    console.error('[gamificacao.lerIndicadoresGamificacao] erro:', err.message);
    return null;
  }
}

// ── RANKING MENSAL (cálculo + fechamento) ──────────────────

/**
 * Calcula ranking do mês corrente (preview, sem fechar).
 * Pontos = soma de logins do mês + (futuro: missões completadas no mês).
 *
 * @param {string} [ano_mes] - 'YYYY-MM' (default: mês corrente)
 * @param {number} [topN] - quantos primeiros (default 10)
 */
async function calcularRankingMensalPreview(ano_mes, topN = 10) {
  const mes = ano_mes || isoMonth();
  const inicio = `${mes}-01`;
  const inicioProximo = somarDias(inicio, 31).slice(0, 7) + '-01';

  const r = await poolCore.query(
    `SELECT usuario_id, COUNT(*)::int AS pontos
       FROM gam_login_diario
      WHERE dia >= $1 AND dia < $2
      GROUP BY usuario_id
      ORDER BY pontos DESC, usuario_id ASC
      LIMIT $3`,
    [inicio, inicioProximo, topN]
  );
  return r.rows.map((row, i) => ({
    posicao: i + 1,
    usuario_id: row.usuario_id,
    pontos: row.pontos,
  }));
}

/**
 * Fecha o ranking de um mês: grava snapshot em gam_ranking_mensal e
 * concede prêmios pros top X via concederPremio (idempotente).
 * Roda 1x por mês (job/cron — a integrar). Idempotente: se já fechou, retorna o existente.
 *
 * Marcos de prêmio (config em gam_premios_config):
 *  - tipo='ranking_mensal', marco='top_1'      → top 1
 *  - tipo='ranking_mensal', marco='top_2_3'    → top 2 e 3
 *  - tipo='ranking_mensal', marco='top_4_10'   → top 4 a 10
 */
async function fecharRankingMensal(ano_mes) {
  const mes = ano_mes || isoMonth();
  const existente = await poolCore.query(
    `SELECT COUNT(*)::int AS qt FROM gam_ranking_mensal WHERE ano_mes = $1`,
    [mes]
  );
  if (existente.rows[0].qt > 0) {
    return { ja_fechado: true };
  }

  const ranking = await calcularRankingMensalPreview(mes, 10);
  if (ranking.length === 0) return { vazio: true };

  // Insere snapshot
  for (const r of ranking) {
    await poolCore.query(
      `INSERT INTO gam_ranking_mensal (ano_mes, posicao, usuario_id, pontos, fechado_em)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (ano_mes, posicao) DO NOTHING`,
      [mes, r.posicao, r.usuario_id, r.pontos]
    );
  }

  // Concede prêmios
  const cicloId = `ranking_${mes}`;
  const concedidos = [];
  for (const r of ranking) {
    let marco;
    if (r.posicao === 1) marco = 'top_1';
    else if (r.posicao <= 3) marco = 'top_2_3';
    else if (r.posicao <= 10) marco = 'top_4_10';
    else continue;

    const p = await concederPremio({
      usuario_id: r.usuario_id,
      tipo: 'ranking_mensal',
      marco,
      ciclo_id: cicloId,
      motivo: 'ranking_mensal',
    });
    if (p.creditado) {
      await poolCore.query(
        `UPDATE gam_ranking_mensal SET premiado = TRUE
          WHERE ano_mes = $1 AND posicao = $2`,
        [mes, r.posicao]
      );
      concedidos.push({ posicao: r.posicao, usuario_id: r.usuario_id, ...p });
    }
  }

  return { fechado: true, ano_mes: mes, ranking, premios_concedidos: concedidos };
}

module.exports = {
  // Login + streaks
  registrarLogin,
  lerStreak,
  lerIndicadoresGamificacao,
  // Missões
  progressoEvento,
  // Prêmios (admin pode chamar manual)
  concederPremio,
  lerConfigPremio,
  // Ranking
  calcularRankingMensalPreview,
  fecharRankingMensal,
  // Helpers
  isoDate,
  isoMonth,
};
