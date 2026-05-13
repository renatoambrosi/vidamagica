/* ============================================================
   VIDA MÁGICA — core/usuarios.js
   Funções helper de identidade/auth/sessões.
   Usa poolCore (banco Core).

   Equivalente às funções que estavam no db.js antigo monolítico.
   ============================================================ */

const { poolCore } = require('../db');

// ── USUÁRIOS ──────────────────────────────────────────────

async function buscarUsuarioPorTelefone(tel) {
  // Busca pelo telefone PRINCIPAL atual (usuarios.telefone_formatado)
  // Se não achar, busca no HISTÓRICO ainda vinculado (telefones_historicos.ativo=TRUE).
  // Histórico só sai quando admin desvincula manualmente pelo painel — então
  // qualquer compra/contato vindo de número antigo continua sendo reconhecido
  // como a mesma aluna. Princípio: conta duplicada NUNCA pode existir.
  const r = await poolCore.query(
    `SELECT u.*
       FROM usuarios u
      WHERE u.telefone_formatado = $1
         OR u.telefone           = $1
         OR u.id IN (
              SELECT usuario_id FROM telefones_historicos
               WHERE (telefone = $1 OR telefone_formatado = $1)
                 AND ativo = TRUE
            )
      LIMIT 1`,
    [tel]
  );
  return r.rows[0] || null;
}

// Igual à função acima, mas retorna TAMBÉM a origem do match.
// origem='principal' → telefone é o ativo atual da conta
// origem='historico' → telefone está em telefones_historicos.ativo=TRUE
//                      (aluna trocou de número, mas histórico ainda válido)
// origem=null        → não achou
//
// Usado por: webhook-evolution (pra responder "número alterado") e fluxo
// de login (mesma regra: histórico identifica, mas não autentica).
async function buscarUsuarioPorTelefoneComOrigem(tel) {
  // 1. Tenta principal primeiro
  const rPrincipal = await poolCore.query(
    `SELECT * FROM usuarios
      WHERE telefone_formatado = $1 OR telefone = $1
      LIMIT 1`,
    [tel]
  );
  if (rPrincipal.rows[0]) {
    return { usuario: rPrincipal.rows[0], origem: 'principal' };
  }

  // 2. Não achou — tenta histórico ativo
  const rHist = await poolCore.query(
    `SELECT u.*
       FROM usuarios u
       JOIN telefones_historicos h ON h.usuario_id = u.id
      WHERE (h.telefone = $1 OR h.telefone_formatado = $1)
        AND h.ativo = TRUE
      LIMIT 1`,
    [tel]
  );
  if (rHist.rows[0]) {
    return { usuario: rHist.rows[0], origem: 'historico' };
  }

  return null;
}

async function buscarUsuarioPorId(id) {
  const r = await poolCore.query(
    'SELECT * FROM usuarios WHERE id=$1',
    [id]
  );
  return r.rows[0] || null;
}

