/* ============================================================
   VIDA MÁGICA — db.js
   Camada de acesso a banco. 4 pools Postgres separados.

   Bancos:
   - poolCore         → identidade, financeiro, produtos, comunidade (Clube)
   - poolTeste        → teste de prosperidade (leads, respostas, perfis)
   - poolMensagens    → chat aluna ↔ atendimento
   - poolComunicacao  → templates, fila, CRM, conteúdo do site/app

   Regras desta camada:
   - SEM pool genérico. Cada módulo importa o pool específico.
   - SEM JOIN entre bancos. Cruzamento é feito no código.
   - Toda tabela é criada com CREATE TABLE IF NOT EXISTS (idempotente).
   - usuario_id em outros bancos é referência LÓGICA (sem FK física).
   - telefone_canonico está sempre presente como chave alternativa.
   ============================================================ */

const { Pool } = require('pg');

const sslConfig = process.env.NODE_ENV === 'production'
  ? { rejectUnauthorized: false }
  : false;

// ── POOLS ───────────────────────────────────────────────────

const poolCore = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
});

const poolTeste = new Pool({
  connectionString: process.env.DATABASE_URL_TESTE,
  ssl: sslConfig,
});

const poolMensagens = new Pool({
  connectionString: process.env.DATABASE_URL_MENSAGENS,
  ssl: sslConfig,
});

const poolComunicacao = new Pool({
  connectionString: process.env.DATABASE_URL_COMUNICACAO,
  ssl: sslConfig,
});

// ── INIT — BANCO 1: CORE ────────────────────────────────────

