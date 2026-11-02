/* ============================================================
   VIDA MÁGICA — core/teste-resultado.js
   Lógica de cálculo do resultado do Teste do Subconsciente.

   Responsabilidades:
   - Receber as 15 respostas e calcular percentuais com alta resolução
   - Aplicar regra de desempate (Validação > Sobrevivência > Desordem > Medo)
   - Determinar o perfil dominante (incluindo subdivisão de Prosperidade em nv1/2/3)
   - Montar o card do livro indicado (indicação vem de core/jornadas.js)

   Princípios:
   - Fonte ÚNICA do cálculo: tudo que grava ou mostra resultado passa por aqui
   - Percentual = respostas da energia / total de respostas
   - Exibição arredonda pra inteiro (regra: 0,5 sobe — Math.round)
   - Percentuais iguais são possíveis (33% e 33%); a vencedora sai do desempate
   ============================================================ */

const { indicacaoDoPerfil } = require('./jornadas');
const { PERFIS_VALIDOS, PERFIS_LABELS } = require('./teste-conteudo');

// Regra de desempate: Validação > Sobrevivência > Desordem > Medo > Prosperidade.
// Prosperidade só é dominante quando vence sozinha.
const DESEMPATE_PRIORIDADE = {
  validacao: 4,
  sobrevivencia: 3,
  desordem: 2,
  medo: 1,
  prosperidade: 0,
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
  // Prosperidade só vence se tiver MAIOR sozinha — em empate com qualquer bloqueadora,
  // a bloqueadora leva.
  let dominanteBruto = null;
  let maiorContagem = -1;
  let maiorPrioridade = -1;

  for (const p of PERFIS_VALIDOS) {
    const cnt = contagem[p];
    const pri = DESEMPATE_PRIORIDADE[p];

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
  // Faixas oficiais (definidas pelo Renato):
  //   < 50%        → prosperidade_nv1 = Otimismo   (até 49,99%)
  //   50% a < 80%  → prosperidade_nv2 = Expansão   (50 a 79,99%)
  //   >= 80%       → prosperidade_nv3 = Plenitude  (80% ou mais)
  // Usamos o percentual INTERNO (com decimais) pra essa decisão.
  let perfilDominante = dominanteBruto;
  let nivelProsperidade = 0;
  const percProsp = percentuais.prosperidade;

  if (dominanteBruto === 'prosperidade') {
    if (percProsp < 50)        { perfilDominante = 'prosperidade_nv1'; nivelProsperidade = 1; }
    else if (percProsp < 80)   { perfilDominante = 'prosperidade_nv2'; nivelProsperidade = 2; }
    else                       { perfilDominante = 'prosperidade_nv3'; nivelProsperidade = 3; }
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

// Os 4 livros da Série Conhecer e Despertar — só eles têm o selo do Aulão.
const LIVROS_DA_SERIE = new Set([
  'vencendo_medo', 'vencendo_desordem', 'vencendo_validacao', 'vencendo_sobrevivencia',
]);

const SELO_PADRAO_LIVRO = '✨ Inclui Aulão com a Suellen';

// ── Livro indicado pro resultado ──────────────────────────
// A indicação vem da tabela de core/jornadas.js (perfil dominante → livro).
// precosBySlug: objeto { 'vencendo_medo': {...dados de precos}, ... }
//               vindo da tabela `precos` (banco Comunicação).
// resultado:    saída de calcularResultado()
// retorna: array com o livro indicado, pronto pra renderizar. Item: {
//            slug, energia, titulo, capa_url, link_checkout_padrao,
//            link_checkout_aluno, preco_aluno, preco_padrao, preco_de,
//            desconto_pct, parcelas_qtd, parcelas_valor, atributos, selo,
//            tag, cor_fundo, cor_texto, percentual_inteiro,
//            percentual_interno, linha_evidencia
//          }
function montarLivrosRecomendados(precosBySlug, resultado) {
  const slug = indicacaoDoPerfil(resultado.perfil_dominante).livro;
  const energia = resultado.perfil_dominante_bruto;
  const percInt = resultado.percentuais_exibicao[energia] || 0;
  const tagInfo = tagPorPercentual(percInt);
  const labelEnergia = PERFIS_LABELS[energia] || energia;

  // Dados do produto (vêm de precos)
  const p = (precosBySlug && precosBySlug[slug]) || {};

  return [{
    slug,
    energia,
    titulo: p.nome || slug,
    capa_url: p.imagem_url || '',
    link_checkout_padrao: p.link_checkout_padrao || '',
    link_checkout_aluno: p.link_checkout_aluno || '',
    // exibir_avista/_de/parcelas já consideram promo ativa (processarProdutos,
    // em routes/produtos.js) — mesmo "pacote" de preço usado nas LPs.
    preco_padrao: p.exibir_avista || p.preco_padrao || '',
    preco_de: p.exibir_de || '',
    desconto_pct: p.desconto_pct || null,
    parcelas_qtd: p.exibir_parcelas_qtd || '',
    parcelas_valor: p.exibir_parcelas_valor || '',
    preco_aluno: p.preco_alunos || '',
    atributos: p.atributos || '',
    selo: LIVROS_DA_SERIE.has(slug) ? SELO_PADRAO_LIVRO : '',
    tag: tagInfo.tag,
    cor_fundo: tagInfo.cor_fundo,
    cor_texto: tagInfo.cor_texto,
    percentual_inteiro: percInt,
    percentual_interno: resultado.percentuais[energia] || 0,
    linha_evidencia: percInt + '% de ' + labelEnergia + ' no seu teste',
  }];
}

// ── Lista de energias pra exibir no Bloco 3 (5 energias) ──
// Devolve array ordenado por percentual decrescente,
// no formato: [{ slug, label, percentual_inteiro }]
// Em percentuais iguais, segue o desempate — a vencedora fica em primeiro.
function montarListaEnergias(resultado) {
  const arr = PERFIS_VALIDOS.map(p => ({
    slug: p,
    label: PERFIS_LABELS[p],
    percentual_inteiro: resultado.percentuais_exibicao[p] || 0,
    percentual_interno: resultado.percentuais[p] || 0,
  }));
  arr.sort((a, b) =>
    (b.percentual_interno - a.percentual_interno)
    || (DESEMPATE_PRIORIDADE[b.slug] - DESEMPATE_PRIORIDADE[a.slug])
  );
  return arr;
}

module.exports = {
  calcularResultado,
  montarLivrosRecomendados,
  montarListaEnergias,
};
