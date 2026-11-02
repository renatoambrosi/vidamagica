/* ============================================================
   VIDA MÁGICA — routes/teste.js
   Endpoints do Teste do Subconsciente (lado da aluna).

   Banco principal: poolTeste.
   Cruzamento: poolCore (tabela usuarios) — sem JOIN entre bancos.

   Versionamento:
   - GET /perguntas devolve versao_id; frontend manda de volta no /responder.
   - Se versão mudou no meio (admin publicou nova), responder retorna
     409 'versao_alterada' e o frontend reinicia o quiz.
   ============================================================ */

const express = require('express');
const router = express.Router();

const { poolCore, poolTeste, poolComunicacao } = require('../db');
const { formatarTelefone } = require('../core/utils');
const { buscarUsuarioPorIdentificador } = require('../core/usuarios');
const { PERFIS_VALIDOS, PERFIS_LABELS, FAIXA_PROSPERIDADE } = require('../core/teste-conteudo');
const {
  calcularResultado,
  montarLivrosRecomendados,
  montarListaEnergias,
} = require('../core/teste-resultado');
const { calcularJornadaVigente, indicacaoDoPerfil, temClubeVidaMagica, SLUG } = require('../core/jornadas');
const { autenticar } = require('../middleware/autenticar');
const { enfileirarAtendimento } = require('../core/gateway');
const { lerModoDevTeste, lerMostrarLogTeste } = require('../core/teste-config');
const { processarProdutos } = require('./produtos');

// Número do Renato — recebe aviso no WhatsApp a cada avaliação nova do resultado.
const TELEFONE_ADMIN_AVALIACOES = formatarTelefone('62983086320');

// LP própria de cada curso indicado — pro botão "Conhecer mais" no resultado.
// Rotas amigáveis definidas em server.js.
const LP_POR_SLUG_CURSO = {
  [SLUG.OURO]: '/ouro-da-reprogramacao-mental',
  [SLUG.LDA]: '/lei-da-atracao-biblica',
  [SLUG.ATAL_CURSO]: '/a-tal-maneira',
};

// ⚠️ DEV FLAG — ATIVAÇÃO DA TRILHA (jornada da aluna) ⚠️
// false (agora) = ver o resultado NÃO ativa a trilha/jornada: não marca
//   ativou_trilha, não atualiza usuarios.perfil_teste, não cria celebração,
//   não mostra splash "Criando sua jornada" nem popup de re-teste. O resultado
//   continua sendo exibido normalmente (perfil, energias, livros, curso).
// true = comportamento completo (ativa a jornada no app). Reverter = 1 linha.
const TRILHA_ATIVA = false;

// ── Validações simples ──────────────────────────────────────
function validarNome(nome) {
  if (!nome || typeof nome !== 'string') return null;
  const limpo = nome.trim().replace(/\s+/g, ' ');
  if (limpo.length < 2 || limpo.length > 255) return null;
  return limpo;
}
function validarTelefoneCanonico(telCanonico) {
  if (!telCanonico) return false;
  return /^55\d{10,11}$/.test(telCanonico);
}
function validarEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const limpo = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo) || limpo.length > 255) return null;
  return limpo;
}
function sanitizarUtm(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const limpo = valor.trim().slice(0, 100);
  return limpo || null;
}

async function pegarVersaoAtiva() {
  const r = await poolTeste.query(
    `SELECT id, nome FROM teste_versoes WHERE status='ativa' LIMIT 1`
  );
  return r.rows[0] || null;
}

