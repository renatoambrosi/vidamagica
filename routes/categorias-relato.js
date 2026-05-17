/* === VIDA MÁGICA — routes/categorias-relato.js ===
   Banco: poolComunicacao.

   FASE 2.1a do refactor de Relatos.

   "Categoria de vida" = área onde a aluna manifestou (filhos, renda, carreira...).
   Diferente de `tema_id` em `depoimentos` (que aponta pro produto que ela leu).

   Renato cura o catálogo. Aluna NÃO escolhe — quem marca é admin/atendimento
   na hora de aprovar o relato (Fase 2.1).

   ── ENDPOINTS ──
   PÚBLICOS:
     - GET  /api/categorias-relato         → ativas (ordenadas)

   ADMIN (escopo=admin OU atendimento):
     - GET    /api/admin/categorias-relato → todas (com inativas e contagem de uso)
     - POST   /api/admin/categorias-relato → cria
     - PUT    /api/admin/categorias-relato/:id
     - DELETE /api/admin/categorias-relato/:id (proteção: não apaga se há vínculo;
                                                 recomenda desativar)
   === */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');
const { autenticarPainel, autenticarPainelHibrido } = require('../middleware/autenticar');

// ───────── PÚBLICO ─────────
router.get('/categorias-relato', async (req, res) => {
  try {
    const r = await poolComunicacao.query(
      `SELECT id, slug, nome, ordem FROM categorias_relato
        WHERE ativo = TRUE
        ORDER BY ordem ASC, id ASC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('❌ Erro ao listar categorias-relato:', err.message);
    res.status(500).json({ error: 'Erro ao carregar categorias' });
  }
});

// ───────── ADMIN ─────────
router.get('/admin/categorias-relato', autenticarPainelHibrido, async (req, res) => {
  try {
    const r = await poolComunicacao.query(`
      SELECT c.id, c.slug, c.nome, c.ordem, c.ativo, c.criado_em, c.atualizado_em,
             (SELECT COUNT(*) FROM depoimento_categorias dc WHERE dc.categoria_id = c.id) AS qtd_uso
        FROM categorias_relato c
       ORDER BY c.ordem ASC, c.id ASC
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/categorias-relato', autenticarPainel('admin'), async (req, res) => {
  try {
    const nome = (req.body.nome || '').toString().trim();
    const slug = (req.body.slug || '').toString().trim().toLowerCase()
      || nome.toLowerCase()
          .normalize('NFD').replace(/\p{M}/gu, '')
          .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
          .slice(0, 40);
    if (!nome || !slug) return res.status(400).json({ error: 'nome obrigatório' });
    const ordem = parseInt(req.body.ordem, 10) || 0;
    const ativo = typeof req.body.ativo === 'boolean' ? req.body.ativo : true;

    const r = await poolComunicacao.query(
      `INSERT INTO categorias_relato (slug, nome, ordem, ativo)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [slug, nome, ordem, ativo]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug já existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/admin/categorias-relato/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sets = []; const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (req.body.nome !== undefined) add('nome', String(req.body.nome).trim());
    if (req.body.slug !== undefined) add('slug', String(req.body.slug).trim().toLowerCase());
    if (req.body.ordem !== undefined) add('ordem', parseInt(req.body.ordem, 10) || 0);
    if (req.body.ativo !== undefined) add('ativo', !!req.body.ativo);
    if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' });

    sets.push(`atualizado_em = NOW()`);
    params.push(id);
    const r = await poolComunicacao.query(
      `UPDATE categorias_relato SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Categoria não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Slug já existe' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/categorias-relato/:id', autenticarPainel('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const u = await poolComunicacao.query(
      `SELECT COUNT(*) AS qtd FROM depoimento_categorias WHERE categoria_id = $1`,
      [id]
    );
    if (parseInt(u.rows[0].qtd, 10) > 0) {
      return res.status(400).json({
        error: `Categoria está vinculada a ${u.rows[0].qtd} relato(s). Desative em vez de apagar (pra preservar o histórico).`,
      });
    }
    await poolComunicacao.query(`DELETE FROM categorias_relato WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ───────── SEED IDEMPOTENTE ─────────
// Lista canônica sugerida em 2026-05-17 (validada por Renato).
// Renato pode renomear/desativar/adicionar pelo CRUD do admin.
const CATEGORIAS_INICIAIS = [
  { slug: 'prosperidade_financeira', nome: 'Prosperidade financeira', ordem: 1  },
  { slug: 'maternidade_filhos',      nome: 'Maternidade e filhos',    ordem: 2  },
  { slug: 'relacionamento_amoroso',  nome: 'Relacionamento amoroso',  ordem: 3  },
  { slug: 'familia',                 nome: 'Família',                 ordem: 4  },
  { slug: 'saude_corpo',             nome: 'Saúde e corpo',           ordem: 5  },
  { slug: 'carreira_proposito',      nome: 'Carreira e propósito',    ordem: 6  },
  { slug: 'cura_emocional',          nome: 'Cura emocional',          ordem: 7  },
  { slug: 'fe_espiritualidade',      nome: 'Fé e espiritualidade',    ordem: 8  },
  { slug: 'casa_lar',                nome: 'Casa e lar',              ordem: 9  },
  { slug: 'estudos_dons',            nome: 'Estudos e dons',          ordem: 10 },
];

async function seedCategoriasRelato() {
  try {
    for (const c of CATEGORIAS_INICIAIS) {
      await poolComunicacao.query(
        `INSERT INTO categorias_relato (slug, nome, ordem)
         VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
        [c.slug, c.nome, c.ordem]
      );
    }
    console.log(`✅ Seed de categorias-relato verificado (${CATEGORIAS_INICIAIS.length}).`);
  } catch (err) {
    console.error('⚠️ Seed de categorias-relato falhou:', err.message);
  }
}

module.exports = router;
module.exports.seedCategoriasRelato = seedCategoriasRelato;
