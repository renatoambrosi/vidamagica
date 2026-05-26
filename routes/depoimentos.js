/* ============================================================
   VIDA MÁGICA — routes/depoimentos.js
   Banco: poolComunicacao.

   FASE 1 do refactor de Relatos.
   Frontend exibe "relatos" pra aluna/visitante; banco/admin/API
   mantém "depoimento" por compat (vide CLAUDE.md / memory).

   ── ESQUEMA ──
   Tema (1) ─── (1) Produto (slug em precos)
       │
       └─── (N) Depoimentos (relatos)
                  │
                  └─── (0..1) Usuario (aluna que enviou — Fase 2)

   ── ENDPOINTS PÚBLICOS ──
   - GET /api/depoimentos?tema=SLUG       → 1 tema
   - GET /api/depoimentos?temas=a,b,c     → vários temas (ticker do app, vendas)
   - GET /api/depoimentos?tag=NOME        → LEGADO (LPs antigas) — busca em depoimentos.tags
   - GET /api/depoimentos?ticker=true     → só os marcados pra ticker
   - GET /api/depoimentos                 → todos os ativos
   - GET /api/depoimentos/agrupados       → barras da página /relatos
   - GET /api/temas                       → temas ativos com produto vinculado (público)

   ── ENDPOINTS ADMIN (escopo=admin) ──
   Temas:
   - GET    /api/admin/temas
   - POST   /api/admin/temas
   - PUT    /api/admin/temas/:id
   - DELETE /api/admin/temas/:id

   Depoimentos:
   - GET    /api/admin/depoimentos        → aceita ?tema, ?placeholder, ?status
   - POST   /api/admin/depoimentos        → cria 1 (substitui o legado de "lista completa")
   - PUT    /api/admin/depoimentos/:id    → atualiza 1
   - DELETE /api/admin/depoimentos/:id    → remove 1

   ⚠️ O POST antigo (que substituía lista inteira) foi DESCONTINUADO.
   Painel admin pré-Fase-1 que mande body como array recebe 503.
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel } = require('../middleware/autenticar');

// ─────────────────────────────────────────────────────────────
// HELPERS internos
// ─────────────────────────────────────────────────────────────

// Resolve um slug de tema pra tema_id (null se não achar).
async function temaIdPorSlug(slug) {
  if (!slug) return null;
  const r = await poolComunicacao.query(
    `SELECT id FROM temas WHERE LOWER(slug) = LOWER($1) LIMIT 1`,
    [slug]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

// Resolve VÁRIOS slugs pra lista de ids (ignora os que não existem).
async function temaIdsPorSlugs(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) return [];
  const lower = slugs.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (!lower.length) return [];
  const r = await poolComunicacao.query(
    `SELECT id FROM temas WHERE LOWER(slug) = ANY($1)`,
    [lower]
  );
  return r.rows.map(x => x.id);
}

// Sanitiza/normaliza payload de depoimento vindo do admin.
function normalizarPayloadDep(body) {
  const safe = (v) => (v === undefined || v === null ? null : String(v).trim());
  const safeInt = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 && n < 150 ? n : null;
  };
  const safeBool = (v, def) => (typeof v === 'boolean' ? v : def);

  return {
    nome: safe(body.nome) || '',
    profissao: safe(body.profissao),
    idade: safeInt(body.idade),
    cidade: safe(body.cidade),  // legacy — mantido por compat
    texto: safe(body.texto) || '',
    tema_id: body.tema_id ? parseInt(body.tema_id, 10) : null,
    // produto_slug: override opcional do produto do tema. Vazio/null = herda do tema.
    produto_slug: safe(body.produto_slug) || null,
    usuario_id: safe(body.usuario_id),
    mostrar_no_ticker: safeBool(body.mostrar_no_ticker, true),
    gerado_por_ia: safeBool(body.gerado_por_ia, false),
    status_moderacao: ['pendente','aprovado','rejeitado'].includes(body.status_moderacao)
      ? body.status_moderacao : 'aprovado',
    autora_era_assinante_clube: safeBool(body.autora_era_assinante_clube, false),
    ordem: Number.isFinite(parseInt(body.ordem, 10)) ? parseInt(body.ordem, 10) : 0,
    ativo: safeBool(body.ativo, true),
    tags: Array.isArray(body.tags)
      ? body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [],
  };
}

// SELECT canônico de depoimento + dados do tema/produto (JOIN simples).
// `categorias_ids` é array agregado do pivot depoimento_categorias (Fase 2.1a).
const SELECT_DEP_COMPLETO = `
  SELECT
    d.id, d.nome, d.profissao, d.idade, d.cidade, d.texto,
    d.tema_id, t.slug AS tema_slug, t.nome AS tema_nome,
    -- produto_slug do relato vence o do tema (COALESCE).
    -- Quando d.produto_slug é NULL, herda t.produto_slug.
    COALESCE(d.produto_slug, t.produto_slug) AS produto_slug,
    d.produto_slug AS produto_slug_relato,
    t.produto_slug AS produto_slug_tema,
    d.usuario_id, d.mostrar_no_ticker, d.gerado_por_ia, d.status_moderacao,
    d.autora_era_assinante_clube, d.motivo_rejeicao,
    d.tags, d.ordem, d.ativo, d.criado_em, d.atualizado_em,
    COALESCE(
      (SELECT array_agg(dc.categoria_id ORDER BY dc.categoria_id)
         FROM depoimento_categorias dc WHERE dc.depoimento_id = d.id),
      '{}'::int[]
    ) AS categorias_ids
  FROM depoimentos d
  LEFT JOIN temas t ON t.id = d.tema_id
`;

// Sincroniza o pivot depoimento_categorias com a lista de ids passada.
// Aceita array (mesmo vazio). Apaga as antigas e insere as novas (transação local).
async function sincronizarCategorias(depoimento_id, categorias_ids) {
  if (!Array.isArray(categorias_ids)) return;
  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM depoimento_categorias WHERE depoimento_id = $1`, [depoimento_id]);
    if (categorias_ids.length) {
      const valores = categorias_ids
        .map(id => parseInt(id, 10))
        .filter(n => Number.isFinite(n) && n > 0);
      if (valores.length) {
        const params = valores.map((_, i) => `($1, $${i + 2})`).join(',');
        await client.query(
          `INSERT INTO depoimento_categorias (depoimento_id, categoria_id)
           VALUES ${params}
           ON CONFLICT DO NOTHING`,
          [depoimento_id, ...valores]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// PÚBLICO — relatos
// ─────────────────────────────────────────────────────────────

router.get('/depoimentos', async (req, res) => {
  try {
    const { tema, temas, tag, ticker } = req.query;

    const where = [`d.ativo = TRUE`, `d.status_moderacao = 'aprovado'`, `d.oculto_por_conta_inativa = FALSE`];
    const params = [];

    if (tema) {
      const tid = await temaIdPorSlug(tema);
      if (!tid) return res.json([]);
      params.push(tid);
      where.push(`d.tema_id = $${params.length}`);
    } else if (temas) {
      const lista = String(temas).split(',').map(s => s.trim()).filter(Boolean);
      const ids = await temaIdsPorSlugs(lista);
      if (!ids.length) return res.json([]);
      params.push(ids);
      where.push(`d.tema_id = ANY($${params.length})`);
    } else if (tag) {
      // Legado pré-Fase-1: LPs antigas chamam ?tag=slug. Aceita por compat
      // até as 7 LPs serem atualizadas. Quando todas usarem ?tema=, isso some.
      params.push(String(tag).trim().toLowerCase());
      where.push(`$${params.length} = ANY(d.tags)`);
    }

    if (ticker === 'true' || ticker === '1') {
      where.push(`d.mostrar_no_ticker = TRUE`);
    }

    const sql = `${SELECT_DEP_COMPLETO}
      WHERE ${where.join(' AND ')}
      ORDER BY d.ordem ASC, d.id ASC`;

    const result = await poolComunicacao.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erro ao buscar depoimentos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar depoimentos' });
  }
});

// Lista todos os temas ativos com produto vinculado (pra frontend de venda).
router.get('/temas', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT id, slug, nome, produto_slug, ordem
         FROM temas WHERE ativo = TRUE
        ORDER BY ordem ASC, id ASC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('❌ Erro ao listar temas:', err.message);
    res.status(500).json({ error: 'Erro ao carregar temas' });
  }
});

// Página /relatos: retorna { tema_slug → { tema, produto_slug, relatos: [...] } }
// Esconde temas que não têm nenhum relato ativo (pra não haver barra vazia).
router.get('/depoimentos/agrupados', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `${SELECT_DEP_COMPLETO}
       WHERE d.ativo = TRUE AND d.status_moderacao = 'aprovado'
         AND d.oculto_por_conta_inativa = FALSE
         AND d.tema_id IS NOT NULL
       ORDER BY t.ordem ASC, d.ordem ASC, d.id ASC`
    );
    const grupos = {};
    for (const dep of r.rows) {
      const slug = dep.tema_slug;
      if (!grupos[slug]) {
        grupos[slug] = {
          tema_slug: dep.tema_slug,
          tema_nome: dep.tema_nome,
          produto_slug: dep.produto_slug,
          relatos: [],
        };
      }
      grupos[slug].relatos.push(dep);
    }
    res.json(Object.values(grupos));
  } catch (err) {
    console.error('❌ Erro ao agrupar depoimentos:', err.message);
    res.status(500).json({ error: 'Erro ao carregar relatos' });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN — temas
// ─────────────────────────────────────────────────────────────

router.get('/admin/temas', autenticarPainel('admin'), async (req, res) => {
  try {
    const r = await poolComunicacao.query(`
      SELECT t.id, t.slug, t.nome, t.produto_slug, t.ordem, t.ativo,
             t.criado_em, t.atualizado_em,
             (SELECT COUNT(*) FROM depoimentos d WHERE d.tema_id = t.id AND d.ativo = TRUE) AS qtd_relatos
        FROM temas t
       ORDER BY t.ordem ASC, t.id ASC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/temas', autenticarPainel('admin'), async (req, res) => {
  try {
    const slug = (req.body.slug || '').toString().trim().toLowerCase();
    const nome = (req.body.nome || '').toString().trim();
    if (!slug || !nome) return res.status(400).json({ error: 'slug e nome são obrigatórios' });
    const produto_slug = (req.body.produto_slug || '').toString().trim() || null;
    const ordem = parseInt(req.body.ordem, 10) || 0;
    const ativo = typeof req.body.ativo === 'boolean' ? req.body.ativo : true;

    const r = await poolComunicacao.query(
      `INSERT INTO temas (slug, nome, produto_slug, ordem, ativo)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [slug, nome, produto_slug, ordem, ativo]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug já existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/temas/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (req.body.slug !== undefined) add('slug', String(req.body.slug).trim().toLowerCase());
    if (req.body.nome !== undefined) add('nome', String(req.body.nome).trim());
    if (req.body.produto_slug !== undefined) add('produto_slug', (String(req.body.produto_slug).trim() || null));
    if (req.body.ordem !== undefined) add('ordem', parseInt(req.body.ordem, 10) || 0);
    if (req.body.ativo !== undefined) add('ativo', !!req.body.ativo);
    if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' });

    sets.push(`atualizado_em = NOW()`);
    params.push(id);
    const r = await poolComunicacao.query(
      `UPDATE temas SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Tema não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug já existe' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/temas/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Proteção: não permitir deletar tema que ainda tem relatos vinculados.
    const r = await poolComunicacao.query(
      `SELECT COUNT(*) AS qtd FROM depoimentos WHERE tema_id = $1`,
      [id]
    );
    if (parseInt(r.rows[0].qtd, 10) > 0) {
      return res.status(400).json({
        error: `Tema tem ${r.rows[0].qtd} relato(s) vinculado(s). Mova ou apague os relatos antes de excluir o tema.`,
      });
    }
    await poolComunicacao.query(`DELETE FROM temas WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN — depoimentos (relatos)
// ─────────────────────────────────────────────────────────────

router.get('/admin/depoimentos', autenticarPainel('admin'), async (req, res) => {
  try {
    const { tema, placeholder, status, ticker } = req.query;
    const where = [];
    const params = [];

    if (tema) {
      const tid = await temaIdPorSlug(tema);
      if (tid) { params.push(tid); where.push(`d.tema_id = $${params.length}`); }
      else where.push(`FALSE`);
    }
    if (placeholder === 'true' || placeholder === '1') where.push(`d.gerado_por_ia = TRUE`);
    if (placeholder === 'false' || placeholder === '0') where.push(`d.gerado_por_ia = FALSE`);
    if (status && ['pendente','aprovado','rejeitado'].includes(status)) {
      params.push(status);
      where.push(`d.status_moderacao = $${params.length}`);
    }
    if (ticker === 'true' || ticker === '1') where.push(`d.mostrar_no_ticker = TRUE`);
    if (ticker === 'false' || ticker === '0') where.push(`d.mostrar_no_ticker = FALSE`);

    const sql = `${SELECT_DEP_COMPLETO}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.ordem ASC, d.id ASC`;

    const r = await poolComunicacao.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/depoimentos — cria 1 relato (NÃO substitui mais a lista).
// Se receber um array (formato legado), retorna 503 com instrução pra atualizar painel.
router.post('/admin/depoimentos', autenticarPainel('admin'), async (req, res) => {
  if (Array.isArray(req.body)) {
    return res.status(503).json({
      error: 'Painel admin desatualizado. Atualize admin.html (Fase 1 de Relatos) antes de editar depoimentos. Subir todos os 4 arquivos novos no GitHub na mesma leva.',
    });
  }
  try {
    const p = normalizarPayloadDep(req.body);
    if (!p.nome || !p.texto) return res.status(400).json({ error: 'nome e texto são obrigatórios' });

    const r = await poolComunicacao.query(
      `INSERT INTO depoimentos
         (nome, profissao, idade, cidade, texto, tema_id, produto_slug, usuario_id,
          mostrar_no_ticker, gerado_por_ia, status_moderacao,
          autora_era_assinante_clube, tags, ordem, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [p.nome, p.profissao, p.idade, p.cidade, p.texto, p.tema_id, p.produto_slug, p.usuario_id,
       p.mostrar_no_ticker, p.gerado_por_ia, p.status_moderacao,
       p.autora_era_assinante_clube, p.tags, p.ordem, p.ativo]
    );
    const r2 = await poolComunicacao.query(`${SELECT_DEP_COMPLETO} WHERE d.id = $1`, [r.rows[0].id]);
    res.json(r2.rows[0]);
  } catch (err) {
    console.error('❌ Erro ao criar depoimento:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/depoimentos/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    const b = req.body || {};

    if (b.nome !== undefined) add('nome', String(b.nome).trim());
    if (b.profissao !== undefined) add('profissao', b.profissao ? String(b.profissao).trim() : null);
    if (b.idade !== undefined) {
      const n = parseInt(b.idade, 10);
      add('idade', (Number.isFinite(n) && n > 0 && n < 150) ? n : null);
    }
    if (b.cidade !== undefined) add('cidade', b.cidade ? String(b.cidade).trim() : null);
    if (b.texto !== undefined) add('texto', String(b.texto).trim());
    if (b.tema_id !== undefined) add('tema_id', b.tema_id ? parseInt(b.tema_id, 10) : null);
    // produto_slug do relato — vazio/null = herda do tema (COALESCE no SELECT).
    if (b.produto_slug !== undefined) {
      const ps = (b.produto_slug == null) ? null : String(b.produto_slug).trim();
      add('produto_slug', ps ? ps : null);
    }
    if (b.usuario_id !== undefined) add('usuario_id', b.usuario_id || null);
    if (b.mostrar_no_ticker !== undefined) add('mostrar_no_ticker', !!b.mostrar_no_ticker);
    if (b.gerado_por_ia !== undefined) add('gerado_por_ia', !!b.gerado_por_ia);
    if (b.status_moderacao !== undefined
        && ['pendente','aprovado','rejeitado'].includes(b.status_moderacao)) {
      add('status_moderacao', b.status_moderacao);
    }
    if (b.autora_era_assinante_clube !== undefined) {
      add('autora_era_assinante_clube', !!b.autora_era_assinante_clube);
    }
    if (b.motivo_rejeicao !== undefined) {
      add('motivo_rejeicao', b.motivo_rejeicao ? String(b.motivo_rejeicao).trim() : null);
    }
    if (b.tags !== undefined && Array.isArray(b.tags)) {
      add('tags', b.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean));
    }
    if (b.ordem !== undefined) add('ordem', parseInt(b.ordem, 10) || 0);
    if (b.ativo !== undefined) add('ativo', !!b.ativo);

    // categorias_ids é um array — não é coluna direta; gerencia o pivot depois do UPDATE.
    const mexerCategorias = Array.isArray(b.categorias_ids);

    if (!sets.length && !mexerCategorias) return res.status(400).json({ error: 'Nada pra atualizar' });

    if (sets.length) {
      sets.push(`atualizado_em = NOW()`);
      params.push(id);
      await poolComunicacao.query(
        `UPDATE depoimentos SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    if (mexerCategorias) {
      await sincronizarCategorias(id, b.categorias_ids);
    }

    const r = await poolComunicacao.query(`${SELECT_DEP_COMPLETO} WHERE d.id = $1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Depoimento não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('❌ Erro ao atualizar depoimento:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/depoimentos/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await poolComunicacao.query(`DELETE FROM depoimentos WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// SEEDS IDEMPOTENTES — rodam no boot via server.js
// ─────────────────────────────────────────────────────────────

const TEMAS_INICIAIS = [
  { slug: 'ts',     nome: 'default tema TS',     produto_slug: 'teste_subconsciente',    ordem: 1  },
  { slug: 'orm',    nome: 'default tema ORM',    produto_slug: 'ouro_reprogramacao',     ordem: 2  },
  { slug: 'lda',    nome: 'default tema LDA',    produto_slug: 'lda_biblica',            ordem: 3  },
  { slug: 'gprm',   nome: 'default tema GPRM',   produto_slug: 'guia_pratico',           ordem: 4  },
  { slug: 'tm',     nome: 'default tema TM',     produto_slug: 'atal_maneira_combo',     ordem: 5  },
  { slug: 'mf',     nome: 'default tema MF',     produto_slug: 'magica_fluir',           ordem: 6  },
  { slug: 'vm',     nome: 'default tema VM',     produto_slug: 'clube_vida_magica',      ordem: 7  },
  { slug: 'cdm',    nome: 'default tema CDM',    produto_slug: 'vencendo_medo',          ordem: 8  },
  { slug: 'cdv',    nome: 'default tema CDV',    produto_slug: 'vencendo_validacao',     ordem: 9  },
  { slug: 'cdd',    nome: 'default tema CDD',    produto_slug: 'vencendo_desordem',      ordem: 10 },
  { slug: 'cds',    nome: 'default tema CDS',    produto_slug: 'vencendo_sobrevivencia', ordem: 11 },
  { slug: 'sessao', nome: 'default tema Sessao', produto_slug: null,                     ordem: 12 },
  { slug: 'geral',  nome: 'default tema Geral',  produto_slug: null,                     ordem: 13 },
];

async function seedTemas() {
  try {
    for (const t of TEMAS_INICIAIS) {
      await poolComunicacao.query(
        `INSERT INTO temas (slug, nome, produto_slug, ordem)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO NOTHING`,
        [t.slug, t.nome, t.produto_slug, t.ordem]
      );
    }
    console.log(`✅ Seed de temas verificado (${TEMAS_INICIAIS.length} temas).`);
  } catch (err) {
    console.error('⚠️ Seed de temas falhou:', err.message);
  }
}

// 30 relatos migrados dos hardcoded das LPs + 14 placeholders gerados por IA.
// Total: 44. Cada um com tema (slug), profissão/idade quando dá pra extrair.
// Os placeholders (gerado_por_ia=true) podem ser revisados pelo admin via filtro.
const DEPOIMENTOS_INICIAIS = [
  // ─── ORM (Ouro da Reprogramação Mental) ───
  { tema: 'orm', nome: 'Maria S.', idade: 41, texto: 'Não achei que daria certo comigo. Eu já tinha feito de tudo. Mas algo nesse curso me alcançou. Hoje, meu jeito de pensar mudou. E com ele, meu casamento, minha autoestima e até minha fé.', gerado_por_ia: false },
  { tema: 'orm', nome: 'Vanessa T.', idade: 29, texto: 'A Suellen fala como se estivesse dentro da gente. Eu nunca fui de acreditar em curso nenhum. Mas esse não é um curso. É um processo de cura. Deus me visitou aqui.', gerado_por_ia: false },
  { tema: 'orm', nome: 'Camila R.', idade: 37, texto: 'Eu achei que esse curso ia ser só mais um... Teve uma aula que me fez chorar do começo ao fim, porque parecia que ela tava contando a minha história. Hoje, eu consigo olhar pra mim com mais amor e clareza. E o mais lindo: comecei a sonhar de novo.', gerado_por_ia: false },
  { tema: 'orm', nome: 'Patrícia', texto: 'O curso Ouro da RM me deu ferramentas que uso até hoje.', gerado_por_ia: false },

  // ─── LDA (Lei da Atração Bíblica) ───
  { tema: 'lda', nome: 'Ana Paula M.', profissao: 'Marketing Digital', idade: 34, texto: 'Surreal as travas que descobri e estou limpando todas. Seu curso me abriu para um caminho novo profissionalmente e pessoalmente.', gerado_por_ia: false },
  { tema: 'lda', nome: 'Mariana S.', profissao: 'Pastora e Terapeuta', idade: 41, texto: 'Su, eu descobri a LDA há 2 anos, mas tinha receio por ser cristã, até conhecer você. Recomendo pra todas as mulheres de fé. Gratidão!', gerado_por_ia: false },
  { tema: 'lda', nome: 'Carolina L.', profissao: 'Advogada', idade: 29, texto: 'Já fiz cursos de PNL e neurociência, mas o Lei da Atração Bíblica é diferente... incomparável, supera tudo.', gerado_por_ia: false },

  // ─── GPRM (Guia Prático de Reprogramação Mental) ───
  { tema: 'gprm', nome: 'Juliana A.', texto: 'Senti diferença no primeiro dia. Era exatamente esse "como" que eu não conseguia achar.', gerado_por_ia: false },
  { tema: 'gprm', nome: 'Gabriella S.', texto: 'Já tinha feito o Ouro, mas esse guia me deu a prática diária que faltava. Minha mente está mais leve.', gerado_por_ia: false },
  { tema: 'gprm', nome: 'Ana N.', texto: 'É simples, direto e realmente funciona. Finalmente entendi como aplicar reprogramação mental na vida real.', gerado_por_ia: false },

  // ─── TM (A Tal Maneira) ───
  { tema: 'tm', nome: 'Juliana M.', profissao: 'Afiliada digital', idade: 33, texto: 'Eu estava perdida, mal conseguia pagar minhas contas básicas e estava cheia de dívidas. Seu livro Tal Maneira transformou minha vida. O livro eu imprimi e encadernei, amei a aula, mas o audiobook eu ouvia todo dia, e foi o que mudou meu subconsciente. Hoje, não só paguei as dívidas, como encontrei paz ganhando mais que nunca!', gerado_por_ia: false },
  { tema: 'tm', nome: 'Bia', profissao: 'Manicure', idade: 29, texto: 'Su, depois de tentar tanto na vida eu realmente estava me conformando em ganhar 2 mil por mês. Foram muitas decepções. Você não tem ideia da minha gratidão pelo seu método. Eu tô ganhando por volta de 3 mil só com vendas na internet, e agora tô até considerando deixar meu emprego. Era tudo que eu precisava pra voltar a confiar em mim — como é bom poder comprar uma roupa sem se preocupar se vai faltar. Gratidão!', gerado_por_ia: false },
  { tema: 'tm', nome: 'Fernanda R.', profissao: 'Corretora', idade: 35, texto: 'Suuuuu, seu método mudou minha vida completamente! Em apenas 3 meses praticando A Tal Maneira consegui fechar contratos que triplicaram minha renda. Finalmente percebi que ganhar o dinheiro que a gente quer não é o bicho de sete cabeças que eu pensava!', gerado_por_ia: false },

  // ─── MF (Mágica do Fluir) ───
  { tema: 'mf', nome: 'Patrícia A.', profissao: 'Empresária', idade: 38, texto: 'Eu tava forçando tudo — orando, reprogramando, mas com ansiedade. O guia me ensinou a soltar. Em 2 semanas as coisas começaram a acontecer sozinhas. Surreal.', gerado_por_ia: false },
  { tema: 'mf', nome: 'Renata C.', profissao: 'Terapeuta', idade: 42, texto: 'A tabela Fluir × Forçar é tipo um espelho. Toda vez que saio do eixo, eu olho e volto. Mudou meu dia a dia completamente.', gerado_por_ia: false },
  { tema: 'mf', nome: 'Camila F.', profissao: 'Designer', idade: 31, texto: 'Eu achava que precisava me esforçar mais. Esse guia me mostrou que precisava me esforçar MENOS. Hoje vivo no que ela chama de "frequência da paz".', gerado_por_ia: false },

  // ─── TS (Teste do Subconsciente) ───
  { tema: 'ts', nome: 'Camila S.', texto: 'Fiquei sem palavras. Ler o resultado do teste me desarmou por dentro. Me senti vista e não julgada.', gerado_por_ia: false },
  { tema: 'ts', nome: 'Fernanda M.', texto: 'Foi certeiro! Meu marido fez também — ele ficou de cara com o quanto o resultado bateu com a realidade dele.', gerado_por_ia: false },
  { tema: 'ts', nome: 'Juliana R.', texto: 'Deu nível 1 de prosperidade. Tudo a ver com o que estou passando. Li várias vezes pra acreditar.', gerado_por_ia: false },
  { tema: 'ts', nome: 'Patrícia L.', texto: 'Fiz o teste, foi incrível. Emocionei, chorei, mas era exatamente tudo o que eu precisava ouvir.', gerado_por_ia: false },
  { tema: 'ts', nome: 'Renata C.', texto: 'Que benção é esse teste?! Realmente me identifiquei muito com o resultado. Até chorei refletindo.', gerado_por_ia: false },
  { tema: 'ts', nome: 'Beatriz A.', texto: 'Tomei coragem e fiz. Falou tanto comigo que hoje comprei o curso que ele me recomendou.', gerado_por_ia: false },
  { tema: 'ts', nome: 'Marina P.', texto: 'Acabei de fazer e foi certeiro. 40% de energia de desordem — fez todo sentido.', gerado_por_ia: false },

  // ─── GERAL (home/index) ───
  { tema: 'geral', nome: 'Ana Paula', texto: 'Mudou completamente a forma como eu via minha vida.', gerado_por_ia: false },
  { tema: 'geral', nome: 'Marcos', texto: 'Nunca imaginei que fé e ciência poderiam andar juntas assim.', gerado_por_ia: false },
  { tema: 'geral', nome: 'Carla', texto: 'O Teste me abriu os olhos para padrões que eu nem percebia.', gerado_por_ia: false },
  { tema: 'geral', nome: 'Roberto', texto: 'Em 3 meses minha realidade financeira mudou radicalmente.', gerado_por_ia: false },
  { tema: 'geral', nome: 'Fernanda', texto: 'Suellen fala de um jeito que ninguém mais fala. É real, é profundo.', gerado_por_ia: false },
  { tema: 'geral', nome: 'André', texto: 'Finalmente entendi por que eu sabotava meu próprio sucesso.', gerado_por_ia: false },

  // ─── SESSÃO (Sessão de Diagnóstico — futuro) ───
  { tema: 'sessao', nome: 'Juliana', texto: 'A Sessão de Diagnóstico foi um divisor de águas na minha vida.', gerado_por_ia: false },
  // Placeholders (gerados por IA — Renato revisa/edita no admin):
  { tema: 'sessao', nome: 'Larissa B.', profissao: 'Professora', idade: 36, texto: 'Em uma única conversa eu enxerguei coisas que vinha carregando há anos. Saí da Sessão sabendo exatamente por onde começar.', gerado_por_ia: true },
  { tema: 'sessao', nome: 'Adriana C.', profissao: 'Coach', idade: 44, texto: 'A escuta da Suellen é diferente. Não é palpite — é diagnóstico mesmo. Voltei pra vida com clareza.', gerado_por_ia: true },

  // ─── VM (Clube Vida Mágica) — placeholders ───
  { tema: 'vm', nome: 'Tatiane R.', profissao: 'Autônoma', idade: 34, texto: 'Entrei no Clube por curiosidade e fiquei pela transformação. Toda semana tem algo que me faz repensar e crescer.', gerado_por_ia: true },
  { tema: 'vm', nome: 'Priscila F.', profissao: 'Empresária', idade: 39, texto: 'O Clube é meu cantinho de paz. Os encontros me ancoram. Cada lição é uma resposta que eu nem sabia que precisava.', gerado_por_ia: true },
  { tema: 'vm', nome: 'Helena M.', profissao: 'Mãe e dona de casa', idade: 47, texto: 'Achei que era tarde demais pra recomeçar. O Clube me devolveu a fé em mim. Hoje vivo no propósito que eu tinha perdido.', gerado_por_ia: true },

  // ─── CDM (Conhecer e Despertar — Medo) — placeholders ───
  { tema: 'cdm', nome: 'Luana P.', profissao: 'Enfermeira', idade: 32, texto: 'Eu vivia travada por medo de ousar. Esse ebook me mostrou de onde vinha — e como sair. Hoje tomei decisões que eu adiava há anos.', gerado_por_ia: true },
  { tema: 'cdm', nome: 'Bianca T.', profissao: 'Estudante', idade: 24, texto: 'Cada página parecia falar comigo. Reconheci medos que eu nem sabia que tinha. Foi um divisor pra mim.', gerado_por_ia: true },
  { tema: 'cdm', nome: 'Cristina O.', profissao: 'Vendedora', idade: 41, texto: 'O medo me paralisava no trabalho. Comecei a aplicar as práticas do livro e em pouco tempo já estava arriscando — e ganhando.', gerado_por_ia: true },

  // ─── CDV (Conhecer e Despertar — Validação) — placeholders ───
  { tema: 'cdv', nome: 'Renata L.', profissao: 'Designer', idade: 35, texto: 'Eu vivia dependendo da aprovação dos outros pra me sentir bem. Esse livro me devolveu pra mim. Finalmente sei o que eu quero.', gerado_por_ia: true },
  { tema: 'cdv', nome: 'Carla S.', profissao: 'Pedagoga', idade: 38, texto: 'Descobri que minha busca por validação vinha de muito antes. Hoje minhas escolhas são minhas — e isso muda tudo.', gerado_por_ia: true },
  { tema: 'cdv', nome: 'Mônica V.', profissao: 'Psicóloga', idade: 43, texto: 'Como terapeuta eu já entendia o conceito. Mas vivenciar foi outra coisa. Recomendo pra qualquer mulher que se anula nas relações.', gerado_por_ia: true },

  // ─── CDD (Conhecer e Despertar — Desordem) — placeholders ───
  { tema: 'cdd', nome: 'Aline G.', profissao: 'Produtora', idade: 30, texto: 'Minha vida era um caos por dentro e por fora. Esse livro me ensinou a ordenar primeiro a mente — o resto veio depois, sozinho.', gerado_por_ia: true },
  { tema: 'cdd', nome: 'Patrícia N.', profissao: 'Administradora', idade: 37, texto: 'Eu achava que era preguiça. Era desordem energética. Em duas semanas aplicando o método, minha casa, minha agenda e minha cabeça mudaram.', gerado_por_ia: true },
  { tema: 'cdd', nome: 'Daniela R.', profissao: 'Empreendedora', idade: 33, texto: 'Foi como ligar uma luz em cômodos que eu evitava abrir. Hoje vivo com bem menos peso.', gerado_por_ia: true },

  // ─── CDS (Conhecer e Despertar — Sobrevivência) — placeholders ───
  { tema: 'cds', nome: 'Joice M.', profissao: 'Auxiliar administrativa', idade: 36, texto: 'Eu vivia no modo "só pagar as contas e respirar". Esse livro me mostrou que existe vida além da sobrevivência — e como ir até lá.', gerado_por_ia: true },
  { tema: 'cds', nome: 'Sandra B.', profissao: 'Costureira', idade: 49, texto: 'Achei que era a minha sina. Hoje sei que não. As práticas me tiraram do automático e me devolveram esperança.', gerado_por_ia: true },
  { tema: 'cds', nome: 'Eliane T.', profissao: 'Cuidadora', idade: 45, texto: 'Eu trabalhava demais e vivia de menos. Esse livro me chacoalhou. Comecei a fazer pequenas mudanças e a vida abriu.', gerado_por_ia: true },
];

async function seedDepoimentos() {
  try {
    const SEED_KEY = 'depoimentos_v1_fase1';
    const r = await poolComunicacao.query(
      `SELECT 1 FROM seed_log WHERE seed_key = $1`, [SEED_KEY]
    );
    if (r.rows.length > 0) {
      // Já rodou — não re-roda. Pra forçar, apaga a linha em seed_log.
      return;
    }

    // Carrega mapa slug → id dos temas (foram seedados antes).
    const t = await poolComunicacao.query(`SELECT id, slug FROM temas`);
    const mapa = {};
    for (const row of t.rows) mapa[row.slug] = row.id;

    let inseridos = 0;
    for (let i = 0; i < DEPOIMENTOS_INICIAIS.length; i++) {
      const d = DEPOIMENTOS_INICIAIS[i];
      const tema_id = mapa[d.tema] || null;
      await poolComunicacao.query(
        `INSERT INTO depoimentos
           (nome, profissao, idade, texto, tema_id, mostrar_no_ticker,
            gerado_por_ia, status_moderacao, ordem, ativo, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          d.nome,
          d.profissao || null,
          d.idade || null,
          d.texto,
          tema_id,
          true,                             // mostrar_no_ticker (ligado por padrão; Renato edita)
          !!d.gerado_por_ia,
          'aprovado',
          i,
          true,
          [d.tema],                         // tags legacy — espelha o slug do tema
        ]
      );
      inseridos++;
    }

    await poolComunicacao.query(
      `INSERT INTO seed_log (seed_key) VALUES ($1) ON CONFLICT DO NOTHING`,
      [SEED_KEY]
    );
    console.log(`✅ Seed inicial de relatos: ${inseridos} depoimentos inseridos.`);
  } catch (err) {
    console.error('⚠️ Seed de depoimentos falhou:', err.message);
  }
}

module.exports = router;
module.exports.seedTemas = seedTemas;
module.exports.seedDepoimentos = seedDepoimentos;
