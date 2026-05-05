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
const { poolCore, poolComunicacao, poolTeste } = require('../db');
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
const { PERFIS_VALIDOS, PERFIS_LABELS, PERFIS_CORES } = require('../core/teste-conteudo');

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

// ════════════════════════════════════════════════════════════
// TESTE DO SUBCONSCIENTE — gestão de versões
// Banco: poolTeste
// Endpoints (prefixo: /api/admin/teste):
//   GET    /teste/versoes              → lista versões
//   POST   /teste/versoes              → cria rascunho clonando ativa
//   GET    /teste/versoes/:id          → detalhes (perguntas + alternativas)
//   PUT    /teste/versoes/:id          → salva edições do rascunho
//   POST   /teste/versoes/:id/publicar → publica rascunho (atômico)
//   DELETE /teste/versoes/:id          → apaga rascunho
//
// Regras:
//   - só rascunhos podem ser editados ou apagados
//   - estrutura é fixa: 15 perguntas × 5 perfis (medo/desordem/sobrevivencia/validacao/prosperidade)
//   - perfil de cada alternativa é IMUTÁVEL — admin só edita texto
//   - publicar: arquiva ativa atual, promove rascunho, apaga teste_respostas órfãos
// ════════════════════════════════════════════════════════════

function _validarNomeVersao(nome) {
  if (!nome || typeof nome !== 'string') return null;
  const limpo = nome.trim();
  if (limpo.length < 1 || limpo.length > 50) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(limpo)) return null;
  return limpo;
}

