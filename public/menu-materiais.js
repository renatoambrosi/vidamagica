/* ============================================================
   VIDA MÁGICA — public/menu-materiais.js
   Menu "Materiais" do topo, compartilhado entre a home e as LPs.
   Deixa a pessoa circular entre os produtos sem virar catálogo:
   lista capa e nome, sem preço.

   Nome e capa vêm de /api/precos. Produto sem LP vai direto pro
   checkout, com a campanha <página>-<produto>-header (ex.: VM-Medo-header).
   O botão fica fora de #navbar-actions, que é limpo pelo navbar-account.js.

   Uso: <script src="/menu-materiais.js" defer></script>
   ============================================================ */

(function () {
  const ITENS = [
    ['teste_subconsciente', '/teste'],
    ['vencendo_medo', null, 'Medo'],
    ['ouro_reprogramacao', '/ouro-da-reprogramacao-mental'],
    ['guia_pratico', '/guia-pratico-reprogramacao-mental/'],
    ['lda_biblica', '/lei-da-atracao-biblica'],
    ['atal_maneira_livro', '/a-tal-maneira/'],
    ['atal_maneira_curso', '/a-tal-maneira/'],
    ['magica_fluir', '/magica-do-fluir'],
  ];

  const CSS = `
    .menu-mat-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 0.35rem; font-family: 'Montserrat', sans-serif; font-size: 0.84rem; font-weight: 700; color: #F4D998; background: rgba(20,14,2,0.82); border: 1px solid rgba(200,146,42,0.5); border-radius: 999px; padding: 0.42rem 0.95rem; cursor: pointer; }
    .menu-mat-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.2s; }
    .menu-mat-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
    .menu-mat { position: fixed; top: 60px; right: 0.75rem; left: 0.75rem; z-index: 120; max-width: 420px; margin-left: auto; max-height: calc(100vh - 76px); overflow-y: auto; background: rgba(20,14,2,0.98); border: 1px solid rgba(200,146,42,0.3); border-radius: 16px; padding: 0.5rem; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
    .menu-mat[hidden] { display: none; }
    .menu-mat a { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem; border-radius: 10px; text-decoration: none; color: #F5F0E8; font-size: 0.88rem; font-weight: 600; line-height: 1.3; }
    .menu-mat a:hover { background: rgba(200,146,42,0.14); }
    .menu-mat img { width: 46px; height: 46px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
  `;

  async function iniciar() {
    const acoes = document.getElementById('navbar-actions');
    if (!acoes) return;

    const estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);

    const btn = document.createElement('button');
    btn.className = 'menu-mat-btn';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = 'Materiais <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    acoes.before(btn);

    const painel = document.createElement('div');
    painel.className = 'menu-mat';
    painel.hidden = true;
    document.body.appendChild(painel);

    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      painel.hidden = !painel.hidden;
      btn.setAttribute('aria-expanded', String(!painel.hidden));
    });
    document.addEventListener('click', () => {
      painel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });

    try {
      const dados = await fetch('/api/precos').then((r) => r.json());
      ITENS.forEach(([slug, lp, nomeUtm]) => {
        const p = dados[slug];
        const href = lp || (p && ((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao))); // promo ligada = link da promo
        if (!p || !href) return;
        const a = document.createElement('a');
        a.href = (!lp && window.VmUtm) ? VmUtm.checkout(href, `${VmUtm.pagina}-${nomeUtm}-header`) : href;
        if (!lp) { a.target = '_blank'; a.rel = 'noopener'; }
        const img = document.createElement('img');
        img.src = p.imagem_url || '';
        img.alt = '';
        const nome = document.createElement('span');
        nome.textContent = p.nome || '';
        a.append(img, nome);
        painel.appendChild(a);
      });
    } catch (e) {
      console.warn('Menu Materiais indisponível:', e);
      btn.remove();
    }
  }

  iniciar();
})();
