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
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_telefone ON usuarios(telefone)`);

    // Migrations idempotentes — caso a tabela já exista sem essas colunas
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN DEFAULT FALSE`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash TEXT`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url TEXT`);
    // Limpeza de legado (2026-05-23): o fluxo antigo de reset de senha
    // gravava token + expira em usuarios. Foi substituído pelo fluxo
    // zap-first com magic token em otp_tokens (tipo='reset_senha').
    // Ninguém lê/escreve essas colunas mais — DROP idempotente.
    await c.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS reset_token`);
    await c.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS reset_token_expira`);
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
    //   'arquivada'  = aluna desativou (arquivada_por='aluna') OU admin arquivou
    //                  Desativada pela aluna: reativa silenciosamente via OTP.
    //                  Arquivada pelo admin: só admin desarquiva.
    //   'legado'     = excluída permanentemente (pela própria aluna no caminho C
    //                  do modal de desativar OU pelo admin). Cadastro novo cria
    //                  conta limpa; dados antigos ficam invisíveis pra aluna,
    //                  visíveis só pro admin. Materiais comprados podem voltar
    //                  via webhook Kiwify se a aluna reativar compra.
    //   'banido'     = bloqueado de logar e cruzado por vínculos (telefone,
    //                  email, CPF, fingerprint). Tentativas registradas em
    //                  tentativas_banido pra auditoria.
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'incompleta'`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone_validado_em TIMESTAMPTZ`);

    // Identificadores únicos extras: CPF (1 pessoa = 1 CPF)
    // Data de nascimento (não-único, usado pra aniversário e idade)
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf VARCHAR(14)`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS data_nascimento DATE`);

    // Perfil pessoal: nome de preferência (como ela quer ser chamada — usado
    // na saudação "Olá, X"), gênero (feminino/masculino/outro), e ocupação
    // (texto livre). `nome` segue sendo o canônico (nome completo civil).
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome_preferencia VARCHAR(120)`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS genero VARCHAR(20)`);
    await c.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ocupacao TEXT`);

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
    // device_fingerprint: amarra a solicitação ao dispositivo que pediu acesso.
    // Quando webhook gera magic token, herda esse fingerprint. /login-magic
    // valida que o request vem do MESMO dispositivo. Bloqueia compartilhamento
    // de link entre dispositivos.
    await c.query(`ALTER TABLE acesso_solicitacoes ADD COLUMN IF NOT EXISTS device_fingerprint JSONB`);
    // intent: 'login' (default) ou 'trocar_telefone' (aluna logada quer mudar
    // o número principal). Em troca, usuario_id aponta pra aluna logada e
    // telefone é o NOVO número que ela está provando posse. Webhook reconhece
    // pelo intent e gera magic link pro novo número confirmando a troca.
    await c.query(`ALTER TABLE acesso_solicitacoes ADD COLUMN IF NOT EXISTS intent VARCHAR(20) DEFAULT 'login'`);
    await c.query(`ALTER TABLE acesso_solicitacoes ADD COLUMN IF NOT EXISTS usuario_id UUID`);

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
    // device_fingerprint: magic tokens herdam o fingerprint do dispositivo que
    // pediu o acesso (acesso_solicitacoes). /login-magic valida match — bloqueia
    // que aluna encaminhe o link e outra pessoa entre em outro dispositivo.
    await c.query(`ALTER TABLE otp_tokens ADD COLUMN IF NOT EXISTS device_fingerprint JSONB`);
    // tipo: 'codigo' (OTP painel) | 'magic_login' | 'magic_boas_vindas' | 'reset_senha'
    await c.query(`CREATE INDEX IF NOT EXISTS idx_otp_token ON otp_tokens(token) WHERE token IS NOT NULL AND usado=FALSE`);


    await c.query(`
      CREATE TABLE IF NOT EXISTS dispositivos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('mobile','tablet','desktop')),
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

    // Migration idempotente: estender CHECK pra incluir 'tablet'.
    // Bancos criados antes desta migração tinham só ('mobile','desktop').
    // Roda no boot, é seguro rodar várias vezes.
    await c.query(`ALTER TABLE dispositivos DROP CONSTRAINT IF EXISTS dispositivos_tipo_check`);
    await c.query(`ALTER TABLE dispositivos ADD CONSTRAINT dispositivos_tipo_check CHECK (tipo IN ('mobile','tablet','desktop'))`);

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

    // Legado: produto comprado fica latente quando aluna excluiu a conta no
    // caminho B/C do modal de desativar. Invisível pra aluna; admin vê na
    // aba Legado. Webhook Kiwify pode reativar (eh_legado=FALSE) se ela
    // comprar novamente com o mesmo telefone.
    await c.query(`ALTER TABLE usuario_produtos ADD COLUMN IF NOT EXISTS eh_legado BOOLEAN DEFAULT FALSE`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_uprod_legado ON usuario_produtos(usuario_id, eh_legado)`);

    // ── ATUALIZAÇÕES PENDENTES DA JORNADA ──────────────────
    // Eventos que disparam um aviso de "sua jornada foi atualizada" no app
    // aluna. Cada linha = 1 evento que ela ainda NÃO consumiu (não viu a
    // animação de celebração).
    //
    // Quando aluna faz/refaz teste e ativa trilha → cria 1 atualização
    //   pendente do tipo 'teste'.
    // Quando aluna compra produto (webhook Kiwify) → cria 1 atualização
    //   pendente do tipo 'compra'.
    //
    // O frontend lê `atualizacoes_pendentes != []` e mostra banner/aviso/
    // splash. Quando ela vê (clica em "Concluir" da splash), o backend
    // marca consumido_em.
    //
    // Slots prontos pra integração:
    // - tipo: 'teste' | 'compra' | (futuros: 'evento_ao_vivo', 'mensagem_su')
    // - payload JSON: detalhes contextuais (teste_id, produto_slug, etc)
    await c.query(`
      CREATE TABLE IF NOT EXISTS atualizacoes_pendentes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('teste','compra')),
        payload JSONB DEFAULT '{}'::jsonb,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        consumido_em TIMESTAMPTZ
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_atualizacoes_usuario_pendente
      ON atualizacoes_pendentes(usuario_id) WHERE consumido_em IS NULL`);

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

    // ── BANIMENTOS ─────────────────────────────────────────
    // Quando o admin marca alguém como banido, registra aqui os vínculos
    // (telefone, email, CPF, fingerprints conhecidos). Qualquer tentativa
    // de cadastro/login com um vínculo que bate vira tentativa_banido e
    // a resposta na UI é a mensagem genérica de suporte (contato@vidamagica.com.br).
    //
    // O admin pode desconectar um vínculo específico (falso positivo) sem
    // desbanir a conta inteira.
    await c.query(`
      CREATE TABLE IF NOT EXISTS banimentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        motivo TEXT,
        banido_em TIMESTAMPTZ DEFAULT NOW(),
        banido_por VARCHAR(80),
        ativo BOOLEAN DEFAULT TRUE,
        vinculos JSONB NOT NULL DEFAULT '{}'::jsonb,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_banimentos_usuario ON banimentos(usuario_id) WHERE ativo=TRUE`);
    // Para buscas rápidas pelos vínculos (cruzamento), indexes parciais GIN
    // sobre o JSONB. Postgres consegue varrer rapidamente quando o app
    // pergunta "tem banido com telefone X / email Y / cpf Z".
    await c.query(`CREATE INDEX IF NOT EXISTS idx_banimentos_vinculos ON banimentos USING GIN (vinculos) WHERE ativo=TRUE`);

    // Auditoria — toda tentativa de login/cadastro que bate em vínculo
    // de banimento cai aqui. Admin monitora padrão (mesmo banido tentando
    // de 5 telefones diferentes → adiciona os 5 ao vínculo).
    await c.query(`
      CREATE TABLE IF NOT EXISTS tentativas_banido (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        banimento_id UUID NOT NULL REFERENCES banimentos(id) ON DELETE CASCADE,
        rota VARCHAR(60),
        vinculo_bateu VARCHAR(20),
        valor_bateu TEXT,
        ip VARCHAR(45),
        user_agent TEXT,
        fingerprint JSONB,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_tentativas_banido_ban ON tentativas_banido(banimento_id, criado_em DESC)`);

    // ── SEED dos produtos do método ──
    // Os slugs aqui SÃO OS MESMOS de routes/seed.js (PRECOS_INICIAIS).
    // A aba Preços é a fonte da verdade pra dados editáveis (preço, link, capa, etc).
    // Esta tabela existe pra: cruzamento com usuario_produtos (FK por id) e
    // metadados estruturais (tipo, acesso_modelo, ordem).
    // ON CONFLICT (slug) DO NOTHING — idempotente.

    // ── Migration de slugs antigos (deploys anteriores usavam slugs com hífen) ──
    // Se a tabela já tem registros com slug antigo (hífen) E NÃO tem registro
    // com slug novo (underscore): renomeia o antigo direto.
    // Se já tem AMBOS (antigo + novo, criados em deploys diferentes): redireciona
    // os usuario_produtos do antigo pro novo (canônico) e deleta o antigo.
    // Idempotente — se já tudo migrado, é um no-op.
    const SLUG_RENAMES = [
      ['teste-subconsciente',          'teste_subconsciente'],
      ['teste-prosperidade',           'teste_prosperidade'],
      ['livro-vencendo-medo',          'vencendo_medo'],
      ['livro-vencendo-desordem',      'vencendo_desordem'],
      ['livro-vencendo-validacao',     'vencendo_validacao'],
      ['livro-vencendo-sobrevivencia', 'vencendo_sobrevivencia'],
      ['curso-ouro-reprogramacao',     'ouro_reprogramacao'],
      ['assinatura-comunidade',        'clube_vida_magica'],
      ['guia-pratico-reprogramar',     'guia_pratico'],
      ['guia-bolso-magica-fluir',      'magica_fluir'],
      ['livro-tal-maneira',            'atal_maneira_livro'],
      ['curso-lda-biblica',            'lda_biblica'],
      ['curso-tal-maneira',            'atal_maneira_curso'],
    ];
    for (const [slugAntigo, slugNovo] of SLUG_RENAMES) {
      // Pega ids dos dois (se existirem)
      const r = await c.query(
        `SELECT slug, id FROM produtos WHERE slug IN ($1, $2)`,
        [slugAntigo, slugNovo]
      );
      const antigo = r.rows.find(x => x.slug === slugAntigo);
      const novo   = r.rows.find(x => x.slug === slugNovo);
      if (!antigo) continue;  // nada a fazer
      if (!novo) {
        // Só tem o antigo — renomear direto, não conflita
        await c.query(
          `UPDATE produtos SET slug = $1, atualizado_em = NOW() WHERE id = $2`,
          [slugNovo, antigo.id]
        );
      } else {
        // Tem ambos. Redireciona usuario_produtos do antigo pro novo,
        // depois deleta o antigo.
        await c.query(
          `UPDATE usuario_produtos SET produto_id = $1 WHERE produto_id = $2`,
          [novo.id, antigo.id]
        );
        await c.query(`DELETE FROM produtos WHERE id = $1`, [antigo.id]);
      }
    }

    await c.query(`
      INSERT INTO produtos (slug, nome, tipo, acesso_modelo, fase, ordem, ativo) VALUES
        ('clube_vida_magica',      'Clube Vida Mágica',                          'assinatura', 'recorrente', 'fase1', 1, true),
        ('teste_prosperidade',     'Teste de Prosperidade',                      'teste',      'vitalicio',  'fase1', 2, true),
        ('teste_subconsciente',    'Teste do Subconsciente',                     'teste',      'vitalicio',  'fase1', 3, true),
        ('vencendo_medo',          'Vencendo o Medo',                            'livro',      'vitalicio',  'fase1', 4, true),
        ('vencendo_desordem',      'Vencendo a Desordem',                        'livro',      'vitalicio',  'fase1', 5, true),
        ('vencendo_validacao',     'Vencendo a Validação',                       'livro',      'vitalicio',  'fase1', 6, true),
        ('vencendo_sobrevivencia', 'Vencendo a Sobrevivência',                   'livro',      'vitalicio',  'fase1', 7, true),
        ('magica_fluir',           'Guia de Bolso Mágica do Fluir',              'livro',      'vitalicio',  'fase2', 8, true),
        ('guia_pratico',           'Guia Prático para Reprogramar a Mente',      'livro',      'vitalicio',  'fase2', 9, true),
        ('atal_maneira_livro',     'A Tal Maneira (Livro)',                      'livro',      'vitalicio',  'fase2', 10, true),
        ('ouro_reprogramacao',     'Ouro da Reprogramação Mental',               'curso',      'vitalicio',  'fase1', 11, true),
        ('lda_biblica',            'Lei da Atração Bíblica',                     'curso',      'vitalicio',  'fase2', 12, true),
        ('atal_maneira_curso',     'A Tal Maneira (Curso)',                      'curso',      'vitalicio',  'fase3', 13, true)
      ON CONFLICT (slug) DO NOTHING
    `);

    // ── SEMENTES — LEDGER (livro-razão de movimentações) ─────
    // Sementes são MOEDA real (vão poder comprar produtos). Toda alteração
    // de saldo é gravada aqui pra auditoria. Saldo em `usuarios.sementes` =
    // soma dos deltas no ledger (discrepância = bug crítico).
    // Toda escrita passa por core/sementes.js (helper centralizado).
    await c.query(`
      CREATE TABLE IF NOT EXISTS sementes_movimentacoes (
        id BIGSERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        delta INTEGER NOT NULL CHECK (delta <> 0),
        motivo VARCHAR(40) NOT NULL,
        origem_tipo VARCHAR(40),
        origem_id VARCHAR(80),
        saldo_apos INTEGER NOT NULL CHECK (saldo_apos >= 0),
        criado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_sm_usuario ON sementes_movimentacoes(usuario_id, criado_em DESC)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_sm_motivo ON sementes_movimentacoes(motivo)`);

    // ── TESOUROS RESGATADOS — IDEMPOTÊNCIA do resgate diário ─
    // Garante que o mesmo tesouro (item do feed) não pode ser resgatado 2x
    // pela mesma aluna. Tabela vive aqui em poolCore (mesma transação do
    // crédito de sementes). feed_id é referência LÓGICA pra feed (poolComunicacao).
    await c.query(`
      CREATE TABLE IF NOT EXISTS tesouros_resgatados (
        id BIGSERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        feed_id INTEGER NOT NULL,
        movimentacao_id BIGINT REFERENCES sementes_movimentacoes(id),
        sementes_creditadas INTEGER NOT NULL DEFAULT 0,
        resgatado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(usuario_id, feed_id)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_tr_usuario ON tesouros_resgatados(usuario_id, resgatado_em DESC)`);

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
        visto_em TIMESTAMPTZ,
        ativou_trilha BOOLEAN DEFAULT FALSE,
        CHECK (usuario_id IS NOT NULL OR lead_id IS NOT NULL)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_telefone ON testes(telefone_canonico)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_usuario ON testes(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_lead ON testes(lead_id)`);
    // Migrações aditivas: tabelas já criadas em deploys anteriores ganham as colunas novas
    await c.query(`ALTER TABLE testes ADD COLUMN IF NOT EXISTS visto_em TIMESTAMPTZ`);
    await c.query(`ALTER TABLE testes ADD COLUMN IF NOT EXISTS ativou_trilha BOOLEAN DEFAULT FALSE`);
    // Legado: teste vai pra cá quando aluna excluiu conta no caminho B/C.
    // Invisível pra aluna (frontend filtra), visível pro admin na aba Legado.
    await c.query(`ALTER TABLE testes ADD COLUMN IF NOT EXISTS eh_legado BOOLEAN DEFAULT FALSE`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_testes_legado ON testes(usuario_id, eh_legado) WHERE usuario_id IS NOT NULL`);

    // ── MIGRAÇÃO INTELIGENTE: testes feitos ANTES dessa coluna existir ──
    // Antes, a aluna tinha 1 teste = era a trilha ativa por padrão. Após o
    // deploy, todos esses testes nascem com ativou_trilha=FALSE, e o app
    // não consegue identificar qual deles é o "atual".
    //
    // Esta migração preenche os ausentes: pra cada aluna que NUNCA teve
    // ativou_trilha=true em nenhum teste, marca o mais recente como ativo.
    // Idempotente: só age na 1ª execução, depois disso a regra normal
    // (ativação via /resultado ou /ativar-trilha) toma conta.
    await c.query(`
      WITH alunas_sem_trilha AS (
        SELECT DISTINCT COALESCE(usuario_id::text, telefone_canonico) AS chave
          FROM testes
        EXCEPT
        SELECT DISTINCT COALESCE(usuario_id::text, telefone_canonico)
          FROM testes
         WHERE ativou_trilha = TRUE
      ),
      ultimos AS (
        SELECT DISTINCT ON (COALESCE(usuario_id::text, telefone_canonico))
               id
          FROM testes
         WHERE COALESCE(usuario_id::text, telefone_canonico) IN (SELECT chave FROM alunas_sem_trilha)
         ORDER BY COALESCE(usuario_id::text, telefone_canonico), feito_em DESC
      )
      UPDATE testes
         SET ativou_trilha = TRUE,
             visto_em = COALESCE(visto_em, feito_em)
       WHERE id IN (SELECT id FROM ultimos)
    `);

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
         E'Que bom que você voltou, {nome}. ✦\nSua jornada estava te esperando.\nSeu Magic Link está pronto.\nToque abaixo para continuar:',
         'acesso', 1),
        ('magic_boas_vindas_msg1',
         'Magic Link — Primeiro acesso',
         E'Bem-vinda, {nome}. ✦\nVocê chegou até aqui — e isso já diz muito sobre você.\nSeu Magic Link está pronto.\nToque abaixo para acessar sua jornada:',
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

    // Refresh dos templates de Magic Link com a voz oficial do Vida Mágica (2026-05-18).
    // Só atualiza se o texto AINDA é o antigo — preserva customizações que Renato
    // tenha feito pela tela /admin → Templates.
    await c.query(`
      UPDATE templates_mensagens
         SET texto = E'Que bom que você voltou, {nome}. ✦\nSua jornada estava te esperando.\nSeu Magic Link está pronto.\nToque abaixo para continuar:',
             atualizado_em = NOW()
       WHERE chave = 'magic_login_msg1'
         AND texto = E'Que bom te ver de volta, {nome}. ✨\nSeu Magic Link está pronto!\nToque no caminho abaixo pra entrar:'
    `);
    await c.query(`
      UPDATE templates_mensagens
         SET texto = E'Bem-vinda, {nome}. ✦\nVocê chegou até aqui — e isso já diz muito sobre você.\nSeu Magic Link está pronto.\nToque abaixo para acessar sua jornada:',
             atualizado_em = NOW()
       WHERE chave = 'magic_boas_vindas_msg1'
         AND texto = E'Bem-vinda, {nome}. 🌟\nEstávamos te esperando.\nSeu Magic Link está pronto.\nToque no caminho abaixo para acessar:'
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

    // ── TEMAS — taxonomia oficial dos depoimentos ──
    // Cada tema aponta pra UM produto (slug em precos). Frontend exibe
    // o nome do tema pra aluna (NUNCA o nome do curso/produto).
    // Tags antigas (coluna depoimentos.tags) continuam existindo por compat
    // mas a verdade nova é depoimentos.tema_id.
    await c.query(`
      CREATE TABLE IF NOT EXISTS temas (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(50) UNIQUE NOT NULL,
        nome VARCHAR(200) NOT NULL,
        produto_slug VARCHAR(100),
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_temas_slug ON temas(slug)`);

    // ── Migrations idempotentes em depoimentos ──
    // Schema novo (Fase 1 do refactor de Relatos):
    // - profissao + idade substituem cidade na exibição pra aluna
    //   (cidade fica como legacy; não exibida em frontend novo)
    // - tema_id é a vinculação oficial (substitui tags na busca)
    // - usuario_id liga a relato enviado pela aluna pela área logada
    //   (Fase 2 — referência LÓGICA pra usuarios em poolCore, sem FK)
    // - mostrar_no_ticker: controle MANUAL do Renato (sem automação)
    // - gerado_por_ia: marca placeholders criados na migração inicial
    //   (filtro no admin pra revisar antes de qualquer coisa)
    // - status_moderacao: pendente/aprovado/rejeitado
    //   (Fase 3 — moderação dos relatos enviados pela aluna)
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS profissao TEXT`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS idade INTEGER`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS tema_id INTEGER`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS usuario_id UUID`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS mostrar_no_ticker BOOLEAN DEFAULT TRUE`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS gerado_por_ia BOOLEAN DEFAULT FALSE`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS status_moderacao VARCHAR(20) DEFAULT 'aprovado'`);
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ DEFAULT NOW()`);
    // Legado: relato vai pra cá quando aluna excluiu conta no caminho B/C
    // (separado do `oculto_arquivamento` que é controlado por arquivar/desarquivar).
    // Endpoints públicos filtram FALSE. Admin vê na aba Legado.
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS eh_legado BOOLEAN DEFAULT FALSE`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_depoimentos_legado ON depoimentos(usuario_id, eh_legado) WHERE usuario_id IS NOT NULL`);
    // autora_era_assinante_clube: snapshot PERMANENTE no momento da postagem/aprovação.
    // Uma vez TRUE, fica TRUE pra sempre (não rebaixa se aluna cancela assinatura depois).
    // Liga brilho dourado no relato em todas as superfícies (LPs, /relatos, modal universal, home /app).
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS autora_era_assinante_clube BOOLEAN DEFAULT FALSE`);
    // oculto_por_conta_inativa (Fase 2.4): TRUE quando aluna arquivou a conta.
    // Endpoints públicos filtram FALSE. Helper em core/relatos.js sincroniza com arquivar/desarquivar.
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS oculto_por_conta_inativa BOOLEAN DEFAULT FALSE`);
    // motivo_rejeicao (Fase 2.1): opcional, quando admin/atendimento rejeita o relato.
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS motivo_rejeicao TEXT`);
    // produto_slug do relato (override opcional do produto do tema). Quando preenchido,
    // vence o t.produto_slug no SELECT_DEP_COMPLETO (COALESCE em routes/depoimentos.js).
    // Quando NULL, relato herda o produto do tema. Permite mesmo tema agrupar relatos
    // de produtos diferentes (ex: tema "geral" no index mostrando variedade real).
    await c.query(`ALTER TABLE depoimentos ADD COLUMN IF NOT EXISTS produto_slug VARCHAR(80)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_depoimentos_tema ON depoimentos(tema_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_depoimentos_usuario ON depoimentos(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_depoimentos_status ON depoimentos(status_moderacao)`);

    // ── CATEGORIAS DE VIDA (Fase 2.1a) ──
    // O que o RELATO fala em termos de área da vida (filhos, renda, carreira...).
    // Diferente de `tema_id` (que aponta pro produto que a aluna leu).
    // Renato gerencia o catálogo via CRUD no admin. Slug fica congelado pra não quebrar histórico.
    await c.query(`
      CREATE TABLE IF NOT EXISTS categorias_relato (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(40) UNIQUE NOT NULL,
        nome VARCHAR(120) NOT NULL,
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_cat_relato_ativo ON categorias_relato(ativo)`);

    // Pivot M:N — cada relato pode ter N categorias.
    await c.query(`
      CREATE TABLE IF NOT EXISTS depoimento_categorias (
        depoimento_id INTEGER NOT NULL REFERENCES depoimentos(id) ON DELETE CASCADE,
        categoria_id INTEGER NOT NULL REFERENCES categorias_relato(id) ON DELETE CASCADE,
        PRIMARY KEY (depoimento_id, categoria_id)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_dep_cat_depoimento ON depoimento_categorias(depoimento_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_dep_cat_categoria ON depoimento_categorias(categoria_id)`);

    // ── REAÇÕES DE RELATO (Fase 2.2) ──
    // 4 tipos de reação. "quero" e "ja_vivo" são mutuamente exclusivas (regra no app).
    // "parabens" é independente. "nao_e_pra_mim" também é exclusiva com "quero" e "ja_vivo".
    // UNIQUE(depoimento_id, usuario_id, tipo) — uma reação do tipo por par.
    await c.query(`
      CREATE TABLE IF NOT EXISTS depoimento_reacoes (
        id BIGSERIAL PRIMARY KEY,
        depoimento_id INTEGER NOT NULL REFERENCES depoimentos(id) ON DELETE CASCADE,
        usuario_id UUID NOT NULL,
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('quero','ja_vivo','nao_e_pra_mim','parabens')),
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(depoimento_id, usuario_id, tipo)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_reacoes_depoimento ON depoimento_reacoes(depoimento_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_reacoes_usuario ON depoimento_reacoes(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_reacoes_tipo ON depoimento_reacoes(tipo)`);

    // ── BAÚ DE RELATOS (Fase 2.2) ──
    // Cada vez que aluna reage com quero/ja_vivo/nao_e_pra_mim/parabens, salva no baú.
    // Mesmo se ela "tira" a reação depois, o registro do baú fica (histórico comportamental).
    // Categoria do baú = tipo da reação (4 abas no /app).
    await c.query(`
      CREATE TABLE IF NOT EXISTS relatos_salvos_bau (
        id BIGSERIAL PRIMARY KEY,
        usuario_id UUID NOT NULL,
        depoimento_id INTEGER NOT NULL REFERENCES depoimentos(id) ON DELETE CASCADE,
        tipo_reacao VARCHAR(20) NOT NULL CHECK (tipo_reacao IN ('quero','ja_vivo','nao_e_pra_mim','parabens')),
        salvo_em TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(usuario_id, depoimento_id, tipo_reacao)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_bau_usuario ON relatos_salvos_bau(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_bau_tipo ON relatos_salvos_bau(usuario_id, tipo_reacao)`);
    // Migration pra acomodar tesouros: feita ABAIXO, após CREATE da tabela feed
    // (porque tesouro_feed_id é FK pra feed.id).

    // ── VISUALIZAÇÕES DE RELATO (Fase 2.5 — anti-repetição) ──
    // "Visto" = aluna ABRIU o modal do relato (não basta passar no carrossel).
    // O algoritmo usa pra despriorizar relatos já vistos sem reagir.
    await c.query(`
      CREATE TABLE IF NOT EXISTS depoimento_visualizacoes (
        id BIGSERIAL PRIMARY KEY,
        depoimento_id INTEGER NOT NULL REFERENCES depoimentos(id) ON DELETE CASCADE,
        usuario_id UUID NOT NULL,
        visto_em TIMESTAMPTZ DEFAULT NOW(),
        vezes_visto INTEGER DEFAULT 1,
        UNIQUE(depoimento_id, usuario_id)
      )
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_views_usuario ON depoimento_visualizacoes(usuario_id)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_views_dep_user ON depoimento_visualizacoes(depoimento_id, usuario_id)`);

    // ── CONFIG DO ALGORITMO DE RELEVÂNCIA (Fase 2.5) ──
    // Singleton (chave='relevancia'). Renato edita pelo admin via sliders.
    // Score do relato R pra aluna V:
    //   score = RANDOM
    //         × (idade ≤ janela_horas ? mult_novidade : 1)
    //         × (tema do R na jornada vigente da V ? mult_jornada : 1)
    //         × (1 + mult_popularidade × log(1 + n_reacoes_publicas))
    //         × (nunca viu ? 1 : viu_sem_reagir ? penalidade_visto : penalidade_reagido)
    await c.query(`
      CREATE TABLE IF NOT EXISTS feed_relevancia_config (
        chave VARCHAR(40) PRIMARY KEY,
        dados JSONB NOT NULL,
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Defaults — preenchidos só se ainda não existir (idempotente).
    await c.query(`
      INSERT INTO feed_relevancia_config (chave, dados)
      VALUES ('relevancia', $1::jsonb)
      ON CONFLICT (chave) DO NOTHING
    `, [JSON.stringify({
      mult_novidade: 5.0,
      mult_jornada: 3.0,
      mult_popularidade: 0.5,
      penalidade_visto: 0.4,
      penalidade_reagido: 0.05,
      janela_novidade_horas: 48,
    })]);

    // ── SEED LOG — controla seeds idempotentes (rodam 1 vez) ──
    await c.query(`
      CREATE TABLE IF NOT EXISTS seed_log (
        seed_key VARCHAR(100) PRIMARY KEY,
        rodado_em TIMESTAMPTZ DEFAULT NOW()
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

    // ── BAÚ: migration pra acomodar TESOUROS (item do feed) ──
    // Agora o baú guarda relatos OU tesouros — exatamente UM dos dois IDs
    // é preenchido. Roda DEPOIS de CREATE TABLE feed (FK depende dela).
    await c.query(`ALTER TABLE relatos_salvos_bau ALTER COLUMN depoimento_id DROP NOT NULL`);
    await c.query(`ALTER TABLE relatos_salvos_bau ADD COLUMN IF NOT EXISTS tesouro_feed_id INTEGER REFERENCES feed(id) ON DELETE CASCADE`);
    // CHECK XOR — exatamente UM ID preenchido. PG não tem IF NOT EXISTS pra CHECK,
    // então usa DO block pra ser idempotente.
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'bau_origem_xor' AND conrelid = 'relatos_salvos_bau'::regclass
        ) THEN
          ALTER TABLE relatos_salvos_bau
            ADD CONSTRAINT bau_origem_xor CHECK (
              (depoimento_id IS NOT NULL AND tesouro_feed_id IS NULL) OR
              (depoimento_id IS NULL AND tesouro_feed_id IS NOT NULL)
            );
        END IF;
      END $$;
    `);
    // UNIQUE parcial pra tesouros (espelha o UNIQUE de relatos)
    await c.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_bau_tesouro
        ON relatos_salvos_bau (usuario_id, tesouro_feed_id, tipo_reacao)
        WHERE tesouro_feed_id IS NOT NULL
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

    // ── (Tabela teste_livros existia em deploys anteriores — agora os 4 livros
    //     da Série Conhecer e Despertar vivem na aba Preços, slugs:
    //     vencendo_medo, vencendo_desordem, vencendo_validacao, vencendo_sobrevivencia.
    //     Mantemos o CREATE pra não quebrar deploys antigos, mas não consultamos mais.) ──
    await c.query(`
      CREATE TABLE IF NOT EXISTS teste_livros (
        slug VARCHAR(50) PRIMARY KEY,
        energia VARCHAR(40),
        titulo VARCHAR(200),
        capa_url TEXT,
        preco NUMERIC(10,2),
        link_checkout TEXT,
        selo VARCHAR(200),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      )
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
        ('subconsciente', 1, 'teste_subconsciente',     'Conhecer',                              'Identifique o padrão que trava sua prosperidade.'),
        ('subconsciente', 2, 'vencendo_medo',           'Despertar — Vencendo o Medo',           'Liberar a energia transversal que paralisa.'),
        ('subconsciente', 3, 'vencendo_desordem',       'Despertar — Vencendo a Desordem',       'Trazer ordem ao que está disperso.'),
        ('subconsciente', 4, 'vencendo_validacao',      'Despertar — Vencendo a Validação',      'Soltar o vício da aprovação externa.'),
        ('subconsciente', 5, 'vencendo_sobrevivencia',  'Despertar — Vencendo a Sobrevivência',  'Sair do modo de fazer demais na própria força.'),
        ('subconsciente', 6, 'ouro_reprogramacao',      'Reprogramar a Base',                    'Instalar a nova identidade. A ferramenta-chave da Fase 1.'),
        ('subconsciente', 7, 'clube_vida_magica',       'Permanecer em Comunidade',              'Sustentar a transformação no convívio diário.')
      ON CONFLICT (jornada_slug, ordem) DO NOTHING
    `);

    // JORNADA 2 — Vida Mágica
    await c.query(`
      INSERT INTO jornadas_passos (jornada_slug, ordem, produto_slug, titulo_passo, descricao_passo) VALUES
        ('vida_magica', 1, 'teste_subconsciente',  'Diagnosticar o nível',                     'Confirmar que sua energia evoluiu para Prosperidade.'),
        ('vida_magica', 2, 'guia_pratico',         'Guia Prático para Reprogramar a Mente',    'Operar a reprogramação no dia a dia.'),
        ('vida_magica', 3, 'magica_fluir',         'Guia de Bolso Mágica do Fluir',            'Manter o estado de fluir nas pequenas coisas.'),
        ('vida_magica', 4, 'atal_maneira_livro',   'A Tal Maneira — Livro',                    'Conhecer o método de manifestação bíblica.'),
        ('vida_magica', 5, 'lda_biblica',          'Lei da Atração Bíblica',                   'Ativar a Lei da Atração à luz da fé.'),
        ('vida_magica', 6, 'clube_vida_magica',    'Permanecer em Comunidade',                 'Crescer entre pessoas que vivem o mesmo método.')
      ON CONFLICT (jornada_slug, ordem) DO NOTHING
    `);

    // JORNADA 3 — Transbordar
    await c.query(`
      INSERT INTO jornadas_passos (jornada_slug, ordem, produto_slug, titulo_passo, descricao_passo) VALUES
        ('transbordar', 1, 'teste_subconsciente',  'Confirmar o transbordo',  'Atestar o nível mais alto de prosperidade.'),
        ('transbordar', 2, 'atal_maneira_curso',   'A Tal Maneira — Curso',   'Ferramenta completa pra quem vive no transbordo.')
      ON CONFLICT (jornada_slug, ordem) DO NOTHING
    `);

    // ── Migration de slugs (deploys anteriores usavam slugs com hífen) ──
    // Atualiza linhas existentes que tinham slugs antigos pra os slugs alinhados com Preços.
    await c.query(`
      UPDATE jornadas_passos SET produto_slug = CASE produto_slug
        WHEN 'teste-subconsciente'           THEN 'teste_subconsciente'
        WHEN 'livro-vencendo-medo'           THEN 'vencendo_medo'
        WHEN 'livro-vencendo-desordem'       THEN 'vencendo_desordem'
        WHEN 'livro-vencendo-validacao'      THEN 'vencendo_validacao'
        WHEN 'livro-vencendo-sobrevivencia'  THEN 'vencendo_sobrevivencia'
        WHEN 'curso-ouro-reprogramacao'      THEN 'ouro_reprogramacao'
        WHEN 'assinatura-comunidade'         THEN 'clube_vida_magica'
        WHEN 'guia-pratico-reprogramar'      THEN 'guia_pratico'
        WHEN 'guia-bolso-magica-fluir'       THEN 'magica_fluir'
        WHEN 'livro-tal-maneira'             THEN 'atal_maneira_livro'
        WHEN 'curso-lda-biblica'             THEN 'lda_biblica'
        WHEN 'curso-tal-maneira'             THEN 'atal_maneira_curso'
        ELSE produto_slug
      END,
      atualizado_em = NOW()
      WHERE produto_slug IN (
        'teste-subconsciente', 'livro-vencendo-medo', 'livro-vencendo-desordem',
        'livro-vencendo-validacao', 'livro-vencendo-sobrevivencia',
        'curso-ouro-reprogramacao', 'assinatura-comunidade',
        'guia-pratico-reprogramar', 'guia-bolso-magica-fluir',
        'livro-tal-maneira', 'curso-lda-biblica', 'curso-tal-maneira'
      )
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
