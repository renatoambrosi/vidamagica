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
const { formatarTelefone } = require('../utils');
const { buscarUsuarioPorIdentificador } = require('../usuarios');

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

module.exports = router;
