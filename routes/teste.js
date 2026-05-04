/* ============================================================
   VIDA MÁGICA — routes/teste.js
   Endpoints do Teste do Subconsciente.

   Banco principal: poolTeste (tabela teste_leads).
   Cruzamento: poolCore (tabela usuarios) — sem JOIN entre bancos.

   Endpoints:
   - POST /api/teste/buscar-usuario   → auto-preenche nome se telefone existe
   - POST /api/teste/iniciar          → grava lead + cria/reusa conta incompleta

   Regras:
   - Telefone normalizado para canônico (55DDDNNNNNNNN) via formatarTelefone.
   - Se telefone já existe em usuarios (qualquer status), reusa o usuario_id.
   - Se não existe, cria conta incompleta com origem_cadastro='teste'.
   - Lead em teste_leads é único por telefone+usuario_id (atualiza se já existe).
   - UTMs sempre gravadas, mesmo vazias (rastreamento de funil).
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolCore, poolTeste } = require('../db');
const { formatarTelefone } = require('../core/utils');
const { buscarUsuarioPorIdentificador } = require('../core/usuarios');
const { calcularPerfil, PERFIS_VALIDOS } = require('../core/teste-conteudo');

// ── Validações simples ──────────────────────────────────────

function validarNome(nome) {
  if (!nome || typeof nome !== 'string') return null;
  const limpo = nome.trim().replace(/\s+/g, ' ');
  if (limpo.length < 2 || limpo.length > 255) return null;
  return limpo;
}

function validarTelefoneCanonico(telCanonico) {
  // Formato esperado: 55 + DDD (2) + número (8 ou 9 dígitos) = 12 ou 13 dígitos
  if (!telCanonico) return false;
  return /^55\d{10,11}$/.test(telCanonico);
}

function sanitizarUtm(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const limpo = valor.trim().slice(0, 100);
  return limpo || null;
}

// ── POST /api/teste/buscar-usuario ──────────────────────────
// Body: { telefone }
// Retorna: { encontrado: true, nome: "..." } ou { encontrado: false }
//
// Usado no blur do campo telefone no modal — auto-preenche nome
// se a pessoa já tem cadastro (qualquer status: incompleta/ativa/arquivada).

router.post('/buscar-usuario', async (req, res) => {
  try {
    const { telefone } = req.body || {};
    const canonico = formatarTelefone(telefone);

    if (!validarTelefoneCanonico(canonico)) {
      return res.json({ encontrado: false });
    }

    const usuario = await buscarUsuarioPorIdentificador({ telefone: canonico });

    if (usuario && usuario.nome) {
      return res.json({
        encontrado: true,
        nome: usuario.nome,
      });
    }

    return res.json({ encontrado: false });
  } catch (err) {
    console.error('[teste/buscar-usuario] erro:', err);
    return res.status(500).json({ encontrado: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/iniciar ─────────────────────────────────
// Body: { nome, telefone, utm_source, utm_medium, utm_campaign }
// Retorna: { ok: true, lead_id, usuario_id }
//
// Fluxo:
// 1. Normaliza telefone, valida campos
// 2. Busca usuário em Postgres-Core. Se não existe, cria conta incompleta.
// 3. Insere/atualiza lead em Postgres-Teste (teste_leads).
// 4. Devolve lead_id e usuario_id pra continuar o teste.

router.post('/iniciar', async (req, res) => {
  try {
    const { nome, telefone, utm_source, utm_medium, utm_campaign } = req.body || {};

    // ── Validação ──
    const nomeLimpo = validarNome(nome);
    if (!nomeLimpo) {
      return res.status(400).json({ ok: false, erro: 'Nome inválido' });
    }

    const telCanonico = formatarTelefone(telefone);
    if (!validarTelefoneCanonico(telCanonico)) {
      return res.status(400).json({ ok: false, erro: 'Telefone inválido' });
    }

    const utms = {
      source:   sanitizarUtm(utm_source),
      medium:   sanitizarUtm(utm_medium),
      campaign: sanitizarUtm(utm_campaign),
    };

    // ── 1. Busca/cria usuário em Postgres-Core ──
    let usuario = await buscarUsuarioPorIdentificador({ telefone: telCanonico });
    let usuarioId;

    if (usuario) {
      usuarioId = usuario.id;
      // Se a conta existe sem nome (caso raro de provisionamento por gateway),
      // atualiza com o nome que a pessoa acabou de digitar.
      if (!usuario.nome || usuario.nome.trim() === '') {
        await poolCore.query(
          `UPDATE usuarios SET nome=$1, atualizado_em=NOW() WHERE id=$2`,
          [nomeLimpo, usuarioId]
        );
      }
    } else {
      // Cria nova conta incompleta (telefone ainda não validado por magic link).
      // Status fica 'incompleta' até o pagamento + magic link pós-teste.
      const r = await poolCore.query(
        `INSERT INTO usuarios (telefone, telefone_formatado, nome, status, origem_cadastro)
         VALUES ($1, $1, $2, 'incompleta', 'teste')
         RETURNING id`,
        [telCanonico, nomeLimpo]
      );
      usuarioId = r.rows[0].id;
    }

    // ── 2. Insere/atualiza lead em Postgres-Teste ──
    // Verifica se já existe lead pra esse usuário (evita duplicar).
    const leadExistente = await poolTeste.query(
      `SELECT id FROM teste_leads
        WHERE usuario_id=$1 OR telefone_canonico=$2
        ORDER BY criado_em DESC LIMIT 1`,
      [usuarioId, telCanonico]
    );

    let leadId;
    if (leadExistente.rows[0]) {
      leadId = leadExistente.rows[0].id;
      await poolTeste.query(
        `UPDATE teste_leads
            SET nome=$1,
                telefone_canonico=$2,
                usuario_id=$3,
                utm_source=COALESCE($4, utm_source),
                utm_medium=COALESCE($5, utm_medium),
                utm_campaign=COALESCE($6, utm_campaign),
                atualizado_em=NOW()
          WHERE id=$7`,
        [nomeLimpo, telCanonico, usuarioId, utms.source, utms.medium, utms.campaign, leadId]
      );
    } else {
      const r = await poolTeste.query(
        `INSERT INTO teste_leads
           (telefone_canonico, nome, usuario_id, utm_source, utm_medium, utm_campaign)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [telCanonico, nomeLimpo, usuarioId, utms.source, utms.medium, utms.campaign]
      );
      leadId = r.rows[0].id;
    }

    return res.json({
      ok: true,
      lead_id: leadId,
      usuario_id: usuarioId,
    });
  } catch (err) {
    console.error('[teste/iniciar] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /api/teste/perguntas ────────────────────────────────
// Devolve as 15 perguntas + 5 alternativas cada, na ordem.
// Frontend usa pra renderizar uma de cada vez.
// Não devolve o perfil de cada alternativa — isso é segredo do backend.

router.get('/perguntas', async (req, res) => {
  try {
    const r = await poolTeste.query(
      `SELECT p.ordem, p.pergunta,
              a.perfil, a.texto, a.ordem_alternativa
         FROM teste_perguntas p
         JOIN teste_alternativas a ON a.pergunta_ordem = p.ordem
        WHERE p.ativo = TRUE
        ORDER BY p.ordem, a.ordem_alternativa`
    );

    // Agrupa em { ordem, pergunta, alternativas: [{ id, texto }] }
    // O "id" é o perfil — frontend devolve isso de volta no /responder.
    // Não revelamos nada extra, mas o nome do perfil é só uma string opaca pro frontend.
    const map = new Map();
    for (const row of r.rows) {
      if (!map.has(row.ordem)) {
        map.set(row.ordem, {
          ordem: row.ordem,
          pergunta: row.pergunta,
          alternativas: [],
        });
      }
      map.get(row.ordem).alternativas.push({
        id: row.perfil,         // chave que volta no /responder
        texto: row.texto,
      });
    }

    const perguntas = Array.from(map.values()).sort((a, b) => a.ordem - b.ordem);
    return res.json({ ok: true, perguntas });
  } catch (err) {
    console.error('[teste/perguntas] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /api/teste/progresso ────────────────────────────────
// Body via query string: ?lead_id=...
// Devolve as respostas que a aluna já deu, pra ela continuar de onde parou.
//
// Retorno: { ok, respostas: [{pergunta_ordem, perfil}, ...], total: 15 }

router.get('/progresso', async (req, res) => {
  try {
    const leadId = (req.query.lead_id || '').toString().trim();
    if (!leadId) return res.status(400).json({ ok: false, erro: 'lead_id ausente' });

    const r = await poolTeste.query(
      `SELECT pergunta_ordem, perfil
         FROM teste_respostas
        WHERE lead_id = $1
        ORDER BY pergunta_ordem`,
      [leadId]
    );

    return res.json({
      ok: true,
      respostas: r.rows,
      total: 15,
    });
  } catch (err) {
    console.error('[teste/progresso] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/responder ───────────────────────────────
// Body: { lead_id, pergunta_ordem (1-15), perfil ('medo'|'desordem'|...) }
//
// Salva/atualiza a resposta. Se for a 15ª e completou tudo,
// calcula o perfil dominante e cria/atualiza linha em `testes`.
//
// Retorno parcial:    { ok, completo: false, respondidas: 7 }
// Retorno completo:   { ok, completo: true, teste_id, perfil_dominante,
//                       percentual_prosperidade, contagem, percentuais }

router.post('/responder', async (req, res) => {
  try {
    const { lead_id, pergunta_ordem, perfil } = req.body || {};

    // ── Validação ──
    if (!lead_id || typeof lead_id !== 'string') {
      return res.status(400).json({ ok: false, erro: 'lead_id inválido' });
    }
    const ordemNum = parseInt(pergunta_ordem, 10);
    if (!Number.isInteger(ordemNum) || ordemNum < 1 || ordemNum > 15) {
      return res.status(400).json({ ok: false, erro: 'pergunta_ordem inválida' });
    }
    if (!PERFIS_VALIDOS.includes(perfil)) {
      return res.status(400).json({ ok: false, erro: 'perfil inválido' });
    }

    // ── Confirma que o lead existe e pega dados pra cruzar ──
    const leadRows = await poolTeste.query(
      `SELECT id, telefone_canonico, usuario_id FROM teste_leads WHERE id = $1`,
      [lead_id]
    );
    if (!leadRows.rows[0]) {
      return res.status(404).json({ ok: false, erro: 'lead não encontrado' });
    }
    const lead = leadRows.rows[0];

    // ── Confirma que o par (pergunta, perfil) existe nas alternativas ──
    // Defesa contra payload inventado pelo frontend.
    const alt = await poolTeste.query(
      `SELECT 1 FROM teste_alternativas WHERE pergunta_ordem=$1 AND perfil=$2`,
      [ordemNum, perfil]
    );
    if (!alt.rows[0]) {
      return res.status(400).json({ ok: false, erro: 'alternativa inexistente' });
    }

    // ── Salva/atualiza a resposta (idempotente: pode reclicar) ──
    await poolTeste.query(
      `INSERT INTO teste_respostas (lead_id, pergunta_ordem, perfil)
       VALUES ($1, $2, $3)
       ON CONFLICT (lead_id, pergunta_ordem)
       DO UPDATE SET perfil = EXCLUDED.perfil, respondido_em = NOW()`,
      [lead_id, ordemNum, perfil]
    );

    // ── Quantas já foram respondidas? ──
    const cnt = await poolTeste.query(
      `SELECT pergunta_ordem, perfil FROM teste_respostas
        WHERE lead_id=$1 ORDER BY pergunta_ordem`,
      [lead_id]
    );
    const respondidas = cnt.rows.length;

    // ── Se ainda não completou: retorna parcial e termina ──
    if (respondidas < 15) {
      return res.json({
        ok: true,
        completo: false,
        respondidas,
        total: 15,
      });
    }

    // ── COMPLETOU: calcula perfil e cria/atualiza linha em `testes` ──
    const respostasArr = cnt.rows.map(r => ({
      pergunta_ordem: r.pergunta_ordem,
      perfil: r.perfil,
    }));

    const resultado = calcularPerfil(respostasArr);

    // Verifica se já existe um teste pra esse lead (caso refaça)
    const testeExistente = await poolTeste.query(
      `SELECT id FROM testes WHERE lead_id=$1 ORDER BY feito_em DESC LIMIT 1`,
      [lead_id]
    );

    let testeId;
    if (testeExistente.rows[0]) {
      testeId = testeExistente.rows[0].id;
      await poolTeste.query(
        `UPDATE testes
            SET respostas=$1, contagem=$2, percentuais=$3,
                perfil_dominante=$4, percentual_prosperidade=$5, nivel_prosperidade=$6,
                feito_em=NOW()
          WHERE id=$7`,
        [
          JSON.stringify(respostasArr),
          JSON.stringify(resultado.contagem),
          JSON.stringify(resultado.percentuais),
          resultado.perfil_dominante,
          resultado.percentual_prosperidade,
          resultado.nivel_prosperidade,
          testeId,
        ]
      );
    } else {
      const r = await poolTeste.query(
        `INSERT INTO testes
           (usuario_id, lead_id, telefone_canonico, respostas,
            contagem, percentuais,
            perfil_dominante, percentual_prosperidade, nivel_prosperidade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          lead.usuario_id,
          lead_id,
          lead.telefone_canonico,
          JSON.stringify(respostasArr),
          JSON.stringify(resultado.contagem),
          JSON.stringify(resultado.percentuais),
          resultado.perfil_dominante,
          resultado.percentual_prosperidade,
          resultado.nivel_prosperidade,
        ]
      );
      testeId = r.rows[0].id;
    }

    return res.json({
      ok: true,
      completo: true,
      teste_id: testeId,
      perfil_dominante: resultado.perfil_dominante,
      percentual_prosperidade: resultado.percentual_prosperidade,
      contagem: resultado.contagem,
      percentuais: resultado.percentuais,
    });
  } catch (err) {
    console.error('[teste/responder] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
