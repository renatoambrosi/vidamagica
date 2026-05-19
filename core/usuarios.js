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

async function criarMagicToken(telefone, tipo, ttlMin = 10, deviceFingerprint = null) {
  if (!['magic_login', 'magic_boas_vindas', 'reset_senha'].includes(tipo)) {
    throw new Error(`tipo inválido: ${tipo}`);
  }
  const token = gerarTokenMagico();
  // deviceFingerprint herdado da solicitação de acesso (acesso_solicitacoes.device_fingerprint).
  // Quando aluna clicar no link, /login-magic compara fingerprint do request com este.
  const fpJson = deviceFingerprint ? JSON.stringify(deviceFingerprint) : null;
  await poolCore.query(
    `INSERT INTO otp_tokens (telefone, codigo, canal, token, tipo, expira_em, device_fingerprint)
     VALUES ($1, '', 'whatsapp', $2, $3, NOW() + $4::interval, $5::jsonb)`,
    [telefone, token, tipo, `${ttlMin} minutes`, fpJson]
  );
  return token;
}

// Validação one-time: marca usado=TRUE, retorna a linha completa (incluindo
// device_fingerprint pra quem chamou comparar). NÃO compara aqui — quem chama
// (/login-magic) decide se valida fingerprint ou aceita qualquer dispositivo
// (ex: reset_senha pode ser flexível).
async function validarMagicToken(token, tiposPermitidos) {
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
  return r.rows[0];  // tem .telefone, .tipo, .device_fingerprint
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

async function criarSolicitacaoAcesso(telefone, ttlMin = 5, deviceFingerprint = null) {
  // Limpa tokens expirados de todos os usuários (housekeeping a cada chamada)
  await poolCore.query(`DELETE FROM acesso_solicitacoes WHERE expira_em < NOW()`);

  // deviceFingerprint: objeto { device_id, ua, lang, tz, screen } do dispositivo
  // que pediu o acesso. Salva em JSONB pra magic token herdar depois.
  const fpJson = deviceFingerprint ? JSON.stringify(deviceFingerprint) : null;

  // Tenta gerar token único (raríssimo colidir, mas blindando)
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const token = gerarTokenSolicitacao();
    try {
      const r = await poolCore.query(
        `INSERT INTO acesso_solicitacoes (token, telefone, expira_em, device_fingerprint)
         VALUES ($1, $2, NOW() + $3::interval, $4::jsonb)
         RETURNING token, criado_em, expira_em`,
        [token, telefone, `${ttlMin} minutes`, fpJson]
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

// ── ARQUIVAR / DESATIVAR / EXCLUIR CONTA / LEGADO ────────
// Princípio: aluna NUNCA apaga de verdade. Pedido dela = arquiva
// (caminho A/B) ou vira legado (caminho C). Apenas admin tem o botão
// "Apagar permanentemente" (DELETE em cascata, em apagarUsuarioPermanente).
//
// Vocabulário pra aluna:
//   - "Desativar conta"             (caminho A: slide 1 = Não)
//   - "Desativar conta"             (caminho B: slide 1 = Sim, slide 2 = Não)
//   - "Excluir conta permanentemente" (caminho C: slide 1 = Sim, slide 2 = Sim)
//
// Internamente:
//   - A: status='arquivada', nada mais. Reativa silenciosa via OTP → tudo volta.
//   - B: status='arquivada', + tornarLegado(Jornada+Materiais+Relatos). Reativa
//        via OTP → identidade volta, bloco legado permanece invisível pra aluna.
//   - C: status='legado'. Reativação NÃO é silenciosa: ela faz cadastro novo,
//        sistema reaproveita o registro existente (atualiza nome/email novos)
//        mas os dados antigos permanecem com eh_legado=TRUE (invisíveis pra
//        ela; admin vê na aba Legado). Materiais só voltam via Kiwify futuro.
//
// Opções:
//   - por: 'admin' | 'aluna' (default 'admin'). arquivada_por='aluna' permite
//     reativação silenciosa. arquivada_por='admin' segue bloqueada (só admin
//     desarquiva).
//   - motivo: texto livre.
//   - deseja_excluir: slide 1 do modal. Se TRUE, dispara tornarLegado do bloco.
//   - deletar_dados_pessoais: slide 2 do modal. Se TRUE (e deseja_excluir TRUE),
//     muda status pra 'legado' e tornarLegado é total.

async function arquivarUsuario(id, opts = {}) {
  const {
    por = 'admin',
    motivo = null,
    deseja_excluir = false,
    deletar_dados_pessoais = false,
  } = opts;

  // Caminho C exige caminho B antes: deletar_dados_pessoais só faz sentido
  // se deseja_excluir for TRUE. Defensivo — se vier inconsistente, segue B.
  const ehCaminhoC = !!(deseja_excluir && deletar_dados_pessoais);
  const ehCaminhoB = !!deseja_excluir && !ehCaminhoC;
  const statusAlvo = ehCaminhoC ? 'legado' : 'arquivada';

  await poolCore.query(
    `UPDATE usuarios
        SET arquivada=TRUE,
            status=$4,
            arquivada_em=NOW(),
            arquivada_por=$2,
            arquivada_motivo=$3,
            atualizado_em=NOW()
      WHERE id=$1`,
    [id, por, motivo, statusAlvo]
  );

  // Revoga todas as sessões — sai imediato de todos os dispositivos
  await poolCore.query(
    `UPDATE sessoes SET revogada=TRUE WHERE usuario_id=$1 AND revogada=FALSE`,
    [id]
  );

  // Caminho B ou C: dispara legado do bloco (Jornada + Materiais + Relatos).
  // Caminho C: também marca tudo agressivamente (libera fingerprint/sessões/
  // sementes/atualizações pra que reativação pareça realmente cadastro novo).
  if (ehCaminhoB || ehCaminhoC) {
    await tornarLegado(id, {
      jornada: true,
      materiais: true,
      relatos: true,
      apagar_consumiveis: ehCaminhoC,
    });
  }
}

// Move blocos da aluna pra LEGADO (eh_legado=TRUE). Dados ficam no banco
// invisíveis pra aluna; admin vê na aba Legado.
//
// Blocos:
//   - jornada:  zera campos derivados em usuarios (perfil_teste, % prosperidade,
//               estagio_arvore, sementes) + marca testes.eh_legado=TRUE.
//   - materiais: marca usuario_produtos.eh_legado=TRUE. Webhook Kiwify futuro
//                pode reativar (eh_legado=FALSE) quando aluna comprar de novo.
//   - relatos:   marca depoimentos.eh_legado=TRUE.
//   - apagar_consumiveis: limpa dispositivos/sementes/atualizações_pendentes
//                         (caminho C, pra reativação parecer cadastro novo).
async function tornarLegado(usuarioId, opts = {}) {
  const {
    jornada = false,
    materiais = false,
    relatos = false,
    apagar_consumiveis = false,
  } = opts;

  if (jornada) {
    await poolCore.query(
      `UPDATE usuarios
          SET perfil_teste=NULL,
              percentual_prosperidade=0,
              sementes=0,
              estagio_arvore='semente',
              atualizado_em=NOW()
        WHERE id=$1`,
      [usuarioId]
    );
    try {
      const { poolTeste } = require('../db');
      await poolTeste.query(`UPDATE testes SET eh_legado=TRUE WHERE usuario_id=$1`, [usuarioId]);
    } catch (err) {
      console.warn('⚠️ tornarLegado testes:', err.message);
    }
  }

  if (materiais) {
    await poolCore.query(
      `UPDATE usuario_produtos SET eh_legado=TRUE, atualizado_em=NOW() WHERE usuario_id=$1`,
      [usuarioId]
    );
  }

  if (relatos) {
    try {
      const { poolComunicacao } = require('../db');
      await poolComunicacao.query(
        `UPDATE depoimentos SET eh_legado=TRUE, atualizado_em=NOW() WHERE usuario_id=$1`,
        [usuarioId]
      );
    } catch (err) {
      console.warn('⚠️ tornarLegado relatos:', err.message);
    }
  }

  if (apagar_consumiveis) {
    // Itens consumíveis (sem valor histórico): limpa pra reativação ficar limpa.
    await poolCore.query(`DELETE FROM sementes WHERE usuario_id=$1`, [usuarioId]);
    await poolCore.query(`DELETE FROM atualizacoes_pendentes WHERE usuario_id=$1`, [usuarioId]);
    await poolCore.query(`DELETE FROM dispositivos WHERE usuario_id=$1`, [usuarioId]);
  }
}

// Helper — aluna que excluiu/desativou a própria conta (vs. arquivada
// pelo admin). Só essas alunas têm reativação silenciosa via OTP de telefone.
function ehArquivadaPorAluna(usuario) {
  if (!usuario) return false;
  const arquivada = !!usuario.arquivada || usuario.status === 'arquivada';
  if (!arquivada) return false;
  return usuario.arquivada_por === 'aluna';
}

function ehLegado(usuario) {
  return usuario?.status === 'legado';
}

function ehBanido(usuario) {
  return usuario?.status === 'banido';
}

// Reativa silenciosamente uma aluna que ela mesma desativou (status='arquivada'
// com arquivada_por='aluna'), no momento em que ela valida OTP de telefone
// num /auth. Funciona pros caminhos A e B do modal:
//   - A: tudo volta visível, animação Kiwify roda com produtos perpétuos ativos.
//   - B: identidade volta, bloco legado permanece invisível (eh_legado filtra).
//
// Aluna nunca vê "bem-vinda de volta" — pra ela é login normal.
async function reativarAlunaSilenciosa(id) {
  await poolCore.query(
    `UPDATE usuarios
        SET arquivada=FALSE,
            status='ativa',
            arquivada_em=NULL,
            arquivada_por=NULL,
            arquivada_motivo=NULL,
            atualizado_em=NOW()
      WHERE id=$1 AND status='arquivada'`,
    [id]
  );

  // Restaura relatos ocultados por arquivamento (oculto_arquivamento).
  // Relatos em legado (eh_legado=TRUE) seguem ocultos — flag separada.
  try {
    const { ocultarRelatosDeAluna } = require('./relatos');
    await ocultarRelatosDeAluna(id, false);
  } catch (err) {
    console.warn('⚠️ Falha ao restaurar relatos na reativação:', err.message);
  }

  // Re-entrega produtos perpétuos ATIVOS e NÃO-legado. Caminho A traz tudo;
  // caminho B traz só o que não foi pro legado (que = vazio, porque B move
  // todos os materiais pro legado; mas o filtro mantém o código correto se
  // a composição variar no futuro).
  try {
    const { criarAtualizacaoCompra } = require('./atualizacoes');
    const r = await poolCore.query(
      `SELECT up.produto_id, p.slug FROM usuario_produtos up
         LEFT JOIN produtos p ON p.id = up.produto_id
        WHERE up.usuario_id = $1 AND up.ativo = TRUE AND up.eh_legado = FALSE`,
      [id]
    );
    for (const row of r.rows) {
      try {
        await criarAtualizacaoCompra(id, {
          produto_slug: row.slug,
          origem: 'reativacao',
        });
      } catch (e) {
        console.warn('⚠️ Falha ao criar atualização de reativação:', e.message);
      }
    }
  } catch (err) {
    console.warn('⚠️ Falha ao re-entregar produtos na reativação:', err.message);
  }
}

// Reativa uma conta em LEGADO (caminho C). Diferente da silenciosa: NÃO
// restaura relatos nem cria animação Kiwify dos produtos antigos. Apenas
// muda status pra 'ativa' — pra aluna parece cadastro novo. Dados antigos
// permanecem com eh_legado=TRUE (invisíveis); Materiais voltam só via
// webhook Kiwify reconhecendo o telefone (eh_legado=FALSE pelo gateway).
async function reativarContaLegado(id) {
  await poolCore.query(
    `UPDATE usuarios
        SET arquivada=FALSE,
            status='ativa',
            arquivada_em=NULL,
            arquivada_por=NULL,
            arquivada_motivo=NULL,
            atualizado_em=NOW()
      WHERE id=$1 AND status='legado'`,
    [id]
  );
}

// ── BANIMENTO ────────────────────────────────────────────
// Banir = bloqueio total de retorno pra esse usuário. O cruzamento por
// vínculos (telefone, email, CPF, fingerprint) impede que ela crie conta
// nova com qualquer dado pessoal já registrado no banimento.
//
// Vínculos coletados automaticamente:
//   - CPF atual
//   - Email atual
//   - Telefone atual + telefones_historicos
//   - Fingerprints dos dispositivos conhecidos
// Admin pode estender via `vinculos_extra` ou desconectar vínculos
// específicos (falso positivo).

async function banirUsuario(usuarioId, { motivo = null, banido_por = 'admin', vinculos_extra = {} } = {}) {
  // Coleta vínculos do usuário
  const r = await poolCore.query(
    `SELECT telefone, email, cpf FROM usuarios WHERE id=$1`,
    [usuarioId]
  );
  const u = r.rows[0];
  if (!u) throw new Error('usuário não encontrado');

  const tels = await poolCore.query(
    `SELECT DISTINCT telefone FROM telefones_historicos WHERE usuario_id=$1`,
    [usuarioId]
  );
  const todosTelefones = [u.telefone, ...tels.rows.map(t => t.telefone)]
    .filter((v, i, a) => v && a.indexOf(v) === i);

  const fps = await poolCore.query(
    `SELECT fingerprint FROM dispositivos WHERE usuario_id=$1 AND fingerprint IS NOT NULL`,
    [usuarioId]
  );
  const fingerprints = fps.rows
    .map(row => {
      const fp = row.fingerprint;
      // device_id é o vínculo forte fingerprint. UA bate frequente entre
      // dispositivos diferentes (não usa sozinho).
      return fp?.device_id || null;
    })
    .filter(Boolean);

  const vinculos = {
    cpf: vinculos_extra.cpf || u.cpf || null,
    emails: [...new Set([
      ...(u.email ? [String(u.email).toLowerCase()] : []),
      ...((vinculos_extra.emails || []).map(e => String(e).toLowerCase())),
    ])],
    telefones: [...new Set([
      ...todosTelefones,
      ...(vinculos_extra.telefones || []),
    ])],
    fingerprints: [...new Set([
      ...fingerprints,
      ...(vinculos_extra.fingerprints || []),
    ])],
  };

  // Marca usuário como banido
  await poolCore.query(
    `UPDATE usuarios SET status='banido', atualizado_em=NOW() WHERE id=$1`,
    [usuarioId]
  );

  // Revoga sessões ativas
  await poolCore.query(
    `UPDATE sessoes SET revogada=TRUE WHERE usuario_id=$1 AND revogada=FALSE`,
    [usuarioId]
  );

  // Cria o registro de banimento
  const b = await poolCore.query(
    `INSERT INTO banimentos (usuario_id, motivo, banido_por, vinculos)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [usuarioId, motivo, banido_por, JSON.stringify(vinculos)]
  );
  return b.rows[0].id;
}

async function desbanirUsuario(banimentoId) {
  const r = await poolCore.query(
    `UPDATE banimentos SET ativo=FALSE, atualizado_em=NOW() WHERE id=$1 AND ativo=TRUE
     RETURNING usuario_id`,
    [banimentoId]
  );
  const userId = r.rows[0]?.usuario_id;
  if (!userId) return false;

  // Restaura status (volta pra 'ativa' se telefone já foi validado, senão 'incompleta')
  await poolCore.query(
    `UPDATE usuarios SET
        status=CASE WHEN telefone_validado_em IS NOT NULL THEN 'ativa' ELSE 'incompleta' END,
        atualizado_em=NOW()
      WHERE id=$1 AND status='banido'`,
    [userId]
  );
  return true;
}

// Remove um vínculo específico do JSONB (falso positivo). Não desbane —
// só libera o vínculo. Tipo: 'cpf' (escalar) | 'emails' | 'telefones' | 'fingerprints' (arrays).
async function desconectarVinculoBanimento(banimentoId, tipo, valor) {
  if (tipo === 'cpf') {
    await poolCore.query(
      `UPDATE banimentos SET vinculos = vinculos - 'cpf', atualizado_em=NOW() WHERE id=$1`,
      [banimentoId]
    );
    return;
  }
  if (!['emails', 'telefones', 'fingerprints'].includes(tipo)) {
    throw new Error(`tipo inválido: ${tipo}`);
  }
  await poolCore.query(
    `UPDATE banimentos
        SET vinculos = jsonb_set(
              vinculos,
              ARRAY[$2::text],
              COALESCE((
                SELECT jsonb_agg(v)
                  FROM jsonb_array_elements_text(vinculos->$2) AS v
                 WHERE v <> $3
              ), '[]'::jsonb)
            ),
            atualizado_em=NOW()
      WHERE id=$1`,
    [banimentoId, tipo, String(valor).toLowerCase()]
  );
}

// Verifica se algum vínculo bate com banimento ativo. Retorna info pro
// registrar tentativa OU null. Chamada em /verificar-existencia, /solicitar-otp
// (modo cadastro), webhook Evolution, e no webhook Kiwify futuro.
async function verificarBanimento({ telefone, email, cpf, fingerprint } = {}) {
  const condicoes = [];
  const valores = [];
  if (telefone) {
    valores.push(telefone);
    condicoes.push(`vinculos->'telefones' ? $${valores.length}`);
  }
  if (email) {
    valores.push(String(email).toLowerCase());
    condicoes.push(`vinculos->'emails' ? $${valores.length}`);
  }
  if (cpf) {
    valores.push(cpf);
    condicoes.push(`vinculos->>'cpf' = $${valores.length}`);
  }
  // Device fingerprint é só um vínculo secundário — pra evitar falso positivo
  // com família/escritório, só conta quando combinada com outro vínculo
  // forte (cpf/email/telefone). Se vier só fingerprint, ignora.
  // (Implementação simples: não inclui fingerprint na query principal aqui.)
  // Admin pode estender vínculos manualmente se quiser que o fingerprint pegue.

  if (!condicoes.length) return null;

  const r = await poolCore.query(
    `SELECT id, usuario_id, motivo, vinculos FROM banimentos
      WHERE ativo=TRUE AND (${condicoes.join(' OR ')})
      LIMIT 1`,
    valores
  );
  const banimento = r.rows[0];
  if (!banimento) return null;

  // Identifica qual vínculo bateu pra log
  let vinculo_bateu = null, valor_bateu = null;
  const v = banimento.vinculos || {};
  if (telefone && Array.isArray(v.telefones) && v.telefones.includes(telefone)) {
    vinculo_bateu = 'telefone'; valor_bateu = telefone;
  } else if (email && Array.isArray(v.emails) && v.emails.includes(String(email).toLowerCase())) {
    vinculo_bateu = 'email'; valor_bateu = String(email).toLowerCase();
  } else if (cpf && v.cpf === cpf) {
    vinculo_bateu = 'cpf'; valor_bateu = cpf;
  }

  return {
    banimento_id: banimento.id,
    usuario_id: banimento.usuario_id,
    motivo: banimento.motivo,
    vinculo_bateu,
    valor_bateu,
  };
}

async function registrarTentativaBanido(banimentoId, { rota, vinculo_bateu, valor_bateu, ip, user_agent, fingerprint } = {}) {
  if (!banimentoId) return;
  try {
    await poolCore.query(
      `INSERT INTO tentativas_banido (banimento_id, rota, vinculo_bateu, valor_bateu, ip, user_agent, fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        banimentoId,
        rota || null,
        vinculo_bateu || null,
        valor_bateu || null,
        ip || null,
        user_agent ? String(user_agent).slice(0, 1000) : null,
        fingerprint ? JSON.stringify(fingerprint) : null,
      ]
    );
  } catch (err) {
    console.warn('⚠️ Falha ao registrar tentativa banido:', err.message);
  }
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
  // Fase 2.4: relatos voltam a aparecer publicamente.
  try {
    const { ocultarRelatosDeAluna } = require('./relatos');
    await ocultarRelatosDeAluna(id, false);
  } catch (err) {
    console.warn('⚠️ Falha ao reexibir relatos da aluna desarquivada:', err.message);
  }
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
  reativarAlunaSilenciosa,
  reativarContaLegado,
  tornarLegado,
  ehArquivadaPorAluna,
  ehLegado,
  ehBanido,
  banirUsuario,
  desbanirUsuario,
  desconectarVinculoBanimento,
  verificarBanimento,
  registrarTentativaBanido,
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
