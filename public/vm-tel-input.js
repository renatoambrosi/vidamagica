/* ============================================================
   VIDA MÁGICA — vm-tel-input.js
   Helper para inputs de telefone com seleção de país (bandeira).

   Usa a biblioteca intl-tel-input (carregada via CDN no <head>).
   Não depende de bundle, fica no front estático.

   REGRA DE FORMATAÇÃO VISUAL:
   - País = Brasil (br): máscara BRASILEIRA fixa "(DD) NNNNN-NNNN"
                          (a aluna vê o que sempre viu: "(62) 98308-6320")
   - Outros países: deixa o intl-tel-input formatar com o utilsScript
                    (padrão internacional E.164 do país selecionado)

   USO:
     <input id="campo-telefone" type="tel">
     <script>
       const tel = VmTelInput.aplicar('#campo-telefone', { paisDefault: 'br' });
       const canonico = tel.canonico();   // "5562983086320" (sem '+', sem máscara)
       const valido   = tel.valido();
       const pais     = tel.pais();        // "br"
       tel.preencher('+5562983086320');    // setNumber + reaplica máscara BR
       tel.bloquear();                     // readonly + país travado
     </script>
   ============================================================ */

(function (global) {
  'use strict';

  const CDN_VERSAO = '23.6.1';
  const UTILS_URL  = `https://cdn.jsdelivr.net/npm/intl-tel-input@${CDN_VERSAO}/build/js/utils.js`;

  function aguardarItiCarregado(callback, tentativas = 0) {
    if (global.window && global.window.intlTelInput) return callback();
    if (tentativas > 50) {
      console.error('[VmTelInput] intl-tel-input não carregou');
      return;
    }
    setTimeout(() => aguardarItiCarregado(callback, tentativas + 1), 100);
  }

  // ── Máscara brasileira: "(DD) NNNNN-NNNN" ou "(DD) NNNN-NNNN" ──
  function mascaraBR(valor) {
    const num = String(valor || '').replace(/\D/g, '').slice(0, 11);
    if (num.length === 0)  return '';
    if (num.length <= 2)   return `(${num}`;
    if (num.length <= 6)   return `(${num.slice(0,2)}) ${num.slice(2)}`;
    if (num.length <= 10)  return `(${num.slice(0,2)}) ${num.slice(2,6)}-${num.slice(6)}`;
    return `(${num.slice(0,2)}) ${num.slice(2,7)}-${num.slice(7)}`;
  }

  function aplicar(seletor, opcoes = {}) {
    const el = typeof seletor === 'string' ? document.querySelector(seletor) : seletor;
    if (!el) {
      console.warn('[VmTelInput] elemento não encontrado:', seletor);
      return null;
    }

    let iti = null;
    let mascaraHandler = null;

    const wrapper = {
      _pendentePreenchimento: null,
      _pendenteBloqueio: false,

      // Canônico E.164 sem '+': "5562983086320"
      canonico() {
        if (!iti) return (el.value || '').replace(/\D/g, '');
        try {
          // Se Brasil + máscara aplicada, monta DDI manualmente (intl-tel-input
          // não consegue parsear "(62) 98308-6320" porque não é o formato dele)
          const pais = wrapper.pais();
          if (pais === 'br') {
            const apenas = (el.value || '').replace(/\D/g, '');
            return apenas ? '55' + apenas : '';
          }
          const num = iti.getNumber();
          return (num || '').replace(/\D/g, '');
        } catch {
          return (el.value || '').replace(/\D/g, '');
        }
      },

      valido() {
        if (!iti) return false;
        try {
          const pais = wrapper.pais();
          if (pais === 'br') {
            // Brasil: validação manual (10 ou 11 dígitos)
            const d = (el.value || '').replace(/\D/g, '');
            return d.length === 10 || d.length === 11;
          }
          return iti.isValidNumber();
        } catch {
          return false;
        }
      },

      pais() {
        if (!iti) return null;
        try {
          const dados = iti.getSelectedCountryData();
          return dados && dados.iso2 ? dados.iso2 : null;
        } catch {
          return null;
        }
      },

      // Pré-preenche com canônico ('5562983086320' ou '+5562983086320')
      preencher(numeroCanonico) {
        if (!numeroCanonico) return;
        const apenasDigitos = String(numeroCanonico).replace(/\D/g, '');
        const numComMais = '+' + apenasDigitos;
        if (!iti) {
          this._pendentePreenchimento = numComMais;
          return;
        }
        try {
          // setNumber escolhe o país e formata. Depois, se for BR, aplica
          // a máscara visual brasileira por cima.
          iti.setNumber(numComMais);
          aplicarMascaraSeBR();
        } catch {}
      },

      bloquear() {
        el.readOnly = true;
        if (!iti) {
          this._pendenteBloqueio = true;
          return;
        }
        try {
          const flag = el.parentElement && el.parentElement.querySelector('.iti__selected-flag');
          if (flag) flag.style.pointerEvents = 'none';
        } catch {}
      },

      iti() { return iti; },
    };

    // ── Lógica da máscara BR sobre o intl-tel-input ──
    // Só aplica visualmente quando país=BR. Nos outros países,
    // o intl-tel-input já formata sozinho.
    function aplicarMascaraSeBR() {
      const pais = wrapper.pais();
      if (pais === 'br') {
        // Pega só os dígitos do que está no input (pode ter vindo formatado
        // pelo intl-tel-input sem o "(") e re-aplica máscara brasileira.
        const apenas = (el.value || '').replace(/\D/g, '');
        // Tira "55" do começo se veio com DDI duplicado
        const semDdi = apenas.startsWith('55') && apenas.length > 11
          ? apenas.slice(2)
          : apenas;
        el.value = mascaraBR(semDdi);
      }
    }

    aguardarItiCarregado(() => {
      iti = global.window.intlTelInput(el, {
        initialCountry: opcoes.paisDefault || 'br',
        utilsScript: UTILS_URL,
        geoIpLookup: function (success) {
          fetch('https://ipapi.co/json/')
            .then(r => r.json())
            .then(data => success((data && data.country_code) ? data.country_code.toLowerCase() : 'br'))
            .catch(() => success('br'));
        },
        separateDialCode: true,
        autoPlaceholder: 'aggressive',
      });

      // Aplica intenções enfileiradas (preencher / bloquear)
      if (wrapper._pendentePreenchimento) {
        try { iti.setNumber(wrapper._pendentePreenchimento); } catch {}
        wrapper._pendentePreenchimento = null;
      }
      if (wrapper._pendenteBloqueio) {
        wrapper.bloquear();
      }

      // Aplica máscara BR no estado inicial (caso país padrão seja Brasil)
      aplicarMascaraSeBR();

      // Listener: a cada tecla, se for BR, re-aplica máscara
      mascaraHandler = function () {
        if (wrapper.pais() === 'br') {
          // Pega cursor atual pra tentar manter posição razoável
          const apenas = (el.value || '').replace(/\D/g, '').slice(0, 11);
          const formatado = mascaraBR(apenas);
          if (el.value !== formatado) {
            el.value = formatado;
          }
        }
        // Pra outros países, deixa o intl-tel-input fazer (não mexe)
      };
      el.addEventListener('input', mascaraHandler);

      // Quando aluna troca de país: reformata visualmente
      el.addEventListener('countrychange', () => {
        const pais = wrapper.pais();
        if (pais === 'br') {
          aplicarMascaraSeBR();
          el.placeholder = '(00) 00000-0000';
        } else {
          // Restaura placeholder do intl-tel-input pro país novo
          // (autoPlaceholder='aggressive' já cuida disso, mas força)
          try {
            const num = iti.getNumber();
            iti.setNumber(num || '');
          } catch {}
        }
      });
    });

    return wrapper;
  }

  global.VmTelInput = { aplicar };
})(typeof window !== 'undefined' ? window : this);