// ── GET /teste/versoes ──────────────────────────────────────
router.get('/teste/versoes', async (req, res) => {
  try {
    const r = await poolTeste.query(
      `SELECT v.id, v.nome, v.status, v.criado_em, v.publicado_em, v.arquivado_em,
              (SELECT COUNT(*)::int FROM teste_perguntas p WHERE p.versao_id=v.id) AS qtd_perguntas,
              (SELECT COUNT(*)::int FROM testes t WHERE t.versao_id=v.id) AS qtd_testes
         FROM teste_versoes v
        ORDER BY
          CASE v.status WHEN 'rascunho' THEN 0 WHEN 'ativa' THEN 1 ELSE 2 END,
          v.criado_em DESC`
    );
    return res.json({ ok: true, versoes: r.rows });
  } catch (err) {
    console.error('[admin/teste/versoes] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /teste/versoes ─────────────────────────────────────
router.post('/teste/versoes', async (req, res) => {
  const c = await poolTeste.connect();
  try {
    const { nome } = req.body || {};
    const nomeLimpo = _validarNomeVersao(nome);
    if (!nomeLimpo) {
      return res.status(400).json({ ok: false, erro: 'Nome inválido (use letras, números, pontos, hífen ou underscore)' });
    }

    const dup = await c.query(`SELECT id FROM teste_versoes WHERE nome=$1`, [nomeLimpo]);
    if (dup.rows[0]) {
      return res.status(409).json({ ok: false, erro: 'Já existe uma versão com esse nome' });
    }

    const ativa = await c.query(`SELECT id FROM teste_versoes WHERE status='ativa' LIMIT 1`);
    if (!ativa.rows[0]) {
      return res.status(503).json({ ok: false, erro: 'Sem versão ativa para clonar' });
    }
    const ativaId = ativa.rows[0].id;

    await c.query('BEGIN');
    const nova = await c.query(
      `INSERT INTO teste_versoes (nome, status) VALUES ($1, 'rascunho') RETURNING id`,
      [nomeLimpo]
    );
    const novaId = nova.rows[0].id;

    await c.query(
      `INSERT INTO teste_perguntas (versao_id, ordem, pergunta)
       SELECT $1, ordem, pergunta FROM teste_perguntas WHERE versao_id=$2`,
      [novaId, ativaId]
    );
    await c.query(
      `INSERT INTO teste_alternativas (versao_id, pergunta_ordem, perfil, texto, ordem_exibicao)
       SELECT $1, pergunta_ordem, perfil, texto, ordem_exibicao
         FROM teste_alternativas WHERE versao_id=$2`,
      [novaId, ativaId]
    );
    await c.query('COMMIT');

    return res.json({ ok: true, versao_id: novaId, nome: nomeLimpo });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[admin/teste/versoes POST] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  } finally {
    c.release();
  }
});

// ── GET /teste/versoes/:id ──────────────────────────────────
router.get('/teste/versoes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    const v = await poolTeste.query(`SELECT * FROM teste_versoes WHERE id=$1`, [id]);
    if (!v.rows[0]) return res.status(404).json({ ok: false, erro: 'versão não encontrada' });

    const r = await poolTeste.query(
      `SELECT p.ordem, p.pergunta,
              a.perfil, a.texto, a.ordem_exibicao
         FROM teste_perguntas p
         LEFT JOIN teste_alternativas a
           ON a.versao_id = p.versao_id AND a.pergunta_ordem = p.ordem
        WHERE p.versao_id = $1
        ORDER BY p.ordem, a.ordem_exibicao`,
      [id]
    );

    const map = new Map();
    for (const row of r.rows) {
      if (!map.has(row.ordem)) {
        map.set(row.ordem, { ordem: row.ordem, pergunta: row.pergunta, alternativas: [] });
      }
      if (row.perfil) {
        map.get(row.ordem).alternativas.push({
          perfil: row.perfil,
          perfil_label: PERFIS_LABELS[row.perfil] || row.perfil,
          perfil_cor: PERFIS_CORES[row.perfil] || '#888',
          texto: row.texto,
          ordem_exibicao: row.ordem_exibicao,
        });
      }
    }

    const perguntas = Array.from(map.values()).sort((a, b) => a.ordem - b.ordem);

    return res.json({
      ok: true,
      versao: v.rows[0],
      perguntas,
      perfis: PERFIS_VALIDOS.map(p => ({
        slug: p,
        label: PERFIS_LABELS[p],
        cor: PERFIS_CORES[p],
      })),
    });
  } catch (err) {
    console.error('[admin/teste/versoes/:id] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── PUT /teste/versoes/:id ──────────────────────────────────
router.put('/teste/versoes/:id', async (req, res) => {
  const c = await poolTeste.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    const v = await c.query(`SELECT id, status FROM teste_versoes WHERE id=$1`, [id]);
    if (!v.rows[0]) return res.status(404).json({ ok: false, erro: 'versão não encontrada' });
    if (v.rows[0].status !== 'rascunho') {
      return res.status(403).json({ ok: false, erro: 'só rascunhos podem ser editados' });
    }

    const { perguntas } = req.body || {};
    if (!Array.isArray(perguntas) || perguntas.length !== 15) {
      return res.status(400).json({ ok: false, erro: 'precisa de 15 perguntas' });
    }

    // Validação completa antes de mexer no banco
    for (const p of perguntas) {
      if (!Number.isInteger(p.ordem) || p.ordem < 1 || p.ordem > 15) {
        return res.status(400).json({ ok: false, erro: 'pergunta com ordem inválida' });
      }
      if (typeof p.pergunta !== 'string' || p.pergunta.trim().length < 5) {
        return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': texto muito curto' });
      }
      if (!Array.isArray(p.alternativas) || p.alternativas.length !== 5) {
        return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': precisa de 5 alternativas' });
      }
      const perfisVistos = new Set();
      const ordensVistas = new Set();
      for (const a of p.alternativas) {
        if (!PERFIS_VALIDOS.includes(a.perfil)) {
          return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': perfil inválido' });
        }
        if (perfisVistos.has(a.perfil)) {
          return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': perfil ' + a.perfil + ' duplicado' });
        }
        perfisVistos.add(a.perfil);
        if (typeof a.texto !== 'string' || a.texto.trim().length < 2) {
          return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': alternativa com texto curto demais' });
        }
        const ord = parseInt(a.ordem_exibicao, 10);
        if (!Number.isInteger(ord) || ord < 1 || ord > 5) {
          return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': ordem_exibicao inválida' });
        }
        if (ordensVistas.has(ord)) {
          return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': ordem_exibicao ' + ord + ' duplicada' });
        }
        ordensVistas.add(ord);
      }
      if (perfisVistos.size !== 5) {
        return res.status(400).json({ ok: false, erro: 'pergunta ' + p.ordem + ': precisa ter os 5 perfis' });
      }
    }
    const ordensP = new Set(perguntas.map(p => p.ordem));
    for (let i = 1; i <= 15; i++) {
      if (!ordensP.has(i)) {
        return res.status(400).json({ ok: false, erro: 'falta pergunta de ordem ' + i });
      }
    }

    await c.query('BEGIN');
    await c.query(`DELETE FROM teste_alternativas WHERE versao_id=$1`, [id]);
    await c.query(`DELETE FROM teste_perguntas WHERE versao_id=$1`, [id]);

    for (const p of perguntas) {
      await c.query(
        `INSERT INTO teste_perguntas (versao_id, ordem, pergunta) VALUES ($1, $2, $3)`,
        [id, p.ordem, p.pergunta.trim()]
      );
      for (const a of p.alternativas) {
        await c.query(
          `INSERT INTO teste_alternativas
              (versao_id, pergunta_ordem, perfil, texto, ordem_exibicao)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, p.ordem, a.perfil, a.texto.trim(), a.ordem_exibicao]
        );
      }
    }
    await c.query('COMMIT');

    return res.json({ ok: true });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[admin/teste/versoes/:id PUT] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  } finally {
    c.release();
  }
});

// ── POST /teste/versoes/:id/publicar ────────────────────────
router.post('/teste/versoes/:id/publicar', async (req, res) => {
  const c = await poolTeste.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    const v = await c.query(`SELECT id, status FROM teste_versoes WHERE id=$1`, [id]);
    if (!v.rows[0]) return res.status(404).json({ ok: false, erro: 'versão não encontrada' });
    if (v.rows[0].status !== 'rascunho') {
      return res.status(400).json({ ok: false, erro: 'só rascunhos podem ser publicados' });
    }

    const conf = await c.query(
      `SELECT
         (SELECT COUNT(*)::int FROM teste_perguntas WHERE versao_id=$1) AS p,
         (SELECT COUNT(*)::int FROM teste_alternativas WHERE versao_id=$1) AS a`,
      [id]
    );
    if (conf.rows[0].p !== 15 || conf.rows[0].a !== 75) {
      return res.status(400).json({
        ok: false,
        erro: 'estrutura incompleta: ' + conf.rows[0].p + ' perguntas e ' + conf.rows[0].a + ' alternativas (esperado: 15 e 75)',
      });
    }

    await c.query('BEGIN');
    await c.query(
      `UPDATE teste_versoes
          SET status='arquivada', arquivado_em=NOW()
        WHERE status='ativa'`
    );
    await c.query(
      `UPDATE teste_versoes
          SET status='ativa', publicado_em=NOW()
        WHERE id=$1`,
      [id]
    );
    const apagadas = await c.query(`DELETE FROM teste_respostas RETURNING id`);
    await c.query('COMMIT');

    return res.json({
      ok: true,
      respostas_apagadas: apagadas.rowCount,
    });
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[admin/teste/versoes/:id/publicar] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  } finally {
    c.release();
  }
});

// ── DELETE /teste/versoes/:id ───────────────────────────────
router.delete('/teste/versoes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, erro: 'id inválido' });

    const v = await poolTeste.query(`SELECT status FROM teste_versoes WHERE id=$1`, [id]);
    if (!v.rows[0]) return res.status(404).json({ ok: false, erro: 'versão não encontrada' });
    if (v.rows[0].status !== 'rascunho') {
      return res.status(403).json({ ok: false, erro: 'só rascunhos podem ser apagados' });
    }

    await poolTeste.query(`DELETE FROM teste_versoes WHERE id=$1`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/teste/versoes/:id DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ════════════════════════════════════════════════════════════
// CONTEÚDO DOS RESULTADOS DO TESTE — perfis e livros
// Banco: poolComunicacao
// Endpoints (prefixo: /api/admin/teste):
//   GET   /teste/perfis-conteudo            → lista os 7 perfis com nome+slug (visão lista)
//   GET   /teste/perfis-conteudo/:slug      → detalhe de 1 perfil
//   PUT   /teste/perfis-conteudo/:slug      → atualiza textos/vídeo/produtos
//   GET   /teste/livros                     → lista os 4 livros
//   PUT   /teste/livros/:slug               → atualiza um livro
// ════════════════════════════════════════════════════════════

// Slugs aceitos (proteção: só edita os 7 perfis canônicos)
const _SLUGS_PERFIS_VALIDOS = [
  'medo', 'desordem', 'sobrevivencia', 'validacao',
  'prosperidade_nv1', 'prosperidade_nv2', 'prosperidade_nv3',
];
const _SLUGS_LIVROS_VALIDOS = [
  'vencendo_medo', 'vencendo_desordem', 'vencendo_validacao', 'vencendo_sobrevivencia',
];

// ── GET /teste/perfis-conteudo ──────────────────────────────
router.get('/teste/perfis-conteudo', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT slug, nome_exibicao, atualizado_em,
              (texto_diagnostico IS NOT NULL AND TRIM(texto_diagnostico) <> '') AS tem_diagnostico,
              (video_url IS NOT NULL AND TRIM(video_url) <> '') AS tem_video,
              (passo3_curso_titulo IS NOT NULL) AS tem_passo3
         FROM teste_perfis_conteudo
        ORDER BY
          CASE slug
            WHEN 'medo'             THEN 1
            WHEN 'desordem'         THEN 2
            WHEN 'sobrevivencia'    THEN 3
            WHEN 'validacao'        THEN 4
            WHEN 'prosperidade_nv1' THEN 5
            WHEN 'prosperidade_nv2' THEN 6
            WHEN 'prosperidade_nv3' THEN 7
            ELSE 99
          END`
    );
    return res.json({ ok: true, perfis: r.rows });
  } catch (err) {
    console.error('[admin/teste/perfis-conteudo] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /teste/perfis-conteudo/:slug ────────────────────────
router.get('/teste/perfis-conteudo/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!_SLUGS_PERFIS_VALIDOS.includes(slug)) {
      return res.status(400).json({ ok: false, erro: 'slug inválido' });
    }
    const r = await poolComunicacao.query(
      `SELECT * FROM teste_perfis_conteudo WHERE slug = $1`,
      [slug]
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, erro: 'perfil não encontrado' });
    return res.json({ ok: true, perfil: r.rows[0] });
  } catch (err) {
    console.error('[admin/teste/perfis-conteudo/:slug] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── PUT /teste/perfis-conteudo/:slug ────────────────────────
router.put('/teste/perfis-conteudo/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!_SLUGS_PERFIS_VALIDOS.includes(slug)) {
      return res.status(400).json({ ok: false, erro: 'slug inválido' });
    }

    // Campos editáveis (slug NÃO é editável)
    const campos = [
      'nome_exibicao',
      'video_url',
      'texto_diagnostico',
      'passo1_texto', 'passo2_texto', 'passo3_texto',
      'passo3_curso_titulo', 'passo3_curso_capa_url', 'passo3_curso_descricao',
      'passo3_curso_preco', 'passo3_curso_link_checkout',
      'passo3_curso_titulo_2', 'passo3_curso_capa_url_2', 'passo3_curso_descricao_2',
      'passo3_curso_preco_2', 'passo3_curso_link_checkout_2',
      'texto_fechamento_final',
    ];

    const sets = [];
    const valores = [];
    let i = 1;
    for (const campo of campos) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, campo)) {
        let valor = req.body[campo];
        // Strings vazias viram NULL pra preço (campo numérico)
        if (campo === 'passo3_curso_preco' || campo === 'passo3_curso_preco_2') {
          if (valor === '' || valor == null) valor = null;
          else {
            const n = parseFloat(valor);
            valor = isNaN(n) ? null : n;
          }
        } else if (typeof valor === 'string') {
          valor = valor.trim() === '' ? null : valor;
        }
        sets.push(campo + ' = $' + i);
        valores.push(valor);
        i++;
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ ok: false, erro: 'nenhum campo enviado' });
    }
    sets.push('atualizado_em = NOW()');
    valores.push(slug);

    const sql = `UPDATE teste_perfis_conteudo SET ${sets.join(', ')} WHERE slug = $${i}`;
    const r = await poolComunicacao.query(sql, valores);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'perfil não encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/teste/perfis-conteudo/:slug PUT] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /teste/livros ───────────────────────────────────────
