const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS precos (key TEXT PRIMARY KEY, dados JSONB NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS depoimentos (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cidade TEXT, texto TEXT NOT NULL, tags TEXT[] DEFAULT '{}', ordem INTEGER DEFAULT 0, ativo BOOLEAN DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`);
    await client.query(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, dados JSONB NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), telefone VARCHAR(30) UNIQUE NOT NULL, telefone_formatado VARCHAR(30) NOT NULL, email VARCHAR(255), email_verificado BOOLEAN DEFAULT FALSE, nome VARCHAR(255), foto_url TEXT, senha_hash TEXT, plano VARCHAR(30) DEFAULT 'gratuito', plano_expira_em TIMESTAMPTZ, subscription_id VARCHAR(100), perfil_teste VARCHAR(30), percentual_prosperidade INTEGER DEFAULT 0, sementes INTEGER DEFAULT 0, estagio_arvore VARCHAR(30) DEFAULT 'semente', criado_em TIMESTAMPTZ DEFAULT NOW(), atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS otp_tokens (id SERIAL PRIMARY KEY, telefone VARCHAR(30) NOT NULL, codigo VARCHAR(6) NOT NULL, canal VARCHAR(10) DEFAULT 'whatsapp', usado BOOLEAN DEFAULT FALSE, tentativas INTEGER DEFAULT 0, expira_em TIMESTAMPTZ NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_otp_telefone ON otp_tokens(telefone)`);
    await client.query(`CREATE TABLE IF NOT EXISTS dispositivos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('mobile','desktop')), device_id TEXT NOT NULL, fingerprint JSONB, nome_amigavel VARCHAR(100), ip_primeiro_acesso VARCHAR(45), ultimo_acesso TIMESTAMPTZ DEFAULT NOW(), ativo BOOLEAN DEFAULT TRUE, criado_em TIMESTAMPTZ DEFAULT NOW(), UNIQUE(usuario_id, tipo))`);
    await client.query(`CREATE TABLE IF NOT EXISTS sessoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, device_id UUID REFERENCES dispositivos(id) ON DELETE CASCADE, refresh_token TEXT UNIQUE NOT NULL, ip VARCHAR(45), user_agent TEXT, ultimo_uso TIMESTAMPTZ DEFAULT NOW(), expira_em TIMESTAMPTZ NOT NULL, revogada BOOLEAN DEFAULT FALSE, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessoes_refresh ON sessoes(refresh_token) WHERE revogada=FALSE`);
    await client.query(`CREATE TABLE IF NOT EXISTS testes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, respostas JSONB NOT NULL, contagem JSONB NOT NULL, percentuais JSONB NOT NULL, perfil_dominante VARCHAR(30) NOT NULL, percentual_prosperidade INTEGER NOT NULL, nivel_prosperidade INTEGER DEFAULT 0, feito_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_testes_usuario ON testes(usuario_id)`);
    await client.query(`CREATE TABLE IF NOT EXISTS sementes (id SERIAL PRIMARY KEY, usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, tipo VARCHAR(50) NOT NULL, descricao TEXT, quantidade INTEGER DEFAULT 1, origem_id TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sementes_usuario ON sementes(usuario_id)`);
    await client.query(`CREATE TABLE IF NOT EXISTS membros (id SERIAL PRIMARY KEY, usuario_id UUID REFERENCES usuarios(id), nome VARCHAR(255), email VARCHAR(255), telefone VARCHAR(30), telefone_formatado VARCHAR(30), subscription_id VARCHAR(100) UNIQUE, order_id VARCHAR(100), payment_method VARCHAR(20), status VARCHAR(30) DEFAULT 'ativo', grupos_adicionado BOOLEAN DEFAULT FALSE, next_payment TIMESTAMPTZ, remocao_agendada TIMESTAMPTZ, criado_em TIMESTAMPTZ DEFAULT NOW(), atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS excecoes (id SERIAL PRIMARY KEY, telefone VARCHAR(30) UNIQUE NOT NULL, nome VARCHAR(255), motivo TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS mensagens_config (chave VARCHAR(50) PRIMARY KEY, titulo VARCHAR(100), texto TEXT, atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS mensagens_enviadas (id SERIAL PRIMARY KEY, subscription_id VARCHAR(100), chave VARCHAR(50), enviado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS eventos (id SERIAL PRIMARY KEY, usuario_id UUID REFERENCES usuarios(id), subscription_id VARCHAR(100), order_id VARCHAR(100), telefone VARCHAR(30), nome VARCHAR(255), evento VARCHAR(50), acao VARCHAR(50), sucesso BOOLEAN, detalhes TEXT, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS fila_mensagens (id SERIAL PRIMARY KEY, telefone VARCHAR(30) NOT NULL, mensagem TEXT NOT NULL, nome VARCHAR(255), origem VARCHAR(50), imediato BOOLEAN DEFAULT FALSE, status VARCHAR(20) DEFAULT 'pendente', tentativas INTEGER DEFAULT 0, erro TEXT, entrou_em TIMESTAMPTZ DEFAULT NOW(), enviado_em TIMESTAMPTZ, ordem INTEGER DEFAULT 0)`);
    await client.query(`CREATE TABLE IF NOT EXISTS historico_mensagens (id SERIAL PRIMARY KEY, fila_id INTEGER, telefone VARCHAR(30) NOT NULL, mensagem TEXT NOT NULL, nome VARCHAR(255), origem VARCHAR(50), sucesso BOOLEAN NOT NULL, erro TEXT, enviado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`CREATE TABLE IF NOT EXISTS gateway_config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL, atualizado_em TIMESTAMPTZ DEFAULT NOW())`);
    await client.query(`INSERT INTO gateway_config (chave, valor) VALUES ('cooldown_segundos','60'),('pausado','false') ON CONFLICT (chave) DO NOTHING`);
    await inserirMensagensPadrao(client);
    console.log('✅ Banco Vida Mágica iniciado — 15 tabelas');
  } catch (err) {
    console.error('❌ Erro ao iniciar banco:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function inserirMensagensPadrao(client) {
  const msgs = [
    { chave:'d_menos_3', titulo:'D-3 — Aviso antecipado', texto:'Olá, {nome}! 😊\n\nPassando para te lembrar que em 3 dias acontece a renovação da sua assinatura da comunidade.\n\nSe quiser, você já pode renovar agora pelo link no seu e-mail. 💛\n\n— Suellen Seragi' },
    { chave:'d_menos_2', titulo:'D-2 — Lembrete', texto:'Oi, {nome}! 👋\n\nSó um lembrete: sua assinatura renova em 2 dias.\n\n— Suellen Seragi' },
    { chave:'d_menos_1', titulo:'D-1 — Vence amanhã', texto:'{nome}, sua assinatura renova amanhã. ⏳\n\nRenove pelo link no seu e-mail para não perder o acesso.\n\n— Suellen Seragi' },
    { chave:'d_mais_1', titulo:'D+1 — Pagamento não processado', texto:'Olá, {nome}!\n\nIdentificamos que o pagamento ainda não foi processado. ⚠️\n\nRegularize pelo link no seu e-mail. 💛\n\n— Suellen Seragi' },
    { chave:'d_mais_3', titulo:'D+3 — Aviso importante', texto:'{nome}, sua assinatura ainda está com pagamento pendente. ⚠️\n\nPara não perder o acesso, regularize pelo link no seu e-mail.\n\n— Suellen Seragi' },
    { chave:'d_mais_5', titulo:'D+5 — Último aviso', texto:'{nome}, este é o último lembrete. ⛔\n\nSe não regularizado hoje, seu acesso será encerrado.\n\n— Suellen Seragi' },
  ];
  for (const m of msgs) {
    await client.query(
      `INSERT INTO mensagens_config (chave, titulo, texto) VALUES ($1,$2,$3) ON CONFLICT (chave) DO NOTHING`,
      [m.chave, m.titulo, m.texto]
    );
  }
}

// PREÇOS
async function getPrecos() {
  const r = await pool.query('SELECT key, dados FROM precos ORDER BY key');
  const out = {}; r.rows.forEach(row => { out[row.key] = row.dados; }); return out;
}
async function upsertPreco(key, dados) {
  await pool.query(`INSERT INTO precos (key, dados, atualizado_em) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET dados=$2, atualizado_em=NOW()`, [key, JSON.stringify(dados)]);
}

// DEPOIMENTOS
async function getDepoimentos(apenasAtivos = true) {
  const where = apenasAtivos ? 'WHERE ativo=TRUE' : '';
  const r = await pool.query(`SELECT * FROM depoimentos ${where} ORDER BY ordem ASC, id ASC`);
  return r.rows;
}
async function salvarDepoimentos(lista) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM depoimentos');
    for (let i = 0; i < lista.length; i++) {
      const { nome, cidade, texto, tags = [], ativo = true } = lista[i];
      const tagsArr = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [];
      await client.query(`INSERT INTO depoimentos (nome, cidade, texto, tags, ordem, ativo) VALUES ($1,$2,$3,$4,$5,$6)`, [nome, cidade || '', texto, tagsArr, i, ativo]);
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

// CONFIG
async function getConfig(chave = 'site') {
  const r = await pool.query('SELECT dados FROM config WHERE chave=$1', [chave]);
  return r.rows[0]?.dados || {};
}
async function upsertConfig(chave, dados) {
  await pool.query(`INSERT INTO config (chave, dados, atualizado_em) VALUES ($1,$2,NOW()) ON CONFLICT (chave) DO UPDATE SET dados=$2, atualizado_em=NOW()`, [chave, JSON.stringify(dados)]);
}

// USUÁRIOS
async function buscarUsuarioPorTelefone(tel) {
  const r = await pool.query('SELECT * FROM usuarios WHERE telefone_formatado=$1', [tel]);
  return r.rows[0] || null;
}
async function buscarUsuarioPorId(id) {
  const r = await pool.query('SELECT * FROM usuarios WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function criarOuAtualizarUsuario({ telefone, telefone_formatado, nome, email }) {
  const r = await pool.query(
    `INSERT INTO usuarios (telefone, telefone_formatado, nome, email) VALUES ($1,$2,$3,$4)
     ON CONFLICT (telefone) DO UPDATE SET nome=COALESCE(EXCLUDED.nome,usuarios.nome), atualizado_em=NOW() RETURNING *`,
    [telefone, telefone_formatado, nome || null, email || null]
  );
  return r.rows[0];
}
async function atualizarUsuario(id, campos) {
  const keys = Object.keys(campos);
  const sets = keys.map((k, i) => `${k}=$${i+2}`).join(', ');
  const r = await pool.query(`UPDATE usuarios SET ${sets}, atualizado_em=NOW() WHERE id=$1 RETURNING *`, [id, ...keys.map(k => campos[k])]);
  return r.rows[0];
}

// OTP
async function criarOTP(telefone, codigo, canal = 'whatsapp', ttlMin = 10) {
  await pool.query(`INSERT INTO otp_tokens (telefone, codigo, canal, expira_em) VALUES ($1,$2,$3, NOW() + $4::interval)`, [telefone, codigo, canal, `${ttlMin} minutes`]);
}
async function validarOTP(telefone, codigo) {
  const r = await pool.query(
    `SELECT * FROM otp_tokens WHERE telefone=$1 AND codigo=$2 AND usado=FALSE AND tentativas<5 AND expira_em>NOW() ORDER BY criado_em DESC LIMIT 1`,
    [telefone, codigo]
  );
  if (!r.rows.length) {
    await pool.query(`UPDATE otp_tokens SET tentativas=tentativas+1 WHERE telefone=$1 AND usado=FALSE AND expira_em>NOW()`, [telefone]);
    return false;
  }
  await pool.query('UPDATE otp_tokens SET usado=TRUE WHERE id=$1', [r.rows[0].id]);
  return true;
}
async function limparOTPsExpirados() {
  await pool.query(`DELETE FROM otp_tokens WHERE expira_em < NOW() - INTERVAL '1 hour'`);
}

// DISPOSITIVOS
async function upsertDispositivo({ usuario_id, tipo, device_id, fingerprint, nome_amigavel, ip }) {
  const r = await pool.query(
    `INSERT INTO dispositivos (usuario_id, tipo, device_id, fingerprint, nome_amigavel, ip_primeiro_acesso)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (usuario_id, tipo) DO UPDATE SET device_id=$3, fingerprint=$4, nome_amigavel=$5, ultimo_acesso=NOW(), ativo=TRUE RETURNING *`,
    [usuario_id, tipo, device_id, JSON.stringify(fingerprint), nome_amigavel, ip]
  );
  return r.rows[0];
}
async function buscarDispositivoAtivo(usuario_id, tipo) {
  const r = await pool.query(`SELECT * FROM dispositivos WHERE usuario_id=$1 AND tipo=$2 AND ativo=TRUE`, [usuario_id, tipo]);
  return r.rows[0] || null;
}
async function listarDispositivosUsuario(usuario_id) {
  const r = await pool.query(`SELECT * FROM dispositivos WHERE usuario_id=$1 ORDER BY ultimo_acesso DESC`, [usuario_id]);
  return r.rows;
}
async function revogarDispositivo(id) {
  await pool.query(`UPDATE dispositivos SET ativo=FALSE WHERE id=$1`, [id]);
  await pool.query(`UPDATE sessoes SET revogada=TRUE WHERE device_id=$1`, [id]);
}

// SESSÕES
async function criarSessao({ usuario_id, device_id, refresh_token, ip, user_agent, diasExpiracao = 30 }) {
  const r = await pool.query(
    `INSERT INTO sessoes (usuario_id, device_id, refresh_token, ip, user_agent, expira_em) VALUES ($1,$2,$3,$4,$5, NOW() + $6::interval) RETURNING *`,
    [usuario_id, device_id, refresh_token, ip, user_agent, `${diasExpiracao} days`]
  );
  return r.rows[0];
}
async function buscarSessaoPorRefreshToken(token) {
  const r = await pool.query(
    `SELECT s.*, u.id as uid, u.nome, u.email, u.telefone_formatado, u.plano, u.perfil_teste, u.percentual_prosperidade, u.sementes, u.estagio_arvore
     FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id
     WHERE s.refresh_token=$1 AND s.revogada=FALSE AND s.expira_em>NOW()`,
    [token]
  );
  return r.rows[0] || null;
}
async function renovarSessao(refresh_token) {
  await pool.query(`UPDATE sessoes SET ultimo_uso=NOW() WHERE refresh_token=$1`, [refresh_token]);
}
async function revogarSessao(refresh_token) {
  await pool.query(`UPDATE sessoes SET revogada=TRUE WHERE refresh_token=$1`, [refresh_token]);
}
async function revogarTodasSessoesUsuario(usuario_id) {
  await pool.query(`UPDATE sessoes SET revogada=TRUE WHERE usuario_id=$1`, [usuario_id]);
}

// TESTE
async function salvarTeste({ usuario_id, respostas, contagem, percentuais, perfil_dominante, percentual_prosperidade }) {
  const nivel = percentual_prosperidade <= 50 ? 1 : percentual_prosperidade <= 80 ? 2 : 3;
  const estagio = perfil_dominante === 'Prosperidade'
    ? (nivel===3 ? 'tree3' : nivel===2 ? 'tree2' : 'tree1') : 'seed';
  const r = await pool.query(
    `INSERT INTO testes (usuario_id, respostas, contagem, percentuais, perfil_dominante, percentual_prosperidade, nivel_prosperidade) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [usuario_id, JSON.stringify(respostas), JSON.stringify(contagem), JSON.stringify(percentuais), perfil_dominante, percentual_prosperidade, nivel]
  );
  await pool.query(
    `UPDATE usuarios SET perfil_teste=$1, percentual_prosperidade=$2, estagio_arvore=$3, atualizado_em=NOW() WHERE id=$4`,
    [perfil_dominante, percentual_prosperidade, estagio, usuario_id]
  );
  return r.rows[0];
}
async function buscarTestes(usuario_id) {
  const r = await pool.query(`SELECT * FROM testes WHERE usuario_id=$1 ORDER BY feito_em DESC`, [usuario_id]);
  return r.rows;
}
async function buscarUltimoTeste(usuario_id) {
  const r = await pool.query(`SELECT * FROM testes WHERE usuario_id=$1 ORDER BY feito_em DESC LIMIT 1`, [usuario_id]);
  return r.rows[0] || null;
}

