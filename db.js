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
    // valores possíveis: 'kiwify', 'teste', 'cadastro_direto', 'manual_admin', 'whatsapp', null

    // Conta arquivada: aluna pediu pra apagar OU admin arquivou.
    // Não loga, não recebe mensagens, mas dados permanecem (reversível).
    // Apenas o admin pode desarquivar / apagar permanentemente.
    // Auditoria de arquivamento (quando admin arquivou OU quando aluna pediu)
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS arquivada BOOLEAN DEFAULT FALSE`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMPTZ`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS arquivada_por VARCHAR(20)`); // 'admin' ou 'aluna'
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS arquivada_motivo TEXT`);

    // Status da conta:
    //   'incompleta' = criada por origem externa, ainda não validou telefone (não loga)
    //   'ativa'      = telefone validado pelo menos uma vez (pode logar)
    //   'arquivada'  = aluna pediu pra apagar OU admin arquivou (não loga)
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'incompleta'`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone_validado_em TIMESTAMPTZ`);

    // Identificadores únicos extras: CPF (1 pessoa = 1 CPF)
    // Data de nascimento (não-único, usado pra aniversário e idade)
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf VARCHAR(14)`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS data_nascimento DATE`);

    // Antes de criar índices únicos, normalizar strings vazias pra NULL.
    // Cadastros antigos gravavam email='' quando vazio — isso quebra o índice
    // porque o WHERE email IS NOT NULL não filtra string vazia.
    await c.query(`UPDATE usuarios SET email=NULL WHERE email IS NOT NULL AND TRIM(email)=''`);
    await c.query(`UPDATE usuarios SET cpf=NULL WHERE cpf IS NOT NULL AND TRIM(cpf)=''`);

    // Limpar DUPLICATAS REAIS antes de criar índice único.
    // Mantém a conta mais RECENTE de cada grupo, deleta as antigas.
    // (regra: criação mais nova = a que tem dados mais completos do trabalho atual)
    const dupEmails = await c.query(`
      SELECT LOWER(email) AS email_norm, ARRAY_AGG(id ORDER BY criado_em DESC) AS ids
        FROM usuarios
       WHERE email IS NOT NULL
       GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
    `);
    for (const row of dupEmails.rows) {
      const [manter, ...apagar] = row.ids;
      console.warn(`⚠ Email duplicado "${row.email_norm}" — mantém ${manter}, apaga ${apagar.length} antiga(s)`);
      await c.query(`DELETE FROM usuarios WHERE id = ANY($1::uuid[])`, [apagar]);
    }

    const dupCpfs = await c.query(`
      SELECT cpf, ARRAY_AGG(id ORDER BY criado_em DESC) AS ids
        FROM usuarios
       WHERE cpf IS NOT NULL
       GROUP BY cpf
      HAVING COUNT(*) > 1
    `);
    for (const row of dupCpfs.rows) {
      const [manter, ...apagar] = row.ids;
      console.warn(`⚠ CPF duplicado "${row.cpf}" — mantém ${manter}, apaga ${apagar.length} antiga(s)`);
      await c.query(`DELETE FROM usuarios WHERE id = ANY($1::uuid[])`, [apagar]);
    }

    // Índice único em CPF (parcial — permite vários NULLs, bloqueia duplicata real)
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_cpf_unique ON usuarios(cpf) WHERE cpf IS NOT NULL`);
    // Índice único em email (parcial — mesmo motivo)
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_unique ON usuarios(LOWER(email)) WHERE email IS NOT NULL`);

    // Migration de retrocompatibilidade: contas antigas que existiam antes da coluna `status`
    // ficaram como 'incompleta' por default (do ALTER ADD COLUMN). Atualizamos:
    //   - Conta com senha_hash OU já com sessões ativas → consideramos 'ativa' (já logou em algum momento)
    //   - Conta marcada como arquivada → 'arquivada'
    await c.query(`
      UPDATE usuarios SET status='ativa', telefone_validado_em=COALESCE(telefone_validado_em, criado_em)
       WHERE status='incompleta'
         AND (senha_hash IS NOT NULL
              OR id IN (SELECT DISTINCT usuario_id FROM sessoes WHERE revogada=FALSE))
    `);
    await c.query(`UPDATE usuarios SET status='arquivada' WHERE arquivada=TRUE AND status<>'arquivada'`);

    // Mantemos a coluna `arquivada` (boolean) por compatibilidade com queries existentes,
    // mas a fonte da verdade passa a ser `status`. Triggers/queries serão sempre via status.
    // (a coluna boolean continua sendo escrita como espelho)

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

    // Endereços — 1 aluna pode ter VÁRIOS (casa, trabalho, casa da mãe, etc).
    // Sem trava de duplicata: várias alunas podem morar no mesmo CEP/endereço.
    // Campo `principal` indica qual é o padrão pra entregas/cobranças.
    await c.query(`
      CREATE TABLE IF NOT EXISTS enderecos (
        id SERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        cep VARCHAR(10),
        rua VARCHAR(255),
        numero VARCHAR(20),
        complemento VARCHAR(100),
        bairro VARCHAR(100),
        cidade VARCHAR(100),
        estado VARCHAR(2),
        tipo VARCHAR(20) DEFAULT 'casa',
        principal BOOLEAN DEFAULT FALSE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_enderecos_usuario ON enderecos(usuario_id)`);
    // Garante no máximo 1 principal por usuário (parcial — só onde principal=TRUE)
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_enderecos_principal ON enderecos(usuario_id) WHERE principal=TRUE`);

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

    // ── SEED dos produtos do método (3 jornadas) ──
    // Cadastra os produtos canônicos com slug fixo. Admin completa preço/link/descrição depois.
    // ON CONFLICT (slug) DO NOTHING — idempotente, não sobrescreve dados editados.
    await c.query(`
      INSERT INTO produtos (slug, nome, tipo, acesso_modelo, fase, ordem, ativo) VALUES
        ('teste-subconsciente',         'Teste do Subconsciente',          'teste',      'vitalicio',  'fase1', 1, true),
        ('livro-vencendo-medo',         'Vencendo o Medo',                 'livro',      'vitalicio',  'fase1', 2, true),
        ('livro-vencendo-desordem',     'Vencendo a Desordem',             'livro',      'vitalicio',  'fase1', 3, true),
        ('livro-vencendo-validacao',    'Vencendo a Validação',            'livro',      'vitalicio',  'fase1', 4, true),
        ('livro-vencendo-sobrevivencia','Vencendo a Sobrevivência',        'livro',      'vitalicio',  'fase1', 5, true),
        ('curso-ouro-reprogramacao',    'Ouro da Reprogramação Mental',    'curso',      'vitalicio',  'fase1', 6, true),
        ('guia-pratico-reprogramar',    'Guia Prático para Reprogramar a Mente', 'livro','vitalicio',  'fase2', 7, true),
        ('guia-bolso-magica-fluir',     'Guia de Bolso Mágica do Fluir',   'livro',      'vitalicio',  'fase2', 8, true),
        ('livro-tal-maneira',           'A Tal Maneira (Livro)',           'livro',      'vitalicio',  'fase2', 9, true),
        ('curso-lda-biblica',           'Lei da Atração Bíblica',          'curso',      'vitalicio',  'fase2', 10, true),
        ('curso-tal-maneira',           'A Tal Maneira (Curso)',           'curso',      'vitalicio',  'fase3', 11, true),
        ('assinatura-comunidade',       'Comunidade Vida Mágica',          'assinatura', 'recorrente', 'fase1', 12, true)
      ON CONFLICT (slug) DO NOTHING
    `);

    console.log('✅ Banco Core iniciado');
  } finally {
    c.release();
  }
}

// ── INIT — BANCO 2: TESTE ───────────────────────────────────

async function initTeste() {
  const c = await poolTeste.connect();
  try {
    // Catálogo dos 6 perfis (continua existindo, agora com 'sobrevivencia')
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

    // ── VERSIONAMENTO ─────────────────────────────────────
    // Cada versão é um snapshot imutável depois de publicada.
    // Status:
    //   - rascunho:  em edição, ainda não foi para alunas
    //   - ativa:     a versão atual em produção (só uma de cada vez)
    //   - arquivada: foi ativa um dia, hoje é histórico
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_versoes (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'rascunho'
          CHECK (status IN ('rascunho','ativa','arquivada')),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        publicado_em TIMESTAMPTZ,
        arquivado_em TIMESTAMPTZ
      )
    `);
    // Garante no máximo 1 versão ativa por vez
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_versao_ativa
        ON teste_versoes (status) WHERE status = 'ativa'
    `);

    // ── Tabelas do teste — schema MÍNIMO (sem versao_id, sem constraints novas) ──
    // Em deploys antigos as tabelas já existem nesse formato. Nos novos é igual.
    // Os ALTER TABLE abaixo adicionam tudo que falta de forma idempotente.
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_perguntas (
        id SERIAL PRIMARY KEY,
        ordem INTEGER NOT NULL,
        pergunta TEXT NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_alternativas (
        id SERIAL PRIMARY KEY,
        pergunta_ordem INTEGER NOT NULL,
        perfil VARCHAR(50) NOT NULL,
        texto TEXT NOT NULL
      )
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_respostas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES teste_leads(id) ON DELETE CASCADE,
        pergunta_ordem INTEGER NOT NULL,
        perfil VARCHAR(50) NOT NULL,
        respondido_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_resp_lead ON teste_respostas(lead_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_resp_data ON teste_respostas(respondido_em)`);

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

    // ── MIGRAÇÃO ADITIVA: adiciona versao_id e ordem_exibicao se faltarem ──
    await c.query(`
      ALTER TABLE teste_perguntas
        ADD COLUMN IF NOT EXISTS versao_id INTEGER REFERENCES teste_versoes(id) ON DELETE CASCADE
    `);
    await c.query(`
      ALTER TABLE teste_alternativas
        ADD COLUMN IF NOT EXISTS versao_id INTEGER REFERENCES teste_versoes(id) ON DELETE CASCADE
    `);
    await c.query(`
      ALTER TABLE teste_alternativas
        ADD COLUMN IF NOT EXISTS ordem_exibicao INTEGER
    `);
    await c.query(`
      ALTER TABLE teste_respostas
        ADD COLUMN IF NOT EXISTS versao_id INTEGER REFERENCES teste_versoes(id) ON DELETE CASCADE
    `);
    await c.query(`
      ALTER TABLE testes
        ADD COLUMN IF NOT EXISTS versao_id INTEGER REFERENCES teste_versoes(id) ON DELETE RESTRICT
    `);

    // Renomeia 'autossuficiencia' → 'sobrevivencia' em registros antigos (se houver)
    await c.query(`UPDATE teste_alternativas SET perfil='sobrevivencia' WHERE perfil='autossuficiencia'`);
    await c.query(`UPDATE teste_respostas    SET perfil='sobrevivencia' WHERE perfil='autossuficiencia'`);

    // ── Garante que existe a versão v1.0 ──
    // Se não há nenhuma versão, cria v1.0 ativa.
    // Se há perguntas/alternativas órfãs (sem versao_id) de deploys antigos,
    // amarra elas a v1.0 antes de tornar a coluna NOT NULL.
    const versoesExistentes = await c.query(`SELECT COUNT(*)::int AS n FROM teste_versoes`);
    let versaoIdInicial = null;

    if (versoesExistentes.rows[0].n === 0) {
      const v = await c.query(
        `INSERT INTO teste_versoes (nome, status, publicado_em)
         VALUES ('v1.0', 'ativa', NOW())
         RETURNING id`
      );
      versaoIdInicial = v.rows[0].id;
      console.log('✅ Versão v1.0 criada');
    } else {
      // Pega a ativa (se houver) ou a primeira versão como destino da migração
      const ativaR = await c.query(`SELECT id FROM teste_versoes WHERE status='ativa' LIMIT 1`);
      if (ativaR.rows[0]) {
        versaoIdInicial = ativaR.rows[0].id;
      } else {
        const primR = await c.query(`SELECT id FROM teste_versoes ORDER BY id LIMIT 1`);
        if (primR.rows[0]) versaoIdInicial = primR.rows[0].id;
      }
    }

    // Migra dados órfãos para a versão inicial
    if (versaoIdInicial) {
      await c.query(`UPDATE teste_perguntas    SET versao_id=$1 WHERE versao_id IS NULL`, [versaoIdInicial]);
      await c.query(`UPDATE teste_alternativas SET versao_id=$1 WHERE versao_id IS NULL`, [versaoIdInicial]);
      // ordem_exibicao: se for NULL, usa ROW_NUMBER por (versao_id, pergunta_ordem) ordenado por id
      await c.query(`
        UPDATE teste_alternativas a SET ordem_exibicao = sub.rn
          FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY versao_id, pergunta_ordem ORDER BY id) AS rn
              FROM teste_alternativas
             WHERE ordem_exibicao IS NULL
          ) sub
         WHERE a.id = sub.id AND a.ordem_exibicao IS NULL
      `);
      await c.query(`UPDATE teste_respostas SET versao_id=$1 WHERE versao_id IS NULL`, [versaoIdInicial]);
      // testes (concluídos) também ganham versao_id se estiverem órfãos
      await c.query(`UPDATE testes SET versao_id=$1 WHERE versao_id IS NULL`, [versaoIdInicial]);
    }

    // ── Endurece os NOT NULL agora que está tudo preenchido ──
    // Usa DO blocks porque ALTER COLUMN SET NOT NULL não é idempotente.
    await c.query(`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE teste_perguntas ALTER COLUMN versao_id SET NOT NULL;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE teste_alternativas ALTER COLUMN versao_id SET NOT NULL;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE teste_alternativas ALTER COLUMN ordem_exibicao SET NOT NULL;
        EXCEPTION WHEN others THEN NULL; END;
        BEGIN
          ALTER TABLE teste_respostas ALTER COLUMN versao_id SET NOT NULL;
        EXCEPTION WHEN others THEN NULL; END;
      END$$;
    `);

    // ── Constraints únicas e índices ──
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uniq_perg_versao_ordem') THEN
          BEGIN
            ALTER TABLE teste_perguntas
              ADD CONSTRAINT uniq_perg_versao_ordem UNIQUE (versao_id, ordem);
          EXCEPTION WHEN others THEN NULL; END;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uniq_alt_versao_perg_perfil') THEN
          BEGIN
            ALTER TABLE teste_alternativas
              ADD CONSTRAINT uniq_alt_versao_perg_perfil UNIQUE (versao_id, pergunta_ordem, perfil);
          EXCEPTION WHEN others THEN NULL; END;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uniq_alt_versao_perg_ordem') THEN
          BEGIN
            ALTER TABLE teste_alternativas
              ADD CONSTRAINT uniq_alt_versao_perg_ordem UNIQUE (versao_id, pergunta_ordem, ordem_exibicao);
          EXCEPTION WHEN others THEN NULL; END;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uniq_resp_lead_versao_perg') THEN
          BEGIN
            ALTER TABLE teste_respostas
              ADD CONSTRAINT uniq_resp_lead_versao_perg UNIQUE (lead_id, versao_id, pergunta_ordem);
          EXCEPTION WHEN others THEN NULL; END;
        END IF;
      END$$;
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_perg_versao    ON teste_perguntas(versao_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_alt_versao     ON teste_alternativas(versao_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_alt_pergunta   ON teste_alternativas(versao_id, pergunta_ordem)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_resp_versao    ON teste_respostas(versao_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_versao  ON testes(versao_id)`);

    // ── SEED de conteúdo: só se a v1.0 está vazia ──
    if (versaoIdInicial) {
      const semConteudo = await c.query(
        `SELECT COUNT(*)::int AS n FROM teste_perguntas WHERE versao_id=$1`,
        [versaoIdInicial]
      );
      if (semConteudo.rows[0].n === 0) {
        const { PERGUNTAS } = require('./core/teste-conteudo');
        for (const p of PERGUNTAS) {
          await c.query(
            `INSERT INTO teste_perguntas (versao_id, ordem, pergunta) VALUES ($1, $2, $3)`,
            [versaoIdInicial, p.ordem, p.pergunta]
          );
          for (let i = 0; i < p.alternativas.length; i++) {
            const a = p.alternativas[i];
            await c.query(
              `INSERT INTO teste_alternativas
                  (versao_id, pergunta_ordem, perfil, texto, ordem_exibicao)
               VALUES ($1, $2, $3, $4, $5)`,
              [versaoIdInicial, p.ordem, a.perfil, a.texto, i + 1]
            );
          }
        }
        console.log('✅ Seed de ' + PERGUNTAS.length + ' perguntas inserido na versão inicial');
      }
    }

    // ── Limpeza de inacabados antigos (>7 dias) ──
    // Apaga teste_respostas de leads que não têm teste finalizado
    // e cuja última atividade foi há mais de 7 dias.
    await c.query(`
      DELETE FROM teste_respostas
       WHERE lead_id IN (
         SELECT r.lead_id FROM teste_respostas r
          LEFT JOIN testes t ON t.lead_id = r.lead_id
          WHERE t.id IS NULL
          GROUP BY r.lead_id
         HAVING MAX(r.respondido_em) < NOW() - INTERVAL '7 days'
       )
    `);

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

    // Estados de entrega do WhatsApp:
    //   ✓ enviada  = persistida no banco (campo criado_em)
    //   ✓✓ entregue = outro lado online (WebSocket conectado) recebeu
    //   ✓✓ lida    = outro lado leu/respondeu conforme a regra
    await c.query(`ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS entregue BOOLEAN DEFAULT FALSE`);
    await c.query(`ALTER TABLE chat_mensagens ADD COLUMN IF NOT EXISTS entregue_em TIMESTAMPTZ`);

    // Reações de mensagens (modelo Slack: 1 pessoa pode reagir com vários emojis na mesma msg).
    // autor_tipo: 'aluna' | 'suellen' | 'equipe' (quem reagiu)
    // autor_id:   UUID do usuário (aluna) OU NULL pra suellen/equipe (vem identidade do painel)
    await c.query(`
      CREATE TABLE IF NOT EXISTS chat_reacoes (
        id SERIAL PRIMARY KEY,
        mensagem_id INTEGER NOT NULL REFERENCES chat_mensagens(id) ON DELETE CASCADE,
        conversa_id INTEGER NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
        autor_tipo VARCHAR(10) NOT NULL CHECK (autor_tipo IN ('aluna','suellen','equipe')),
        autor_id UUID,
        emoji TEXT NOT NULL,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (mensagem_id, autor_tipo, autor_id, emoji)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_chat_reacoes_msg ON chat_reacoes(mensagem_id)`);

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

    // ── CONTEÚDO DOS RESULTADOS DO TESTE DO SUBCONSCIENTE ──
    // 7 linhas (1 por perfil dominante possível): 4 energias bloqueadoras + 3 níveis de prosperidade.
    // Cada linha tem todos os textos/vídeos/produtos da página de resultado da aluna.
    // Editado pelo painel admin.
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_perfis_conteudo (
        slug VARCHAR(40) PRIMARY KEY,
        nome_exibicao VARCHAR(100) NOT NULL,
        video_url TEXT,
        texto_diagnostico TEXT,
        passo1_texto TEXT,
        passo2_texto TEXT,
        passo3_texto TEXT,
        passo3_curso_titulo VARCHAR(200),
        passo3_curso_capa_url TEXT,
        passo3_curso_descricao TEXT,
        passo3_curso_preco NUMERIC(10,2),
        passo3_curso_link_checkout TEXT,
        passo3_curso_titulo_2 VARCHAR(200),
        passo3_curso_capa_url_2 TEXT,
        passo3_curso_descricao_2 TEXT,
        passo3_curso_preco_2 NUMERIC(10,2),
        passo3_curso_link_checkout_2 TEXT,
        texto_fechamento_final TEXT,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed inicial — 7 perfis com placeholders. Admin edita pelo painel depois.
    await c.query(`
      INSERT INTO teste_perfis_conteudo (slug, nome_exibicao, passo3_curso_titulo) VALUES
        ('medo',              'Medo',                    'O Ouro da Reprogramação Mental'),
        ('desordem',          'Desordem',                'O Ouro da Reprogramação Mental'),
        ('sobrevivencia',     'Sobrevivência',           'Lei da Atração Bíblica'),
        ('validacao',         'Validação',               'O Ouro da Reprogramação Mental'),
        ('prosperidade_nv1',  'Prosperidade Nível 1',    'Lei da Atração Bíblica'),
        ('prosperidade_nv2',  'Prosperidade Nível 2',    'Lei da Atração Bíblica'),
        ('prosperidade_nv3',  'Prosperidade Nível 3',    'A Tal Maneira (Curso)')
      ON CONFLICT (slug) DO NOTHING
    `);

    // Seed do segundo curso pros perfis nv1 e nv2 (que recomendam LDA + Tal Maneira)
    await c.query(`
      UPDATE teste_perfis_conteudo
         SET passo3_curso_titulo_2 = 'A Tal Maneira (Livro)'
       WHERE slug IN ('prosperidade_nv1','prosperidade_nv2')
         AND passo3_curso_titulo_2 IS NULL
    `);

    // ── LIVROS DA SÉRIE CONHECER E DESPERTAR ──
    // 4 linhas (1 por energia bloqueadora). Aparecem no Passo 2 conforme regras de gatilho.
    // Editado pelo painel admin.
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_livros (
        slug VARCHAR(50) PRIMARY KEY,
        energia VARCHAR(40) NOT NULL UNIQUE,
        titulo VARCHAR(200) NOT NULL,
        capa_url TEXT,
        preco NUMERIC(10,2),
        link_checkout TEXT,
        selo VARCHAR(200),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed inicial — 4 livros com placeholders. Admin edita pelo painel.
    await c.query(`
      INSERT INTO teste_livros (slug, energia, titulo, preco, selo) VALUES
        ('vencendo_medo',          'medo',          'Vencendo o Medo',           59.90, '✨ Inclui Aulão ao vivo com a Suellen'),
        ('vencendo_desordem',      'desordem',      'Vencendo a Desordem',       59.90, '✨ Inclui Aulão ao vivo com a Suellen'),
        ('vencendo_validacao',     'validacao',     'Vencendo a Validação',      59.90, '✨ Inclui Aulão ao vivo com a Suellen'),
        ('vencendo_sobrevivencia', 'sobrevivencia', 'Vencendo a Sobrevivência',  59.90, '✨ Inclui Aulão ao vivo com a Suellen')
      ON CONFLICT (slug) DO NOTHING
    `);

    // Texto padrão do compartilhamento no WhatsApp (Bloco 4 da página de resultado)
    await c.query(`
      INSERT INTO config (chave, dados) VALUES
        ('resultado_compartilhar_texto',
         '{"texto":"Acabei de descobrir minha energia predominante no Teste do Subconsciente da Vida Mágica. Faça o seu também:"}'::jsonb)
      ON CONFLICT (chave) DO NOTHING
    `);

    // ════════════════════════════════════════════════════════
    // JORNADAS DO MÉTODO (3 jornadas: Subconsciente, Vida Mágica, Transbordar)
    // ════════════════════════════════════════════════════════
    // Cada aluna está em UMA jornada por vez. A jornada é determinada pelo perfil
    // dominante do teste mais recente. O progresso dentro da jornada é determinado
    // pelas compras (linhas em usuario_produtos).

    // ── Definição das 3 jornadas ──
    await c.query(`
      CREATE TABLE IF NOT EXISTS jornadas_metodo (
        slug VARCHAR(40) PRIMARY KEY,
        numero INTEGER NOT NULL UNIQUE,
        nome_exibicao VARCHAR(100) NOT NULL,
        subtitulo VARCHAR(200),
        descricao TEXT,
        cor VARCHAR(20),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`
      INSERT INTO jornadas_metodo (slug, numero, nome_exibicao, subtitulo, cor) VALUES
        ('subconsciente', 1, 'Subconsciente', 'Despertando a mente',          '#C8922A'),
        ('vida_magica',   2, 'Vida Mágica',   'Operando a abundância',       '#2BA5E8'),
        ('transbordar',   3, 'Transbordar',   'Vivendo no transbordo',       '#F4D060')
      ON CONFLICT (slug) DO NOTHING
    `);

    // ── Mapa: perfil dominante → qual jornada a aluna está ──
    await c.query(`
      CREATE TABLE IF NOT EXISTS jornadas_perfis_map (
        perfil_slug VARCHAR(40) PRIMARY KEY,
        jornada_slug VARCHAR(40) NOT NULL REFERENCES jornadas_metodo(slug)
      )
    `);
    await c.query(`
      INSERT INTO jornadas_perfis_map (perfil_slug, jornada_slug) VALUES
        ('medo',              'subconsciente'),
        ('desordem',          'subconsciente'),
        ('sobrevivencia',     'subconsciente'),
        ('validacao',         'subconsciente'),
        ('prosperidade_nv1',  'vida_magica'),
        ('prosperidade_nv2',  'vida_magica'),
        ('prosperidade_nv3',  'transbordar')
      ON CONFLICT (perfil_slug) DO UPDATE SET jornada_slug = EXCLUDED.jornada_slug
    `);

    // ── Passos de cada jornada (sequência ordenada de produtos) ──
    // Cada passo tem um título no contexto do método (ex: "Despertar", "Reprogramar a Base")
    // e referencia um produto cadastrado na tabela produtos (banco Core) pelo slug.
    await c.query(`
      CREATE TABLE IF NOT EXISTS jornadas_passos (
        id SERIAL PRIMARY KEY,
        jornada_slug VARCHAR(40) NOT NULL REFERENCES jornadas_metodo(slug) ON DELETE CASCADE,
        ordem INTEGER NOT NULL,
        produto_slug VARCHAR(80) NOT NULL,
        titulo_passo VARCHAR(120) NOT NULL,
        descricao_passo TEXT,
        atualizado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (jornada_slug, ordem)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_jornadas_passos_jornada ON jornadas_passos(jornada_slug, ordem)`);

    // Seed dos passos:
    // JORNADA 1 — Subconsciente
    //   1: Conhecer        → Teste do Subconsciente
    //   2: Despertar       → Conhecer e Despertar (4 livros — passo composto, qualquer livro completa parte)
    //   3: Reprogramar     → Ouro da Reprogramação Mental
    //   4: Permanecer      → Comunidade Vida Mágica
    //
    // Observação importante: o passo "Despertar" da Jornada 1 é representado pelos 4 livros.
    // Pra simplificar a estrutura tabular, cada livro é um passo separado. A UI agrupa
    // eles visualmente como "Despertar — Série Conhecer e Despertar" no app.

    await c.query(`
      INSERT INTO jornadas_passos (jornada_slug, ordem, produto_slug, titulo_passo, descricao_passo) VALUES
        ('subconsciente', 1, 'teste-subconsciente',          'Conhecer',                'Identifique o padrão que trava sua prosperidade.'),
        ('subconsciente', 2, 'livro-vencendo-medo',          'Despertar — Vencendo o Medo',           'Liberar a energia transversal que paralisa.'),
        ('subconsciente', 3, 'livro-vencendo-desordem',      'Despertar — Vencendo a Desordem',       'Trazer ordem ao que está disperso.'),
        ('subconsciente', 4, 'livro-vencendo-validacao',     'Despertar — Vencendo a Validação',      'Soltar o vício da aprovação externa.'),
        ('subconsciente', 5, 'livro-vencendo-sobrevivencia', 'Despertar — Vencendo a Sobrevivência',  'Sair do modo de fazer demais na própria força.'),
        ('subconsciente', 6, 'curso-ouro-reprogramacao',     'Reprogramar a Base',      'Instalar a nova identidade. A ferramenta-chave da Fase 1.'),
        ('subconsciente', 7, 'assinatura-comunidade',        'Permanecer em Comunidade','Sustentar a transformação no convívio diário.')
      ON CONFLICT (jornada_slug, ordem) DO NOTHING
    `);

    // JORNADA 2 — Vida Mágica
    await c.query(`
      INSERT INTO jornadas_passos (jornada_slug, ordem, produto_slug, titulo_passo, descricao_passo) VALUES
        ('vida_magica', 1, 'teste-subconsciente',     'Diagnosticar o nível',                     'Confirmar que sua energia evoluiu para Prosperidade.'),
        ('vida_magica', 2, 'guia-pratico-reprogramar','Guia Prático para Reprogramar a Mente',    'Operar a reprogramação no dia a dia.'),
        ('vida_magica', 3, 'guia-bolso-magica-fluir', 'Guia de Bolso Mágica do Fluir',            'Manter o estado de fluir nas pequenas coisas.'),
        ('vida_magica', 4, 'livro-tal-maneira',       'A Tal Maneira — Livro',                    'Conhecer o método de manifestação bíblica.'),
        ('vida_magica', 5, 'curso-lda-biblica',       'Lei da Atração Bíblica',                   'Ativar a Lei da Atração à luz da fé.'),
        ('vida_magica', 6, 'assinatura-comunidade',   'Permanecer em Comunidade',                 'Crescer entre pessoas que vivem o mesmo método.')
      ON CONFLICT (jornada_slug, ordem) DO NOTHING
    `);

    // JORNADA 3 — Transbordar
    await c.query(`
      INSERT INTO jornadas_passos (jornada_slug, ordem, produto_slug, titulo_passo, descricao_passo) VALUES
        ('transbordar', 1, 'teste-subconsciente', 'Confirmar o transbordo',  'Atestar o nível mais alto de prosperidade.'),
        ('transbordar', 2, 'curso-tal-maneira',   'A Tal Maneira — Curso',   'Ferramenta completa pra quem vive no transbordo.')
      ON CONFLICT (jornada_slug, ordem) DO NOTHING
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
