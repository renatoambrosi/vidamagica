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
const { calcularJornadaVigente, temClubeVidaMagica } = require('../core/jornadas');
const { autenticar } = require('../middleware/autenticar');

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

    // ──────────────────────────────────────────────────────────
    // REGRA DE PERSISTÊNCIA DO TESTE
    // ──────────────────────────────────────────────────────────
    // - Sem teste prévio                       → INSERT linha nova
    // - Tem teste prévio, NÃO PAGO             → DELETE antigo + INSERT (sobrescreve)
    // - Tem teste prévio, PAGO                 → INSERT linha nova (preserva histórico)
    //
    // Justificativa: testes pagos viram histórico permanente (a aluna pagou,
    // tem direito ao registro). Testes não pagos podem ser sobrescritos quando
    // refeitos, evitando lixo no banco.
    // Aluna pode ter VÁRIOS testes do mesmo lead+versão se todos estão pagos.
    const testesPrevios = await poolTeste.query(
      `SELECT id, pago FROM testes
        WHERE lead_id=$1 AND versao_id=$2
        ORDER BY feito_em DESC`,
      [lead_id, versaoIdNum]
    );

    // Separa: pagos preservar / não pagos deletar
    const naoPagos = testesPrevios.rows.filter(t => !t.pago);
    if (naoPagos.length > 0) {
      const idsPraDeletar = naoPagos.map(t => t.id);
      await poolTeste.query(
        `DELETE FROM testes WHERE id = ANY($1::uuid[])`,
        [idsPraDeletar]
      );
    }

    // INSERT sempre — o registro novo nasce não visto.
    // ⚠️ TEMPORÁRIO ⚠️ — `pago=TRUE` na criação mantém todos os testes
    // como "pago" enquanto o gateway não está implementado. Isso casa com
    // o bypass `|| true` em routes/app.js. Quando o webhook do Kiwify
    // entrar, REMOVER `pago` do INSERT (volta ao default FALSE) — daí
    // só vira pago via /api/teste/marcar-pago disparado pelo webhook.
    const insR = await poolTeste.query(
      `INSERT INTO testes
         (usuario_id, lead_id, versao_id, telefone_canonico, respostas,
          contagem, percentuais,
          perfil_dominante, percentual_prosperidade, nivel_prosperidade,
          pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
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

    // ──────────────────────────────────────────────────────────
    // PRIMEIRO ACESSO ao resultado → marca visto_em.
    // Se é o PRIMEIRO teste da aluna (não tem outro com ativou_trilha=true),
    // ativa a trilha automaticamente — não tem porque perguntar, é a 1ª vez.
    // Se é RE-TESTE (já tem outro ativo), só marca visto_em e retorna
    // eh_reteste=true pra o frontend mostrar o popup "quer atualizar trilha?".
    // ──────────────────────────────────────────────────────────
    let ehReteste = false;
    let trilhaAtivadaAgora = false;

    if (!teste.visto_em) {
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

    // Livros do Passo 2 — buscam dados da tabela `precos` (slugs:
    // vencendo_medo, vencendo_desordem, vencendo_validacao, vencendo_sobrevivencia)
    const livrosR = await poolComunicacao.query(
      `SELECT key, dados FROM precos
        WHERE key IN ('vencendo_medo','vencendo_desordem','vencendo_validacao','vencendo_sobrevivencia')`
    );
    const precosBySlug = {};
    livrosR.rows.forEach(r => { precosBySlug[r.key] = r.dados || {}; });
    const livrosRecomendados = montarLivrosRecomendados(precosBySlug, resultado);

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

    // ── Jornada vigente (via core/jornadas.js) ──
    // Função canônica que determina:
    //   - qual jornada a aluna está (1, 2 ou 3)
    //   - quais passos com pesos (P1/P2/P3) e produtos
    //   - quais passos estão concluídos (cruzando com usuario_produtos)
    //   - progresso ponderado em %
    //   - análise automatizada (texto pra exibir quando relevante)
    //
    // Regras:
    //   - Conhecer e Despertar = default ou quando há trava forte (>20%)
    //   - Vida Mágica          = prosperidade dominante (nv1 ou nv2) sem trava
    //   - Multiplicando Vida Mágica = prosperidade nv3 sem trava

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
      perfil_dominante_bruto: resultado.perfil_dominante_bruto,
      percentuais_exibicao: resultado.percentuais_exibicao,
      nivel_prosperidade: resultado.nivel_prosperidade,
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
      energias,                                                 // [{slug,label,percentual_inteiro}, ...]
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