// SEMENTES
async function adicionarSemente({ usuario_id, tipo, descricao, quantidade = 1, origem_id }) {
  await pool.query(`INSERT INTO sementes (usuario_id, tipo, descricao, quantidade, origem_id) VALUES ($1,$2,$3,$4,$5)`, [usuario_id, tipo, descricao, quantidade, origem_id || null]);
  const r = await pool.query(`UPDATE usuarios SET sementes=sementes+$1, atualizado_em=NOW() WHERE id=$2 RETURNING sementes`, [quantidade, usuario_id]);
  return r.rows[0]?.sementes || 0;
}
async function totalSementes(usuario_id) {
  const r = await pool.query(`SELECT COALESCE(SUM(quantidade),0) as total FROM sementes WHERE usuario_id=$1`, [usuario_id]);
  return parseInt(r.rows[0]?.total || 0);
}
async function historicoSementes(usuario_id) {
  const r = await pool.query(`SELECT * FROM sementes WHERE usuario_id=$1 ORDER BY criado_em DESC`, [usuario_id]);
  return r.rows;
}

// MEMBROS
async function upsertMembro({ nome, email, telefone, telefone_formatado, subscription_id, order_id, payment_method, status, next_payment, usuario_id }) {
  const r = await pool.query(
    `INSERT INTO membros (nome, email, telefone, telefone_formatado, subscription_id, order_id, payment_method, status, next_payment, usuario_id, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (subscription_id) DO UPDATE SET
       nome=EXCLUDED.nome, email=EXCLUDED.email, telefone=EXCLUDED.telefone, telefone_formatado=EXCLUDED.telefone_formatado,
       payment_method=COALESCE(EXCLUDED.payment_method,membros.payment_method), status=EXCLUDED.status, next_payment=EXCLUDED.next_payment,
       usuario_id=COALESCE(EXCLUDED.usuario_id,membros.usuario_id), atualizado_em=NOW() RETURNING *`,
    [nome, email, telefone, telefone_formatado, subscription_id, order_id, payment_method, status, next_payment, usuario_id || null]
  );
  return r.rows[0];
}
async function buscarMembroPorSubscription(subscription_id) {
  const r = await pool.query('SELECT * FROM membros WHERE subscription_id=$1', [subscription_id]);
  return r.rows[0] || null;
}
async function buscarMembroPorTelefone(telefone_formatado) {
  const r = await pool.query('SELECT * FROM membros WHERE telefone_formatado=$1', [telefone_formatado]);
  return r.rows[0] || null;
}
async function marcarGruposAdicionado(subscription_id) {
  await pool.query(`UPDATE membros SET grupos_adicionado=TRUE, status='ativo', atualizado_em=NOW() WHERE subscription_id=$1`, [subscription_id]);
}
async function atualizarStatusMembro(subscription_id, status) {
  await pool.query(`UPDATE membros SET status=$1, atualizado_em=NOW() WHERE subscription_id=$2`, [status, subscription_id]);
}
async function atualizarNextPayment(subscription_id, next_payment) {
  await pool.query(`UPDATE membros SET next_payment=$1, atualizado_em=NOW() WHERE subscription_id=$2`, [next_payment, subscription_id]);
}
async function agendarRemocao(subscription_id, remocao_agendada) {
  await pool.query(`UPDATE membros SET remocao_agendada=$1, atualizado_em=NOW() WHERE subscription_id=$2`, [remocao_agendada, subscription_id]);
}
async function cancelarRemocao(subscription_id) {
  await pool.query(`UPDATE membros SET remocao_agendada=NULL, atualizado_em=NOW() WHERE subscription_id=$1`, [subscription_id]);
}
async function listarMembros() {
  const r = await pool.query('SELECT * FROM membros ORDER BY criado_em DESC');
  return r.rows;
}
async function buscarParaRemocao() {
  const r = await pool.query(`SELECT * FROM membros WHERE remocao_agendada IS NOT NULL AND remocao_agendada<=NOW() AND status!='removido' AND grupos_adicionado=TRUE`);
  return r.rows;
}
async function buscarAtivosParaScheduler() {
  const r = await pool.query(`SELECT * FROM membros WHERE next_payment IS NOT NULL AND status NOT IN ('removido','chargeback') AND grupos_adicionado=TRUE`);
  return r.rows;
}
async function estatisticasMembros() {
  const r = await pool.query(`SELECT COUNT(*) FILTER (WHERE status='ativo') AS ativos, COUNT(*) FILTER (WHERE status='cancelado') AS cancelados, COUNT(*) FILTER (WHERE status='atrasado') AS atrasados, COUNT(*) FILTER (WHERE status='reembolsado') AS reembolsados, COUNT(*) FILTER (WHERE status='chargeback') AS chargebacks, COUNT(*) AS total FROM membros`);
  return r.rows[0];
}

