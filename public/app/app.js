================================================================
ARQUIVO: public/app/app.js
================================================================
LOCALIZAR a função `renderFeedHome` (começa em `function renderFeedHome(item) {`
e vai até o `}` que fecha a função) e SUBSTITUIR INTEIRA pela versão
NOVA abaixo.
================================================================


─── FUNÇÃO NOVA (colar no lugar da antiga) ────────────────────

function renderFeedHome(item) {
  if (!item) return;
  const destaqueEl = document.getElementById('feed-home-destaque');
  const thumbEl    = document.getElementById('feed-home-thumb');
  const playEl     = document.getElementById('feed-home-play');
  const infoEl     = document.getElementById('feed-home-info');
  const cadeadoEl  = document.getElementById('feed-home-cadeado');
  const verMaisEl  = document.getElementById('feed-home-ver-mais');

  const thumb = item.imagem_url || thumbDeUrl(item.url);
  if (thumbEl) thumbEl.src = thumb || '';
  if (destaqueEl) destaqueEl.style.display = '';

  // Sem Clube → cadeado no centro (play escondido).
  // Com Clube → play no centro (cadeado escondido).
  const temClube = !!(window.__vm_tem_clube);
  if (cadeadoEl) cadeadoEl.style.display = temClube ? 'none' : '';
  if (playEl)    playEl.style.display    = temClube ? '' : 'none';

  const acaoConteudo = () => {
    if (temClube) {
      try { abrirPlayer({ titulo: item.titulo, subtitulo: item.subtitulo, corpo: item.corpo, url: item.url }); }
      catch { window.open(item.url, '_blank', 'noopener'); }
    } else {
      try { window.app && window.app.abrirModalClube && window.app.abrirModalClube(); } catch {}
    }
  };

  if (playEl)    playEl.onclick = acaoConteudo;
  if (cadeadoEl) cadeadoEl.onclick = acaoConteudo;
  if (thumbEl)   thumbEl.onclick = acaoConteudo;

  if (infoEl) {
    infoEl.onclick = (ev) => {
      ev.stopPropagation();
      abrirModalInfoContextual('feed_video');
    };
  }

  // "Ver mais vídeos" → manda pra aba Materiais (acervo).
  // Antes apontava pra /feed.html que não existe.
  if (verMaisEl) {
    verMaisEl.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { irPara('produtos'); } catch (e) { console.warn('[feed] navegação:', e); }
    };
  }
}


================================================================
PRONTO. Salvar e commit.

A linha que setava `tituloEl.textContent = item.titulo` foi removida
porque o elemento `#feed-home-titulo` deixou de existir no HTML novo.
Sem getElementById de elemento inexistente, sem ramos mortos.

O título do vídeo continua sendo gravado no banco e exibido:
  - No admin (lista do feed)
  - Dentro do modal do player (id="player-titulo")

OBS sobre o handler global do "i" (mais no topo do app.js, com
`document.getElementById('feed-home-info')?.addEventListener...`):
mantém — o id do botão é o mesmo, só mudou de lugar visualmente.
================================================================
