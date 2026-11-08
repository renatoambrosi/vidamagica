/* ============================================================
   VIDA MÁGICA — public/campanha/campanha.js
   Roupagem da Black November no site. Só veste quando a campanha
   está no ar (admin → Campanhas; GET /api/campanha). Fora dela, não
   faz nada e o site fica normal.

   Uso: <script src="/campanha/campanha.js" data-pagina="home|lp" defer></script>
   (a página /black recebe data-pagina="black", montada em core/campanha.js).

   - Tarja com cronômetro regressivo até a data final do admin.
   - Home e /black "se fantasiam" de preto; LPs só ganham a tarja e as etiquetas.
   - Produto da Black = produto com a Promo ligada (o preço é o da Promo,
     o link é o link_checkout_promo quando a Promo está ligada, senão o
     link_checkout_padrao; tudo já vem em /api/precos). Nada de preço aqui.
   - Home: cartão "Pega esse ouro!" e cartões de produto em sanfona.
   - /black: preenche combos, cursos e materiais com os dados do admin.
   Estilos em /campanha/campanha.css (carregado só com a campanha no ar).
   ============================================================ */
(function () {
  const script = document.currentScript;
  const pagina = (script && script.dataset.pagina) || 'lp';

  fetch('/api/campanha', { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null)
    .then(c => { if (c && c.ativa) vestir(c); })
    .catch(() => { /* sem campanha: site normal */ });

  function vestir(campanha) {
  const FIM = Date.parse(campanha.fim);
  const DATA_FINAL = 'até ' + new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date(FIM));
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  // ?v= força o navegador a pegar o CSS novo (o Cloudflare manda o navegador guardar por 4h).
  // Mexeu no campanha.css? Suba o número aqui. Mexeu no campanha.js? Suba o ?v= nas 8 páginas.
  css.href = '/campanha/campanha.css?v=8';
  document.head.appendChild(css);
  document.querySelectorAll('[data-black-data]').forEach(el => { el.textContent = DATA_FINAL.charAt(0).toUpperCase() + DATA_FINAL.slice(1); });
    document.body.classList.add('black');
    if (pagina !== 'lp') document.body.classList.add('black-fantasia');

    // Tarja com cronômetro regressivo (dias, horas, minutos, segundos).
    const faixa = document.createElement('a');
    faixa.className = 'black-faixa';
    faixa.href = '/black';
    faixa.setAttribute('aria-label', 'Black November - Vida Mágica: ver ofertas');
    const UNIDADES = [['d', 'dias'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']];
    faixa.innerHTML = '<span class="black-faixa-nome"><span>Black November</span><span class="black-faixa-hifen"> - </span><span class="black-faixa-marca">Vida Mágica</span></span>' +
      '<span class="black-faixa-traco"></span>' +
      '<span class="black-crono">' + UNIDADES.map(([k, rotulo]) =>
        '<span class="black-crono-bloco"><span class="black-crono-num" data-crono="' + k + '">' +
          '<span class="black-dig"><span>0</span></span><span class="black-dig"><span>0</span></span>' +
        '</span><span class="black-crono-rot">' + rotulo + '</span></span>').join('<span class="black-crono-sep">:</span>') +
      '</span>';
    document.body.appendChild(faixa);

    // Cada dígito que muda gira: o novo sobe por baixo e o antigo sai por cima.
    const trocarDigito = (caixa, valor) => {
      const atual = caixa.lastElementChild;
      if (atual.textContent === valor) return;
      const novo = document.createElement('span');
      novo.textContent = valor;
      novo.className = 'entra';
      caixa.appendChild(novo);
      atual.classList.add('sai');
      requestAnimationFrame(() => requestAnimationFrame(() => novo.classList.remove('entra')));
      setTimeout(() => atual.remove(), 450);
    };
    const tic = () => {
      let resta = Math.max(0, Math.floor((FIM - Date.now()) / 1000));
      const valores = { d: Math.floor(resta / 86400), h: Math.floor(resta % 86400 / 3600), m: Math.floor(resta % 3600 / 60), s: resta % 60 };
      Object.entries(valores).forEach(([k, v]) => {
        const txt = String(v).padStart(2, '0');
        faixa.querySelectorAll('[data-crono="' + k + '"] .black-dig').forEach((caixa, i) => trocarDigito(caixa, txt[i]));
      });
    };
    tic();
    setInterval(tic, 1000);

    // Menu Materiais: "Ofertas da Black" como primeiro item (o menu é montado depois).
    const ICONE_TAG = '<svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"></path><circle cx="7.5" cy="7.5" r="1.5"></circle></svg>';
    const porNoMenu = () => {
      const painel = document.querySelector('.menu-mat');
      if (!painel || !painel.children.length || painel.querySelector('.black-menu-item')) return;
      const item = document.createElement('a');
      item.className = 'black-menu-item';
      item.href = '/black';
      item.innerHTML = '<span class="black-menu-icone">' + ICONE_TAG + '</span>' +
        '<span class="black-menu-texto"><strong>Ofertas da Black</strong><small>Combos, cursos e materiais, ' + DATA_FINAL + '</small></span>';
      painel.prepend(item);
    };
    new MutationObserver(porNoMenu).observe(document.body, { childList: true, subtree: true });

    const precos = fetch('/api/precos').then(r => r.json());

    // Produto da Black = produto com a Promo ligada no admin (a Black usa o preço da Promo).
    let dadosBlack = {};
    const ehBlack = (slug) => !!(dadosBlack[slug] && dadosBlack[slug].mostrar_promo === true);
    const etiqueta = () => {
      const e = document.createElement('span');
      e.className = 'black-etiqueta';
      e.innerHTML = ICONE_TAG + 'Black November';
      return e;
    };
    const etiquetar = (alvo, onde) => {
      if (!alvo || alvo.querySelector(':scope > .black-etiqueta')) return;
      onde === 'fim' ? alvo.appendChild(etiqueta()) : alvo.prepend(etiqueta());
    };
    // LP de produto único: slug pelo endereço.
    const LP_SLUG = { '/ouro-da-reprogramacao-mental': 'ouro_reprogramacao', '/lei-da-atracao-biblica': 'lda_biblica',
      '/guia-pratico-reprogramacao-mental': 'guia_pratico', '/magica-do-fluir': 'magica_fluir' };
    const slugDaLp = LP_SLUG[location.pathname.replace(/\/$/, '')];
    precos.then(dados => {
      dadosBlack = dados;
      // Home: tarja preta no alto do cartão + contorno dourado.
      document.querySelectorAll('.produto-card[data-produto]').forEach(card => {
        if (!ehBlack(card.dataset.produto) || card.classList.contains('black-produto')) return;
        card.classList.add('black-produto');
        const tarja = document.createElement('span');
        tarja.className = 'black-tarja-card';
        tarja.innerHTML = ICONE_TAG + '<span>Black November</span>';
        card.prepend(tarja);
      });
      // LPs de um produto: em cima de cada preço.
      if (slugDaLp && ehBlack(slugDaLp)) {
        document.querySelectorAll('.preco-bloco, .preco-hero, .cta-card').forEach(b => etiquetar(b));
      }
      // A Tal Maneira: em cima do preço de cada plano.
      document.querySelectorAll('.plano-preco').forEach(b => {
        const k = b.querySelector('[data-preco-key]');
        if (k && ehBlack(k.dataset.precoKey)) etiquetar(b);
      });
      // Menu Materiais: ao lado do nome (o menu é montado depois).
      const nomesBlack = new Set(Object.keys(dados).filter(ehBlack).map(s => dados[s].nome).filter(Boolean));
      const noMenu = () => document.querySelectorAll('.menu-mat a:not(.black-menu-item) > span:last-child').forEach(span => {
        if (nomesBlack.has(span.textContent) && !span.querySelector('.black-etiqueta')) {
          span.classList.add('black-menu-nome');
          etiquetar(span, 'fim');
        }
      });
      noMenu();
      new MutationObserver(noMenu).observe(document.body, { childList: true, subtree: true });
    });

    // Home: cartões de produto recolhidos (capa + nome). Tocar abre o resto; um aberto por vez.
    if (pagina === 'home') {
      const SETA_BAIXO = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      document.querySelectorAll('.produto-card[data-produto]').forEach(card => {
        card.classList.add('pc-sanfona', 'pc-fechado');
        card.setAttribute('aria-expanded', 'false');
        const seta = document.createElement('span');
        seta.className = 'pc-seta';
        seta.innerHTML = SETA_BAIXO;
        card.appendChild(seta);
        // Fechado mostra o nome curto (antes do " - "); aberto, o nome inteiro do admin.
        const nome = card.querySelector('[data-produto-nome]');
        const dividirNome = () => {
          const txt = nome.textContent;
          const i = txt.indexOf(' - ');
          if (i < 0 || nome.querySelector('.pc-resto')) return;
          nome.textContent = '';
          const curto = document.createElement('span');
          curto.textContent = txt.slice(0, i);
          const resto = document.createElement('span');
          resto.className = 'pc-resto';
          resto.textContent = txt.slice(i);
          nome.append(curto, resto);
        };
        dividirNome();
        new MutationObserver(dividirNome).observe(nome, { childList: true });
        // Captura: no cabeçalho (capa e nome), o toque abre/fecha em vez de ir para a página.
        card.addEventListener('click', ev => {
          if (ev.target.closest('.produto-links')) return;
          ev.preventDefault();
          ev.stopPropagation();
          const abrir = card.classList.contains('pc-fechado');
          document.querySelectorAll('.produto-card.pc-sanfona').forEach(c => {
            c.classList.add('pc-fechado');
            c.setAttribute('aria-expanded', 'false');
          });
          if (abrir) {
            card.classList.remove('pc-fechado');
            card.setAttribute('aria-expanded', 'true');
          }
        }, true);
      });
    }

    // Home: cartão "Pega esse ouro!" logo abaixo da chamada do Teste.
    if (pagina === 'home') {
      const oferta = document.createElement('a');
      oferta.className = 'black-oferta';
      oferta.href = '/black';
      oferta.innerHTML = '<span class="black-oferta-miolo">' +
        '<span class="black-oferta-rotulo black-oferta-rotulo-topo">Black November - Vida Mágica</span>' +
        '<span class="black-desconto">' +
          '<span class="black-desconto-ate">até</span>' +
          '<span class="black-desconto-num">40%</span>' +
          '<span class="black-desconto-de">de desconto*</span>' +
          '<span class="black-desconto-nota">*nos materiais selecionados</span>' +
        '</span>' +
        '<span class="black-oferta-txt">' +
          '<span class="black-oferta-titulo">Pega esse ouro!</span>' +
          '<span class="black-oferta-texto">Combos, materiais e cursos em oferta, por tempo limitado.</span>' +
        '</span>' +
        '<span class="black-oferta-cta">Quero ver as ofertas <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="13 6 19 12 13 18"></polyline></svg></span>' +
      '</span>';
      // Divisor com a estrela dourada da marca separa o hero do cartão da Black (sem palavra).
      const divisor = document.createElement('div');
      divisor.className = 'black-divisor';
      divisor.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c.5 4.6 2.4 7.9 10.5 10.5-8.1 2.6-10 5.9-10.5 10.5-.5-4.6-2.4-7.9-10.5-10.5C9.6 9.4 11.5 6.1 12 1.5z"></path></svg>';
      document.querySelector('.hero-home-prova').after(divisor);
      divisor.after(oferta);
    }

    // Página /black: nome, capa, preço e checkout de cada combo vêm do admin.
    if (pagina === 'black') {
      const LP_CURSO = { ouro_reprogramacao: '/ouro-da-reprogramacao-mental', lda_biblica: '/lei-da-atracao-biblica', atal_maneira_curso: '/a-tal-maneira/', atal_maneira_livro: '/a-tal-maneira/', guia_pratico: '/guia-pratico-reprogramacao-mental/', magica_fluir: '/magica-do-fluir' };
      const formatPreco = (p) => {
        let html = '';
        if (p.exibir_de) {
          // Percentual: o da API; sem ele (ex. "1.154,99", com ponto de milhar), conta aqui.
          const num = (v) => parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')) || 0;
          const de = num(p.exibir_de), por = num(p.exibir_avista);
          const pct = p.desconto_pct || (de > por && por > 0 ? Math.round((de - por) / de * 100) : null);
          if (pct) html += `<span class="produto-preco-off bk-selo"><span class="bk-selo-fundo"><span class="bk-selo-ouro">${pct}% OFF</span></span></span>`;
          html += `<span class="produto-preco-de">de <s>R$ ${p.exibir_de}</s> por</span>`;
        }
        if (p.exibir_parcelas_valor) {
          html += `<span><strong>${p.exibir_parcelas_qtd}x R$ ${p.exibir_parcelas_valor}</strong></span>`;
          html += `<span class="produto-preco-vista">ou R$ ${p.exibir_avista} à vista</span>`;
        } else {
          html += `<span><strong>R$ ${p.exibir_avista}</strong></span>`;
        }
        return html;
      };
      precos.then(dados => {
        document.querySelectorAll('[data-bk-produto]').forEach(oferta => {
          const p = dados[oferta.dataset.bkProduto];
          if (!p || !ehBlack(oferta.dataset.bkProduto)) { oferta.remove(); return; }
          const img = oferta.querySelector('.bk-oferta-capa img');
          if (p.imagem_url) { img.src = p.imagem_url; img.alt = p.nome || ''; }
          else oferta.querySelector('.bk-oferta-capa').remove();
          oferta.querySelector('[data-bk-nome]').textContent = p.nome || '';
          if (parseFloat(String(p.exibir_avista || '0').replace(',', '.')) > 0) {
            oferta.querySelector('[data-bk-preco]').innerHTML = formatPreco(p);
            // Selo do desconto vai para o canto da capa.
            const seloC = oferta.querySelector('[data-bk-preco] .bk-selo');
            if (seloC && oferta.querySelector('.bk-oferta-capa')) oferta.querySelector('.bk-oferta-capa').appendChild(seloC);
          }
          const cta = oferta.querySelector('[data-bk-checkout]');
          if (((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao))) {
            cta.href = window.VmUtm ? VmUtm.checkout(((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao)), oferta.dataset.utm) : ((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao));
            cta.hidden = false;
          }
          const caixa = oferta.querySelector('.bk-oferta-inclui');
          oferta.dataset.cursos.split(',').forEach(slug => {
            const c = dados[slug];
            if (!c) return;
            const item = document.createElement('a');
            item.className = 'bk-item';
            if (LP_CURSO[slug]) item.href = LP_CURSO[slug];
            const nome = document.createElement('span');
            nome.textContent = (c.nome || '').split(' - ')[0];
            // Lista sem capas (data-inclui-texto): a capa do combo já mostra tudo.
            if (oferta.hasAttribute('data-inclui-texto')) {
              item.append(nome);
            } else {
              const capa = document.createElement('img');
              capa.src = c.imagem_url;
              capa.alt = '';
              item.append(capa, nome);
            }
            caixa.appendChild(item);
          });
        });
        // Cursos e materiais avulsos: mesmo cartão dos combos (capa e nome levam à LP,
      // botão de compra e "Saiba mais"). Dados do admin.
        document.querySelectorAll('[data-bk-item]').forEach(card => {
          const p = dados[card.dataset.bkItem];
          if (!p || !((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao)) || !ehBlack(card.dataset.bkItem)) { card.remove(); return; }
          const img = card.querySelector('.bk-oferta-capa img');
          if (p.imagem_url) { img.src = p.imagem_url; img.alt = p.nome || ''; }
          else card.querySelector('.bk-oferta-capa').remove();
          card.querySelector('[data-bk-nome]').textContent = p.nome || '';
          if (parseFloat(String(p.exibir_avista || '0').replace(',', '.')) > 0) {
            card.querySelector('[data-bk-preco]').innerHTML = formatPreco(p);
            const seloI = card.querySelector('[data-bk-preco] .bk-selo');
            if (seloI && card.querySelector('.bk-oferta-capa')) card.querySelector('.bk-oferta-capa').appendChild(seloI);
          }
          const cta = card.querySelector('[data-bk-checkout]');
          cta.href = window.VmUtm ? VmUtm.checkout(((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao)), card.dataset.utm) : ((((p).mostrar_promo && String((p).link_checkout_promo || '').trim()) || (p).link_checkout_padrao));
          cta.hidden = false;
        });
        // Seção sem nenhum produto com Promo ligada some, com o título.
        document.querySelectorAll('.bk-ofertas, .bk-lista').forEach(secao => {
          if (secao.querySelector('article')) return;
          const titulo = secao.previousElementSibling;
          if (titulo && titulo.classList.contains('bk-secao-titulo')) titulo.remove();
          secao.remove();
        });
        // Abas no lugar dos títulos: Cursos, Combos, Materiais (só as que têm produto).
        const barra = document.querySelector('.bk-abas');
        const secoes = [...document.querySelectorAll('[data-aba]')]
          .sort((x, y) => Number(x.dataset.abaOrdem) - Number(y.dataset.abaOrdem));
        if (barra && secoes.length) {
          let ref = barra;
          secoes.forEach(sec => {
            const t = sec.previousElementSibling;
            if (t && t.classList.contains('bk-secao-titulo')) t.remove();
            ref.after(sec); // seções na ordem das abas, logo abaixo delas
            ref = sec;
          });
          const abrir = (nome) => {
            secoes.forEach(sec => { sec.hidden = sec.dataset.aba !== nome; });
            barra.querySelectorAll('.bk-aba').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
          };
          secoes.forEach(sec => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'bk-aba';
            b.setAttribute('role', 'tab');
            b.dataset.aba = sec.dataset.aba;
            b.textContent = sec.dataset.aba;
            b.addEventListener('click', () => abrir(sec.dataset.aba));
            barra.appendChild(b);
          });
          barra.hidden = false;
          abrir(secoes[0].dataset.aba);
        }
      });
    }

  }
})();
