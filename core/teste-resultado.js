/* ============================================================
   VIDA MÁGICA — core/teste-resultado.js
   Lógica de cálculo do resultado do Teste do Subconsciente.

   Responsabilidades:
   - Receber as 15 respostas e calcular percentuais com alta resolução
   - Aplicar regra de desempate (Validação > Sobrevivência > Desordem > Medo)
   - Determinar o perfil dominante (incluindo subdivisão de Prosperidade em nv1/2/3)
   - Filtrar e ordenar os livros do Passo 2 conforme regras de gatilho/tag

   Princípios:
   - Cálculo INTERNO em alta resolução (frações com casas decimais)
   - Cálculo da dominante e desempate operam sobre valor INTERNO
   - Exibição arredonda pra inteiro (regra: 0,5 sobe — Math.round)
   - Empates VISUAIS são possíveis (27% e 27%), mas internamente o sistema sabe quem ganha
   ============================================================ */

const PERFIS_BLOQUEADORES = ['medo', 'desordem', 'sobrevivencia', 'validacao'];
const PERFIS_VALIDOS = [...PERFIS_BLOQUEADORES, 'prosperidade'];

const PERFIS_LABELS = {
  medo:          'Medo',
  desordem:      'Desordem',
  sobrevivencia: 'Sobrevivência',
  validacao:     'Validação',
  prosperidade:  'Prosperidade',
};

const PERFIS_CORES = {
  medo:          '#9b59b6',
  desordem:      '#e67e22',
  sobrevivencia: '#34495e',
  validacao:     '#e74c3c',
  prosperidade:  '#2ba5e8',
};

// Regra de desempate (energia mais alta vence em empate literal):
// Validação > Sobrevivência > Desordem > Medo
// Prosperidade não entra nessa regra porque, se for dominante, leva direto.
const DESEMPATE_PRIORIDADE = {
  validacao: 4,
  sobrevivencia: 3,
  desordem: 2,
  medo: 1,
};

// ── Cálculo do resultado ──────────────────────────────────
// respostas: array de { pergunta_ordem, perfil }
// retorna: {
//   contagem:     { medo, desordem, sobrevivencia, validacao, prosperidade } (inteiros)
//   percentuais:  { ...mesma estrutura, mas com decimais (percentual interno) }
//   percentuais_exibicao: { ...mesma estrutura, inteiros arredondados }
//   perfil_dominante:           'medo'|'desordem'|...|'prosperidade_nv1'|'prosperidade_nv2'|'prosperidade_nv3'
//   perfil_dominante_bruto:     'medo'|...|'prosperidade' (sem subdivisão)
//   percentual_prosperidade:    inteiro
//   nivel_prosperidade:         0 (não-prosperidade) | 1 | 2 | 3
// }
function calcularResultado(respostas) {
  const contagem = { medo: 0, desordem: 0, sobrevivencia: 0, validacao: 0, prosperidade: 0 };

  for (const r of respostas) {
    if (PERFIS_VALIDOS.includes(r.perfil)) {
      contagem[r.perfil]++;
    }
  }

  const total = respostas.length || 1;

  // Percentuais internos (alta resolução, com decimais)
  const percentuais = {};
  for (const p of PERFIS_VALIDOS) {
    percentuais[p] = (contagem[p] / total) * 100;
  }

  // Percentuais de exibição (inteiros, arredondados — 0,5 sobe)
  const percentuaisExibicao = {};
  for (const p of PERFIS_VALIDOS) {
    percentuaisExibicao[p] = Math.round(percentuais[p]);
  }

  // ── Determinar dominante BRUTO ──
  // Maior contagem; em empate, prioridade fixa (Validação > Sobrevivência > Desordem > Medo).
  // Prosperidade só vence se tiver MAIOR sozinha — em empate de Prosperidade com qualquer
  // bloqueadora, a regra clássica do produto é que Prosperidade NÃO leva (a aluna ainda
  // tem trava). Implementação: damos prioridade 0 a Prosperidade no desempate.
  let dominanteBruto = null;
  let maiorContagem = -1;
  let maiorPrioridade = -1;

  for (const p of PERFIS_VALIDOS) {
    const cnt = contagem[p];
    const pri = (DESEMPATE_PRIORIDADE[p] !== undefined) ? DESEMPATE_PRIORIDADE[p] : 0;

    if (cnt > maiorContagem) {
      maiorContagem = cnt;
      maiorPrioridade = pri;
      dominanteBruto = p;
    } else if (cnt === maiorContagem && pri > maiorPrioridade) {
      maiorPrioridade = pri;
      dominanteBruto = p;
    }
  }

  // ── Subdivisão de Prosperidade em nv1/2/3 ──
  // Se a dominante for Prosperidade, dividimos pelo percentual:
  //   <= 50%  → prosperidade_nv1
  //   <= 80%  → prosperidade_nv2
  //   >  80%  → prosperidade_nv3
  // Usamos o percentual INTERNO (com decimais) pra essa decisão.
  let perfilDominante = dominanteBruto;
  let nivelProsperidade = 0;
  const percProsp = percentuais.prosperidade;

  if (dominanteBruto === 'prosperidade') {
    if (percProsp <= 50)      { perfilDominante = 'prosperidade_nv1'; nivelProsperidade = 1; }
    else if (percProsp <= 80) { perfilDominante = 'prosperidade_nv2'; nivelProsperidade = 2; }
    else                      { perfilDominante = 'prosperidade_nv3'; nivelProsperidade = 3; }
  }

  return {
    contagem,
    percentuais,                                  // alta resolução (interno)
    percentuais_exibicao: percentuaisExibicao,    // inteiros (UI)
    perfil_dominante: perfilDominante,
    perfil_dominante_bruto: dominanteBruto,
    percentual_prosperidade: percentuaisExibicao.prosperidade,
    nivel_prosperidade: nivelProsperidade,
  };
}

