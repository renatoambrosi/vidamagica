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
const { calcularPerfil, PERFIS_VALIDOS } = require('../core/teste-conteudo');
const {
  calcularResultado,
  montarLivrosRecomendados,
  montarListaEnergias,
} = require('../core/teste-resultado');

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
    const { nome, telefone, utm_source, utm_medium, utm_campaign } = req.body || {};

    const nomeLimpo = validarNome(nome);
    if (!nomeLimpo) return res.status(400).json({ ok: false, erro: 'Nome inválido' });

    const telCanonico = formatarTelefone(telefone);
    if (!validarTelefoneCanonico(telCanonico)) {
      return res.status(400).json({ ok: false, erro: 'Telefone inválido' });
    }

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
    } else {
      const r = await poolCore.query(
        `INSERT INTO usuarios (telefone, telefone_formatado, nome, status, origem_cadastro)
         VALUES ($1, $1, $2, 'incompleta', 'teste')
         RETURNING id`,
        [telCanonico, nomeLimpo]
      );
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
            SET nome=$1, telefone_canonico=$2, usuario_id=$3,
                utm_source=COALESCE($4, utm_source),
                utm_medium=COALESCE($5, utm_medium),
                utm_campaign=COALESCE($6, utm_campaign),
                atualizado_em=NOW()
          WHERE id=$7`,
        [nomeLimpo, telCanonico, usuarioId, utms.source, utms.medium, utms.campaign, leadId]
      );
    } else {
      const r = await poolTeste.query(
        `INSERT INTO teste_leads (telefone_canonico, nome, usuario_id, utm_source, utm_medium, utm_campaign)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [telCanonico, nomeLimpo, usuarioId, utms.source, utms.medium, utms.campaign]
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
    const resultado = calcularPerfil(respostasArr);

    const testeExistente = await poolTeste.query(
      `SELECT id FROM testes WHERE lead_id=$1 AND versao_id=$2 ORDER BY feito_em DESC LIMIT 1`,
      [lead_id, versaoIdNum]
    );

    let testeId;
    if (testeExistente.rows[0]) {
      testeId = testeExistente.rows[0].id;
      await poolTeste.query(
        `UPDATE testes
            SET respostas=$1, contagem=$2, percentuais=$3,
                perfil_dominante=$4, percentual_prosperidade=$5, nivel_prosperidade=$6,
                feito_em=NOW()
          WHERE id=$7`,
        [
          JSON.stringify(respostasArr),
          JSON.stringify(resultado.contagem),
          JSON.stringify(resultado.percentuais),
          resultado.perfil_dominante,
          resultado.percentual_prosperidade,
          resultado.nivel_prosperidade,
          testeId,
        ]
      );
    } else {
      const r = await poolTeste.query(
        `INSERT INTO testes
           (usuario_id, lead_id, versao_id, telefone_canonico, respostas,
            contagem, percentuais,
            perfil_dominante, percentual_prosperidade, nivel_prosperidade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          lead.usuario_id,
          lead_id,
          versaoIdNum,
          lead.telefone_canonico,
          JSON.stringify(respostasArr),
          JSON.stringify(resultado.contagem),
          JSON.stringify(resultado.percentuais),
          resultado.perfil_dominante,
          resultado.percentual_prosperidade,
          resultado.nivel_prosperidade,
        ]
      );
      testeId = r.rows[0].id;
    }

    return res.json({
      ok: true,
      completo: true,
      teste_id: testeId,
      perfil_dominante: resultado.perfil_dominante,
      percentual_prosperidade: resultado.percentual_prosperidade,
      contagem: resultado.contagem,
      percentuais: resultado.percentuais,
    });
  } catch (err) {
    console.error('[teste/responder] erro:', err);
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

    // Recalcula com a lógica oficial (não confia 100% no que está salvo —
    // se a regra mudar, novos acessos refletem a regra nova).
    // teste.respostas vem como JSONB; pode vir como array já parseado.
    const respostas = Array.isArray(teste.respostas) ? teste.respostas : JSON.parse(teste.respostas || '[]');
    const resultado = calcularResultado(respostas);

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

    // Livros cadastrados (Banco Comunicação)
    const livrosR = await poolComunicacao.query(
      `SELECT * FROM teste_livros ORDER BY energia`
    );
    const livrosRecomendados = montarLivrosRecomendados(livrosR.rows, resultado);

    // Lista das 5 energias (Bloco 3)
    const energias = montarListaEnergias(resultado);

    // Texto do compartilhamento
    let textoCompartilhar = '';
    try {
      const cR = await poolComunicacao.query(
        `SELECT dados FROM config WHERE chave = 'resultado_compartilhar_texto'`
      );
      if (cR.rows[0]) textoCompartilhar = cR.rows[0].dados.texto || '';
    } catch {}

    return res.json({
      ok: true,
      teste: {
        id: teste.id,
        feito_em: teste.feito_em,
        versao_nome: teste.versao_nome,
      },
      aluna: {
        nome: nomeAluna,
      },
      // Cálculo
      perfil_dominante: resultado.perfil_dominante,            // ex: 'medo' ou 'prosperidade_nv2'
      perfil_dominante_bruto: resultado.perfil_dominante_bruto, // ex: 'medo' ou 'prosperidade'
      energias,                                                 // [{slug,label,percentual_inteiro}, ...]
      // Conteúdo do perfil
      conteudo: conteudoPerfil,                                 // tudo de teste_perfis_conteudo
      // Livros do Passo 2
      livros: livrosRecomendados,
      // Texto pro botão de compartilhar
      compartilhar_texto: textoCompartilhar,
    });
  } catch (err) {
    console.error('[teste/resultado] erro:', err);
    return res.status(500).json({ ok: false, erro: 'erro interno' });
  }
});

module.exports = router;