// EXCEÇÕES
async function listarExcecoes() { const r = await pool.query('SELECT * FROM excecoes ORDER BY criado_em DESC'); return r.rows; }
async function adicionarExcecao(telefone, nome, motivo) { await pool.query(`INSERT INTO excecoes (telefone, nome, motivo) VALUES ($1,$2,$3) ON CONFLICT (telefone) DO UPDATE SET nome=EXCLUDED.nome, motivo=EXCLUDED.motivo`, [telefone, nome, motivo]); }
async function removerExcecao(id) { await pool.query('DELETE FROM excecoes WHERE id=$1', [id]); }
async function isExcecao(telefone) { const r = await pool.query('SELECT 1 FROM excecoes WHERE telefone=$1', [telefone]); return r.rows.length > 0; }

// MENSAGENS CONFIG
async function listarMensagensConfig() { const r = await pool.query('SELECT * FROM mensagens_config ORDER BY chave'); return r.rows; }
async function atualizarMensagemConfig(chave, texto) { await pool.query(`UPDATE mensagens_config SET texto=$1, atualizado_em=NOW() WHERE chave=$2`, [texto, chave]); }
async function getMensagem(chave) { const r = await pool.query('SELECT texto FROM mensagens_config WHERE chave=$1', [chave]); return r.rows[0]?.texto || ''; }
async function jaEnviouMensagem(subscription_id, chave) { const r = await pool.query(`SELECT 1 FROM mensagens_enviadas WHERE subscription_id=$1 AND chave=$2 AND enviado_em>=NOW()-INTERVAL '35 days'`, [subscription_id, chave]); return r.rows.length > 0; }
async function registrarMensagemEnviada(subscription_id, chave) { await pool.query(`INSERT INTO mensagens_enviadas (subscription_id, chave) VALUES ($1,$2)`, [subscription_id, chave]); }
async function limparMensagensEnviadas(subscription_id) { await pool.query('DELETE FROM mensagens_enviadas WHERE subscription_id=$1', [subscription_id]); }

