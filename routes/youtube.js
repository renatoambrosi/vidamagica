/* ============================================================
   VIDA MÁGICA — routes/youtube.js
   Vídeo mais recente do canal da Suellen para a home.
   Sem banco: lê o feed público do canal e guarda 30 min em memória.

   O YouTube não toca mais a playlist de envios (videoseries?list=UU…)
   embutida no site; vídeo avulso toca. Por isso a home pede o id aqui.

   Endpoint:
   - GET /api/youtube/ultimo → { id, titulo } (Shorts ficam de fora)
   ============================================================ */

const express = require('express');
const router = express.Router();

const CANAL_ID = 'UCmFlggcUIWIHSAaS2piLYmw';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CANAL_ID}`;
const CACHE_MS = 30 * 60 * 1000;

let cache = null; // { id, titulo, em }

function desfazerEntidades(t) {
  return t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function buscarUltimo() {
  const r = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`feed respondeu ${r.status}`);
  const xml = await r.text();
  const entradas = xml.split('<entry>').slice(1);
  for (const e of entradas) {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '';
    const titulo = (e.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    if (id && !link.includes('/shorts/')) return { id, titulo: desfazerEntidades(titulo) };
  }
  throw new Error('nenhum vídeo no feed');
}

router.get('/youtube/ultimo', async (req, res) => {
  try {
    if (!cache || Date.now() - cache.em > CACHE_MS) {
      cache = { ...(await buscarUltimo()), em: Date.now() };
    }
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ id: cache.id, titulo: cache.titulo });
  } catch (err) {
    console.error('⚠️ Último vídeo do YouTube indisponível:', err.message);
    if (cache) return res.json({ id: cache.id, titulo: cache.titulo });
    res.status(503).json({ error: 'Vídeo indisponível' });
  }
});

module.exports = router;
