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

    res.json({
      usuario: u.rows[0],
      sessoes: ses.rows,
      dispositivos: disps.rows,
      telefones: tels.rows,
    });
  } catch (err) {
    console.error('❌ /usuarios/:id:', err.message);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// ════════════════════════════════════════════════════════════
// 8.5. USUÁRIOS — EDITAR (nome e email)
// Telefone não entra aqui — aluna troca pelo app dela.
// Email é UNIQUE em outras contas: bloqueia se duplicado.
// ════════════════════════════════════════════════════════════

router.put('/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email } = req.body || {};

    // Aceita "limpar" um campo passando string vazia → vira null
    const nomeNorm  = typeof nome  === 'string' ? (nome.trim()  || null) : undefined;
    const emailNorm = typeof email === 'string' ? (email.trim().toLowerCase() || null) : undefined;

    if (nomeNorm === undefined && emailNorm === undefined) {
      return res.status(400).json({ error: 'Nada pra atualizar' });
    }

    // Conferir que o usuário existe
    const u = await poolCore.query(`SELECT id, email FROM usuarios WHERE id=$1`, [id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Se está mudando email, checar duplicata em OUTRA conta
    if (emailNorm !== undefined && emailNorm) {
      const dup = await poolCore.query(
        `SELECT id FROM usuarios WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1`,
        [emailNorm, id]
      );
      if (dup.rows.length) {
        return res.status(409).json({ error: 'E-mail já cadastrado em outra conta' });
      }
    }

    // Monta UPDATE dinâmico só com os campos enviados
    const sets = [];
    const params = [];
    if (nomeNorm  !== undefined) { params.push(nomeNorm);  sets.push(`nome=$${params.length}`); }
    if (emailNorm !== undefined) { params.push(emailNorm); sets.push(`email=$${params.length}`); }
    params.push(id);

    const r = await poolCore.query(
      `UPDATE usuarios SET ${sets.join(', ')}, atualizado_em=NOW()
        WHERE id=$${params.length}
        RETURNING id, nome, email, telefone, telefone_formatado,
                  email_verificado, foto_url, origem_cadastro,
                  criado_em, atualizado_em`,
      params
    );
    res.json({ success: true, usuario: r.rows[0] });
  } catch (err) {
    console.error('❌ /usuarios/:id PUT:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
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

module.exports = router;