// EVENTOS
async function registrarEvento({ usuario_id, subscription_id, order_id, telefone, nome, evento, acao, sucesso, detalhes }) {
  await pool.query(`INSERT INTO eventos (usuario_id, subscription_id, order_id, telefone, nome, evento, acao, sucesso, detalhes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [usuario_id || null, subscription_id, order_id, telefone, nome, evento, acao, sucesso, detalhes]);
}
async function listarEventos(limit = 200) { const r = await pool.query(`SELECT * FROM eventos ORDER BY criado_em DESC LIMIT $1`, [limit]); return r.rows; }

// GATEWAY
async function enfileirarMensagem({ telefone, mensagem, nome, origem, imediato = false }) {
  const r = await pool.query(`INSERT INTO fila_mensagens (telefone, mensagem, nome, origem, imediato, ordem) VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(ordem),0)+1 FROM fila_mensagens WHERE status='pendente')) RETURNING *`, [telefone, mensagem, nome || telefone, origem || 'sistema', imediato]);
  return r.rows[0];
}
async function buscarProximaMensagem() { const r = await pool.query(`SELECT * FROM fila_mensagens WHERE status='pendente' ORDER BY imediato DESC, ordem ASC, entrou_em ASC LIMIT 1`); return r.rows[0] || null; }
async function listarFilaPendente() { const r = await pool.query(`SELECT * FROM fila_mensagens WHERE status='pendente' ORDER BY imediato DESC, ordem ASC, entrou_em ASC`); return r.rows; }
async function marcarMensagemEnviada(id) { await pool.query(`UPDATE fila_mensagens SET status='enviado', enviado_em=NOW() WHERE id=$1`, [id]); }
async function marcarMensagemErro(id, erro) { await pool.query(`UPDATE fila_mensagens SET status='erro', tentativas=tentativas+1, erro=$1 WHERE id=$2`, [erro, id]); }
async function cancelarMensagemFila(id) { await pool.query(`UPDATE fila_mensagens SET status='cancelado' WHERE id=$1 AND status='pendente'`, [id]); }
async function reordenarFila(ids) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i=0;i<ids.length;i++) await client.query(`UPDATE fila_mensagens SET ordem=$1 WHERE id=$2 AND status='pendente'`, [i+1, ids[i]]);
    await client.query('COMMIT');
  } catch(err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}
async function listarHistoricoMensagens(limit = 50) { const r = await pool.query(`SELECT * FROM historico_mensagens ORDER BY enviado_em DESC LIMIT $1`, [limit]); return r.rows; }
async function registrarHistoricoMensagem({ fila_id, telefone, mensagem, nome, origem, sucesso, erro }) {
  const preview = mensagem.substring(0,60).replace(/\n/g,' ');
  await pool.query(`INSERT INTO historico_mensagens (fila_id, telefone, mensagem, nome, origem, sucesso, erro) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [fila_id||null, telefone, preview, nome, origem, sucesso, erro||null]);
}
async function getGatewayConfig() {
  const r = await pool.query('SELECT chave, valor FROM gateway_config');
  const cfg={}; r.rows.forEach(row=>{cfg[row.chave]=row.valor;});
  return { cooldown_ms: parseInt(cfg.cooldown_segundos||'60')*1000, pausado: cfg.pausado==='true' };
}
async function setGatewayConfig(chave, valor) {
  await pool.query(`INSERT INTO gateway_config (chave, valor, atualizado_em) VALUES ($1,$2,NOW()) ON CONFLICT (chave) DO UPDATE SET valor=$2, atualizado_em=NOW()`, [chave, String(valor)]);
}

