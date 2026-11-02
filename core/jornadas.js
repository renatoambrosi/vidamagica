/* ============================================================
   VIDA MÁGICA — core/jornadas.js

   FONTE ÚNICA da jornada da aluna e dos materiais indicados por
   resultado. Resultado, /app, admin e atendimento leem daqui.

   Jornadas (ordem fixa):
   1. Conhecer e Despertar → Medo, Desordem, Validação, Sobrevivência
   2. Vida Mágica          → Otimismo (nv1) e Expansão (nv2)
   3. Poder e Plenitude    → Plenitude (nv3)

   As jornadas são as Fases 1, 2 e 3 da página inicial.

   A energia dominante decide tudo. Prosperidade dominante vai pra
   Vida Mágica ou Poder e Plenitude mesmo com outra energia alta
   (não existe mais o rebaixamento por trava forte).

   Pesos dos passos:
   - Com curso: Teste 25%, Livro 25%, Curso 50%
   - Sem curso (Plenitude): Teste 50%, Livro 50%

   Slugs imutáveis: `prosperidade_nv1/2/3` seguem no banco; Otimismo,
   Expansão e Plenitude são os nomes de exibição.

   ============================================================ */

const { poolTeste } = require('../db');

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

const JORNADAS = {
  1: { slug: 'conhecer_e_despertar', nome: 'Conhecer e Despertar', subtitulo: 'Despertando a mente', cor: '#C8922A' },
  2: { slug: 'vida_magica', nome: 'Vida Mágica', subtitulo: 'Operando a abundância', cor: '#2BA5E8' },
  3: { slug: 'poder_e_plenitude', nome: 'Poder e Plenitude', subtitulo: 'Vivendo em plenitude', cor: '#F4D060' },
};

// Tabela de indicação: perfil dominante → jornada + livro + curso.
// curso: null = perfil sem curso indicado.
const INDICACAO_POR_PERFIL = {
  medo:             { jornada: 1, livro: SLUG.VENCENDO_MEDO,          curso: SLUG.OURO,       titulo_livro: 'Despertar',  titulo_curso: 'Reprogramação' },
  desordem:         { jornada: 1, livro: SLUG.VENCENDO_DESORDEM,      curso: SLUG.OURO,       titulo_livro: 'Despertar',  titulo_curso: 'Reprogramação' },
  validacao:        { jornada: 1, livro: SLUG.VENCENDO_VALIDACAO,     curso: SLUG.OURO,       titulo_livro: 'Despertar',  titulo_curso: 'Reprogramação' },
  sobrevivencia:    { jornada: 1, livro: SLUG.VENCENDO_SOBREVIVENCIA, curso: SLUG.LDA,        titulo_livro: 'Despertar',  titulo_curso: 'Reprogramação' },
  prosperidade_nv1: { jornada: 2, livro: SLUG.GUIA_PRATICO,           curso: SLUG.LDA,        titulo_livro: 'Prática',    titulo_curso: 'Reprogramação' },
  prosperidade_nv2: { jornada: 2, livro: SLUG.ATAL_LIVRO,             curso: SLUG.ATAL_CURSO, titulo_livro: 'Expansão',   titulo_curso: 'Riqueza Bíblica' },
  prosperidade_nv3: { jornada: 3, livro: SLUG.MAGICA_FLUIR,           curso: null,            titulo_livro: 'Plenitude',  titulo_curso: null },
};

/**
 * Devolve { jornada, livro, curso, titulo_livro, titulo_curso } do perfil.
 * Perfil desconhecido cai na indicação do Medo (jornada 1).
 */
function indicacaoDoPerfil(perfil_dominante) {
  return INDICACAO_POR_PERFIL[perfil_dominante] || INDICACAO_POR_PERFIL.medo;
}

/**
 * Teste que define a jornada da aluna: o mais recente com trilha ativada.
 * Refazer o teste só muda a jornada depois de ativar o novo resultado.
 */
