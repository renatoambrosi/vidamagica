/* ============================================================
   VIDA MÁGICA — core/admins.js
   Funções helper de admin (Renato + Suellen no futuro).
   Usa poolComunicacao.

   Tabelas: admins, admin_otp_tokens, admin_sessoes
   ============================================================ */

const { poolComunicacao } = require('../db');

// ── ADMINS ────────────────────────────────────────────────

async function buscarAdminPorTelefone(telefone) {
  const r = await poolComunicacao.query(
    `SELECT * FROM admins WHERE telefone_canonico=$1 AND ativo=TRUE`,
    [telefone]
  );
  return r.rows[0] || null;
}

async function buscarAdminPorId(id) {
  const r = await poolComunicacao.query(
    `SELECT * FROM admins WHERE id=$1`,
    [id]
  );
  return r.rows[0] || null;
}

async function marcarAcessoAdmin(id) {
  await poolComunicacao.query(
    `UPDATE admins SET ultimo_acesso=NOW(), atualizado_em=NOW() WHERE id=$1`,
    [id]
  );
}

// ── OTP ADMIN ─────────────────────────────────────────────

async function criarOtpAdmin(telefone, codigo, ttlMin = 10) {
  await poolComunicacao.query(
    `INSERT INTO admin_otp_tokens (telefone_canonico, codigo, expira_em)
     VALUES ($1, $2, NOW() + $3::interval)`,
    [telefone, codigo, `${ttlMin} minutes`]
  );
}

async function validarOtpAdmin(telefone, codigo) {
  const r = await poolComunicacao.query(
    `SELECT * FROM admin_otp_tokens
     WHERE telefone_canonico=$1 AND codigo=$2 AND usado=FALSE
       AND tentativas<5 AND expira_em>NOW()
     ORDER BY criado_em DESC LIMIT 1`,
    [telefone, codigo]
  );
  if (!r.rows.length) {
    await poolComunicacao.query(
      `UPDATE admin_otp_tokens SET tentativas=tentativas+1
       WHERE telefone_canonico=$1 AND usado=FALSE AND expira_em>NOW()`,
      [telefone]
    );
    return false;
  }
  await poolComunicacao.query(
    `UPDATE admin_otp_tokens SET usado=TRUE WHERE id=$1`,
    [r.rows[0].id]
  );
  return true;
}

async function limparOtpAdminExpirados() {
  await poolComunicacao.query(
    `DELETE FROM admin_otp_tokens WHERE expira_em < NOW() - INTERVAL '1 hour'`
  );
}

// ── SESSÕES ADMIN ─────────────────────────────────────────

async function criarSessaoAdmin({ admin_id, escopo, device_fingerprint, user_agent, ip, diasExpiracao = 30 }) {
  const r = await poolComunicacao.query(
    `INSERT INTO admin_sessoes (admin_id, escopo, device_fingerprint, user_agent, ip, expira_em)
     VALUES ($1, $2, $3, $4, $5, NOW() + $6::interval)
     RETURNING *`,
    [admin_id, escopo, device_fingerprint || null, user_agent || null, ip || null, `${diasExpiracao} days`]
  );
  return r.rows[0];
}

async function buscarSessaoAdmin(sessao_id) {
  const r = await poolComunicacao.query(
    `SELECT * FROM admin_sessoes WHERE id=$1 AND revogada=FALSE AND expira_em>NOW()`,
    [sessao_id]
  );
  return r.rows[0] || null;
}

async function revogarSessaoAdmin(sessao_id) {
  await poolComunicacao.query(
    `UPDATE admin_sessoes SET revogada=TRUE WHERE id=$1`,
    [sessao_id]
  );
}

async function tocarSessaoAdmin(sessao_id) {
  await poolComunicacao.query(
    `UPDATE admin_sessoes SET ultimo_uso=NOW() WHERE id=$1`,
    [sessao_id]
  );
}

module.exports = {
  buscarAdminPorTelefone,
  buscarAdminPorId,
  marcarAcessoAdmin,
  criarOtpAdmin,
  validarOtpAdmin,
  limparOtpAdminExpirados,
  criarSessaoAdmin,
  buscarSessaoAdmin,
  revogarSessaoAdmin,
  tocarSessaoAdmin,
};