module.exports = {
  pool, initDb,
  getPrecos, upsertPreco,
  getDepoimentos, salvarDepoimentos,
  getConfig, upsertConfig,
  buscarUsuarioPorTelefone, buscarUsuarioPorId, criarOuAtualizarUsuario, atualizarUsuario,
  criarOTP, validarOTP, limparOTPsExpirados,
  upsertDispositivo, buscarDispositivoAtivo, listarDispositivosUsuario, revogarDispositivo,
  criarSessao, buscarSessaoPorRefreshToken, renovarSessao, revogarSessao, revogarTodasSessoesUsuario,
  salvarTeste, buscarTestes, buscarUltimoTeste,
  adicionarSemente, totalSementes, historicoSementes,
  upsertMembro, buscarMembroPorSubscription, buscarMembroPorTelefone,
  marcarGruposAdicionado, atualizarStatusMembro, atualizarNextPayment,
  agendarRemocao, cancelarRemocao, listarMembros, buscarParaRemocao,
  buscarAtivosParaScheduler, estatisticasMembros,
  listarExcecoes, adicionarExcecao, removerExcecao, isExcecao,
  listarMensagensConfig, atualizarMensagemConfig, getMensagem,
  jaEnviouMensagem, registrarMensagemEnviada, limparMensagensEnviadas,
  registrarEvento, listarEventos,
  enfileirarMensagem, buscarProximaMensagem, listarFilaPendente,
  marcarMensagemEnviada, marcarMensagemErro, cancelarMensagemFila,
  reordenarFila, listarHistoricoMensagens, registrarHistoricoMensagem,
  getGatewayConfig, setGatewayConfig,
};
