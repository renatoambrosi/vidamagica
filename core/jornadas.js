/* ============================================================
   VIDA MÁGICA — core/jornadas.js

   Calcula a JORNADA VIGENTE da aluna baseado no resultado do
   teste e nos produtos que ela possui. É a fonte da verdade.

   Estrutura de jornadas (ordem fixa):
   1. Conhecer e Despertar  → default, pra quem tem trava
   2. Vida Mágica           → prosperidade dominante nv1 ou nv2
                              SEM nenhuma trava > 20%
   3. Multiplicando a Vida Mágica → prosperidade dominante nv3
                                    SEM nenhuma trava > 20%

   Regra do override:
   - Mesmo se Prosperidade for dominante, se alguma energia-
     problema (medo/desordem/validacao/sobrevivencia) > 20%,
     aluna fica em "Conhecer e Despertar". Trava forte tem
     prioridade.

   Pesos dos passos:
   - Jornada 1: P1=25%, P2=25%, P3=50%
   - Jornada 2: P1=50%, P2=25%, P3=25%
   - Jornada 3: P1=100%

   ============================================================ */

// Slugs canônicos dos produtos
const SLUG = {
  TESTE: 'teste_subconsciente',
  VENCENDO_MEDO: 'vencendo_medo',
  VENCENDO_DESORDEM: 'vencendo_desordem',
  VENCENDO_VALIDACAO: 'vencendo_validacao',
  VENCENDO_SOBREVIVENCIA: 'vencendo_sobrevivencia',
  OURO: 'ouro_reprogramacao',
  LDA: 'lda_biblica',
  GUIA_PRATICO: 'guia_pratico',
  MAGICA_FLUIR: 'magica_fluir',
  ATAL_LIVRO: 'atal_maneira_livro',
  ATAL_CURSO: 'atal_maneira_curso',
};

// Mapa de energia → livro da Série Conhecer e Despertar
const LIVRO_POR_ENERGIA = {
  medo: SLUG.VENCENDO_MEDO,
  desordem: SLUG.VENCENDO_DESORDEM,
  validacao: SLUG.VENCENDO_VALIDACAO,
  sobrevivencia: SLUG.VENCENDO_SOBREVIVENCIA,
};

// Limite de trava forte: se qualquer energia-problema for > 20%,
// aluna fica em Conhecer e Despertar mesmo que Prosperidade seja dominante.
const LIMITE_TRAVA_FORTE = 20;

// Limites das tags de prioridade dos livros (em %):
// - 16% a 25% = Necessário (conta na trilha)
// - > 25%     = Urgente    (conta na trilha)
const TAG_NECESSARIO_MIN = 16;
const TAG_URGENTE_MIN = 25;

/**
 * Determina se aluna tem alguma trava forte (>20% em qualquer energia-problema).
 * Usa percentuais inteiros de exibição.
 */
function temTravaForte(percentuais_exibicao) {
  const p = percentuais_exibicao || {};
  return ['medo', 'desordem', 'validacao', 'sobrevivencia'].some(
    e => (p[e] || 0) > LIMITE_TRAVA_FORTE
  );
}

/**
 * Regra especial do Medo: aparece como Necessário se >0% (mesmo que <16%).
 * Demais energias: 16-25% Necessário, >25% Urgente.
 * Retorna 'urgente' | 'necessario' | null (não conta na trilha).
 */
function tagPrioridade(energia, percentual) {
  const p = percentual || 0;
  if (energia === 'medo') {
    if (p > TAG_URGENTE_MIN) return 'urgente';
    if (p > 0) return 'necessario'; // medo >0% sempre conta
    return null;
  }
  // Outras: precisa de pelo menos 16%
  if (p > TAG_URGENTE_MIN) return 'urgente';
  if (p >= TAG_NECESSARIO_MIN) return 'necessario';
  return null;
}

/**
 * Lista de energias-problema que CONTAM na trilha (urgente ou necessário),
 * ordenadas: urgente primeiro, depois por percentual decrescente.
 * Não inclui prosperidade.
 */