async function criarOuAtualizarUsuario({ telefone, telefone_formatado, nome, email, origem_cadastro }) {
  const r = await poolCore.query(
    `INSERT INTO usuarios (telefone, telefone_formatado, nome, email, origem_cadastro)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (telefone) DO UPDATE SET
       nome=COALESCE(EXCLUDED.nome,usuarios.nome),
       atualizado_em=NOW()
     RETURNING *`,
    [telefone, telefone_formatado, nome || null, email || null, origem_cadastro || null]
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

// ── MAGIC TOKENS ──────────────────────────────────────────
// Tokens longos pra magic link de login, boas-vindas e reset de senha.
// Reusam a tabela otp_tokens (campo `token` + `tipo`).

const crypto = require('crypto');

function gerarTokenMagico() {
  // 32 bytes hex = 64 chars, suficiente pra ser imprevisível na URL
  return crypto.randomBytes(32).toString('hex');
}

async function criarMagicToken(telefone, tipo, ttlMin = 10) {
  if (!['magic_login', 'magic_boas_vindas', 'reset_senha'].includes(tipo)) {
    throw new Error(`tipo inválido: ${tipo}`);
  }
  const token = gerarTokenMagico();
  await poolCore.query(
    `INSERT INTO otp_tokens (telefone, codigo, canal, token, tipo, expira_em)
     VALUES ($1, '', 'whatsapp', $2, $3, NOW() + $4::interval)`,
    [telefone, token, tipo, `${ttlMin} minutes`]
  );
  return token;
}

async function validarMagicToken(token, tiposPermitidos) {
  // tiposPermitidos = ['magic_login','magic_boas_vindas'] etc
  const tipos = Array.isArray(tiposPermitidos) ? tiposPermitidos : [tiposPermitidos];
  const r = await poolCore.query(
    `SELECT * FROM otp_tokens
      WHERE token=$1 AND usado=FALSE AND expira_em>NOW()
        AND tipo = ANY($2::text[])
      ORDER BY criado_em DESC
      LIMIT 1`,
    [token, tipos]
  );
  if (!r.rows.length) return null;
  await poolCore.query(`UPDATE otp_tokens SET usado=TRUE WHERE id=$1`, [r.rows[0].id]);
  return r.rows[0];  // tem .telefone e .tipo
}

// ── ACESSO_SOLICITACOES ──────────────────────────────────
// Token de 5min gerado pelo botão "Solicite entrar pelo seu Whatsapp"
// no /auth. Aluna toca → recebe wa.me com texto contendo o token.
// Quando webhook recebe zap dela, valida o token contra o telefone de origem.

function gerarTokenSolicitacao() {
  // 5 chars alfanuméricos (excluindo 0, O, I, 1 pra evitar confusão visual)
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alfabeto[crypto.randomInt(alfabeto.length)];
  return 'VM' + s;
}

async function criarSolicitacaoAcesso(telefone, ttlMin = 5) {
  // Limpa tokens expirados de todos os usuários (housekeeping a cada chamada)
  await poolCore.query(`DELETE FROM acesso_solicitacoes WHERE expira_em < NOW()`);

  // Tenta gerar token único (raríssimo colidir, mas blindando)
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const token = gerarTokenSolicitacao();
    try {
      const r = await poolCore.query(
        `INSERT INTO acesso_solicitacoes (token, telefone, expira_em)
         VALUES ($1, $2, NOW() + $3::interval)
         RETURNING token, criado_em, expira_em`,
        [token, telefone, `${ttlMin} minutes`]
      );
      return r.rows[0];
    } catch (err) {
      if (err.code !== '23505') throw err;  // se não for duplicate key, propaga
    }
  }
  throw new Error('falha ao gerar token único após 5 tentativas');
}

async function buscarSolicitacaoPorToken(token) {
  const r = await poolCore.query(
    `SELECT * FROM acesso_solicitacoes WHERE token=$1`, [token]);
  return r.rows[0] || null;
}

async function marcarSolicitacaoUsada(token, magicToken = null) {
  await poolCore.query(
    `UPDATE acesso_solicitacoes
        SET usado=TRUE, usado_em=NOW(),
            webhook_recebido_em=NOW(),
            magic_token=COALESCE($2, magic_token)
      WHERE token=$1`,
    [token, magicToken]
  );
}

async function deletarSolicitacao(token) {
  await poolCore.query(`DELETE FROM acesso_solicitacoes WHERE token=$1`, [token]);
}

// Procura QUALQUER token VM válido na string de mensagem recebida via webhook
async function detectarTokenNaMensagem(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const matches = texto.toUpperCase().match(/VM[A-Z2-9]{5}/g);
  if (!matches || !matches.length) return null;
  // Pode ter mais de um token na string — testa todos, devolve o primeiro válido
  for (const t of matches) {
    const sol = await buscarSolicitacaoPorToken(t);
    if (sol && !sol.usado && new Date(sol.expira_em) > new Date()) {
      return sol;
    }
  }
  return null;
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

// ── ARQUIVAR / APAGAR CONTA ──────────────────────────────
// Princípio: aluna NUNCA apaga de verdade. Pedido dela = arquiva.
// Apenas admin tem o botão "Apagar permanentemente" (DELETE em cascata).

async function arquivarUsuario(id, { por = 'admin', motivo = null } = {}) {
  // Marca arquivada=TRUE + status='arquivada'. Revoga todas as sessões.
  await poolCore.query(
    `UPDATE usuarios
        SET arquivada=TRUE,
            status='arquivada',
            arquivada_em=NOW(),
            arquivada_por=$2,
            arquivada_motivo=$3,
            atualizado_em=NOW()
      WHERE id=$1`,
    [id, por, motivo]
  );
  await poolCore.query(
    `UPDATE sessoes SET revogada=TRUE WHERE usuario_id=$1 AND revogada=FALSE`,
    [id]
  );
}

async function desarquivarUsuario(id) {
  // Volta pra 'ativa' se já tinha telefone_validado_em, senão 'incompleta'
  await poolCore.query(
    `UPDATE usuarios
        SET arquivada=FALSE,
            status=CASE WHEN telefone_validado_em IS NOT NULL THEN 'ativa' ELSE 'incompleta' END,
            arquivada_em=NULL,
            arquivada_por=NULL,
            arquivada_motivo=NULL,
            atualizado_em=NOW()
      WHERE id=$1`,
    [id]
  );
}

async function apagarUsuarioPermanente(id) {
  // DELETE em cascata — sessões, dispositivos, telefones_historicos, OTPs
  // todos têm ON DELETE CASCADE em usuario_id, então saem junto.
  // Linha de membros/pagamentos antigos PERMANECE (são bancos diferentes,
  // sem FK física entre eles). Histórico financeiro fica preservado.
  const r = await poolCore.query(`DELETE FROM usuarios WHERE id=$1 RETURNING id`, [id]);
  return r.rowCount > 0;
}

// ── ATIVAÇÃO DE CONTA ─────────────────────────────────────
// Conta nasce 'incompleta' por várias origens (Kiwify webhook, manual admin,
// teste, cadastro_direto). Vira 'ativa' SOMENTE quando aluna prova ter o
// telefone na mão — tocando magic link OU mandando zap pelo /auth.
//
// Login senha de conta 'incompleta' é REJEITADO (quem nunca validou telefone
// não pode entrar — segurança contra abuso de cadastros falsos).
async function marcarComoAtiva(id) {
  await poolCore.query(
    `UPDATE usuarios
        SET status='ativa',
            telefone_validado_em=COALESCE(telefone_validado_em, NOW()),
            atualizado_em=NOW()
      WHERE id=$1 AND status<>'arquivada'`,
    [id]
  );
}

// ── TROCA DE TELEFONE PRINCIPAL ──────────────────────────
// Move o atual pra telefones_historicos.ativo=TRUE (preserva histórico)
// e instala o novo em usuarios.telefone / telefone_formatado.
// Sem validação de duplicata — admin tem controle total. Aluna que faz
// pelo app dela passa por validação via magic no número novo.
async function trocarTelefonePrincipal(usuarioId, novoTelefone, novoTelefoneFormatado) {
  const u = await poolCore.query(
    `SELECT telefone, telefone_formatado FROM usuarios WHERE id=$1`, [usuarioId]);
  if (!u.rows.length) throw new Error('Usuário não encontrado');

  const tel_atual_raw = u.rows[0].telefone;
  const tel_atual_fmt = u.rows[0].telefone_formatado;

  // Se é igual, não faz nada
  if (tel_atual_raw === novoTelefone) return;

  // 1. Move atual pra histórico (se ainda não está lá)
  if (tel_atual_raw) {
    await poolCore.query(
      `INSERT INTO telefones_historicos (usuario_id, telefone, telefone_formatado, origem, ativo)
       VALUES ($1, $2, $3, 'admin_trocou', TRUE)
       ON CONFLICT DO NOTHING`,
      [usuarioId, tel_atual_raw, tel_atual_fmt]
    );
  }

  // 2. Atualiza usuario com o novo
  await poolCore.query(
    `UPDATE usuarios
        SET telefone=$1, telefone_formatado=$2, atualizado_em=NOW()
      WHERE id=$3`,
    [novoTelefone, novoTelefoneFormatado || novoTelefone, usuarioId]
  );
}

// ── CPF: normalização e validação ────────────────────────
// Sempre armazenamos somente dígitos. Validação por checksum padrão BR.

function normalizarCpf(cpf) {
  if (!cpf) return null;
  const digitos = String(cpf).replace(/\D/g, '');
  return digitos || null;
}

function validarCpf(cpf) {
  const c = normalizarCpf(cpf);
  if (!c || c.length !== 11) return false;
  // Rejeita sequências triviais (111.111.111-11 etc)
  if (/^(\d)\1{10}$/.test(c)) return false;
  // Checksum dígito 1
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(c[i], 10) * (10 - i);
  let d1 = 11 - (soma % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;
  // Checksum dígito 2
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(c[i], 10) * (11 - i);
  let d2 = 11 - (soma % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(c[10], 10);
}

// ── DUPLICIDADE: verifica se algum identificador conflita com OUTRA conta ──
// Retorna { campo, conflito } no PRIMEIRO conflito encontrado, ou null se OK.
// `campo`     = 'telefone' | 'email' | 'cpf'
// `conflito`  = { id, nome, telefone_formatado, email } da outra conta
//
// Se usuarioIdAtual=null, é uma criação (verifica contra TODAS as contas).
// Se usuarioIdAtual=ID, é edição (ignora a própria conta).
async function verificarDuplicidade({ usuarioIdAtual = null, telefone = null, email = null, cpf = null } = {}) {
  const idAtual = usuarioIdAtual || '00000000-0000-0000-0000-000000000000';

  // Telefone — checa em usuarios E em telefones_historicos.ativo=TRUE
  if (telefone && telefone.trim()) {
    const tel = telefone.trim();
    // Em usuarios.telefone
    const r1 = await poolCore.query(
      `SELECT id, nome, telefone_formatado, email FROM usuarios
        WHERE telefone=$1 AND id<>$2 LIMIT 1`,
      [tel, idAtual]
    );
    if (r1.rows.length) return { campo: 'telefone', conflito: r1.rows[0] };

    // Em telefones_historicos
    const r2 = await poolCore.query(
      `SELECT u.id, u.nome, u.telefone_formatado, u.email
         FROM telefones_historicos h
         JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.telefone=$1 AND h.ativo=TRUE AND u.id<>$2 LIMIT 1`,
      [tel, idAtual]
    );
    if (r2.rows.length) return { campo: 'telefone_historico', conflito: r2.rows[0] };
  }

  // Email
  if (email && email.trim()) {
    const e = email.trim().toLowerCase();
    const r = await poolCore.query(
      `SELECT id, nome, telefone_formatado, email FROM usuarios
        WHERE LOWER(email)=$1 AND id<>$2 LIMIT 1`,
      [e, idAtual]
    );
    if (r.rows.length) return { campo: 'email', conflito: r.rows[0] };
  }

  // CPF
  if (cpf) {
    const c = normalizarCpf(cpf);
    if (c) {
      const r = await poolCore.query(
        `SELECT id, nome, telefone_formatado, email FROM usuarios
          WHERE cpf=$1 AND id<>$2 LIMIT 1`,
        [c, idAtual]
      );
      if (r.rows.length) return { campo: 'cpf', conflito: r.rows[0] };
    }
  }

  return null;
}

// ── Busca por QUALQUER identificador ──────────────────────
// Útil pro webhook Kiwify futuro: "achei essa pessoa por telefone, email OU cpf?"
async function buscarUsuarioPorIdentificador({ telefone, email, cpf } = {}) {
  if (telefone) {
    const r = await poolCore.query(
      `SELECT u.* FROM usuarios u
        WHERE u.telefone=$1 OR u.telefone_formatado=$1
           OR u.id IN (SELECT usuario_id FROM telefones_historicos
                        WHERE (telefone=$1 OR telefone_formatado=$1) AND ativo=TRUE)
        LIMIT 1`,
      [telefone]
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (email) {
    const r = await poolCore.query(
      `SELECT * FROM usuarios WHERE LOWER(email)=$1 LIMIT 1`,
      [email.toLowerCase()]
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (cpf) {
    const c = normalizarCpf(cpf);
    if (c) {
      const r = await poolCore.query(
        `SELECT * FROM usuarios WHERE cpf=$1 LIMIT 1`,
        [c]
      );
      if (r.rows[0]) return r.rows[0];
    }
  }
  return null;
}

// ── ENDEREÇOS ─────────────────────────────────────────────
// 1 aluna = N endereços. Sem validação de duplicata.

async function listarEnderecos(usuarioId) {
  const r = await poolCore.query(
    `SELECT * FROM enderecos WHERE usuario_id=$1
      ORDER BY principal DESC, criado_em DESC`,
    [usuarioId]
  );
  return r.rows;
}

async function criarEndereco(usuarioId, dados) {
  const { cep, rua, numero, complemento, bairro, cidade, estado, tipo, principal } = dados || {};
  // Se vai ser principal, desmarca os outros antes
  if (principal) {
    await poolCore.query(`UPDATE enderecos SET principal=FALSE WHERE usuario_id=$1`, [usuarioId]);
  }
  const r = await poolCore.query(
    `INSERT INTO enderecos (usuario_id, cep, rua, numero, complemento, bairro, cidade, estado, tipo, principal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [usuarioId, cep||null, rua||null, numero||null, complemento||null,
     bairro||null, cidade||null, estado||null, tipo||'casa', !!principal]
  );
  return r.rows[0];
}

async function atualizarEndereco(enderecoId, usuarioId, dados) {
  if (dados.principal) {
    await poolCore.query(
      `UPDATE enderecos SET principal=FALSE WHERE usuario_id=$1 AND id<>$2`,
      [usuarioId, enderecoId]
    );
  }
  const campos = ['cep','rua','numero','complemento','bairro','cidade','estado','tipo','principal'];
  const sets = [];
  const params = [];
  for (const c of campos) {
    if (dados[c] !== undefined) {
      params.push(dados[c]); sets.push(`${c}=$${params.length}`);
    }
  }
  if (!sets.length) return null;
  params.push(enderecoId, usuarioId);
  const r = await poolCore.query(
    `UPDATE enderecos SET ${sets.join(', ')}, atualizado_em=NOW()
      WHERE id=$${params.length-1} AND usuario_id=$${params.length}
      RETURNING *`,
    params
  );
  return r.rows[0];
}

async function deletarEndereco(enderecoId, usuarioId) {
  const r = await poolCore.query(
    `DELETE FROM enderecos WHERE id=$1 AND usuario_id=$2`,
    [enderecoId, usuarioId]
  );
  return r.rowCount > 0;
}

module.exports = {
  buscarUsuarioPorTelefone,
  buscarUsuarioPorTelefoneComOrigem,
  arquivarUsuario,
  desarquivarUsuario,
  apagarUsuarioPermanente,
  marcarComoAtiva,
  trocarTelefonePrincipal,
  // identidade
  normalizarCpf,
  validarCpf,
  verificarDuplicidade,
  buscarUsuarioPorIdentificador,
  // endereços
  listarEnderecos,
  criarEndereco,
  atualizarEndereco,
  deletarEndereco,
  buscarUsuarioPorId,
  criarOuAtualizarUsuario,
  atualizarUsuario,
  criarOTP,
  validarOTP,
  limparOTPsExpirados,
  criarMagicToken,
  validarMagicToken,
  criarSolicitacaoAcesso,
  buscarSolicitacaoPorToken,
  marcarSolicitacaoUsada,
  deletarSolicitacao,
  detectarTokenNaMensagem,
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
