/* ============================================================
   VIDA MÁGICA — core/usuarios.js
   Funções helper de identidade/auth/sessões.
   Usa poolCore (banco Core).

   Equivalente às funções que estavam no db.js antigo monolítico.
   ============================================================ */

const { poolCore } = require('../db');

// ── USUÁRIOS ──────────────────────────────────────────────

async function buscarUsuarioPorTelefone(tel) {
  const r = await poolCore.query(
    'SELECT * FROM usuarios WHERE telefone_formatado=$1',
    [tel]
  );
  return r.rows[0] || null;
}

async function buscarUsuarioPorId(id) {
  const r = await poolCore.query(
    'SELECT * FROM usuarios WHERE id=$1',
    [id]
  );
  return r.rows[0] || null;
}

async function criarOuAtualizarUsuario({ telefone, telefone_formatado, nome, email }) {
  const r = await poolCore.query(
    `INSERT INTO usuarios (telefone, telefone_formatado, nome, email)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (telefone) DO UPDATE SET
       nome=COALESCE(EXCLUDED.nome,usuarios.nome),
       atualizado_em=NOW()
     RETURNING *`,
    [telefone, telefone_formatado, nome || null, email || null]
  );
  return r.rows[0];
}

async function atualizarUsuario(id, campos) {
  const keys = Object.keys(campos);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const r = await poolCore.query(
    `UPDATE usuarios SET ${sets}, atualizado_em=NOW() WHERE id=$1 RETURNING *`,
    [id, ...keys.map(k => campos[k])]
  );
  return r.rows[0];
}

// ── OTP ───────────────────────────────────────────────────

async function criarOTP(telefone, codigo, canal = 'whatsapp', ttlMin = 10) {
  await poolCore.query(
    `INSERT INTO otp_tokens (telefone, codigo, canal, expira_em)
     VALUES ($1,$2,$3, NOW() + $4::interval)`,
    [telefone, codigo, canal, `${ttlMin} minutes`]
  );
}

async function validarOTP(telefone, codigo) {
  const r = await poolCore.query(
    `SELECT * FROM otp_tokens
     WHERE telefone=$1 AND codigo=$2 AND usado=FALSE
       AND tentativas<5 AND expira_em>NOW()
     ORDER BY criado_em DESC LIMIT 1`,
    [telefone, codigo]
  );
  if (!r.rows.length) {
    await poolCore.query(
      `UPDATE otp_tokens SET tentativas=tentativas+1
       WHERE telefone=$1 AND usado=FALSE AND expira_em>NOW()`,
      [telefone]
    );
    return false;
  }
  await poolCore.query(
    `UPDATE otp_tokens SET usado=TRUE WHERE id=$1`,
    [r.rows[0].id]
  );
  return true;
}

async function limparOTPsExpirados() {
  await poolCore.query(
    `DELETE FROM otp_tokens WHERE expira_em < NOW() - INTERVAL '1 hour'`
  );
}

// ── DISPOSITIVOS ──────────────────────────────────────────

async function upsertDispositivo({ usuario_id, tipo, device_id, fingerprint, nome_amigavel, ip }) {
  const r = await poolCore.query(
    `INSERT INTO dispositivos (usuario_id, tipo, device_id, fingerprint, nome_amigavel, ip_primeiro_acesso)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (usuario_id, tipo) DO UPDATE SET
       device_id=$3, fingerprint=$4, nome_amigavel=$5,
       ultimo_acesso=NOW(), ativo=TRUE
     RETURNING *`,
    [usuario_id, tipo, device_id, JSON.stringify(fingerprint), nome_amigavel, ip]
  );
  return r.rows[0];
}

async function buscarDispositivoAtivo(usuario_id, tipo) {
  const r = await poolCore.query(
    `SELECT * FROM dispositivos WHERE usuario_id=$1 AND tipo=$2 AND ativo=TRUE`,
    [usuario_id, tipo]
  );
  return r.rows[0] || null;
}