async function initCore() {
  const c = await poolCore.connect();
  try {
    // Identidade
    await c.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone VARCHAR(30) UNIQUE NOT NULL,
        telefone_formatado VARCHAR(30) NOT NULL,
        email VARCHAR(255),
        email_verificado BOOLEAN DEFAULT FALSE,
        nome VARCHAR(255),
        foto_url TEXT,
        senha_hash TEXT,
        plano VARCHAR(30) DEFAULT 'gratuito',
        plano_expira_em TIMESTAMPTZ,
        subscription_id VARCHAR(100),
        perfil_teste VARCHAR(30),
        percentual_prosperidade INTEGER DEFAULT 0,
        sementes INTEGER DEFAULT 0,
        estagio_arvore VARCHAR(30) DEFAULT 'semente',
        reset_token TEXT,
        reset_token_expira TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_telefone ON usuarios(telefone)`);

    // Migrations idempotentes — caso a tabela já exista sem essas colunas
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN DEFAULT FALSE`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash TEXT`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url TEXT`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_token TEXT`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS reset_token_expira TIMESTAMPTZ`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS origem_cadastro VARCHAR(30)`);
    // valores possíveis: 'kiwify', 'teste', 'cadastro_direto', 'manual_admin', null

    // Histórico de telefones — telefone é chave-âncora, NUNCA apaga.
    // Aluna pode trocar telefone, mas o antigo continua vinculado à conta.
    // Apenas o admin (Renato) pode desvincular pelo painel.
    await c.query(`
      CREATE TABLE IF NOT EXISTS telefones_historicos (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        telefone VARCHAR(30) NOT NULL,
        telefone_formatado VARCHAR(30),
        origem VARCHAR(30),
        ativo BOOLEAN DEFAULT TRUE,
        vinculado_em TIMESTAMPTZ DEFAULT NOW(),
        desvinculado_em TIMESTAMPTZ,
        desvinculado_por UUID,
        observacao TEXT
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_tel_hist_usuario ON telefones_historicos(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_tel_hist_tel_ativo ON telefones_historicos(telefone) WHERE ativo=TRUE`);

    // Solicitações de acesso pendentes (token gerado pelo /auth, validado pelo zap)
    // Aluna digita telefone → toca botão → site gera token → abre wa.me com texto
    // Aluna manda zap → webhook recebe → valida token + telefone → manda magic link
    await c.query(`
      CREATE TABLE IF NOT EXISTS acesso_solicitacoes (
        id SERIAL PRIMARY KEY,
        token VARCHAR(20) UNIQUE NOT NULL,
        telefone VARCHAR(30) NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        expira_em TIMESTAMPTZ NOT NULL,
        usado BOOLEAN DEFAULT FALSE,
        usado_em TIMESTAMPTZ,
        webhook_recebido_em TIMESTAMPTZ,
        magic_token TEXT
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_acesso_token ON acesso_solicitacoes(token) WHERE usado=FALSE`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_acesso_telefone ON acesso_solicitacoes(telefone, criado_em DESC)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS otp_tokens (
        id SERIAL PRIMARY KEY,
        telefone VARCHAR(30) NOT NULL,
        codigo VARCHAR(6) NOT NULL,
        canal VARCHAR(10) DEFAULT 'whatsapp',
        usado BOOLEAN DEFAULT FALSE,
        tentativas INTEGER DEFAULT 0,
        expira_em TIMESTAMPTZ NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        token TEXT,
        tipo VARCHAR(20) DEFAULT 'codigo'
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_otp_telefone ON otp_tokens(telefone)`);
    // Migrations idempotentes
    await c.query(`ALTER TABLE otp_tokens ADD COLUMN IF NOT EXISTS token TEXT`);
    await c.query(`ALTER TABLE otp_tokens ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'codigo'`);
    // tipo: 'codigo' (OTP painel) | 'magic_login' | 'magic_boas_vindas' | 'reset_senha'
    await c.query(`CREATE INDEX IF NOT EXISTS idx_otp_token ON otp_tokens(token) WHERE token IS NOT NULL AND usado=FALSE`);


    await c.query(`
      CREATE TABLE IF NOT EXISTS dispositivos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('mobile','desktop')),
        device_id TEXT NOT NULL,
        fingerprint JSONB,
        nome_amigavel VARCHAR(100),
        ip_primeiro_acesso VARCHAR(45),
        ultimo_acesso TIMESTAMPTZ DEFAULT NOW(),
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(usuario_id, tipo)
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS sessoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        device_id UUID REFERENCES dispositivos(id) ON DELETE CASCADE,
        refresh_token TEXT UNIQUE NOT NULL,
        ip VARCHAR(45),
        user_agent TEXT,
        ultimo_uso TIMESTAMPTZ DEFAULT NOW(),
        expira_em TIMESTAMPTZ NOT NULL,
        revogada BOOLEAN DEFAULT FALSE,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_sessoes_refresh ON sessoes(refresh_token) WHERE revogada=FALSE`);

    // Produtos
    await c.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug VARCHAR(80) UNIQUE NOT NULL,
        nome VARCHAR(255) NOT NULL,
        descricao TEXT,
        tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('curso','ebook','teste','assinatura','livro','outro')),
        acesso_modelo VARCHAR(20) NOT NULL CHECK (acesso_modelo IN ('vitalicio','recorrente')),
        imagem_url TEXT,
        link_lp TEXT,
        link_checkout_padrao TEXT,
        fase VARCHAR(30),
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS produto_gateway_ids (
        id SERIAL PRIMARY KEY,
        produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        gateway VARCHAR(30) NOT NULL CHECK (gateway IN ('kiwify','mercadopago','manual','outro')),
        external_id VARCHAR(255) NOT NULL,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(gateway, external_id)
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS usuario_produtos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        telefone_canonico VARCHAR(30) NOT NULL,
        produto_id UUID NOT NULL REFERENCES produtos(id),
        origem_tipo VARCHAR(20) NOT NULL CHECK (origem_tipo IN ('pagamento','assinatura','cortesia','manual')),
        origem_id UUID,
        acesso_inicio TIMESTAMPTZ DEFAULT NOW(),
        acesso_fim TIMESTAMPTZ,
        ativo BOOLEAN DEFAULT TRUE,
        observacao TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_uprod_telefone ON usuario_produtos(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_uprod_usuario ON usuario_produtos(usuario_id)`);

    // Financeiro
    await c.query(`
      CREATE TABLE IF NOT EXISTS eventos_financeiros (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        gateway VARCHAR(30) NOT NULL,
        evento VARCHAR(80) NOT NULL,
        gateway_transaction_id VARCHAR(255),
        gateway_subscription_id VARCHAR(255),
        payload_bruto JSONB NOT NULL,
        processado BOOLEAN DEFAULT FALSE,
        processado_em TIMESTAMPTZ,
        erro_processamento TEXT,
        recebido_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(gateway, evento, gateway_transaction_id)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_evfin_processado ON eventos_financeiros(processado, recebido_em)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS pagamentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID REFERENCES usuarios(id),
        telefone_canonico VARCHAR(30) NOT NULL,
        gateway VARCHAR(30) NOT NULL,
        gateway_transaction_id VARCHAR(255) NOT NULL,
        gateway_subscription_id VARCHAR(255),
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('venda','renovacao','estorno','chargeback','cortesia')),
        valor NUMERIC(12,2) NOT NULL,
        moeda VARCHAR(3) DEFAULT 'BRL',
        metodo VARCHAR(20) CHECK (metodo IN ('pix','cartao','boleto','manual')),
        status VARCHAR(20) NOT NULL CHECK (status IN ('aprovado','pendente','rejeitado','estornado','cancelado')),
        produto_id UUID REFERENCES produtos(id),
        evento_origem_id UUID REFERENCES eventos_financeiros(id),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        processado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(gateway, gateway_transaction_id, tipo)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_pag_telefone ON pagamentos(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_pag_usuario ON pagamentos(usuario_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS assinaturas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID REFERENCES usuarios(id),
        telefone_canonico VARCHAR(30) NOT NULL,
        produto_id UUID NOT NULL REFERENCES produtos(id),
        gateway VARCHAR(30) NOT NULL,
        gateway_subscription_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('ativo','atrasado','cancelado','reembolsado','chargeback','finalizada')),
        proximo_pagamento TIMESTAMPTZ,
        data_inicio TIMESTAMPTZ DEFAULT NOW(),
        data_fim TIMESTAMPTZ,
        motivo_fim TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(gateway, gateway_subscription_id)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_assin_telefone ON assinaturas(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_assin_usuario ON assinaturas(usuario_id)`);

    // Comunidade (Clube WhatsApp)
    await c.query(`
      CREATE TABLE IF NOT EXISTS membros (
        id SERIAL PRIMARY KEY,
        usuario_id UUID REFERENCES usuarios(id),
        assinatura_id UUID REFERENCES assinaturas(id),
        nome VARCHAR(255),
        email VARCHAR(255),
        telefone VARCHAR(30),
        telefone_formatado VARCHAR(30),
        subscription_id VARCHAR(100) UNIQUE,
        order_id VARCHAR(100),
        payment_method VARCHAR(20),
        status VARCHAR(30) DEFAULT 'ativo',
        grupos_adicionado BOOLEAN DEFAULT FALSE,
        next_payment TIMESTAMPTZ,
        remocao_agendada TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS excecoes (
        id SERIAL PRIMARY KEY,
        telefone VARCHAR(30) UNIQUE NOT NULL,
        nome VARCHAR(255),
        motivo TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS eventos (
        id SERIAL PRIMARY KEY,
        usuario_id UUID REFERENCES usuarios(id),
        subscription_id VARCHAR(100),
        order_id VARCHAR(100),
        telefone VARCHAR(30),
        nome VARCHAR(255),
        evento VARCHAR(50),
        acao VARCHAR(50),
        sucesso BOOLEAN,
        detalhes TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Anti-duplicata do scheduler do Clube — controla se já enviou D-3, D-1, D+5 etc.
    // Vive aqui no Core porque é parte do ciclo de vida da assinatura (membros).
    await c.query(`
      CREATE TABLE IF NOT EXISTS mensagens_enviadas (
        id SERIAL PRIMARY KEY,
        subscription_id VARCHAR(100),
        chave VARCHAR(80),
        enviado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_msg_env_sub ON mensagens_enviadas(subscription_id, chave, enviado_em)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS sementes (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo VARCHAR(50) NOT NULL,
        descricao TEXT,
        quantidade INTEGER DEFAULT 1,
        origem_id TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_sementes_usuario ON sementes(usuario_id)`);

    console.log('✅ Banco Core iniciado');
  } finally {
    c.release();
  }
}

// ── INIT — BANCO 2: TESTE ───────────────────────────────────

async function initTeste() {
  const c = await poolTeste.connect();
  try {
    // Catálogo dos 6 perfis
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_perfis (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(50) UNIQUE NOT NULL,
        nome VARCHAR(100) NOT NULL,
        descricao_curta TEXT,
        descricao_completa TEXT,
        cor VARCHAR(20),
        icone VARCHAR(50),
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Lead do teste — quem fez o teste sem ter conta
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone_canonico VARCHAR(30) NOT NULL,
        nome VARCHAR(255),
        email VARCHAR(255),
        usuario_id UUID,
        utm_source VARCHAR(100),
        utm_medium VARCHAR(100),
        utm_campaign VARCHAR(100),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_teste_leads_tel ON teste_leads(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_teste_leads_usuario ON teste_leads(usuario_id)`);

    // Respostas do teste — uma linha por teste feito
    await c.query(`
      CREATE TABLE IF NOT EXISTS testes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID,
        lead_id UUID REFERENCES teste_leads(id) ON DELETE SET NULL,
        telefone_canonico VARCHAR(30) NOT NULL,
        respostas JSONB NOT NULL,
        contagem JSONB,
        percentuais JSONB,
        perfil_dominante VARCHAR(50),
        percentual_prosperidade INTEGER,
        nivel_prosperidade INTEGER DEFAULT 0,
        gateway_payment_id VARCHAR(255),
        pago BOOLEAN DEFAULT FALSE,
        feito_em TIMESTAMPTZ DEFAULT NOW(),
        CHECK (usuario_id IS NOT NULL OR lead_id IS NOT NULL)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_telefone ON testes(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_usuario ON testes(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_lead ON testes(lead_id)`);

    console.log('✅ Banco Teste iniciado');
  } finally {
    c.release();
  }
}

// ── INIT — BANCO 3: MENSAGENS ───────────────────────────────

async function initMensagens() {
  const c = await poolMensagens.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS chat_conversas (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL,
        tipo VARCHAR(10) NOT NULL DEFAULT 'suellen' CHECK (tipo IN ('suellen','suporte')),
        plano_chat VARCHAR(20) DEFAULT 'basic' CHECK (plano_chat IN ('basic','prioritario')),
        interacoes_restantes INTEGER,
        prioritario_expira_em TIMESTAMPTZ,
        prioritario_ativado_em TIMESTAMPTZ,
        bloqueada BOOLEAN DEFAULT FALSE,
        favoritada BOOLEAN DEFAULT FALSE,
        ultima_mensagem_em TIMESTAMPTZ DEFAULT NOW(),
        ultima_preview TEXT,
        nao_lidas_suellen INTEGER DEFAULT 0,
        nao_lidas_aluna INTEGER DEFAULT 0,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(usuario_id, tipo)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_chat_conv_usuario ON chat_conversas(usuario_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS chat_mensagens (
        id SERIAL PRIMARY KEY,
        conversa_id INTEGER NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
        usuario_id UUID NOT NULL,
        remetente VARCHAR(10) NOT NULL CHECK (remetente IN ('aluna','suellen')),
        identidade VARCHAR(10) CHECK (identidade IN ('suellen','equipe')),
        tipo VARCHAR(10) NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','imagem','audio')),
        conteudo TEXT,
        url TEXT,
        reply_to_id INTEGER,
        reply_to_conteudo TEXT,
        reply_to_remetente VARCHAR(10),
        reply_to_identidade VARCHAR(10),
        lida BOOLEAN DEFAULT FALSE,
        lida_em TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_mensagens(conversa_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_chat_msg_usuario ON chat_mensagens(usuario_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS chat_pacotes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL,
        interacoes INTEGER NOT NULL,
        valor_pago NUMERIC(10,2),
        ativado_em TIMESTAMPTZ DEFAULT NOW(),
        expira_em TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'ativo',
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_chat_pac_usuario ON chat_pacotes(usuario_id)`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
        id SERIAL PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        keys JSONB NOT NULL,
        user_agent TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        ativo BOOLEAN DEFAULT TRUE
      )
    `);

    console.log('✅ Banco Mensagens iniciado');
  } finally {
    c.release();
  }
}

// ── INIT — BANCO 4: COMUNICAÇÃO ─────────────────────────────

async function initComunicacao() {
  const c = await poolComunicacao.connect();
  try {
    // Templates
    await c.query(`
      CREATE TABLE IF NOT EXISTS templates_mensagens (
        chave VARCHAR(80) PRIMARY KEY,
        titulo VARCHAR(200),
        texto TEXT NOT NULL,
        categoria VARCHAR(40) DEFAULT 'outros',
        ordem INTEGER DEFAULT 99,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Migrations idempotentes
    await c.query(`ALTER TABLE templates_mensagens ADD COLUMN IF NOT EXISTS categoria VARCHAR(40) DEFAULT 'outros'`);
    await c.query(`ALTER TABLE templates_mensagens ADD COLUMN IF NOT EXISTS ordem INTEGER DEFAULT 99`);

    // Fila persistente — agora trabalhada por ATENDIMENTO (1 atendimento = 1+ msgs em sequência)
    await c.query(`
      CREATE TABLE IF NOT EXISTS fila_mensagens (
        id SERIAL PRIMARY KEY,
        telefone VARCHAR(30) NOT NULL,
        mensagem TEXT NOT NULL,
        nome VARCHAR(255),
        origem VARCHAR(50),
        imediato BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','enviando','enviado','erro','cancelado')),
        tentativas INTEGER DEFAULT 0,
        erro TEXT,
        entrou_em TIMESTAMPTZ DEFAULT NOW(),
        enviado_em TIMESTAMPTZ,
        ordem INTEGER DEFAULT 0,
        atendimento_id UUID,
        ordem_no_atendimento INTEGER DEFAULT 1,
        categoria VARCHAR(50),
        tipo VARCHAR(10) DEFAULT 'ativo' CHECK (tipo IN ('ativo','reativo')),
        prioridade INTEGER DEFAULT 2,
        template_chave VARCHAR(80)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_fila_status ON fila_mensagens(status, ordem, entrou_em)`);

    // Migrations idempotentes — caso a tabela já exista sem as colunas novas
    await c.query(`ALTER TABLE fila_mensagens ADD COLUMN IF NOT EXISTS atendimento_id UUID`);
    await c.query(`ALTER TABLE fila_mensagens ADD COLUMN IF NOT EXISTS ordem_no_atendimento INTEGER DEFAULT 1`);
    await c.query(`ALTER TABLE fila_mensagens ADD COLUMN IF NOT EXISTS categoria VARCHAR(50)`);
    await c.query(`ALTER TABLE fila_mensagens ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) DEFAULT 'ativo'`);
    await c.query(`ALTER TABLE fila_mensagens ADD COLUMN IF NOT EXISTS prioridade INTEGER DEFAULT 2`);
    await c.query(`ALTER TABLE fila_mensagens ADD COLUMN IF NOT EXISTS template_chave VARCHAR(80)`);

    await c.query(`CREATE INDEX IF NOT EXISTS idx_fila_atendimento ON fila_mensagens(atendimento_id, ordem_no_atendimento)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_fila_pendentes ON fila_mensagens(status, prioridade, entrou_em) WHERE status='pendente'`);

    // Categorias do gateway (pausa por categoria)
    await c.query(`
      CREATE TABLE IF NOT EXISTS gateway_categorias (
        chave VARCHAR(50) PRIMARY KEY,
        nome_exibicao VARCHAR(100) NOT NULL,
        emoji VARCHAR(10),
        pausado BOOLEAN DEFAULT FALSE,
        ordem INTEGER DEFAULT 0,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed das categorias iniciais
    await c.query(`
      INSERT INTO gateway_categorias (chave, nome_exibicao, emoji, ordem) VALUES
        ('cobranca_clube',     'Cobranças do Clube (D-3, D-1, D+5)', '💰', 1),
        ('convite_sessao',     'Convite sessão diagnóstico',         '🎁', 2),
        ('pos_venda_kiwify',   'Pós-venda Kiwify',                    '🛒', 3),
        ('anuncio_geral',      'Anúncios gerais',                     '📢', 4),
        ('manual_admin',       'Manual do admin',                     '✋', 5)
      ON CONFLICT (chave) DO NOTHING
    `);

    // Histórico de envio
    await c.query(`
      CREATE TABLE IF NOT EXISTS historico_mensagens (
        id SERIAL PRIMARY KEY,
        fila_id INTEGER,
        telefone VARCHAR(30) NOT NULL,
        mensagem TEXT NOT NULL,
        nome VARCHAR(255),
        origem VARCHAR(50),
        sucesso BOOLEAN NOT NULL,
        erro TEXT,
        enviado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Config do gateway — chaves de comportamento
    await c.query(`
      CREATE TABLE IF NOT EXISTS gateway_config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`
      INSERT INTO gateway_config (chave, valor) VALUES
        ('cooldown_entre_msgs_atendimento', '2'),
        ('cooldown_atendimentos_reativos',  '5'),
        ('cooldown_atendimentos_ativos',   '60'),
        ('limite_msgs_dia_ativas',        '200'),
        ('pausado_geral',                'false'),
        ('cooldown_segundos',             '60'),
        ('pausado',                      'false')
      ON CONFLICT (chave) DO NOTHING
    `);

    // Seed de templates iniciais (Renato edita pelo painel quando quiser)
    // Categorias: 'acesso', 'cobranca', 'pos_venda', 'convites', 'otp_painel'
    await c.query(`
      INSERT INTO templates_mensagens (chave, titulo, texto, categoria, ordem) VALUES
        ('magic_login_msg1',
         'Magic Link — Login (volta para casa)',
         E'Que bom te ver de volta, {nome}. ✨\nSeu Magic Link está pronto!\nToque no caminho abaixo pra entrar:',
         'acesso', 1),
        ('magic_boas_vindas_msg1',
         'Magic Link — Primeiro acesso',
         E'Bem-vinda, {nome}. 🌟\nEstávamos te esperando.\nSeu Magic Link está pronto.\nToque no caminho abaixo para acessar:',
         'acesso', 2),
        ('reset_senha_msg1',
         'Reset de senha',
         E'Olá, {nome}. 🔐\nRecebemos seu pedido pra criar uma nova senha.\nToque no caminho abaixo pra começar:',
         'acesso', 3),
        ('primeiro_contato_sem_cadastro',
         'Primeiro contato — sem cadastro',
         E'Seja bem-vinda ao Vida Mágica. ✨\n\nAqui é onde pessoas se reencontram com o próprio caminho — através de uma mente alinhada com Deus, de um método eficaz e nossos produtos de autoconhecimento.\n\nPra começar sua jornada com a gente, toque no caminho abaixo. É lá que você vai:\n\n🌱 Fazer o Teste do Subconsciente\n📿 Iniciar sua trilha de conhecimento\n💛 Falar com a Su e nosso suporte\n\nTe vejo por lá.',
         'acesso', 4),
        ('telefone_alterado',
         'Telefone alterado — número antigo tentou logar',
         E'Olá. ✨\nEsta conta teve seu número alterado.\nFaça o login utilizando seu número atual.',
         'acesso', 5),
        ('cobranca_clube_d_menos_3',
         'Cobrança Clube — 3 dias antes',
         E'Olá, {nome}. 💛\nSua jornada no Clube renova em 3 dias.\nPra continuar com a gente sem pausa, deixamos o caminho abaixo:',
         'cobranca', 1),
        ('cobranca_clube_d_menos_1',
         'Cobrança Clube — 1 dia antes',
         E'{nome}, sua renovação chega amanhã. ✨\nPra seguir com a gente sem interrupção, toque no caminho abaixo:',
         'cobranca', 2),
        ('cobranca_clube_d_mais_5',
         'Cobrança Clube — 5 dias em atraso',
         E'{nome}, sentimos sua falta no Clube. 💛\nSua mensalidade ficou pendente há 5 dias.\nPra voltar pra dentro, toque no caminho abaixo:',
         'cobranca', 3),
        ('pos_venda_kiwify',
         'Pós-venda — boas-vindas após compra',
         E'Bem-vinda ao Vida Mágica, {nome}. 💛\nSua jornada começa agora.\nSeu acesso está pronto. Toque no caminho abaixo:',
         'pos_venda', 1),
        ('convite_sessao_diagnostico',
         'Convite — Sessão de Diagnóstico',
         E'Olá, {nome}. ✨\nTe queremos perto neste sábado.\nSua Sessão de Diagnóstico está reservada — toque no caminho abaixo pra confirmar:',
         'convites', 1),
        ('otp_painel_admin',
         'OTP — Painel Admin',
         E'{nome}, seu acesso ao Painel Admin do Vida Mágica está pronto.\nCódigo: *{codigo}*\nVálido por 10 minutos.',
         'otp_painel', 1),
        ('otp_painel_atendimento',
         'OTP — Painel de Atendimento',
         E'{nome}, seu acesso ao Painel de Atendimento do Vida Mágica está pronto.\nCódigo: *{codigo}*\nVálido por 10 minutos.',
         'otp_painel', 2)
      ON CONFLICT (chave) DO NOTHING
    `);

    // Update categoria/ordem em templates JÁ existentes (caso tenham sido seedados antes do schema novo)
    await c.query(`
      UPDATE templates_mensagens SET categoria = CASE chave
        WHEN 'magic_login_msg1'              THEN 'acesso'
        WHEN 'magic_boas_vindas_msg1'        THEN 'acesso'
        WHEN 'reset_senha_msg1'              THEN 'acesso'
        WHEN 'primeiro_contato_sem_cadastro' THEN 'acesso'
        WHEN 'telefone_alterado'             THEN 'acesso'
        WHEN 'cobranca_clube_d_menos_3'      THEN 'cobranca'
        WHEN 'cobranca_clube_d_menos_1'      THEN 'cobranca'
        WHEN 'cobranca_clube_d_mais_5'       THEN 'cobranca'
        WHEN 'pos_venda_kiwify'              THEN 'pos_venda'
        WHEN 'convite_sessao_diagnostico'    THEN 'convites'
        WHEN 'otp_painel_admin'              THEN 'otp_painel'
        WHEN 'otp_painel_atendimento'        THEN 'otp_painel'
        ELSE COALESCE(categoria, 'outros')
      END
      WHERE categoria IS NULL OR categoria='outros'
    `);

    // CRM — Sessão de Diagnóstico
    await c.query(`
      CREATE TABLE IF NOT EXISTS sessoes_diagnostico (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone_canonico VARCHAR(30) NOT NULL,
        usuario_id UUID,
        lead_id UUID,
        nome VARCHAR(255) NOT NULL,
        data_sessao DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'confirmado'
          CHECK (status IN ('confirmado','cancelado','passado','compareceu','faltou')),
        confirmado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_sd_telefone ON sessoes_diagnostico(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_sd_data ON sessoes_diagnostico(data_sessao, status)`);

    // CRM — Funil de leads (vindo do teste, com estágio)
    await c.query(`
      CREATE TABLE IF NOT EXISTS leads_funil (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone_canonico VARCHAR(30) NOT NULL,
        nome VARCHAR(255),
        email VARCHAR(255),
        usuario_id UUID,
        teste_id UUID,
        status_funil VARCHAR(30) NOT NULL DEFAULT 'aguardando_convite'
          CHECK (status_funil IN ('aguardando_convite','convite_enviado','confirmado','cancelado','passado')),
        uid_origem VARCHAR(50),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_funil_telefone ON leads_funil(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_funil_status ON leads_funil(status_funil)`);

    // Promoções
    await c.query(`
      CREATE TABLE IF NOT EXISTS promocoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        produto_id UUID,
        nome VARCHAR(200) NOT NULL,
        tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('desconto_pct','desconto_fixo','parcelamento_especial')),
        valor NUMERIC(10,2),
        ativa BOOLEAN DEFAULT TRUE,
        inicio TIMESTAMPTZ,
        fim TIMESTAMPTZ,
        ordem INTEGER DEFAULT 0,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Conteúdo do site/app
    await c.query(`
      CREATE TABLE IF NOT EXISTS depoimentos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        cidade TEXT,
        texto TEXT NOT NULL,
        tags TEXT[] DEFAULT '{}',
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS config (
        chave TEXT PRIMARY KEY,
        dados JSONB NOT NULL,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS feed (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('video','texto','imagem','link')),
        titulo TEXT NOT NULL,
        subtitulo TEXT,
        corpo TEXT,
        url TEXT,
        imagem_url TEXT,
        destaque BOOLEAN DEFAULT FALSE,
        ativo BOOLEAN DEFAULT TRUE,
        ordem INTEGER DEFAULT 0,
        publicado_em TIMESTAMPTZ DEFAULT NOW(),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS precos (
        key TEXT PRIMARY KEY,
        dados JSONB NOT NULL,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── ADMINS — login do painel admin/atendimento (OTP via WhatsApp) ──
    await c.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone_canonico VARCHAR(20) UNIQUE NOT NULL,
        nome VARCHAR(120),
        ativo BOOLEAN DEFAULT TRUE,
        ultimo_acesso TIMESTAMPTZ,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`
      CREATE TABLE IF NOT EXISTS admin_otp_tokens (
        id SERIAL PRIMARY KEY,
        telefone_canonico VARCHAR(20) NOT NULL,
        codigo VARCHAR(6) NOT NULL,
        usado BOOLEAN DEFAULT FALSE,
        tentativas INTEGER DEFAULT 0,
        expira_em TIMESTAMPTZ NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_admin_otp_tel ON admin_otp_tokens(telefone_canonico)`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS admin_sessoes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        escopo VARCHAR(20) NOT NULL CHECK (escopo IN ('admin','atendimento')),
        device_fingerprint TEXT,
        user_agent TEXT,
        ip VARCHAR(45),
        ultimo_uso TIMESTAMPTZ DEFAULT NOW(),
        expira_em TIMESTAMPTZ NOT NULL,
        revogada BOOLEAN DEFAULT FALSE,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessoes_admin ON admin_sessoes(admin_id, escopo) WHERE revogada=FALSE`);

    // Seed: garante que o telefone do Renato existe como admin
    await c.query(`
      INSERT INTO admins (telefone_canonico, nome)
      VALUES ('5562983086320', 'Renato Ambrosi')
      ON CONFLICT (telefone_canonico) DO NOTHING
    `);

    console.log('✅ Banco Comunicação iniciado');
  } finally {
    c.release();
  }
}

// ── INIT GERAL ──────────────────────────────────────────────

async function initDb() {
  await initCore();
  await initTeste();
  await initMensagens();
  await initComunicacao();
  console.log('✅ Todos os bancos iniciados');
}

// ── HEALTH CHECK ────────────────────────────────────────────

async function checkHealth() {
  const status = {};
  const bancos = [
    ['core', poolCore],
    ['teste', poolTeste],
    ['mensagens', poolMensagens],
    ['comunicacao', poolComunicacao],
  ];
  for (const [nome, p] of bancos) {
    try {
      await p.query('SELECT 1');
      status[nome] = 'ok';
    } catch (err) {
      status[nome] = `erro: ${err.message}`;
    }
  }
  return status;
}

module.exports = {
  poolCore,
  poolTeste,
  poolMensagens,
  poolComunicacao,
  initDb,
  checkHealth,
};