function energiasQueContam(percentuais_exibicao) {
  const p = percentuais_exibicao || {};
  const lista = [];
  ['medo', 'desordem', 'validacao', 'sobrevivencia'].forEach(e => {
    const tag = tagPrioridade(e, p[e]);
    if (tag) lista.push({ energia: e, percentual: p[e] || 0, tag });
  });
  // Urgente antes de necessário; dentro disso, % decrescente
  lista.sort((a, b) => {
    const pa = a.tag === 'urgente' ? 0 : 1;
    const pb = b.tag === 'urgente' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return b.percentual - a.percentual;
  });
  return lista;
}

/**
 * Identifica qual curso de reprogramação entra no Passo 3 da Jornada 1.
 * Regra: Sobrevivência dominante → LDA Bíblica; outras → Ouro.
 */
function cursoJornada1(perfil_dominante_bruto) {
  if (perfil_dominante_bruto === 'sobrevivencia') return SLUG.LDA;
  return SLUG.OURO;
}

/**
 * Função principal. Recebe o resultado do teste + produtos que aluna possui,
 * e devolve a jornada vigente com passos e progresso.
 *
 * Parâmetros:
 *   perfil_dominante        - ex: 'medo' | 'prosperidade_nv1' | etc
 *   perfil_dominante_bruto  - ex: 'medo' | 'prosperidade' (sem subdivisão)
 *   percentuais_exibicao    - { medo, desordem, validacao, sobrevivencia, prosperidade } inteiros
 *   nivel_prosperidade      - 0 | 1 | 2 | 3
 *   slugsComprados          - Set ou array com slugs que aluna possui (ativo=true)
 *
 * Retorna:
 *   {
 *     numero: 1 | 2 | 3,
 *     slug: 'conhecer_e_despertar' | 'vida_magica' | 'multiplicando_vida_magica',
 *     nome: 'Conhecer e Despertar' | 'Vida Mágica' | 'Multiplicando a Vida Mágica',
 *     passos: [{
 *       ordem,
 *       titulo,
 *       produtos: [slug...],
 *       peso,           // soma dos pesos = 100
 *       concluido,      // true se aluna tem TODOS os produtos do passo
 *       eh_proximo,     // primeiro não-concluído
 *     }],
 *     progresso_percentual,  // soma dos pesos dos passos concluídos
 *     analise: string | null, // explicação automatizada quando relevante
 *   }
 */
