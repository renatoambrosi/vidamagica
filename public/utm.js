/* ═══════════════════════════════════════════════════════════════
   VIDA MÁGICA — utm.js
   UTMs de todas as páginas públicas, na mesma regra do
   suellenseragi.com.br (código do Wix + utm-tracker.js das LPs dela).

   - utm_source / utm_medium: URL → sessão → padrão da página
     (data-padrao no <script>: "Site" na home, "LpOuro" na LP do Ouro…).
     Ficam na sessão e acompanham a pessoa até o checkout.
   - utm_campaign: sempre o botão de compra (ex.: "LpOuro-hero").
     A campanha que vier na URL não é usada.
   - utm_content: só existe quando a URL de entrada traz um (anúncio
     de campanha) ou a página de campanha marca (data-conteudo="black").
     Nunca é criado a partir de outro campo.
   - extra_params: passa adiante sem mudança.

   API:
     VmUtm.checkout(url, campanha) → link de compra com as UTMs
     VmUtm.interno(url)            → link entre páginas (sem campanha)
     VmUtm.pagina                  → origem padrão da página (prefixo das campanhas)
   Links para as páginas do site ganham as UTMs no clique, inclusive
   os criados depois (menu Materiais, mapa do rodapé).
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (window.VmUtm) return;

  const script = document.currentScript;
  const PADRAO = (script && script.dataset.padrao) || 'Site';
  const CAMPOS = ['utm_source', 'utm_medium', 'utm_content', 'extra_params'];
  const PAGINAS = ['/', '/teste', '/ouro-da-reprogramacao-mental', '/lei-da-atracao-biblica',
    '/guia-pratico-reprogramacao-mental', '/a-tal-maneira', '/magica-do-fluir', '/relatos', '/black'];

  function ler(chave) {
    try { return sessionStorage.getItem(chave) || ''; } catch { return ''; }
  }
  function gravar(chave, valor) {
    try { sessionStorage.setItem(chave, valor); } catch {}
  }

  // A URL vence a sessão, como no site da Suellen.
  const url = new URLSearchParams(window.location.search);
  CAMPOS.forEach((campo) => {
    const valor = url.get(campo);
    if (valor) gravar(campo, valor);
  });
  if (!ler('utm_source')) gravar('utm_source', PADRAO);
  // Página de campanha (ex.: a da Black) marca o próprio content: data-conteudo="black".
  if (script && script.dataset.conteudo && !url.get('utm_content')) gravar('utm_content', script.dataset.conteudo);

  function montar(base, campanha) {
    try {
      const u = new URL(base, window.location.origin);
      CAMPOS.forEach((campo) => {
        const valor = ler(campo);
        if (valor && !u.searchParams.has(campo)) u.searchParams.set(campo, valor);
      });
      if (campanha) u.searchParams.set('utm_campaign', campanha);
      return u.origin === window.location.origin ? u.pathname + u.search + u.hash : u.toString();
    } catch {
      return base;
    }
  }

  function ehPaginaDoSite(a) {
    try {
      const u = new URL(a.href, window.location.origin);
      const caminho = u.pathname.replace(/\/$/, '') || '/';
      return u.origin === window.location.origin && PAGINAS.includes(caminho);
    } catch {
      return false;
    }
  }

  // Link entre páginas: aplica no clique (pega também os links criados depois).
  function aoClicar(ev) {
    const a = ev.target.closest && ev.target.closest('a[href]');
    if (!a || a.hasAttribute('data-sem-utm')) return;
    const bruto = a.getAttribute('href') || '';
    if (!bruto || bruto.startsWith('#') || bruto.startsWith('javascript:') || !ehPaginaDoSite(a)) return;
    const destino = new URL(a.href, window.location.origin);
    if (destino.pathname === window.location.pathname && destino.hash) return; // âncora na mesma página
    a.href = montar(a.href);
  }
  document.addEventListener('click', aoClicar, true);
  document.addEventListener('auxclick', aoClicar, true);

  window.VmUtm = {
    checkout: (base, campanha) => montar(base, campanha),
    interno: (base) => montar(base),
    ler,
    pagina: PADRAO,
  };
})();
