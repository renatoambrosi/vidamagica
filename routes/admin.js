/* ============================================================
   VIDA MÁGICA — routes/admin.js
   Endpoints do painel /admin (Gateway, Templates, Usuários).
   Todos protegidos por autenticarPainel com escopo='admin'.

   Bancos:
   - poolComunicacao: gateway_config, gateway_categorias,
                      templates_mensagens, fila_mensagens,
                      historico_mensagens
   - poolCore:        usuarios, telefones_historicos, sessoes,
                      dispositivos
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolCore, poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');
const {
  invalidarConfigCache, invalidarCategoriasCache,
} = require('../core/gateway');
const {
  arquivarUsuario, desarquivarUsuario, apagarUsuarioPermanente,
  trocarTelefonePrincipal, marcarComoAtiva,
  criarMagicToken,
  normalizarCpf, validarCpf, verificarDuplicidade,
  listarEnderecos, criarEndereco, atualizarEndereco, deletarEndereco,
} = require('../core/usuarios');
const { enfileirarAtendimento } = require('../core/gateway');
const { formatarTelefone } = require('../core/utils');

// ── Middleware: só admin pode usar tudo aqui (escopo='admin')
router.use(autenticarPainel('admin'));

// ════════════════════════════════════════════════════════════
// 1. GATEWAY — STATUS GERAL (config + contadores + categorias + fila)
// ════════════════════════════════════════════════════════════

router.get('/gateway/status', async (req, res) => {
  try {
    // 1. Config
    const cfgRows = await poolComunicacao.query(`SELECT chave, valor FROM gateway_config`);
    const config = {};
    for (const r of cfgRows.rows) config[r.chave] = r.valor;

    // 2. Categorias
    const catRows = await poolComunicacao.query(
      `SELECT chave, nome_exibicao, emoji, pausado, ordem
         FROM gateway_categorias ORDER BY ordem ASC`
    );

    // 3. Contadores do dia (timezone São Paulo)
    const histRows = await poolComunicacao.query(
      `SELECT
          COUNT(*) FILTER (WHERE sucesso=TRUE
            AND origem NOT LIKE 'auth-%'
            AND origem NOT LIKE 'painel-%'
            AND origem NOT LIKE 'reset-%'
          )::int AS ativas_hoje,
          COUNT(*) FILTER (WHERE sucesso=TRUE
            AND (origem LIKE 'auth-%' OR origem LIKE 'painel-%' OR origem LIKE 'reset-%')
          )::int AS reativas_hoje,
          COUNT(*) FILTER (WHERE sucesso=FALSE)::int AS erros_hoje
        FROM historico_mensagens
       WHERE enviado_em >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')`
    );
    const contador = histRows.rows[0] || { ativas_hoje: 0, reativas_hoje: 0, erros_hoje: 0 };

    // 4. Fila atual (atendimentos pendentes/processando agrupados)
    const filaRows = await poolComunicacao.query(
      `SELECT
          atendimento_id,
          MAX(telefone)               AS telefone,
          MAX(nome)                   AS nome,
          MAX(categoria)              AS categoria,
          MAX(tipo)                   AS tipo,
          MAX(prioridade)             AS prioridade,
          MAX(origem)                 AS origem,
          COUNT(*)::int               AS total_msgs,
          COUNT(*) FILTER (WHERE status='pendente')::int  AS pendentes,
          COUNT(*) FILTER (WHERE status='enviando')::int  AS enviando,
          COUNT(*) FILTER (WHERE status='enviado')::int   AS enviadas,
          COUNT(*) FILTER (WHERE status='erro')::int      AS com_erro,
          MIN(entrou_em)              AS entrou_em,
          MAX(erro)                   AS ultimo_erro
        FROM fila_mensagens
       WHERE atendimento_id IS NOT NULL
         AND (status IN ('pendente','enviando','erro') OR enviado_em > NOW() - INTERVAL '5 minutes')
    GROUP BY atendimento_id
    ORDER BY
      CASE
        WHEN MAX(status::text) IN ('enviando') THEN 0
        WHEN MAX(status::text) IN ('pendente') THEN 1
        WHEN MAX(status::text) IN ('erro')     THEN 2
        ELSE 3
      END,
      MAX(prioridade) ASC,
      MIN(entrou_em) ASC
       LIMIT 50`
    );

    res.json({
      config: {
        cooldown_entre_msgs_atendimento: parseInt(config.cooldown_entre_msgs_atendimento || '2', 10),
        cooldown_atendimentos_reativos:  parseInt(config.cooldown_atendimentos_reativos  || '5', 10),
        cooldown_atendimentos_ativos:    parseInt(config.cooldown_atendimentos_ativos   || '60', 10),
        limite_msgs_dia_ativas:          parseInt(config.limite_msgs_dia_ativas        || '200', 10),
        pausado_geral:                   (config.pausado_geral || 'false') === 'true',
      },
      contador,
      categorias: catRows.rows,
      fila: filaRows.rows,
    });
  } catch (err) {
    console.error('❌ /gateway/status:', err.message);
    res.status(500).json({ error: 'Erro ao buscar status' });
  }
});

// ════════════════════════════════════════════════════════════
// 2. GATEWAY — SALVAR CONFIG (cooldowns, limite, pausa)
// ════════════════════════════════════════════════════════════

router.put('/gateway/config', async (req, res) => {
  try {
    const {
      cooldown_entre_msgs_atendimento,
      cooldown_atendimentos_reativos,
      cooldown_atendimentos_ativos,
      limite_msgs_dia_ativas,
      pausado_geral,
    } = req.body;

    // Validações leves
    const num = (v, min, max, def) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < min || n > max) return def;
      return n;
    };

    const updates = [
      ['cooldown_entre_msgs_atendimento', String(num(cooldown_entre_msgs_atendimento, 0, 60, 2))],
      ['cooldown_atendimentos_reativos',  String(num(cooldown_atendimentos_reativos, 0, 600, 5))],
      ['cooldown_atendimentos_ativos',    String(num(cooldown_atendimentos_ativos,   0, 3600, 60))],
      ['limite_msgs_dia_ativas',          String(num(limite_msgs_dia_ativas,        1, 10000, 200))],
      ['pausado_geral',                   pausado_geral === true || pausado_geral === 'true' ? 'true' : 'false'],
    ];

    for (const [chave, valor] of updates) {
      await poolComunicacao.query(
        `INSERT INTO gateway_config (chave, valor, atualizado_em)
         VALUES ($1, $2, NOW())
         ON CONFLICT (chave) DO UPDATE SET valor=$2, atualizado_em=NOW()`,
        [chave, valor]
      );
    }

    invalidarConfigCache();
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /gateway/config:', err.message);
    res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ════════════════════════════════════════════════════════════
// 3. GATEWAY — PAUSAR/ATIVAR CATEGORIA
// ════════════════════════════════════════════════════════════

router.put('/gateway/categoria/:chave', async (req, res) => {
  try {
    const { chave } = req.params;
    const { pausado } = req.body;
    const r = await poolComunicacao.query(
      `UPDATE gateway_categorias SET pausado=$1, atualizado_em=NOW()
        WHERE chave=$2 RETURNING *`,
      [pausado === true || pausado === 'true', chave]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Categoria não encontrada' });
    invalidarCategoriasCache();
    res.json({ success: true, categoria: r.rows[0] });
  } catch (err) {
    console.error('❌ /gateway/categoria:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

// ════════════════════════════════════════════════════════════
// 4. GATEWAY — CANCELAR ATENDIMENTO PENDENTE
// ════════════════════════════════════════════════════════════

router.post('/gateway/fila/:atendimento_id/cancelar', async (req, res) => {
  try {
    const { atendimento_id } = req.params;
    const r = await poolComunicacao.query(
      `UPDATE fila_mensagens SET status='cancelado', erro='cancelado pelo admin'
        WHERE atendimento_id=$1 AND status='pendente'
        RETURNING id`,
      [atendimento_id]
    );
    res.json({ success: true, canceladas: r.rowCount });
  } catch (err) {
    console.error('❌ /gateway/cancelar:', err.message);
    res.status(500).json({ error: 'Erro ao cancelar' });
  }
});

// ════════════════════════════════════════════════════════════
// 5. TEMPLATES — LISTAR
// ════════════════════════════════════════════════════════════

router.get('/templates', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT chave, titulo, texto, categoria, ordem, atualizado_em
         FROM templates_mensagens
        ORDER BY
          CASE COALESCE(categoria,'outros')
            WHEN 'acesso'     THEN 1
            WHEN 'cobranca'   THEN 2
            WHEN 'pos_venda'  THEN 3
            WHEN 'convites'   THEN 4
            WHEN 'otp_painel' THEN 5
            ELSE 9
          END ASC,
          COALESCE(ordem, 99) ASC,
          chave ASC`
    );
    res.json({ templates: r.rows });
  } catch (err) {
    console.error('❌ /templates:', err.message);
    res.status(500).json({ error: 'Erro ao listar templates' });
  }
});

// ════════════════════════════════════════════════════════════
// 6. TEMPLATES — SALVAR (upsert)
// ════════════════════════════════════════════════════════════

router.put('/templates/:chave', async (req, res) => {
  try {
    const { chave } = req.params;
    const { texto, titulo } = req.body;
    if (!texto || typeof texto !== 'string') {
      return res.status(400).json({ error: 'Texto obrigatório' });
    }
    const r = await poolComunicacao.query(
      `UPDATE templates_mensagens
          SET texto=$1, titulo=COALESCE($2,titulo), atualizado_em=NOW()
        WHERE chave=$3
        RETURNING *`,
      [texto, titulo || null, chave]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Template não encontrado' });
    res.json({ success: true, template: r.rows[0] });
  } catch (err) {
    console.error('❌ /templates PUT:', err.message);
    res.status(500).json({ error: 'Erro ao salvar template' });
  }
});

// ════════════════════════════════════════════════════════════
// 7. USUÁRIOS — LISTAR (com busca)
// ════════════════════════════════════════════════════════════

router.get('/usuarios', async (req, res) => {
  try {
    const { q = '', limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const params = [];
    let where = `1=1`;
    if (q && q.trim()) {
      const termo = `%${q.trim().toLowerCase()}%`;
      params.push(termo);
      where = `(LOWER(nome) LIKE $1 OR LOWER(email) LIKE $1 OR telefone LIKE $1 OR telefone_formatado LIKE $1)`;
    }
    params.push(lim);
    const r = await poolCore.query(
      `SELECT id, nome, email, telefone, telefone_formatado,
              email_verificado, foto_url, origem_cadastro,
              cpf, data_nascimento,
              status, arquivada, arquivada_em, arquivada_por,
              telefone_validado_em,
              criado_em, atualizado_em
         FROM usuarios
        WHERE ${where}
     ORDER BY criado_em DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ usuarios: r.rows });
  } catch (err) {
    console.error('❌ /usuarios:', err.message);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// ════════════════════════════════════════════════════════════
// 8. USUÁRIOS — DETALHE (sessões, dispositivos, telefones)
// ════════════════════════════════════════════════════════════

router.get('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const u = await poolCore.query(
      `SELECT id, nome, email, telefone, telefone_formatado,
              email_verificado, foto_url, origem_cadastro,
              cpf, data_nascimento,
              status, arquivada, arquivada_em, arquivada_por, arquivada_motivo,
              telefone_validado_em, senha_hash IS NOT NULL AS tem_senha,
              criado_em, atualizado_em
         FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });

    const ses = await poolCore.query(
      `SELECT s.id, s.criado_em, s.expira_em, s.ip, s.user_agent,
              d.tipo AS dispositivo_tipo, d.nome_amigavel AS dispositivo_nome
         FROM sessoes s
    LEFT JOIN dispositivos d ON d.id = s.device_id
        WHERE s.usuario_id=$1 AND s.revogada=FALSE AND s.expira_em > NOW()
     ORDER BY s.criado_em DESC LIMIT 20`, [id]);

    const disps = await poolCore.query(
      `SELECT id, tipo, device_id, nome_amigavel, ativo,
              ultimo_acesso, ip_primeiro_acesso, criado_em
         FROM dispositivos
        WHERE usuario_id=$1
     ORDER BY ultimo_acesso DESC NULLS LAST LIMIT 20`, [id]);

    const tels = await poolCore.query(
      `SELECT id, telefone, telefone_formatado, origem, ativo,
              vinculado_em, desvinculado_em, observacao
         FROM telefones_historicos
        WHERE usuario_id=$1
     ORDER BY ativo DESC, vinculado_em DESC`, [id]);

    const enderecos = await listarEnderecos(id);

    res.json({
      usuario: u.rows[0],
      sessoes: ses.rows,
      dispositivos: disps.rows,
      telefones: tels.rows,
      enderecos,
    });
  } catch (err) {
    console.error('❌ /usuarios/:id:', err.message);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// ════════════════════════════════════════════════════════════
// 8.5. USUÁRIOS — EDITAR (nome, email, telefone, status, origem)
// Admin tem controle total — sem trava de duplicata, sem validação.
// Trocar telefone move o atual pra telefones_historicos.ativo=TRUE.
// ════════════════════════════════════════════════════════════

router.put('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, telefone, cpf, data_nascimento, status, origem_cadastro } = req.body || {};

    // Conferir que existe
    const u = await poolCore.query(`SELECT * FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });

    // ── Validar CPF (formato) ──
    let cpfNorm = undefined;
    if (typeof cpf === 'string') {
      if (!cpf.trim()) {
        cpfNorm = null;
      } else {
        cpfNorm = normalizarCpf(cpf);
        if (!validarCpf(cpfNorm)) {
          return res.status(400).json({ error: 'CPF inválido', code: 'CPF_INVALIDO' });
        }
      }
    }

    // ── Validar duplicidade (telefone, email, cpf) em OUTRAS contas ──
    const telCanonico = (typeof telefone === 'string' && telefone.trim())
      ? formatarTelefone(telefone) : null;
    const dup = await verificarDuplicidade({
      usuarioIdAtual: id,
      telefone: (telCanonico && telCanonico !== u.rows[0].telefone) ? telCanonico : null,
      email: typeof email === 'string' && email.trim() ? email.trim() : null,
      cpf: cpfNorm,
    });
    if (dup) {
      const labels = {
        telefone:           'Telefone já cadastrado em outra conta',
        telefone_historico: 'Telefone já vinculado ao histórico de outra conta',
        email:              'E-mail já cadastrado em outra conta',
        cpf:                'CPF já cadastrado em outra conta',
      };
      return res.status(409).json({
        error: labels[dup.campo] || 'Identificador já em uso',
        campo: dup.campo,
        conflito: dup.conflito,
        code: 'DUPLICATA',
      });
    }

    // ── Tudo validado: trocar telefone (se mudou) ──
    if (telCanonico && telCanonico !== u.rows[0].telefone) {
      await trocarTelefonePrincipal(id, telCanonico, telCanonico);
    }

    // ── Atualizar outros campos ──
    const sets = [];
    const params = [];
    if (typeof nome === 'string') {
      params.push(nome.trim() || null); sets.push(`nome=$${params.length}`);
    }
    if (typeof email === 'string') {
      params.push(email.trim().toLowerCase() || null); sets.push(`email=$${params.length}`);
    }
    if (cpfNorm !== undefined) {
      params.push(cpfNorm); sets.push(`cpf=$${params.length}`);
    }
    if (typeof data_nascimento === 'string') {
      params.push(data_nascimento.trim() || null); sets.push(`data_nascimento=$${params.length}`);
    }
    if (typeof status === 'string' && ['incompleta','ativa','arquivada'].includes(status)) {
      params.push(status); sets.push(`status=$${params.length}`);
      if (status === 'arquivada') sets.push(`arquivada=TRUE, arquivada_em=COALESCE(arquivada_em, NOW())`);
      if (status !== 'arquivada') sets.push(`arquivada=FALSE`);
      if (status === 'ativa') sets.push(`telefone_validado_em=COALESCE(telefone_validado_em, NOW())`);
    }
    if (typeof origem_cadastro === 'string') {
      params.push(origem_cadastro.trim() || null); sets.push(`origem_cadastro=$${params.length}`);
    }

    if (sets.length) {
      params.push(id);
      await poolCore.query(
        `UPDATE usuarios SET ${sets.join(', ')}, atualizado_em=NOW() WHERE id=$${params.length}`,
        params
      );
    }

    const r = await poolCore.query(
      `SELECT id, nome, email, telefone, telefone_formatado,
              email_verificado, foto_url, origem_cadastro,
              cpf, data_nascimento,
              status, arquivada, telefone_validado_em,
              criado_em, atualizado_em
         FROM usuarios WHERE id=$1`, [id]);
    res.json({ success: true, usuario: r.rows[0] });
  } catch (err) {
    console.error('❌ /usuarios/:id PUT:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// ════════════════════════════════════════════════════════════
// 8.6. USUÁRIOS — CRIAR (admin manual)
// Telefone obrigatório. Validação bloqueante de duplicata em
// telefone, email e CPF (em outras contas).
// Conta nasce 'incompleta' — vira 'ativa' quando aluna validar via magic.
// ════════════════════════════════════════════════════════════

router.post('/usuarios', async (req, res) => {
  try {
    const { telefone, nome, email, cpf, data_nascimento, origem_cadastro } = req.body || {};
    if (!telefone || !String(telefone).trim()) {
      return res.status(400).json({ error: 'Telefone é obrigatório' });
    }

    const tel = formatarTelefone(telefone);
    const emailNorm = (email||'').trim().toLowerCase() || null;

    // Validar CPF (formato) se foi passado
    let cpfNorm = null;
    if (cpf && String(cpf).trim()) {
      cpfNorm = normalizarCpf(cpf);
      if (!validarCpf(cpfNorm)) {
        return res.status(400).json({ error: 'CPF inválido', code: 'CPF_INVALIDO' });
      }
    }

    // Validar duplicidade
    const dup = await verificarDuplicidade({
      telefone: tel,
      email: emailNorm,
      cpf: cpfNorm,
    });
    if (dup) {
      const labels = {
        telefone:           'Telefone já cadastrado em outra conta',
        telefone_historico: 'Telefone já vinculado ao histórico de outra conta',
        email:              'E-mail já cadastrado em outra conta',
        cpf:                'CPF já cadastrado em outra conta',
      };
      return res.status(409).json({
        error: labels[dup.campo] || 'Identificador já em uso',
        campo: dup.campo,
        conflito: dup.conflito,
        code: 'DUPLICATA',
      });
    }

    const r = await poolCore.query(
      `INSERT INTO usuarios
        (telefone, telefone_formatado, nome, email, cpf, data_nascimento, origem_cadastro, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'incompleta')
       RETURNING id, nome, email, telefone, telefone_formatado, cpf, data_nascimento,
                 status, origem_cadastro, criado_em`,
      [tel, tel,
       (nome||'').trim() || null,
       emailNorm,
       cpfNorm,
       (data_nascimento||'').trim() || null,
       origem_cadastro || 'manual_admin']
    );
    res.json({ success: true, usuario: r.rows[0] });
  } catch (err) {
    console.error('❌ /usuarios POST:', err.message);
    // Backup: se algum índice único pegou no banco (race condition), retorna 409
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Identificador duplicado', code: 'DUPLICATA' });
    }
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// ════════════════════════════════════════════════════════════
// 8.7. USUÁRIOS — ENVIAR MAGIC LINK AGORA
// Gera magic_boas_vindas (10min) e enfileira no gateway.
// Quando aluna tocar, login-magic ativa a conta automaticamente.
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/enviar-magic', async (req, res) => {
  try {
    const { id } = req.params;
    const u = await poolCore.query(`SELECT id, nome, telefone_formatado, status FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (u.rows[0].status === 'arquivada') {
      return res.status(400).json({ error: 'Conta arquivada — desarquive primeiro' });
    }

    const tel = u.rows[0].telefone_formatado;
    const primeiroNome = (u.rows[0].nome || '').split(' ')[0] || '';

    const magicToken = await criarMagicToken(tel, 'magic_boas_vindas', 10);
    const APP_URL = process.env.APP_URL || 'https://www.vidamagica.com.br';
    const magicUrl = `${APP_URL}/auth?magic=${magicToken}`;

    await enfileirarAtendimento({
      telefone: tel,
      tipo: 'reativo',
      origem: 'admin-manual-magic',
      nome: primeiroNome,
      mensagens: [
        { template: 'magic_boas_vindas_msg1', variaveis: { nome: primeiroNome } },
        { texto: magicUrl },
      ],
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ /usuarios/:id/enviar-magic:', err.message);
    res.status(500).json({ error: 'Erro ao enviar magic link' });
  }
});

// ════════════════════════════════════════════════════════════
// 8.8. USUÁRIOS — RESETAR SENHA (limpa senha_hash)
// Próximo login só vai funcionar via magic link.
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/resetar-senha', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await poolCore.query(
      `UPDATE usuarios SET senha_hash=NULL, atualizado_em=NOW() WHERE id=$1 RETURNING id`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /usuarios/:id/resetar-senha:', err.message);
    res.status(500).json({ error: 'Erro ao resetar senha' });
  }
});

// ════════════════════════════════════════════════════════════
// 9. USUÁRIOS — REVOGAR TODAS AS SESSÕES (forçar logout)
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/logout-tudo', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await poolCore.query(
      `UPDATE sessoes SET revogada=TRUE
        WHERE usuario_id=$1 AND revogada=FALSE
       RETURNING id`, [id]);
    res.json({ success: true, sessoes_revogadas: r.rowCount });
  } catch (err) {
    console.error('❌ /usuarios/logout-tudo:', err.message);
    res.status(500).json({ error: 'Erro ao revogar sessões' });
  }
});

// ════════════════════════════════════════════════════════════
// 10. USUÁRIOS — DESVINCULAR TELEFONE HISTÓRICO
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/telefones/:telId/desvincular', async (req, res) => {
  try {
    const { id, telId } = req.params;
    const { observacao } = req.body;
    const r = await poolCore.query(
      `UPDATE telefones_historicos
          SET ativo=FALSE,
              desvinculado_em=NOW(),
              desvinculado_por=$1,
              observacao=COALESCE($2, observacao)
        WHERE id=$3 AND usuario_id=$4 AND ativo=TRUE
        RETURNING *`,
      [req.admin?.id || null, observacao || null, telId, id]
    );
    if (!r.rows.length) {
      return res.status(404).json({ error: 'Telefone não encontrado ou já inativo' });
    }
    res.json({ success: true, telefone: r.rows[0] });
  } catch (err) {
    console.error('❌ /telefones/desvincular:', err.message);
    res.status(500).json({ error: 'Erro ao desvincular' });
  }
});

// ════════════════════════════════════════════════════════════
// 11. USUÁRIOS — ARQUIVAR (soft delete, reversível)
// Marca arquivada=TRUE + revoga sessões. Dados permanecem.
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/arquivar', async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body || {};
    const u = await poolCore.query(`SELECT id, arquivada FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (u.rows[0].arquivada) return res.status(400).json({ error: 'Conta já está arquivada' });

    await arquivarUsuario(id, { por: 'admin', motivo: motivo || null });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /usuarios/arquivar:', err.message);
    res.status(500).json({ error: 'Erro ao arquivar' });
  }
});

// ════════════════════════════════════════════════════════════
// 12. USUÁRIOS — DESARQUIVAR
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/desarquivar', async (req, res) => {
  try {
    const { id } = req.params;
    const u = await poolCore.query(`SELECT id, arquivada FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!u.rows[0].arquivada) return res.status(400).json({ error: 'Conta já está ativa' });

    await desarquivarUsuario(id);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /usuarios/desarquivar:', err.message);
    res.status(500).json({ error: 'Erro ao desarquivar' });
  }
});

// ════════════════════════════════════════════════════════════
// 13. USUÁRIOS — APAGAR PERMANENTEMENTE (DELETE em cascata)
// Operação irreversível. Cabe ao frontend confirmar 2x antes.
// ════════════════════════════════════════════════════════════

router.delete('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const u = await poolCore.query(`SELECT id, nome, telefone FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });

    const apagado = await apagarUsuarioPermanente(id);
    if (!apagado) return res.status(500).json({ error: 'Falha ao apagar' });

    console.warn(`⚠️ [admin] CONTA APAGADA PERMANENTEMENTE: ${u.rows[0].nome || '(sem nome)'} / ${u.rows[0].telefone}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /usuarios DELETE:', err.message);
    res.status(500).json({ error: 'Erro ao apagar' });
  }
});

// ════════════════════════════════════════════════════════════
// 14. USUÁRIOS — ENDEREÇOS (CRUD)
// 1 aluna pode ter VÁRIOS endereços. Sem validação de duplicata.
// ════════════════════════════════════════════════════════════

router.post('/usuarios/:id/enderecos', async (req, res) => {
  try {
    const { id } = req.params;
    const u = await poolCore.query(`SELECT id FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    const endereco = await criarEndereco(id, req.body || {});
    res.json({ success: true, endereco });
  } catch (err) {
    console.error('❌ /enderecos POST:', err.message);
    res.status(500).json({ error: 'Erro ao criar endereço' });
  }
});

router.put('/usuarios/:id/enderecos/:enderecoId', async (req, res) => {
  try {
    const { id, enderecoId } = req.params;
    const endereco = await atualizarEndereco(parseInt(enderecoId, 10), id, req.body || {});
    if (!endereco) return res.status(404).json({ error: 'Endereço não encontrado' });
    res.json({ success: true, endereco });
  } catch (err) {
    console.error('❌ /enderecos PUT:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar endereço' });
  }
});

router.delete('/usuarios/:id/enderecos/:enderecoId', async (req, res) => {
  try {
    const { id, enderecoId } = req.params;
    const ok = await deletarEndereco(parseInt(enderecoId, 10), id);
    if (!ok) return res.status(404).json({ error: 'Endereço não encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /enderecos DELETE:', err.message);
    res.status(500).json({ error: 'Erro ao deletar endereço' });
  }
});

module.exports = router;