function calcularJornadaVigente({
  perfil_dominante,
  perfil_dominante_bruto,
  percentuais_exibicao,
  nivel_prosperidade,
  slugsComprados,
}) {
  // Normaliza slugsComprados pra Set
  const possui = (slugsComprados instanceof Set)
    ? slugsComprados
    : new Set(Array.isArray(slugsComprados) ? slugsComprados : []);

  // Aluna que chegou aqui fez o teste → garante teste no set
  possui.add(SLUG.TESTE);

  const ehProsperidadeDominante = (perfil_dominante_bruto === 'prosperidade');
  const trava = temTravaForte(percentuais_exibicao);

  // ──────────────────────────────────────────────────────────
  // Decisão de jornada
  // ──────────────────────────────────────────────────────────
  let numero = 1;
  let analise = null;

  if (ehProsperidadeDominante && !trava) {
    // Sem trava forte → liberada pra próxima jornada
    if (nivel_prosperidade >= 3) {
      numero = 3;  // Multiplicando a Vida Mágica
    } else {
      numero = 2;  // Vida Mágica (nv1 ou nv2)
    }
  } else if (ehProsperidadeDominante && trava) {
    // Prosperidade dominante MAS tem trava forte → fica em Conhecer e Despertar
    numero = 1;
    analise = 'Sua energia dominante é a Prosperidade — ótimo sinal. Mas você ainda tem uma trava com percentual elevado, e por isso sua jornada precisa começar (ou recomeçar) no Conhecer e Despertar. Vamos resolver essa trava antes de avançar.';
  } else {
    // Energia-problema dominante
    numero = 1;
  }

  // ──────────────────────────────────────────────────────────
  // Monta passos da jornada escolhida
  // ──────────────────────────────────────────────────────────
  let passos = [];
  let slug;
  let nome;

  if (numero === 1) {
    slug = 'conhecer_e_despertar';
    nome = 'Conhecer e Despertar';

    // P1 - Teste (25%)
    passos.push({
      ordem: 1,
      titulo: 'Conhecer',
      subtitulo: 'Teste do Subconsciente',
      produtos: [SLUG.TESTE],
      peso: 25,
    });

    // P2 - Livros das energias que contam (Necessário/Urgente) (25%)
    const energias = energiasQueContam(percentuais_exibicao);
    const slugsP2 = energias
      .map(e => LIVRO_POR_ENERGIA[e.energia])
      .filter(Boolean);
    // Sempre tem pelo menos um (Medo sempre conta se >0%)
    passos.push({
      ordem: 2,
      titulo: 'Despertar',
      subtitulo: 'Livros da Série Conhecer e Despertar',
      produtos: slugsP2.length > 0 ? slugsP2 : [SLUG.VENCENDO_MEDO],
      peso: 25,
    });

    // P3 - Curso de reprogramação (50%)
    const curso = cursoJornada1(perfil_dominante_bruto);
    passos.push({
      ordem: 3,
      titulo: 'Reprogramação',
      subtitulo: curso === SLUG.LDA ? 'Curso Lei da Atração Bíblica' : 'Curso Ouro da Reprogramação Mental',
      produtos: [curso],
      peso: 50,
    });

  } else if (numero === 2) {
    slug = 'vida_magica';
    nome = 'Vida Mágica';

    // P1 - LDA Bíblica (50%)
    passos.push({
      ordem: 1,
      titulo: 'Reprogramação',
      subtitulo: 'Curso Lei da Atração Bíblica',
      produtos: [SLUG.LDA],
      peso: 50,
    });

    // P2 - Guia Prático + Mágica do Fluir (25% — precisa dos 2)
    passos.push({
      ordem: 2,
      titulo: 'Prática diária',
      subtitulo: 'Guia Prático para Reprogramar a Mente + Guia de Bolso Mágica do Fluir',
      produtos: [SLUG.GUIA_PRATICO, SLUG.MAGICA_FLUIR],
      peso: 25,
    });

    // P3 - A Tal Maneira (livro) (25%)
    passos.push({
      ordem: 3,
      titulo: 'Aprofundamento',
      subtitulo: 'Livro Digital A Tal Maneira',
      produtos: [SLUG.ATAL_LIVRO],
      peso: 25,
    });

  } else {
    // numero === 3
    slug = 'multiplicando_vida_magica';
    nome = 'Multiplicando a Vida Mágica';

    // P1 - A Tal Maneira (curso) (100%)
    passos.push({
      ordem: 1,
      titulo: 'Multiplicar',
      subtitulo: 'Curso A Tal Maneira — O Curso Definitivo da Riqueza Bíblica',
      produtos: [SLUG.ATAL_CURSO],
      peso: 100,
    });
  }

  // ──────────────────────────────────────────────────────────
  // Marca concluído (passo concluído = aluna tem TODOS os produtos)
  // e calcula próximo + progresso
  // ──────────────────────────────────────────────────────────
  passos.forEach(p => {
    p.concluido = p.produtos.every(s => possui.has(s));
  });

  const idxProx = passos.findIndex(p => !p.concluido);
  passos.forEach((p, i) => {
    p.eh_proximo = (i === idxProx);
  });

  const progresso_percentual = passos
    .filter(p => p.concluido)
    .reduce((soma, p) => soma + (p.peso || 0), 0);

  return {
    numero,
    slug,
    nome,
    passos,
    progresso_percentual,
    analise,
  };
}

/**
 * Determina se a aluna tem o Clube Vida Mágica ativo.
 * Fonte da verdade: usuario.plano !== 'gratuito'.
 */
function temClubeVidaMagica(usuario) {
  if (!usuario) return false;
  const plano = String(usuario.plano || 'gratuito').toLowerCase();
  return plano !== 'gratuito';
}

module.exports = {
  calcularJornadaVigente,
  temClubeVidaMagica,
  SLUG,
  LIVRO_POR_ENERGIA,
  tagPrioridade,
  energiasQueContam,
  temTravaForte,
};