async function buscarTesteDaJornada(usuario_id, telefone) {
  const r = await poolTeste.query(
    `SELECT id, respostas, perfil_dominante, feito_em
       FROM testes
      WHERE (usuario_id = $1 OR telefone_canonico = $2)
        AND ativou_trilha = TRUE
      ORDER BY feito_em DESC
      LIMIT 1`,
    [usuario_id, telefone]
  );
  return r.rows[0] || null;
}

/**
 * Função principal. Recebe o perfil dominante + produtos que aluna possui
 * e devolve a jornada vigente com passos e progresso.
 *
 * Parâmetros:
 *   perfil_dominante - ex: 'medo' | 'prosperidade_nv1' | etc
 *   slugsComprados   - Set ou array com slugs que aluna possui (ativo=true)
 *
 * Retorna:
 *   {
 *     numero: 1 | 2 | 3,
 *     slug: 'conhecer_e_despertar' | 'vida_magica' | 'poder_e_plenitude',
 *     nome, subtitulo, cor,
 *     passos: [{
 *       ordem,
 *       titulo,
 *       produtos: [slug],
 *       peso,           // soma dos pesos = 100
 *       concluido,      // true se aluna tem o produto do passo
 *       eh_proximo,     // primeiro não-concluído
 *     }],
 *     progresso_percentual,  // soma dos pesos dos passos concluídos
 *   }
 */
function calcularJornadaVigente({ perfil_dominante, slugsComprados }) {
  // Normaliza slugsComprados pra Set
  const possui = (slugsComprados instanceof Set)
    ? slugsComprados
    : new Set(Array.isArray(slugsComprados) ? slugsComprados : []);

  // Aluna que chegou aqui fez o teste → garante teste no set
  possui.add(SLUG.TESTE);

  const ind = indicacaoDoPerfil(perfil_dominante);
  const jornada = JORNADAS[ind.jornada];

  const passos = [
    { ordem: 1, titulo: 'Conhecer', produtos: [SLUG.TESTE], peso: ind.curso ? 25 : 50 },
    { ordem: 2, titulo: ind.titulo_livro, produtos: [ind.livro], peso: ind.curso ? 25 : 50 },
  ];
  if (ind.curso) {
    passos.push({ ordem: 3, titulo: ind.titulo_curso, produtos: [ind.curso], peso: 50 });
  }

  // ──────────────────────────────────────────────────────────
  // Marca concluído e calcula próximo + progresso
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
    numero: ind.jornada,
    slug: jornada.slug,
    nome: jornada.nome,
    subtitulo: jornada.subtitulo,
    cor: jornada.cor,
    passos,
    progresso_percentual,
  };
}

/**
 * Junta a jornada vigente com os dados do produto (nome, capa, links, preço)
 * no formato usado pelas telas de jornada (/app, admin, atendimento).
 * precosBySlug: { slug: dados } da tabela `precos` — fonte da verdade do produto.
 */
function montarJornadaExibicao(vigente, precosBySlug) {
  if (!vigente) return null;
  const dadosBySlug = precosBySlug || {};

  const passos = vigente.passos.map(p => {
    const produto_slug = p.produtos[0];
    const dadosProd = dadosBySlug[produto_slug] || {};
    return {
      ordem: p.ordem,
      titulo: p.titulo,
      descricao: '',
      produto_slug,
      produto_nome: dadosProd.nome || produto_slug,
      produto_imagem: dadosProd.imagem_url || '',
      link_checkout_padrao: dadosProd.link_checkout_padrao || '',
      link_checkout_aluno: dadosProd.link_checkout_aluno || '',
      preco_padrao: dadosProd.preco_padrao || '',
      preco_aluno: dadosProd.preco_alunos || '',
      comprado: p.concluido,
      eh_proximo: p.eh_proximo,
    };
  });

  return {
    slug: vigente.slug,
    numero: vigente.numero,
    nome_exibicao: vigente.nome,
    subtitulo: vigente.subtitulo,
    cor: vigente.cor,
    passos,
    progresso: {
      passos_concluidos: passos.filter(p => p.comprado).length,
      passos_totais: passos.length,
      percentual: vigente.progresso_percentual,
    },
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
  montarJornadaExibicao,
  indicacaoDoPerfil,
  buscarTesteDaJornada,
  temClubeVidaMagica,
  SLUG,
};
