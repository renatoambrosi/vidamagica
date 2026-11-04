/* ============================================================
   VIDA MÁGICA — routes/youtube.js
   Vídeo mais recente do canal da Suellen para a home.
   Lê a aba Vídeos do canal (só vídeos longos) e, se falhar, o feed
   público. Guarda 30 min em memória e grava o último vídeo bom em
   `config` (poolComunicacao, chave 'youtube_ultimo_video'), para não
   perder o vídeo quando o servidor reinicia. Se tudo cair, usa o
   último vídeo conhecido do código, e a home nunca fica sem vídeo.

   O YouTube não toca mais a playlist de envios (videoseries?list=UU…)
   embutida no site; vídeo avulso toca. Por isso a home pede o id aqui.

   Endpoint:
   - GET /api/youtube/ultimo → { id, titulo } (Shorts ficam de fora)
   ============================================================ */

const express = require('express');
const router = express.Router();
const { poolComunicacao } = require('../db');

const CANAL_ID = 'UCmFlggcUIWIHSAaS2piLYmw';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CANAL_ID}`;
const VIDEOS_URL = 'https://www.youtube.com/@SuellenSeragi/videos';
const NAVEGADOR = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};
const CACHE_MS = 30 * 60 * 1000;
const CHAVE_CONFIG = 'youtube_ultimo_video';
// Último recurso, se o YouTube e o banco falharem ao mesmo tempo.
const ULTIMO_CONHECIDO = { id: 'JqOdI8XZUgU', titulo: 'Como treinar sua mente pra ACREDITAR que tudo vai dar certo' };

let cache = null; // { id, titulo, em }
let ultimoGravado = null; // id já salvo no banco

function desfazerEntidades(t) {
  return t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// Aba Vídeos do canal: o primeiro item da grade é o envio mais recente (Shorts ficam em outra aba).
async function buscarPelaAbaVideos() {
  const r = await fetch(VIDEOS_URL, { headers: NAVEGADOR });
  if (!r.ok) throw new Error(`aba Vídeos respondeu ${r.status}`);
  const html = await r.text();
  const grade = html.indexOf('"richGridRenderer"');
  if (grade < 0) throw new Error('aba Vídeos sem grade');
  const trecho = html.slice(grade, grade + 20000);
  const id = (trecho.match(/"videoId":"([\w-]{11})"/) || trecho.match(/\/vi\/([\w-]{11})\//) || [])[1];
  if (!id) throw new Error('aba Vídeos sem vídeo');
  const titulo = (trecho.match(/"title":\{"content":"([^"]+)"/) || [])[1] || '';
  return { id, titulo: titulo.replace(/\\u0026/g, '&') };
}

async function buscarPeloFeed() {
  const r = await fetch(FEED_URL, { headers: NAVEGADOR });
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

async function buscarUltimo() {
  try {
    return await buscarPelaAbaVideos();
  } catch (err) {
    console.error('⚠️ Aba Vídeos do YouTube falhou, tentando o feed:', err.message);
    return buscarPeloFeed();
  }
}

async function gravarNoBanco(video) {
  try {
    await poolComunicacao.query(
      `INSERT INTO config (chave, dados, atualizado_em) VALUES ($1, $2, NOW())
       ON CONFLICT (chave) DO UPDATE SET dados = $2, atualizado_em = NOW()`,
      [CHAVE_CONFIG, JSON.stringify({ id: video.id, titulo: video.titulo })]
    );
  } catch (err) {
    console.error('⚠️ Não gravei o último vídeo no banco:', err.message);
  }
}

async function lerDoBanco() {
  try {
    const r = await poolComunicacao.query(`SELECT dados FROM config WHERE chave = $1`, [CHAVE_CONFIG]);
    const d = r.rows[0] && r.rows[0].dados;
    return d && d.id ? { id: d.id, titulo: d.titulo || '' } : null;
  } catch {
    return null;
  }
}

router.get('/youtube/ultimo', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  if (cache && Date.now() - cache.em <= CACHE_MS) {
    return res.json({ id: cache.id, titulo: cache.titulo });
  }
  try {
    const video = await buscarUltimo();
    cache = { ...video, em: Date.now() };
    if (ultimoGravado !== video.id) { ultimoGravado = video.id; gravarNoBanco(video); }
    return res.json({ id: video.id, titulo: video.titulo });
  } catch (err) {
    console.error('⚠️ YouTube indisponível, usando o último vídeo guardado:', err.message);
  }
  // YouTube fora: vídeo da memória, depois do banco, depois o último conhecido.
  const reserva = cache || (await lerDoBanco()) || ULTIMO_CONHECIDO;
  cache = { id: reserva.id, titulo: reserva.titulo, em: Date.now() };
  res.json({ id: reserva.id, titulo: reserva.titulo });
});

module.exports = router;