router.get('/teste/livros', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT * FROM teste_livros
        ORDER BY
          CASE energia
            WHEN 'medo'           THEN 1
            WHEN 'desordem'       THEN 2
            WHEN 'sobrevivencia'  THEN 3
            WHEN 'validacao'      THEN 4
            ELSE 99
          END`
    );
    return res.json({ ok: true, livros: r.rows });
  } catch (err) {
    console.error('[admin/teste/livros] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── PUT /teste/livros/:slug ─────────────────────────────────
router.put('/teste/livros/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!_SLUGS_LIVROS_VALIDOS.includes(slug)) {
      return res.status(400).json({ ok: false, erro: 'slug inválido' });
    }

    const campos = ['titulo', 'capa_url', 'preco', 'link_checkout', 'selo'];
    const sets = [];
    const valores = [];
    let i = 1;
    for (const campo of campos) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, campo)) {
        let valor = req.body[campo];
        if (campo === 'preco') {
          if (valor === '' || valor == null) valor = null;
          else {
            const n = parseFloat(valor);
            valor = isNaN(n) ? null : n;
          }
        } else if (typeof valor === 'string') {
          valor = valor.trim() === '' ? null : valor;
        }
        sets.push(campo + ' = $' + i);
        valores.push(valor);
        i++;
      }
    }
    if (sets.length === 0) {
      return res.status(400).json({ ok: false, erro: 'nenhum campo enviado' });
    }
    sets.push('atualizado_em = NOW()');
    valores.push(slug);

    const sql = `UPDATE teste_livros SET ${sets.join(', ')} WHERE slug = $${i}`;
    const r = await poolComunicacao.query(sql, valores);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'livro não encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/teste/livros/:slug PUT] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ════════════════════════════════════════════════════════════
// PRODUTOS DA ALUNA + RECOMENDAÇÕES (admin + atendimento usam os mesmos)
// ════════════════════════════════════════════════════════════
//
// Endpoints (prefixo: /api/admin):
//   GET    /produtos                        → lista de produtos cadastrados (pra dropdown)
//   GET    /usuarios/:id/produtos           → produtos liberados pra essa aluna
//   POST   /usuarios/:id/produtos           → libera produto manualmente
//   DELETE /usuarios/:id/produtos/:upId     → revoga acesso
//   GET    /usuarios/:id/jornada            → jornada atual da aluna + recomendações
//                                             (pra Suellen ver no painel de atendimento)

// ── GET /produtos ───────────────────────────────────────────
router.get('/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const r = await poolCore.query(
      `SELECT id, slug, nome, tipo, acesso_modelo, link_checkout_padrao, ativo
         FROM produtos
        WHERE ativo = true
        ORDER BY ordem, nome`
    );
    return res.json({ ok: true, produtos: r.rows });
  } catch (err) {
    console.error('[admin/produtos] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /usuarios/:id/produtos ──────────────────────────────
router.get('/usuarios/:id/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const usuarioId = req.params.id;

    // Pega telefone canônico do usuário pra cruzamento
    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    const r = await poolCore.query(
      `SELECT up.id, up.produto_id, up.origem_tipo, up.acesso_inicio, up.acesso_fim,
              up.ativo, up.observacao,
              p.slug, p.nome, p.tipo, p.imagem_url
         FROM usuario_produtos up
         LEFT JOIN produtos p ON p.id = up.produto_id
        WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2)
        ORDER BY up.ativo DESC, up.acesso_inicio DESC`,
      [usuarioId, telefone]
    );
    return res.json({ ok: true, produtos: r.rows });
  } catch (err) {
    console.error('[admin/usuarios/:id/produtos] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /usuarios/:id/produtos ─────────────────────────────
// Body: { produto_id ou produto_slug, origem_tipo: 'cortesia'|'manual', observacao? }
router.post('/usuarios/:id/produtos', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const usuarioId = req.params.id;
    let { produto_id, produto_slug, origem_tipo, observacao } = req.body || {};

    // Pega telefone do usuário
    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    // Resolve produto_id se veio só slug
    if (!produto_id && produto_slug) {
      const p = await poolCore.query(`SELECT id FROM produtos WHERE slug = $1`, [produto_slug]);
      if (!p.rows[0]) return res.status(400).json({ ok: false, erro: 'produto não encontrado' });
      produto_id = p.rows[0].id;
    }
    if (!produto_id) return res.status(400).json({ ok: false, erro: 'produto_id ou produto_slug obrigatório' });

    if (!['cortesia', 'manual'].includes(origem_tipo)) {
      origem_tipo = 'manual';
    }

    // Se já existe ATIVO pro mesmo produto, atualiza observação; senão insere novo
    const exist = await poolCore.query(
      `SELECT id FROM usuario_produtos
        WHERE (usuario_id = $1 OR telefone_canonico = $2)
          AND produto_id = $3 AND ativo = true
        LIMIT 1`,
      [usuarioId, telefone, produto_id]
    );
    if (exist.rows[0]) {
      await poolCore.query(
        `UPDATE usuario_produtos SET observacao = COALESCE($1, observacao), atualizado_em = NOW() WHERE id = $2`,
        [observacao || null, exist.rows[0].id]
      );
      return res.json({ ok: true, id: exist.rows[0].id, ja_existia: true });
    }

    const r = await poolCore.query(
      `INSERT INTO usuario_produtos (usuario_id, telefone_canonico, produto_id, origem_tipo, observacao, ativo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [usuarioId, telefone, produto_id, origem_tipo, observacao || null]
    );
    return res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error('[admin/usuarios/:id/produtos POST] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── DELETE /usuarios/:id/produtos/:upId ─────────────────────
// Revoga (ativo = false). Não apaga histórico.
router.delete('/usuarios/:id/produtos/:upId', async (req, res) => {
  try {
    const { poolCore } = require('../db');
    const r = await poolCore.query(
      `UPDATE usuario_produtos SET ativo = false, atualizado_em = NOW()
        WHERE id = $1 AND usuario_id = $2`,
      [req.params.upId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, erro: 'não encontrado' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin/usuarios/:id/produtos DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /usuarios/:id/jornada ───────────────────────────────
// Devolve a jornada atual da aluna + passos com estado de comprado
// Usado pelo painel de atendimento pra Suellen ver as recomendações.
router.get('/usuarios/:id/jornada', async (req, res) => {
  try {
    const { poolCore, poolTeste, poolComunicacao } = require('../db');
    const {
      calcularResultado,
      montarJornada,
    } = require('../core/teste-resultado');

    const usuarioId = req.params.id;
    const u = await poolCore.query(`SELECT telefone FROM usuarios WHERE id = $1`, [usuarioId]);
    if (!u.rows[0]) return res.status(404).json({ ok: false, erro: 'usuário não encontrado' });
    const telefone = u.rows[0].telefone;

    // Teste mais recente (cruzamento por usuario_id ou telefone)
    const tR = await poolTeste.query(
      `SELECT id, respostas, perfil_dominante, feito_em
         FROM testes
        WHERE usuario_id = $1 OR telefone_canonico = $2
        ORDER BY feito_em DESC LIMIT 1`,
      [usuarioId, telefone]
    );
    if (!tR.rows[0]) {
      return res.json({ ok: true, jornada: null, motivo: 'Aluna ainda não fez o teste.' });
    }
    const teste = tR.rows[0];
    const respostas = Array.isArray(teste.respostas) ? teste.respostas : JSON.parse(teste.respostas || '[]');
    const calc = calcularResultado(respostas);

    // Mapa perfil → jornada
    const mapR = await poolComunicacao.query(
      `SELECT j.slug, j.numero, j.nome_exibicao, j.subtitulo, j.cor
         FROM jornadas_perfis_map m
         JOIN jornadas_metodo j ON j.slug = m.jornada_slug
        WHERE m.perfil_slug = $1`,
      [calc.perfil_dominante]
    );
    if (!mapR.rows[0]) {
      return res.json({ ok: true, jornada: null, motivo: 'Sem jornada mapeada para o perfil ' + calc.perfil_dominante });
    }
    const jornadaCfg = mapR.rows[0];

    // Passos
    const passosR = await poolComunicacao.query(
      `SELECT ordem, produto_slug, titulo_passo, descricao_passo
         FROM jornadas_passos
        WHERE jornada_slug = $1 ORDER BY ordem`,
      [jornadaCfg.slug]
    );
    jornadaCfg.passos = passosR.rows;

    // Produtos comprados pela aluna
    const compR = await poolCore.query(
      `SELECT p.slug FROM usuario_produtos up
         JOIN produtos p ON p.id = up.produto_id
        WHERE (up.usuario_id = $1 OR up.telefone_canonico = $2) AND up.ativo = true`,
      [usuarioId, telefone]
    );
    const slugsComprados = new Set(compR.rows.map(r => r.slug));

    // Produtos cadastrados (com link)
    const prodR = await poolCore.query(
      `SELECT slug, nome, link_checkout_padrao, imagem_url
         FROM produtos WHERE slug = ANY($1::text[])`,
      [passosR.rows.map(p => p.produto_slug)]
    );

    const jornada = montarJornada(jornadaCfg, slugsComprados, prodR.rows);

    return res.json({
      ok: true,
      teste_id: teste.id,
      perfil_dominante: calc.perfil_dominante,
      jornada,
    });
  } catch (err) {
    console.error('[admin/usuarios/:id/jornada] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