// ── POST /api/teste/buscar-usuario ──────────────────────────
router.post('/buscar-usuario', async (req, res) => {
  try {
    const { telefone } = req.body || {};
    const canonico = formatarTelefone(telefone);
    if (!validarTelefoneCanonico(canonico)) {
      return res.json({ encontrado: false });
    }
    const usuario = await buscarUsuarioPorIdentificador({ telefone: canonico });
    if (usuario && usuario.nome) {
      return res.json({ encontrado: true, nome: usuario.nome });
    }
    return res.json({ encontrado: false });
  } catch (err) {
    console.error('[teste/buscar-usuario] erro:', err);
    return res.status(500).json({ encontrado: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/iniciar ─────────────────────────────────
router.post('/iniciar', async (req, res) => {
  try {
    const { nome, telefone, email, aceite_marketing, utm_source, utm_medium, utm_campaign } = req.body || {};

    const nomeLimpo = validarNome(nome);
    if (!nomeLimpo) return res.status(400).json({ ok: false, erro: 'Nome inválido' });

    const telCanonico = formatarTelefone(telefone);
    if (!validarTelefoneCanonico(telCanonico)) {
      return res.status(400).json({ ok: false, erro: 'Telefone inválido' });
    }

    const emailLimpo = validarEmail(email);
    if (!emailLimpo) return res.status(400).json({ ok: false, erro: 'E-mail inválido' });

    const aceiteMarketing = aceite_marketing === true;

    const utms = {
      source:   sanitizarUtm(utm_source),
      medium:   sanitizarUtm(utm_medium),
      campaign: sanitizarUtm(utm_campaign),
    };

    let usuario = await buscarUsuarioPorIdentificador({ telefone: telCanonico });
    let usuarioId;
    if (usuario) {
      usuarioId = usuario.id;
      if (!usuario.nome || usuario.nome.trim() === '') {
        await poolCore.query(
          `UPDATE usuarios SET nome=$1, atualizado_em=NOW() WHERE id=$2`,
          [nomeLimpo, usuarioId]
        );
      }
      // E-mail não sobrescreve se já existir (pode ser de outra origem/verificado);
      // aceite de marketing só evolui de false→true, nunca regride sozinho.
      await poolCore.query(
        `UPDATE usuarios
            SET email = COALESCE(email, $1),
                aceite_marketing = aceite_marketing OR $2,
                atualizado_em = NOW()
          WHERE id = $3`,
        [emailLimpo, aceiteMarketing, usuarioId]
      ).catch(e => console.warn('⚠️ [teste/iniciar] usuario email (provável duplicado):', e.message));
    } else {
      let r;
      try {
        r = await poolCore.query(
          `INSERT INTO usuarios (telefone, telefone_formatado, nome, email, aceite_marketing, status, origem_cadastro)
           VALUES ($1, $1, $2, $3, $4, 'incompleta', 'teste')
           RETURNING id`,
          [telCanonico, nomeLimpo, emailLimpo, aceiteMarketing]
        );
      } catch (e) {
        // E-mail já usado por outra conta (índice único) — não pode travar um
        // telefone novo por causa disso; cadastra sem o e-mail.
        console.warn('⚠️ [teste/iniciar] email duplicado no cadastro novo, seguindo sem email:', e.message);
        r = await poolCore.query(
          `INSERT INTO usuarios (telefone, telefone_formatado, nome, aceite_marketing, status, origem_cadastro)
           VALUES ($1, $1, $2, $3, 'incompleta', 'teste')
           RETURNING id`,
          [telCanonico, nomeLimpo, aceiteMarketing]
        );
      }
      usuarioId = r.rows[0].id;
    }

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
            SET nome=$1, telefone_canonico=$2, usuario_id=$3, email=$4,
                aceite_marketing=aceite_marketing OR $5,
                utm_source=COALESCE($6, utm_source),
                utm_medium=COALESCE($7, utm_medium),
                utm_campaign=COALESCE($8, utm_campaign),
                atualizado_em=NOW()
          WHERE id=$9`,
        [nomeLimpo, telCanonico, usuarioId, emailLimpo, aceiteMarketing, utms.source, utms.medium, utms.campaign, leadId]
      );
    } else {
      const r = await poolTeste.query(
        `INSERT INTO teste_leads (telefone_canonico, nome, usuario_id, email, aceite_marketing, utm_source, utm_medium, utm_campaign)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [telCanonico, nomeLimpo, usuarioId, emailLimpo, aceiteMarketing, utms.source, utms.medium, utms.campaign]
      );
      leadId = r.rows[0].id;
    }

    return res.json({ ok: true, lead_id: leadId, usuario_id: usuarioId });
  } catch (err) {
    console.error('[teste/iniciar] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /api/teste/perguntas ────────────────────────────────
router.get('/perguntas', async (req, res) => {
  try {
    const versao = await pegarVersaoAtiva();
    if (!versao) {
      return res.status(503).json({ ok: false, erro: 'Sem versão ativa do teste' });
    }
    const r = await poolTeste.query(
      `SELECT p.ordem, p.pergunta,
              a.perfil, a.texto, a.ordem_exibicao
         FROM teste_perguntas p
         JOIN teste_alternativas a
           ON a.versao_id = p.versao_id
          AND a.pergunta_ordem = p.ordem
        WHERE p.versao_id = $1
        ORDER BY p.ordem, a.ordem_exibicao`,
      [versao.id]
    );
    const map = new Map();
    for (const row of r.rows) {
      if (!map.has(row.ordem)) {
        map.set(row.ordem, { ordem: row.ordem, pergunta: row.pergunta, alternativas: [] });
      }
      map.get(row.ordem).alternativas.push({ id: row.perfil, texto: row.texto });
    }
    const perguntas = Array.from(map.values()).sort((a, b) => a.ordem - b.ordem);
    return res.json({
      ok: true,
      versao_id: versao.id,
      versao_nome: versao.nome,
      perguntas,
    });
  } catch (err) {
    console.error('[teste/perguntas] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /api/teste/progresso?lead_id=...&versao_id=... ──────
router.get('/progresso', async (req, res) => {
  try {
    const leadId = (req.query.lead_id || '').toString().trim();
    const versaoId = parseInt(req.query.versao_id, 10);
    if (!leadId) return res.status(400).json({ ok: false, erro: 'lead_id ausente' });
    if (!Number.isInteger(versaoId)) return res.status(400).json({ ok: false, erro: 'versao_id ausente' });

    const r = await poolTeste.query(
      `SELECT pergunta_ordem, perfil, respondido_em
         FROM teste_respostas
        WHERE lead_id=$1 AND versao_id=$2
        ORDER BY pergunta_ordem`,
      [leadId, versaoId]
    );

    // Data/hora da primeira resposta (= quando o teste começou)
    let iniciadoEm = null;
    if (r.rows.length > 0) {
      const minR = await poolTeste.query(
        `SELECT MIN(respondido_em) AS m
           FROM teste_respostas
          WHERE lead_id=$1 AND versao_id=$2`,
        [leadId, versaoId]
      );
      iniciadoEm = minR.rows[0].m;
    }

    return res.json({
      ok: true,
      respostas: r.rows.map(x => ({ pergunta_ordem: x.pergunta_ordem, perfil: x.perfil })),
      iniciado_em: iniciadoEm,
      total: 15,
    });
  } catch (err) {
    console.error('[teste/progresso] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/reiniciar ───────────────────────────────
// Body: { lead_id, versao_id }
// Apaga todas as respostas em progresso desse lead nessa versão.
// Usado quando a aluna escolhe "começar de novo" tendo um teste já iniciado.
router.post('/reiniciar', async (req, res) => {
  try {
    const { lead_id, versao_id } = req.body || {};
    if (!lead_id || typeof lead_id !== 'string') {
      return res.status(400).json({ ok: false, erro: 'lead_id inválido' });
    }
    const versaoIdNum = parseInt(versao_id, 10);
    if (!Number.isInteger(versaoIdNum)) {
      return res.status(400).json({ ok: false, erro: 'versao_id inválido' });
    }

    const versaoAtiva = await pegarVersaoAtiva();
    if (!versaoAtiva || versaoAtiva.id !== versaoIdNum) {
      return res.status(409).json({ ok: false, erro: 'versao_alterada' });
    }

    const r = await poolTeste.query(
      `DELETE FROM teste_respostas WHERE lead_id=$1 AND versao_id=$2 RETURNING id`,
      [lead_id, versaoIdNum]
    );
    return res.json({ ok: true, apagadas: r.rowCount });
  } catch (err) {
    console.error('[teste/reiniciar] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/responder ───────────────────────────────
router.post('/responder', async (req, res) => {
  try {
    const { lead_id, versao_id, pergunta_ordem, perfil } = req.body || {};

    if (!lead_id || typeof lead_id !== 'string') {
      return res.status(400).json({ ok: false, erro: 'lead_id inválido' });
    }
    const versaoIdNum = parseInt(versao_id, 10);
    if (!Number.isInteger(versaoIdNum)) {
      return res.status(400).json({ ok: false, erro: 'versao_id inválido' });
    }
    const ordemNum = parseInt(pergunta_ordem, 10);
    if (!Number.isInteger(ordemNum) || ordemNum < 1 || ordemNum > 15) {
      return res.status(400).json({ ok: false, erro: 'pergunta_ordem inválida' });
    }
    if (!PERFIS_VALIDOS.includes(perfil)) {
      return res.status(400).json({ ok: false, erro: 'perfil inválido' });
    }

    const versaoAtiva = await pegarVersaoAtiva();
    if (!versaoAtiva || versaoAtiva.id !== versaoIdNum) {
      return res.status(409).json({ ok: false, erro: 'versao_alterada' });
    }

    const leadRows = await poolTeste.query(
      `SELECT id, telefone_canonico, usuario_id FROM teste_leads WHERE id=$1`,
      [lead_id]
    );
    if (!leadRows.rows[0]) return res.status(404).json({ ok: false, erro: 'lead não encontrado' });
    const lead = leadRows.rows[0];

    const alt = await poolTeste.query(
      `SELECT 1 FROM teste_alternativas
        WHERE versao_id=$1 AND pergunta_ordem=$2 AND perfil=$3`,
      [versaoIdNum, ordemNum, perfil]
    );
    if (!alt.rows[0]) {
      return res.status(400).json({ ok: false, erro: 'alternativa inexistente' });
    }

    await poolTeste.query(
      `INSERT INTO teste_respostas (lead_id, versao_id, pergunta_ordem, perfil)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lead_id, versao_id, pergunta_ordem)
       DO UPDATE SET perfil=EXCLUDED.perfil, respondido_em=NOW()`,
      [lead_id, versaoIdNum, ordemNum, perfil]
    );

    // Se ela voltou e mudou uma resposta intermediária (ex: pergunta 4),
    // as respostas posteriores (5 em diante) eram da rodada antiga.
    // Apaga elas pra forçar a aluna a refazer dali pra frente.
    await poolTeste.query(
      `DELETE FROM teste_respostas
        WHERE lead_id=$1 AND versao_id=$2 AND pergunta_ordem > $3`,
      [lead_id, versaoIdNum, ordemNum]
    );

    const cnt = await poolTeste.query(
      `SELECT pergunta_ordem, perfil FROM teste_respostas
        WHERE lead_id=$1 AND versao_id=$2 ORDER BY pergunta_ordem`,
      [lead_id, versaoIdNum]
    );
    const respondidas = cnt.rows.length;

    if (respondidas < 15) {
      return res.json({ ok: true, completo: false, respondidas, total: 15 });
    }

    const respostasArr = cnt.rows.map(r => ({
      pergunta_ordem: r.pergunta_ordem,
      perfil: r.perfil,
    }));
    const resultado = calcularResultado(respostasArr);

    // Cada teste concluído é um registro próprio e nunca é apagado: um checkout
    // aberto de um teste anterior ainda pode ser pago e precisa encontrá-lo.
    // INSERT sempre — o registro novo nasce não visto e não pago.
    // Só vira pago via POST /api/teste/marcar-pago (webhook do checkout).
    // Feito com Modo dev ligado, guarda isso e o resultado fica aberto.
    const modoDev = await lerModoDevTeste();
    const insR = await poolTeste.query(
      `INSERT INTO testes
         (usuario_id, lead_id, versao_id, telefone_canonico, respostas,
          contagem, percentuais,
          perfil_dominante, percentual_prosperidade, nivel_prosperidade,
          pago, modo_dev)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11)
       RETURNING id`,
      [
        lead.usuario_id,
        lead_id,
        versaoIdNum,
        lead.telefone_canonico,
        JSON.stringify(respostasArr),
        JSON.stringify(resultado.contagem),
        JSON.stringify(resultado.percentuais_exibicao),
        resultado.perfil_dominante,
        resultado.percentual_prosperidade,
        resultado.nivel_prosperidade,
        modoDev,
      ]
    );
    const testeId = insR.rows[0].id;

    // OBS: O cache usuarios.perfil_teste e .percentual_prosperidade NÃO é
    // atualizado aqui. A regra é: a jornada/perfil da aluna só muda DEPOIS
    // que ela clica em "ver resultado" (e marca visto_em). Esse update
    // acontece em GET /api/teste/resultado/:teste_id.
    // Justificativa: enquanto a aluna não viu o novo resultado, o app dela
    // continua funcionando com base no teste anterior (jornada antiga).

    return res.json({
      ok: true,
      completo: true,
      teste_id: testeId,
      perfil_dominante: resultado.perfil_dominante,
      percentual_prosperidade: resultado.percentual_prosperidade,
      contagem: resultado.contagem,
      percentuais: resultado.percentuais_exibicao,
      pagamento_obrigatorio: !modoDev,
    });
  } catch (err) {
    console.error('[teste/responder] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/marcar-pago ─────────────────────────────
// Webhook do checkout externo (pagamento.suellenseragi.com.br).
// Chamado quando o Pix é confirmado. Faz DUAS coisas:
//   1. Marca o teste como pago (libera o gate em GET /resultado/:teste_id).
//   2. ENRIQUECE O CADASTRO da aluna com os dados que ela digitou no checkout
//      (email, nome, CPF) — "completa o cadastro" que o teste deixou incompleto
//      (o /iniciar cria usuarios com status='incompleta', só telefone+nome).
// Idempotente — pode ser chamado várias vezes (MP dispara created + updated).
//
// Contrato flexível — aceita:
//   uid:      body.uid | body.teste_id | body.id | query.uid | query.teste_id (UUID)
//   email:    body.email | body.payer_email
//   nome:     body.nome | body.name | body.first_name (+ last_name)
//   cpf:      body.cpf | body.documento
//   telefone: body.telefone | body.phone | body.whatsapp
// Enriquecimento preenche SÓ campos vazios (COALESCE). Conflito de email/CPF
// (já pertence a outra aluna) é logado e ignorado — NUNCA quebra a confirmação
// do pagamento.
//
// Segurança: se PAGAMENTO_WEBHOOK_TOKEN estiver no .env, exige o mesmo token
// via header 'x-webhook-token' | query.token | body.token. Sem o env, apenas
// registra um aviso e prossegue (não trava o Renato antes de configurar).
router.post('/marcar-pago', async (req, res) => {
  try {
    const b = req.body || {};
    const q = req.query || {};

    // ── Auth por token compartilhado (opcional até configurar o env) ──
    const tokenEsperado = (process.env.PAGAMENTO_WEBHOOK_TOKEN || '').trim();
    if (tokenEsperado) {
      const tokenRecebido = (
        req.get('x-webhook-token') || q.token || b.token || ''
      ).toString().trim();
      if (tokenRecebido !== tokenEsperado) {
        console.warn('⚠️ [teste/marcar-pago] token inválido — recusado.');
        return res.status(403).json({ ok: false, erro: 'token inválido' });
      }
    } else {
      console.warn('⚠️ [teste/marcar-pago] PAGAMENTO_WEBHOOK_TOKEN não configurado — webhook sem autenticação.');
    }

    // ── Extrai o uid (teste_id) de qualquer campo plausível ──
    // Tolera prefixo "VM" (marca de origem posta pelo Vida Mágica) — remove
    // pra recuperar o teste_id (UUID puro), caso o checkout não tenha tirado.
    const uid = (b.uid || b.teste_id || b.id || q.uid || q.teste_id || '')
      .toString().trim().replace(/^VM/i, '');
    if (!uid) {
      return res.status(400).json({ ok: false, erro: 'uid ausente' });
    }
    // teste_id é UUID — valida o formato pra evitar UPDATE com lixo.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
      return res.status(400).json({ ok: false, erro: 'uid inválido' });
    }

    // ── 1) Marca pago e recupera a identidade ligada ao teste ──
    const upd = await poolTeste.query(
      `UPDATE testes SET pago = TRUE
        WHERE id = $1
        RETURNING id, usuario_id, telefone_canonico`,
      [uid]
    );
    if (!upd.rows[0]) {
      console.warn(`⚠️ [teste/marcar-pago] teste não encontrado: ${uid}`);
      return res.status(404).json({ ok: false, erro: 'teste não encontrado' });
    }
    const { usuario_id, telefone_canonico } = upd.rows[0];
    console.log(`✅ [teste/marcar-pago] teste ${uid} marcado como pago.`);

    // ── 2) Normaliza os dados do checkout pra enriquecer o cadastro ──
    const emailRaw = (b.email || b.payer_email || q.email || '').toString().trim().toLowerCase();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;

    const nomeMontado = (b.nome || b.name ||
      [b.first_name, b.last_name].filter(Boolean).join(' ') || '').toString().trim();
    const nome = nomeMontado ? validarNome(nomeMontado) : null;

    const cpfDigitos = (b.cpf || b.documento || '').toString().replace(/\D/g, '');
    const cpf = cpfDigitos.length === 11 ? cpfDigitos : null;

    const telRaw = (b.telefone || b.phone || b.whatsapp || '').toString().trim();
    const telChk = telRaw ? formatarTelefone(telRaw) : null;

    // Descobre qual usuária completar (por id do teste; senão pelo telefone).
    let alvoId = usuario_id || null;
    if (!alvoId) {
      const telBusca = telefone_canonico || (validarTelefoneCanonico(telChk) ? telChk : null);
      if (telBusca) {
        const u = await poolCore.query(
          `SELECT id FROM usuarios WHERE telefone = $1 LIMIT 1`, [telBusca]
        ).catch(() => null);
        if (u && u.rows[0]) alvoId = u.rows[0].id;
      }
    }

    // Enriquece o lead do teste (tem coluna email própria).
    if (email && (usuario_id || telefone_canonico)) {
      await poolTeste.query(
        `UPDATE teste_leads
            SET email = COALESCE(NULLIF(email, ''), $1), atualizado_em = NOW()
          WHERE usuario_id = $2 OR telefone_canonico = $3`,
        [email, usuario_id, telefone_canonico]
      ).catch(e => console.warn('⚠️ [teste/marcar-pago] lead email:', e.message));
    }

    // Enriquece o cadastro (usuarios). Cada campo em query própria pra que um
    // conflito de UNIQUE (email/cpf) não impeça os outros de preencher.
    if (alvoId) {
      if (nome) {
        // Nome do checkout vai pra coluna dedicada `nome_completo` — não toca no
        // `nome` (que veio do teste). Preenche só se ainda estiver vazio.
        await poolCore.query(
          `UPDATE usuarios SET nome_completo = COALESCE(NULLIF(nome_completo, ''), $2), atualizado_em = NOW() WHERE id = $1`,
          [alvoId, nome]
        ).catch(e => console.warn('⚠️ [teste/marcar-pago] usuario nome_completo:', e.message));
      }
      if (email) {
        // COALESCE só preenche se estiver NULL; se já tem email, mantém (sem conflito consigo).
        await poolCore.query(
          `UPDATE usuarios SET email = COALESCE(email, $2), atualizado_em = NOW() WHERE id = $1`,
          [alvoId, email]
        ).catch(e => console.warn('⚠️ [teste/marcar-pago] usuario email (provável duplicado):', e.message));
      }
      if (cpf) {
        await poolCore.query(
          `UPDATE usuarios SET cpf = COALESCE(cpf, $2), atualizado_em = NOW() WHERE id = $1`,
          [alvoId, cpf]
        ).catch(e => console.warn('⚠️ [teste/marcar-pago] usuario cpf (provável duplicado):', e.message));
      }
    }

    return res.json({
      ok: true,
      pago: true,
      teste_id: uid,
      cadastro_enriquecido: !!alvoId,
    });
  } catch (err) {
    console.error('❌ [teste/marcar-pago] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /api/teste/cliente/:teste_id ────────────────────────
// Contato da aluna (nome, telefone, email) pelo teste_id. É o "análogo VM"
// da planilha do Tally: o checkout usa isto pra montar as mensagens do fluxo
// Teste do Subconsciente (WhatsApp), já que o telefone foi coletado no /iniciar.
// Aceita o teste_id com ou sem prefixo "VM". Retorna PII → protegido pelo mesmo
// token do webhook (se PAGAMENTO_WEBHOOK_TOKEN estiver setado).
router.get('/cliente/:teste_id', async (req, res) => {
  try {
    const tokenEsperado = (process.env.PAGAMENTO_WEBHOOK_TOKEN || '').trim();
    if (tokenEsperado) {
      const rec = (req.get('x-webhook-token') || req.query.token || '').toString().trim();
      if (rec !== tokenEsperado) {
        return res.status(403).json({ ok: false, erro: 'token inválido' });
      }
    }

    const testeId = (req.params.teste_id || '').toString().trim().replace(/^VM/i, '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testeId)) {
      return res.status(400).json({ ok: false, erro: 'teste_id inválido' });
    }

    const t = await poolTeste.query(
      `SELECT usuario_id, lead_id, telefone_canonico FROM testes WHERE id = $1`,
      [testeId]
    );
    if (!t.rows[0]) return res.status(404).json({ ok: false, erro: 'teste não encontrado' });
    const { usuario_id, lead_id, telefone_canonico } = t.rows[0];

    let nome = null, email = null, telefone = telefone_canonico || null;

    if (lead_id) {
      const l = await poolTeste.query(
        `SELECT nome, email, telefone_canonico FROM teste_leads WHERE id = $1`, [lead_id]
      );
      if (l.rows[0]) {
        nome = l.rows[0].nome || nome;
        email = l.rows[0].email || email;
        telefone = l.rows[0].telefone_canonico || telefone;
      }
    }
    // Completa o que faltar com o cadastro (poolCore) — sem JOIN entre bancos.
    if (usuario_id && (!nome || !email || !telefone)) {
      const u = await poolCore.query(
        `SELECT nome, email, telefone FROM usuarios WHERE id = $1`, [usuario_id]
      );
      if (u.rows[0]) {
        nome = nome || u.rows[0].nome;
        email = email || u.rows[0].email;
        telefone = telefone || u.rows[0].telefone;
      }
    }

    return res.json({ ok: true, teste_id: testeId, nome, telefone, email });
  } catch (err) {
    console.error('❌ [teste/cliente] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── GET /api/teste/resultado/:teste_id ──────────────────────
// Devolve TODO o pacote de dados pra renderizar a página de resultado.
// Frontend só renderiza, não calcula nada.
router.get('/resultado/:teste_id', async (req, res) => {
  try {
    const testeId = (req.params.teste_id || '').toString().trim();
    if (!testeId) return res.status(400).json({ ok: false, erro: 'teste_id ausente' });

    // Busca o teste
    const tRows = await poolTeste.query(
      `SELECT t.*, v.nome AS versao_nome
         FROM testes t
         LEFT JOIN teste_versoes v ON v.id = t.versao_id
        WHERE t.id = $1`,
      [testeId]
    );
    if (!tRows.rows[0]) return res.status(404).json({ ok: false, erro: 'teste não encontrado' });
    const teste = tRows.rows[0];

    // GATE DE PAGAMENTO — não vale pra teste feito em modo dev nem enquanto
    // o modo dev do admin estiver ligado.
    // Antes de pagar, o resultado não é revelado nem a trilha é ativada:
    // devolve 402 pra o frontend mostrar "finalize seu pagamento".
    if (!teste.pago && !teste.modo_dev && !(await lerModoDevTeste())) {
      return res.status(402).json({ ok: false, erro: 'pagamento_pendente', pago: false });
    }

    // Recalcula com a lógica oficial (não confia 100% no que está salvo —
    // se a regra mudar, novos acessos refletem a regra nova).
    // teste.respostas vem como JSONB; pode vir como array já parseado.
    const respostas = Array.isArray(teste.respostas) ? teste.respostas : JSON.parse(teste.respostas || '[]');
    const resultado = calcularResultado(respostas);

    // ──────────────────────────────────────────────────────────
    // PRIMEIRO ACESSO ao resultado → marca visto_em.
    // Se é o PRIMEIRO teste da aluna (não tem outro com ativou_trilha=true),
    // ativa a trilha automaticamente — não tem porque perguntar, é a 1ª vez.
    // Se é RE-TESTE (já tem outro ativo), só marca visto_em e retorna
    // eh_reteste=true pra o frontend mostrar o popup "quer atualizar trilha?".
    // ──────────────────────────────────────────────────────────
    let ehReteste = false;
    let trilhaAtivadaAgora = false;

    // TRILHA_ATIVA=false → não ativa a jornada (nem marca visto/celebração).
    if (TRILHA_ATIVA && !teste.visto_em) {
      // Marca como visto
      try {
        await poolTeste.query(
          `UPDATE testes SET visto_em = NOW() WHERE id = $1 AND visto_em IS NULL`,
          [testeId]
        );
        teste.visto_em = new Date();
      } catch (e) {
        console.warn('[teste/resultado] falha ao marcar visto_em:', e.message);
      }

      // Verifica se é primeiro teste ou re-teste
      const outrosAtivos = await poolTeste.query(
        `SELECT id FROM testes
          WHERE (usuario_id = $1 OR telefone_canonico = $2)
            AND id <> $3
            AND ativou_trilha = TRUE
          LIMIT 1`,
        [teste.usuario_id, teste.telefone_canonico, testeId]
      );

      if (outrosAtivos.rows.length === 0) {
        // PRIMEIRO TESTE — ativa a trilha automaticamente
        try {
          await poolTeste.query(
            `UPDATE testes SET ativou_trilha = TRUE WHERE id = $1`,
            [testeId]
          );
          teste.ativou_trilha = true;
          trilhaAtivadaAgora = true;

          // Atualiza cache no banco Core (usuarios.perfil_teste)
          // E cria a atualização pendente da animação de celebração.
          if (teste.usuario_id) {
            const perfilBruto = (resultado.perfil_dominante || '').startsWith('prosperidade')
              ? 'prosperidade'
              : resultado.perfil_dominante;
            await poolCore.query(
              `UPDATE usuarios
                  SET perfil_teste = $1,
                      percentual_prosperidade = $2,
                      atualizado_em = NOW()
                WHERE id = $3`,
              [perfilBruto, resultado.percentual_prosperidade, teste.usuario_id]
            );

            // Atualização pendente — frontend vai mostrar a splash quando
            // a aluna clicar no banner/aviso, ou no fim do resultado do teste.
            await poolCore.query(
              `INSERT INTO atualizacoes_pendentes (usuario_id, tipo, payload)
               VALUES ($1, 'teste', $2)`,
              [teste.usuario_id, JSON.stringify({ teste_id: testeId, contexto: 'criando' })]
            );
          }
        } catch (e) {
          console.warn('[teste/resultado] falha ao ativar trilha (primeiro teste):', e.message);
        }
      } else {
        // RE-TESTE — não ativa automaticamente, frontend vai mostrar popup
        ehReteste = true;
      }
    }

    // Nome da aluna (lead)
    let nomeAluna = '';
    if (teste.lead_id) {
      const lRows = await poolTeste.query(
        `SELECT nome FROM teste_leads WHERE id=$1`,
        [teste.lead_id]
      );
      if (lRows.rows[0]) nomeAluna = lRows.rows[0].nome || '';
    }

    // Conteúdo do perfil dominante (Banco Comunicação)
    const conteudoR = await poolComunicacao.query(
      `SELECT * FROM teste_perfis_conteudo WHERE slug = $1`,
      [resultado.perfil_dominante]
    );
    const conteudoPerfil = conteudoR.rows[0] || null;

    // Produtos relevantes pro resultado:
    //   - Livro indicado: Série Conhecer e Despertar, Guia Prático,
    //     A Tal Maneira (livro) ou Mágica do Fluir
    //   - Curso indicado: Ouro, LDA ou A Tal Maneira (curso)
    // Tudo da mesma tabela `precos` (= produtos).
    const livrosR = await poolComunicacao.query(
      `SELECT key, dados FROM precos
        WHERE key IN (
          'vencendo_medo','vencendo_desordem','vencendo_validacao','vencendo_sobrevivencia',
          'guia_pratico','atal_maneira_livro','magica_fluir',
          'ouro_reprogramacao','lda_biblica','atal_maneira_curso'
        )`
    );
    const precosBySlug = {};
    livrosR.rows.forEach(r => { precosBySlug[r.key] = r.dados || {}; });
    // Aplica a mesma regra de preço usada em /api/produtos (promo ativa vs
    // padrão) — sem isso, o resultado mostrava sempre preco_padrao e ignorava
    // promoção configurada no admin.
    processarProdutos(precosBySlug);
    const livrosRecomendados = montarLivrosRecomendados(precosBySlug, resultado);

    // ── Passo 3 — Curso recomendado (vem da regra, NÃO do admin) ──
    // Substituímos os campos manuais antigos do teste_perfis_conteudo
    // (passo3_curso_titulo, _capa_url, _preco, _link_checkout) pela
    // leitura automática do produto da tabela `precos` baseado no perfil.
    //
    // A indicação vem de core/jornadas.js (perfil dominante → curso).
    // Plenitude não tem curso: os campos ficam vazios e o card some.
    if (conteudoPerfil) {
      const slugCurso = indicacaoDoPerfil(resultado.perfil_dominante).curso;
      const produto = (slugCurso && precosBySlug[slugCurso]) || {};
      conteudoPerfil.passo3_curso_slug         = slugCurso;
      conteudoPerfil.passo3_curso_titulo       = produto.nome || '';
      conteudoPerfil.passo3_curso_capa_url     = produto.imagem_url || '';
      conteudoPerfil.passo3_curso_preco        = produto.exibir_avista || produto.preco_padrao || '';
      conteudoPerfil.passo3_curso_link_checkout = produto.link_checkout_padrao || '';
      // Mesmo "pacote" de preço das LPs (de/por + parcelas) — processarProdutos
      // já calculou tudo isso acima, em cima da promo real configurada no admin.
      conteudoPerfil.passo3_curso_preco_de       = produto.exibir_de || '';
      conteudoPerfil.passo3_curso_desconto_pct   = produto.desconto_pct || null;
      conteudoPerfil.passo3_curso_parcelas_qtd   = produto.exibir_parcelas_qtd || '';
      conteudoPerfil.passo3_curso_parcelas_valor = produto.exibir_parcelas_valor || '';
      conteudoPerfil.passo3_curso_lp             = (slugCurso && LP_POR_SLUG_CURSO[slugCurso]) || '';
      // Qualificações do curso (ex: "4 Módulos" / "14 Aulas Práticas") —
      // texto livre cadastrado pelo Renato no admin de Produtos, campo
      // `atributos`. Fonte do produto, não hardcoded aqui.
      conteudoPerfil.passo3_curso_atributos      = produto.atributos || '';
      // descricao: não vem do produto. Mantém vazio (frontend esconde
      // o trecho se for falsy).
      conteudoPerfil.passo3_curso_descricao = conteudoPerfil.passo3_curso_descricao || '';
      // Limpa o "2 de 2" — não usamos mais a duplicação de Prosperidade.
      conteudoPerfil.passo3_curso_titulo_2 = null;
      conteudoPerfil.passo3_curso_capa_url_2 = null;
      conteudoPerfil.passo3_curso_descricao_2 = null;
      conteudoPerfil.passo3_curso_preco_2 = null;
      conteudoPerfil.passo3_curso_link_checkout_2 = null;
    }

    // Lista das 5 energias (Bloco 3)
    const energias = montarListaEnergias(resultado);
    const log = (await lerMostrarLogTeste())
      ? await montarLogTeste(testeId).catch(() => null)
      : null;

    // Texto do compartilhamento
    let textoCompartilhar = '';
    try {
      const cR = await poolComunicacao.query(
        `SELECT dados FROM config WHERE chave = 'resultado_compartilhar_texto'`
      );
      if (cR.rows[0]) textoCompartilhar = cR.rows[0].dados.texto || '';
    } catch {}

    // ── Jornada vigente (via core/jornadas.js) ──
    // Função canônica que determina:
    //   - qual jornada a aluna está (1, 2 ou 3)
    //   - quais passos com pesos e produtos
    //   - quais passos estão concluídos (cruzando com usuario_produtos)
    //   - progresso ponderado em %

    // Slugs que a aluna possui (com cortesia/manual entrando naturalmente)
    const slugsComprados = new Set();
    let usuarioPlano = 'gratuito';
    if (teste.usuario_id) {
      try {
        const compR = await poolCore.query(
          `SELECT p.slug
             FROM usuario_produtos up
             JOIN produtos p ON p.id = up.produto_id
            WHERE up.usuario_id = $1 AND up.ativo = TRUE`,
          [teste.usuario_id]
        );
        compR.rows.forEach(r => { if (r.slug) slugsComprados.add(r.slug); });
      } catch (e) {
        console.warn('[teste/resultado] erro ao buscar produtos da aluna:', e.message);
      }

      // Plano atual da aluna (pra saber se tem Clube Vida Mágica)
      try {
        const uR = await poolCore.query(
          `SELECT plano FROM usuarios WHERE id=$1`,
          [teste.usuario_id]
        );
        if (uR.rows[0]) usuarioPlano = uR.rows[0].plano || 'gratuito';
      } catch (e) {
        console.warn('[teste/resultado] erro ao buscar plano:', e.message);
      }
    }

    const jornadaInfo = calcularJornadaVigente({
      perfil_dominante: resultado.perfil_dominante,
      slugsComprados,
    });

    const temClube = temClubeVidaMagica({ plano: usuarioPlano });

    return res.json({
      ok: true,
      teste: {
        id: teste.id,
        feito_em: teste.feito_em,
        visto_em: teste.visto_em,
        ativou_trilha: !!teste.ativou_trilha,
        versao_nome: teste.versao_nome,
      },
      aluna: {
        nome: nomeAluna,
      },
      // Cálculo
      perfil_dominante: resultado.perfil_dominante,            // ex: 'medo' ou 'prosperidade_nv2'
      perfil_dominante_bruto: resultado.perfil_dominante_bruto, // ex: 'medo' ou 'prosperidade'
      faixa_prosperidade: FAIXA_PROSPERIDADE[resultado.perfil_dominante] || null,
      energias,                                                 // [{slug,label,percentual_inteiro}, ...]
      log,                                                      // box Log, só com a chave do admin ligada
      // Conteúdo do perfil
      conteudo: conteudoPerfil,                                 // tudo de teste_perfis_conteudo
      // Livros do Passo 2
      livros: livrosRecomendados,
      // Jornada do método (genérica, pública)
      jornada: jornadaInfo,
      // Texto pro botão de compartilhar
      compartilhar_texto: textoCompartilhar,
      // Plano da aluna (pra cadeado/CTA Clube Vida Mágica no frontend)
      tem_clube: temClube,
      // ── Flags de fluxo ──
      // eh_reteste: aluna acabou de ver um RE-TESTE (já tinha trilha ativa).
      //   Frontend mostra popup "quer atualizar sua trilha?" antes de exibir.
      // trilha_ativada_agora: era o PRIMEIRO teste e a trilha foi ativada
      //   automaticamente. Frontend mostra animação "Criando sua jornada".
      eh_reteste: ehReteste,
      trilha_ativada_agora: trilhaAtivadaAgora,
    });
  } catch (err) {
    console.error('[teste/resultado] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── POST /api/teste/ativar-trilha/:teste_id ─────────────────
// Endpoint pra confirmar que a aluna QUER atualizar a trilha pra esse teste.
// Disparado pelo popup "Quer atualizar sua trilha?" no app aluna.
//
// Marca esse teste como ativou_trilha=true, desativa todos os outros do
// mesmo lead/usuário, e atualiza o cache em usuarios.perfil_teste.
//
// Idempotente — se já está ativo, não faz nada.
router.post('/ativar-trilha/:teste_id', async (req, res) => {
  try {
    // Trilha desligada nesta fase — não ativa nada (mas responde ok pra não quebrar o front).
    if (!TRILHA_ATIVA) return res.json({ ok: true, ignorado: true });

    const testeId = (req.params.teste_id || '').toString().trim();
    if (!testeId) return res.status(400).json({ ok: false, erro: 'teste_id ausente' });

    // Busca o teste
    const tRows = await poolTeste.query(
      `SELECT id, usuario_id, telefone_canonico, respostas, ativou_trilha
         FROM testes WHERE id = $1`,
      [testeId]
    );
    if (!tRows.rows[0]) return res.status(404).json({ ok: false, erro: 'teste não encontrado' });
    const teste = tRows.rows[0];

    // Se já está ativo, no-op
    if (teste.ativou_trilha) return res.json({ ok: true, ja_ativo: true });

    // Desativa todos os outros do mesmo lead/usuário
    await poolTeste.query(
      `UPDATE testes
          SET ativou_trilha = FALSE
        WHERE (usuario_id = $1 OR telefone_canonico = $2)
          AND id <> $3`,
      [teste.usuario_id, teste.telefone_canonico, testeId]
    );

    // Ativa esse
    await poolTeste.query(
      `UPDATE testes SET ativou_trilha = TRUE WHERE id = $1`,
      [testeId]
    );

    // Atualiza cache em usuarios.perfil_teste (banco Core) E cria
    // a atualização pendente pra disparar a splash de celebração.
    if (teste.usuario_id) {
      try {
        const respostas = Array.isArray(teste.respostas) ? teste.respostas : JSON.parse(teste.respostas || '[]');
        const resultado = calcularResultado(respostas);
        const perfilBruto = (resultado.perfil_dominante || '').startsWith('prosperidade')
          ? 'prosperidade'
          : resultado.perfil_dominante;
        await poolCore.query(
          `UPDATE usuarios
              SET perfil_teste = $1,
                  percentual_prosperidade = $2,
                  atualizado_em = NOW()
            WHERE id = $3`,
          [perfilBruto, resultado.percentual_prosperidade, teste.usuario_id]
        );

        // Atualização pendente — splash "Atualizando sua jornada" será
        // disparada quando a aluna clicar no banner ou no aviso.
        await poolCore.query(
          `INSERT INTO atualizacoes_pendentes (usuario_id, tipo, payload)
           VALUES ($1, 'teste', $2)`,
          [teste.usuario_id, JSON.stringify({ teste_id: testeId, contexto: 'atualizando' })]
        );
      } catch (e) {
        console.warn('[teste/ativar-trilha] falha ao atualizar/criar pendência:', e.message);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[teste/ativar-trilha] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ── Box Log da página de resultado ──────────────────────────
// Conferência: cada campo sai direto do que está gravado, sem passar pelo
// cálculo da tela. Percentual real e primeira menção são refeitos aqui, à parte,
// sobre as respostas cruas, pra comparar com core/teste-resultado.js.
// Letra = posição atual da alternativa. Teste feito antes de uma mudança
// de ordem mostra a letra de hoje, não a que a pessoa viu.
async function montarLogTeste(testeId) {
  const totalR = await poolTeste.query(
    `SELECT jsonb_array_length(respostas) AS total FROM testes WHERE id = $1`,
    [testeId]
  );
  const contagemR = await poolTeste.query(
    `SELECT r->>'perfil' AS perfil, COUNT(*)::int AS respostas
       FROM testes t, jsonb_array_elements(t.respostas) r
      WHERE t.id = $1
      GROUP BY 1`,
    [testeId]
  );
  const gravadoR = await poolTeste.query(
    `SELECT perfil_dominante, versao_id FROM testes WHERE id = $1`,
    [testeId]
  );
  const respostasR = await poolTeste.query(
    `SELECT (r->>'pergunta_ordem')::int AS pergunta, r->>'perfil' AS perfil
       FROM testes t, jsonb_array_elements(t.respostas) r
      WHERE t.id = $1
      ORDER BY 1`,
    [testeId]
  );
  const gravado = gravadoR.rows[0];
  const letrasR = await poolTeste.query(
    `SELECT pergunta_ordem, perfil, ordem_exibicao FROM teste_alternativas WHERE versao_id = $1`,
    [gravado.versao_id]
  );
  const perguntasR = await poolTeste.query(
    `SELECT COUNT(*)::int AS total FROM teste_perguntas WHERE versao_id = $1`,
    [gravado.versao_id]
  );

  const letras = new Map(
    letrasR.rows.map(a => [a.pergunta_ordem + '|' + a.perfil, 'ABCDE'[a.ordem_exibicao - 1]])
  );
  const respostas = respostasR.rows.map(x => ({
    pergunta: x.pergunta,
    letra: letras.get(x.pergunta + '|' + x.perfil) || '?',
    slug: x.perfil,
    label: PERFIS_LABELS[x.perfil] || x.perfil,
  }));
  const contagem = Object.fromEntries(contagemR.rows.map(x => [x.perfil, x.respostas]));

  // Primeira menção: no empate do 1º lugar, vence a primeira energia que
  // apareceu nas respostas. Prosperidade nunca vence empate.
  const maior = Math.max(...Object.values(contagem));
  const empatadas = Object.keys(contagem).filter(p => contagem[p] === maior);
  const candidatas = empatadas.filter(p => p !== 'prosperidade');
  const primeira = respostas.find(x => candidatas.includes(x.slug));
  const usouPrimeira = candidatas.length > 1;
  const vencedora = empatadas.length === 1
    ? empatadas[0]
    : (usouPrimeira ? primeira.slug : candidatas[0]);

  return {
    total: totalR.rows[0].total,
    perguntas_da_versao: perguntasR.rows[0].total,
    contagem,
    percentuais_reais: Object.fromEntries(
      Object.entries(contagem).map(([p, n]) => [p, (n * 100) / totalR.rows[0].total])
    ),
    predominante_gravada: gravado.perfil_dominante,
    respostas,
    primeira_mencao: {
      empate: empatadas.length > 1,
      empatadas: empatadas.map(p => PERFIS_LABELS[p] || p),
      respostas_empate: maior,
      pergunta: usouPrimeira ? primeira.pergunta : null,
      letra: usouPrimeira ? primeira.letra : null,
      vencedora,
    },
    labels: PERFIS_LABELS,
  };
}

// ──────────────────────────────────────────────────────────
// POST /api/teste/avaliacao/:teste_id
// Estrelas (1-5) + comentário, exibidos logo após o botão "Compartilhar
// resultado" em /resultado/:id. Cada envio grava e avisa o Renato por
// WhatsApp (reativo).
// ──────────────────────────────────────────────────────────
router.post('/avaliacao/:teste_id', async (req, res) => {
  try {
    const testeId = (req.params.teste_id || '').toString().trim();
    if (!testeId) return res.status(400).json({ ok: false, erro: 'teste_id ausente' });

    const nota = parseInt(req.body && req.body.nota, 10);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ ok: false, erro: 'nota inválida' });
    }
    const comentario = ((req.body && req.body.comentario) || '').toString().trim().slice(0, 2000) || null;

    const tRows = await poolTeste.query(
      `SELECT t.id, t.perfil_dominante, l.nome
         FROM testes t
         LEFT JOIN teste_leads l ON l.id = t.lead_id
        WHERE t.id = $1`,
      [testeId]
    );
    if (!tRows.rows[0]) return res.status(404).json({ ok: false, erro: 'teste não encontrado' });
    const teste = tRows.rows[0];

    await poolTeste.query(
      `INSERT INTO teste_avaliacoes (teste_id, nota, comentario)
       VALUES ($1, $2, $3)
       ON CONFLICT (teste_id) DO UPDATE
         SET nota = $2,
             comentario = $3,
             criado_em = NOW()`,
      [testeId, nota, comentario]
    );

    try {
      // Mesmo conteúdo exibido no card do admin (aba Avaliações): estrelas,
      // nome + perfil, data, comentário e link pro resultado.
      const nomeAluna = teste.nome || 'Aluna sem nome cadastrado';
      const perfilLabel = PERFIS_LABELS[teste.perfil_dominante] || teste.perfil_dominante || '—';
      const estrelas = '⭐'.repeat(nota) + '☆'.repeat(5 - nota);
      const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const baseUrl = process.env.APP_URL || 'https://www.vidamagica.com.br';
      const linkResultado = `${baseUrl}/resultado/${testeId}`;

      let texto = `📝 Nova avaliação do resultado do Teste do Subconsciente\n\n${estrelas} (${nota}/5)\n${nomeAluna} · ${perfilLabel}\n${agora}`;
      if (comentario) texto += `\n\n"${comentario}"`;
      texto += `\n\n🔗 ${linkResultado}`;

      await enfileirarAtendimento({
        telefone: TELEFONE_ADMIN_AVALIACOES,
        tipo: 'reativo',
        origem: 'teste-avaliacao',
        nome: 'Renato',
        mensagens: [{ texto }],
      });
    } catch (e) {
      console.warn('[teste/avaliacao] falha ao notificar admin no WhatsApp:', e.message);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[teste/avaliacao] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

// ──────────────────────────────────────────────────────────
// DELETE /api/teste/em-andamento
// Apaga as respostas de um teste não concluído da aluna logada.
// Chamado pelo botão "Apagar" do card "Em andamento" em Materiais.
// ──────────────────────────────────────────────────────────
router.delete('/em-andamento', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario && req.usuario.sub;
    if (!usuarioId) return res.status(401).json({ ok: false, erro: 'não autenticado' });

    // Acha telefone canônico pra cruzar com teste_leads (banco separado)
    const uR = await poolCore.query(
      `SELECT telefone FROM usuarios WHERE id=$1 LIMIT 1`,
      [usuarioId]
    );
    const telefone = uR.rows[0] ? uR.rows[0].telefone : null;

    // Busca leads dessa aluna (por usuario_id direto OU por telefone)
    const leadsR = await poolTeste.query(
      `SELECT id FROM teste_leads
        WHERE usuario_id = $1
           OR ($2::text IS NOT NULL AND telefone_canonico = $2)`,
      [usuarioId, telefone]
    );
    const leadIds = leadsR.rows.map(r => r.id);

    if (leadIds.length === 0) {
      return res.json({ ok: true, removidas: 0 });
    }

    // Apaga respostas em andamento (de qualquer versão).
    // Não apaga linhas de testes finalizados (essas estão em `testes`,
    // não em `teste_respostas`).
    const r = await poolTeste.query(
      `DELETE FROM teste_respostas WHERE lead_id = ANY($1::int[])`,
      [leadIds]
    );

    return res.json({ ok: true, removidas: r.rowCount });
  } catch (err) {
    console.error('[teste/em-andamento DELETE] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
