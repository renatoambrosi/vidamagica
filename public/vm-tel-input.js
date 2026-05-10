/* ============================================================
   VIDA MÁGICA — vm-tel-input.js
   Helper para inputs de telefone com seleção de país (bandeira).

   Usa a biblioteca intl-tel-input (carregada via CDN no <head>).
   Não depende de bundle, fica no front estático.

   REGRA DE FORMATAÇÃO VISUAL:
   - País = Brasil (br): bandeira + dropdown + máscara "(DD) NNNNN-NNNN"
                          SEM o "+55" aparecendo no input.
                          A aluna vê "(62) 98308-6320" como sempre viu.
   - Outros países: bandeira + dropdown + formato com DDI visível
                    no padrão internacional (ex: "+1 (202) 555-0100",
                    "+351 912 345 678"). Usa o utilsScript do
                    intl-tel-input pra formatar.

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

    const wrapper = {
      _pendentePreenchimento: null,
      _pendenteBloqueio: false,

      // Canônico E.164 sem '+': "5562983086320"
      canonico() {
        if (!iti) return (el.value || '').replace(/\D/g, '');
        try {
          const pais = wrapper.pais();
          if (pais === 'br') {
            // Brasil: input só tem dígitos do número (DDD+celular).
            // Adiciona o "55" do DDI manualmente.
            const apenas = (el.value || '').replace(/\D/g, '');
            return apenas ? '55' + apenas : '';
          }
          // Outros países: usa getNumber() que já vem em E.164 com '+'
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
            // Brasil: validação manual (10 ou 11 dígitos no DDD+número)
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
        if (!iti) {
          this._pendentePreenchimento = '+' + apenasDigitos;
          return;
        }
        try {
          // Detecta se é Brasil pelo prefixo
          if (apenasDigitos.startsWith('55') && (apenasDigitos.length === 12 || apenasDigitos.length === 13)) {
            // Força país BR e seta só os dígitos do número (sem DDI)
            iti.setCountry('br');
            const semDdi = apenasDigitos.slice(2);
            el.value = mascaraBR(semDdi);
          } else {
            // Outros países: deixa setNumber escolher o país e formatar
            iti.setNumber('+' + apenasDigitos);
          }
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

    // Aplica máscara visual baseada no país atual.
    // Brasil → máscara "(DD) NNNNN-NNNN".
    // Outros → não mexe (intl-tel-input formata via utilsScript).
    function reformatarConformePais() {
      const pais = wrapper.pais();
      if (pais === 'br') {
        const apenas = (el.value || '').replace(/\D/g, '').slice(0, 11);
        const formatado = mascaraBR(apenas);
        if (el.value !== formatado) el.value = formatado;
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
        // separateDialCode=false: NÃO mostra o "+55" antes do input.
        // Pra Brasil isso some o DDI da UI (deixamos invisível pra ficar
        // igual à máscara antiga). Pra outros países, o "+XX" aparece
        // dentro do próprio campo, formatado pelo utilsScript.
        separateDialCode: false,
        autoPlaceholder: 'aggressive',
        formatOnDisplay: true,
      });

      // Aplica intenções enfileiradas
      if (wrapper._pendentePreenchimento) {
        const num = wrapper._pendentePreenchimento;
        wrapper._pendentePreenchimento = null;
        wrapper.preencher(num);
      }
      if (wrapper._pendenteBloqueio) {
        wrapper.bloquear();
      }

      // Estado inicial: se Brasil e input vazio, define placeholder amigável.
      // Se já tem valor, reformatar.
      if (wrapper.pais() === 'br') {
        el.placeholder = '(00) 00000-0000';
        reformatarConformePais();
      }

      // A cada tecla: re-aplica máscara BR enquanto país for Brasil.
      // (Pra outros países, deixa o intl-tel-input/utilsScript formatar.)
      el.addEventListener('input', () => {
        if (wrapper.pais() === 'br') {
          const apenas = (el.value || '').replace(/\D/g, '').slice(0, 11);
          const formatado = mascaraBR(apenas);
          if (el.value !== formatado) el.value = formatado;
        }
      });

      // Quando a aluna troca de país manualmente
      el.addEventListener('countrychange', () => {
        const pais = wrapper.pais();
        if (pais === 'br') {
          el.placeholder = '(00) 00000-0000';
          reformatarConformePais();
        } else {
          // Outros: limpa input pra deixar o intl-tel-input mostrar
          // o placeholder do país novo. setNumber('') reseta.
          try { iti.setNumber(''); } catch {}
        }
      });
    });

    return wrapper;
  }

  global.VmTelInput = { aplicar };
})(typeof window !== 'undefined' ? window : this);