// ── Tag de prioridade do livro ────────────────────────────
// Recebe o percentual INTEIRO da energia (de exibição) e devolve tag + cor.
// Faixas:
//   0%        → Complemento (apenas pro Medo, que aparece sempre)
//   1 a 10%   → Complemento
//   11 a 15%  → Útil
//   16 a 25%  → Necessário
//   acima 25% → Urgente
function tagPorPercentual(percInteiro) {
  if (percInteiro === 0)   return { tag: 'Complemento', cor_fundo: '#5C4A2E', cor_texto: '#E8D4A0' };
  if (percInteiro <= 10)   return { tag: 'Complemento', cor_fundo: '#5C4A2E', cor_texto: '#E8D4A0' };
  if (percInteiro <= 15)   return { tag: 'Útil',        cor_fundo: '#D9B262', cor_texto: '#3D2E1A' };
  if (percInteiro <= 25)   return { tag: 'Necessário',  cor_fundo: '#C8922A', cor_texto: '#1A0F00' };
  return                          { tag: 'Urgente',     cor_fundo: '#3D2E1A', cor_texto: '#F4D060' };
}

// Ordem de prioridade da tag (pra ordenação)
const ORDEM_TAG = { 'Urgente': 4, 'Necessário': 3, 'Útil': 2, 'Complemento': 1 };

// ── Filtrar e ordenar os livros do Passo 2 ────────────────
// livrosCadastro: array vindo do banco teste_livros (4 linhas)
// resultado:      saída de calcularResultado()
// retorna: array de livros já filtrados/ordenados, prontos pra renderizar.
//          Cada item: { ...dadosDoLivro, tag, cor_fundo, cor_texto, percentual_inteiro,
//                       linha_evidencia }
function montarLivrosRecomendados(livrosCadastro, resultado) {
  const lista = [];

  for (const livro of livrosCadastro) {
    const energia = livro.energia;
    const percInt = resultado.percentuais_exibicao[energia] || 0;
    const percReal = resultado.percentuais[energia] || 0;

    // Regra geral: Desordem/Validação/Sobrevivência só aparecem se > 0%.
    // Regra especial: Medo aparece SEMPRE (mesmo com 0%).
    const apareceSempre = (energia === 'medo');
    if (!apareceSempre && percInt === 0) continue;

    const tagInfo = tagPorPercentual(percInt);

    // Linha de evidência muda quando é Medo com 0%
    let linhaEvidencia;
    if (energia === 'medo' && percInt === 0) {
      linhaEvidencia = 'O medo é uma energia transversal — vale como apoio em qualquer jornada.';
    } else {
      const labelEnergia = PERFIS_LABELS[energia] || energia;
      linhaEvidencia = percInt + '% de ' + labelEnergia + ' no seu teste';
    }

    lista.push({
      ...livro,
      tag: tagInfo.tag,
      cor_fundo: tagInfo.cor_fundo,
      cor_texto: tagInfo.cor_texto,
      percentual_inteiro: percInt,
      percentual_interno: percReal,
      linha_evidencia: linhaEvidencia,
    });
  }

  // Ordenar: Urgente → Necessário → Útil → Complemento
  // Em empate de tag: maior percentual interno primeiro
  lista.sort((a, b) => {
    const ordemA = ORDEM_TAG[a.tag] || 0;
    const ordemB = ORDEM_TAG[b.tag] || 0;
    if (ordemA !== ordemB) return ordemB - ordemA;
    return b.percentual_interno - a.percentual_interno;
  });

  return lista;
}

// ── Lista de energias pra exibir no Bloco 3 (5 energias) ──
// Devolve array ordenado por percentual decrescente (interno, pra desempate),
// no formato: [{ slug, label, percentual_inteiro }]
function montarListaEnergias(resultado) {
  const arr = PERFIS_VALIDOS.map(p => ({
    slug: p,
    label: PERFIS_LABELS[p],
    percentual_inteiro: resultado.percentuais_exibicao[p] || 0,
    percentual_interno: resultado.percentuais[p] || 0,
  }));
  arr.sort((a, b) => b.percentual_interno - a.percentual_interno);
  return arr;
}

module.exports = {
  PERFIS_BLOQUEADORES,
  PERFIS_VALIDOS,
  PERFIS_LABELS,
  PERFIS_CORES,
  calcularResultado,
  tagPorPercentual,
  montarLivrosRecomendados,
  montarListaEnergias,
};
