/* ============================================================
   VIDA MÁGICA — vm-tel-input.js
   Helper para inputs de telefone com seleção de país (bandeira).

   Usa a biblioteca intl-tel-input (carregada via CDN no <head> da página).
   Não depende de bundle, não vai pro npm — fica no front estático.

   USO:
     <input id="campo-telefone" type="tel">
     <script>
       const tel = VmTelInput.aplicar('#campo-telefone', { paisDefault: 'br' });
       // Em algum submit:
       const canonico = tel.canonico();          // "5562983086320"
       const valido   = tel.valido();            // true/false
       const pais     = tel.pais();              // "br"
       tel.preencher('+5562983086320');          // pré-preenche e seleciona país
       tel.bloquear();                           // readonly + sem trocar país
     </script>

   REGRA:
   - Default: Brasil
   - Auto-detecta país pelo IP da aluna (via ipapi.co — fallback transparente)
   - Aceita TODOS os países (sem allowlist)
   ============================================================ */

(function (global) {
  'use strict';

  // CDN base do intl-tel-input usado pelas tags <link>/<script> no HTML.
  // Aqui só usamos pra apontar o utilsScript.
  const CDN_VERSAO = '23.6.1';
  const UTILS_URL  = `https://cdn.jsdelivr.net/npm/intl-tel-input@${CDN_VERSAO}/build/js/utils.js`;

  function aguardarItiCarregado(callback, tentativas = 0) {
    if (global.window && global.window.intlTelInput) return callback();
    if (tentativas > 50) {
      console.error('[VmTelInput] biblioteca intl-tel-input não carregou');
      return;
    }
    setTimeout(() => aguardarItiCarregado(callback, tentativas + 1), 100);
  }

  function aplicar(seletor, opcoes = {}) {
    const el = typeof seletor === 'string' ? document.querySelector(seletor) : seletor;
    if (!el) {
      console.warn('[VmTelInput] elemento não encontrado:', seletor);
      return null;
    }

    let iti = null;
    const wrapper = {
      _pendentePreenchimento: null,
      _pendenteBloqueio: false,

      // Retorna o canônico no formato E.164 SEM o '+': "5562983086320"
      canonico() {
        if (!iti) return (el.value || '').replace(/\D/g, '');
        try {
          const numero = iti.getNumber(); // E.164: "+5562983086320"
          return (numero || '').replace(/\D/g, '');
        } catch {
          return (el.value || '').replace(/\D/g, '');
        }
      },

      // Validação por país (aproveita o banco de dados do intl-tel-input)
      valido() {
        if (!iti) return false;
        try {
          // isValidNumber respeita o país selecionado e checa contra utils.js
          return iti.isValidNumber();
        } catch {
          return false;
        }
      },

      // Código ISO do país: "br", "us", "pt"
      pais() {
        if (!iti) return null;
        try {
          const dados = iti.getSelectedCountryData();
          return dados && dados.iso2 ? dados.iso2 : null;
        } catch {
          return null;
        }
      },

      // Pré-preenche com um número canônico (com ou sem '+')
      preencher(numeroCanonico) {
        if (!numeroCanonico) return;
        const num = String(numeroCanonico).startsWith('+')
          ? String(numeroCanonico)
          : `+${String(numeroCanonico).replace(/\D/g, '')}`;
        if (!iti) {
          this._pendentePreenchimento = num;
          return;
        }
        try { iti.setNumber(num); } catch {}
      },

      // Bloqueia edição: readonly + país travado
      bloquear() {
        el.readOnly = true;
        if (!iti) {
          this._pendenteBloqueio = true;
          return;
        }
        try {
          // Esconde a setinha do dropdown pra não dar clique em país
          const flagContainer = el.parentElement && el.parentElement.querySelector('.iti__selected-flag');
          if (flagContainer) flagContainer.style.pointerEvents = 'none';
        } catch {}
      },

      // Acesso ao instância nativa do intl-tel-input se precisar
      iti() { return iti; },
    };

    aguardarItiCarregado(() => {
      iti = global.window.intlTelInput(el, {
        initialCountry: opcoes.paisDefault || 'br',
        // Carrega utils.js (validação + formatação por país)
        utilsScript: UTILS_URL,
        // Default Brasil; tenta auto-detectar país por geo-IP
        // (não bloqueante — se falhar, fica em Brasil)
        geoIpLookup: function (success) {
          fetch('https://ipapi.co/json/')
            .then(r => r.json())
            .then(data => success((data && data.country_code) ? data.country_code.toLowerCase() : 'br'))
            .catch(() => success('br'));
        },
        // Mostra +código no início do input quando país selecionado
        separateDialCode: true,
        // Acessibilidade
        autoPlaceholder: 'aggressive',
      });

      // Aplica intenções enfileiradas
      if (wrapper._pendentePreenchimento) {
        try { iti.setNumber(wrapper._pendentePreenchimento); } catch {}
        wrapper._pendentePreenchimento = null;
      }
      if (wrapper._pendenteBloqueio) {
        wrapper.bloquear();
      }
    });

    return wrapper;
  }

  global.VmTelInput = { aplicar };
})(typeof window !== 'undefined' ? window : this);