async function listarDispositivosUsuario(usuario_id) {
  const r = await poolCore.query(
    `SELECT * FROM dispositivos WHERE usuario_id=$1 ORDER BY ultimo_acesso DESC`,
    [usuario_id]
  );
  return r.rows;
}

async function revogarDispositivo(id) {
  await poolCore.query(`UPDATE dispositivos SET ativo=FALSE WHERE id=$1`, [id]);
  await poolCore.query(`UPDATE sessoes SET revogada=TRUE WHERE device_id=$1`, [id]);
}

// ── SESSÕES ───────────────────────────────────────────────

async function criarSessao({ usuario_id, device_id, refresh_token, ip, user_agent, diasExpiracao = 30 }) {
  const r = await poolCore.query(
    `INSERT INTO sessoes (usuario_id, device_id, refresh_token, ip, user_agent, expira_em)
     VALUES ($1,$2,$3,$4,$5, NOW() + $6::interval)
     RETURNING *`,
    [usuario_id, device_id, refresh_token, ip, user_agent, `${diasExpiracao} days`]
  );
  return r.rows[0];
}

async function buscarSessaoPorRefreshToken(token) {
  const r = await poolCore.query(
    `SELECT s.*,
            u.id as uid, u.nome, u.email, u.telefone_formatado,
            u.plano, u.perfil_teste, u.percentual_prosperidade,
            u.sementes, u.estagio_arvore
     FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id
     WHERE s.refresh_token=$1 AND s.revogada=FALSE AND s.expira_em>NOW()`,
    [token]
  );
  return r.rows[0] || null;
}

async function renovarSessao(refresh_token) {
  await poolCore.query(
    `UPDATE sessoes SET ultimo_uso=NOW() WHERE refresh_token=$1`,
    [refresh_token]
  );
}

async function revogarSessao(refresh_token) {
  await poolCore.query(
    `UPDATE sessoes SET revogada=TRUE WHERE refresh_token=$1`,
    [refresh_token]
  );
}

async function revogarTodasSessoesUsuario(usuario_id) {
  await poolCore.query(
    `UPDATE sessoes SET revogada=TRUE WHERE usuario_id=$1`,
    [usuario_id]
  );
}

// ── SEMENTES ──────────────────────────────────────────────

async function adicionarSemente({ usuario_id, tipo, descricao, quantidade = 1, origem_id }) {
  await poolCore.query(
    `INSERT INTO sementes (usuario_id, tipo, descricao, quantidade, origem_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [usuario_id, tipo, descricao, quantidade, origem_id || null]
  );
  const r = await poolCore.query(
    `UPDATE usuarios SET sementes=sementes+$1, atualizado_em=NOW()
     WHERE id=$2 RETURNING sementes`,
    [quantidade, usuario_id]
  );
  return r.rows[0]?.sementes || 0;
}

async function totalSementes(usuario_id) {
  const r = await poolCore.query(
    `SELECT COALESCE(SUM(quantidade),0) as total FROM sementes WHERE usuario_id=$1`,
    [usuario_id]
  );
  return parseInt(r.rows[0]?.total || 0);
}

async function historicoSementes(usuario_id) {
  const r = await poolCore.query(
    `SELECT * FROM sementes WHERE usuario_id=$1 ORDER BY criado_em DESC`,
    [usuario_id]
  );
  return r.rows;
}

module.exports = {
  buscarUsuarioPorTelefone,
  buscarUsuarioPorId,
  criarOuAtualizarUsuario,
  atualizarUsuario,
  criarOTP,
  validarOTP,
  limparOTPsExpirados,
  upsertDispositivo,
  buscarDispositivoAtivo,
  listarDispositivosUsuario,
  revogarDispositivo,
  criarSessao,
  buscarSessaoPorRefreshToken,
  renovarSessao,
  revogarSessao,
  revogarTodasSessoesUsuario,
  adicionarSemente,
  totalSementes,
  historicoSementes,
};
