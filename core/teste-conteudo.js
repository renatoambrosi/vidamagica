/* ============================================================
   VIDA MÁGICA — core/teste-conteudo.js
   Conteúdo do Teste do Subconsciente (versão inicial v1.0).

   Estrutura:
   - PERGUNTAS: array de 15 perguntas com 5 alternativas cada (75 total).
   - As alternativas já vêm na ordem A-E que a aluna deve ver.
   - Cada alternativa tem: perfil (interno) + texto (visível).

   Os 5 perfis:
   - medo
   - desordem
   - sobrevivencia   (antes 'autossuficiencia' — renomeado, mesma lógica)
   - validacao
   - prosperidade

   Após responder as 15, conta-se quantas respostas caíram em cada perfil.
   O perfil dominante é o que mais aparece. Se for "prosperidade",
   subdivide em 3 níveis pelo percentual:
   - <= 50%  → prosperidade_nv1
   - <= 80%  → prosperidade_nv2
   - >  80%  → prosperidade_nv3

   Esse arquivo é a fonte da verdade da PRIMEIRA versão do teste (v1.0).
   Edições futuras das perguntas são feitas pelo painel admin (cria nova versão).
   ============================================================ */

const PERGUNTAS = [
  {
    ordem: 1,
    pergunta: 'Quando vejo alguém enriquecer sem valores ou princípios, sinto:',
    alternativas: [
      { perfil: 'desordem',      texto: 'Frustração. Parece que nada muda, já fiz o certo e o errado e não consegui nada.' },
      { perfil: 'sobrevivencia', texto: 'Motivação, porque não existe verdade, apenas resultado.' },
      { perfil: 'prosperidade',  texto: 'Decido estudar mais e subir do jeito certo, mas sem ingenuidade.' },
      { perfil: 'validacao',     texto: 'Se alguém consegue dessa forma, eu também posso, só que da forma certa.' },
      { perfil: 'medo',          texto: 'Raiva. É sempre assim: os bonzinhos só se ferram.' },
    ],
  },
  {
    ordem: 2,
    pergunta: 'Quando penso no meu potencial de gerar renda, sinto:',
    alternativas: [
      { perfil: 'desordem',      texto: 'Não sei nem por onde começar.' },
      { perfil: 'medo',          texto: 'Duvido. Às vezes acho que minha realidade não permite isso.' },
      { perfil: 'prosperidade',  texto: 'Acredito que posso crescer em qualquer lugar.' },
      { perfil: 'validacao',     texto: 'Sinto que preciso alcançar um certo nível grande para me sentir realizado e reconhecido.' },
      { perfil: 'sobrevivencia', texto: 'Tenho convicção de que, com foco e lógica, eu consigo.' },
    ],
  },
  {
    ordem: 3,
    pergunta: 'Se surge um conflito sério com alguém importante, eu:',
    alternativas: [
      { perfil: 'sobrevivencia', texto: 'Deixo pra lá e sigo em frente para os meus objetivos.' },
      { perfil: 'prosperidade',  texto: 'Converso com calma, busco entender o outro lado e não ver só o meu.' },
      { perfil: 'desordem',      texto: 'Falo demais ou fico no meu canto e acabo piorando a situação, sem querer.' },
      { perfil: 'medo',          texto: 'Evito conversar por medo de desagradar ou ter conflito com a pessoa.' },
      { perfil: 'validacao',     texto: 'Tento evitar confronto ou tento resolver mas fico chateado quando não consigo.' },
    ],
  },
  {
    ordem: 4,
    pergunta: 'Ao perceber sintomas físicos inesperados, eu:',
    alternativas: [
      { perfil: 'validacao',     texto: 'Torço e peço para me ajudarem ao máximo porque me sinto fragilizado.' },
      { perfil: 'sobrevivencia', texto: 'Procuro resolver sozinho com remédios por conta própria.' },
      { perfil: 'medo',          texto: 'Me preocupo mais do que deveria.' },
      { perfil: 'prosperidade',  texto: 'Creio que está tudo bem, mas me cuido para garantir a boa recuperação.' },
      { perfil: 'desordem',      texto: 'Ignoro o máximo, até realmente eu precisar tratar.' },
    ],
  },
  {
    ordem: 5,
    pergunta: 'Minha relação com exercícios físicos é:',
    alternativas: [
      { perfil: 'validacao',     texto: 'Considero fazer mesmo não gostando, pois tenho insatisfação ou vergonha do meu corpo.' },
      { perfil: 'desordem',      texto: 'Começo e paro diversas vezes, sempre me perdendo na rotina.' },
      { perfil: 'prosperidade',  texto: 'Pratico com frequência e consciência, respeitando meus limites.' },
      { perfil: 'medo',          texto: 'Não faço por desânimo, medo de lesões ou vergonha.' },
      { perfil: 'sobrevivencia', texto: 'Sou extremamente disciplinado.' },
    ],
  },
  {
    ordem: 6,
    pergunta: 'Como reajo ao perceber que preciso melhorar minha alimentação:',
    alternativas: [
      { perfil: 'sobrevivencia', texto: 'Se realmente eu precisar, serei firme.' },
      { perfil: 'validacao',     texto: 'Quando estou bem eu como bem. Mas quando fico mal eu desando.' },
      { perfil: 'prosperidade',  texto: 'Faço ajustes graduais e consistentes.' },
      { perfil: 'desordem',      texto: 'Faço mudanças bruscas e acabo desistindo rapidamente.' },
      { perfil: 'medo',          texto: 'Fico ansioso e tento mudar, mas não consigo.' },
    ],
  },
  {
    ordem: 7,
    pergunta: 'Quando analiso minhas dificuldades, eu:',
    alternativas: [
      { perfil: 'validacao',     texto: 'Costumo me sentir inútil e impotente para mudar as coisas.' },
      { perfil: 'sobrevivencia', texto: 'Sinto o quanto a vida não é justa.' },
      { perfil: 'prosperidade',  texto: 'Lembro que eu sempre colho o que planto e fico em paz.' },
      { perfil: 'medo',          texto: 'Acho muito difícil qualquer mudança.' },
      { perfil: 'desordem',      texto: 'Me distraio fazendo várias coisas para não pensar nisso.' },
    ],
  },
  {
    ordem: 8,
    pergunta: 'Se algo sai do meu controle, eu:',
    alternativas: [
      { perfil: 'prosperidade',  texto: 'Aceito com calma e reorganizo minhas ações com clareza.' },
      { perfil: 'validacao',     texto: 'Fico inquieto e incomodado com as coisas que me atrapalham.' },
      { perfil: 'medo',          texto: 'Fico ansioso pensando nas consequências negativas.' },
      { perfil: 'sobrevivencia', texto: 'Resolvo sozinho, pois não quero depender de ninguém.' },
      { perfil: 'desordem',      texto: 'Me perco mentalmente, sem saber exatamente por onde recomeçar.' },
    ],
  },
  {
    ordem: 9,
    pergunta: 'Quando preciso tomar uma decisão importante:',
    alternativas: [
      { perfil: 'validacao',     texto: 'Evito contrariar pessoas ao tomar decisões.' },
      { perfil: 'desordem',      texto: 'Faço o que der na hora. Depois eu vejo se foi o certo.' },
      { perfil: 'sobrevivencia', texto: 'Avalio rapidamente e tomo minha decisão.' },
      { perfil: 'medo',          texto: 'Adio até o último segundo.' },
      { perfil: 'prosperidade',  texto: 'Coloco no papel, penso e ajo com o que tenho em mãos.' },
    ],
  },
  {
    ordem: 10,
    pergunta: 'Como lido com os meus próprios erros:',
    alternativas: [
      { perfil: 'prosperidade',  texto: 'Realmente aprendi com eles.' },
      { perfil: 'validacao',     texto: 'Fico péssimo, me martirizando.' },
      { perfil: 'desordem',      texto: 'Evito pensar nisso. Fico mal quando lembro.' },
      { perfil: 'sobrevivencia', texto: 'Odeio errar. Mas as vezes acontece.' },
      { perfil: 'medo',          texto: 'Me culpo até hoje. Aquilo nunca deveria ter acontecido.' },
    ],
  },
  {
    ordem: 11,
    pergunta: 'Como lido com períodos emocionalmente difíceis:',
    alternativas: [
      { perfil: 'desordem',      texto: 'Desorganizo tudo. Depois tento arrumar.' },
      { perfil: 'prosperidade',  texto: 'Reavalio com calma, sabendo que emoção e realidade não se misturam.' },
      { perfil: 'validacao',     texto: 'Choro muito. Todas as minhas falhas vêm à tona ao mesmo tempo.' },
      { perfil: 'sobrevivencia', texto: 'Fico firme e busco resolver rápido.' },
      { perfil: 'medo',          texto: 'Me retraio, o que eu fizer a mais poderá dar errado.' },
    ],
  },
  {
    ordem: 12,
    pergunta: 'Como costumo reagir quando uma meta não é alcançada no prazo:',
    alternativas: [
      { perfil: 'prosperidade',  texto: 'Avalio onde errei e ajusto com calma.' },
      { perfil: 'desordem',      texto: 'Me incomoda, mas faço quando der.' },
      { perfil: 'validacao',     texto: 'Fico com a sensação que fracassei.' },
      { perfil: 'medo',          texto: 'Fico com vontade de sumir para não lidar com as consequências.' },
      { perfil: 'sobrevivencia', texto: 'Eu corro para compensar.' },
    ],
  },
  {
    ordem: 13,
    pergunta: 'O que mais me trava quando penso em alinhar minha vida ao meu propósito é:',
    alternativas: [
      { perfil: 'desordem',      texto: 'A correria e obrigações do dia a dia, que sempre tomam todo meu tempo.' },
      { perfil: 'validacao',     texto: 'Parece que ninguém me enxerga e esse propósito nunca vai acontecer.' },
      { perfil: 'prosperidade',  texto: 'Ter que aprender a esperar tempo que leva para ter mais respostas.' },
      { perfil: 'medo',          texto: 'O medo de que seja tarde demais — ou que não tenha propósito nenhum na minha vida.' },
      { perfil: 'sobrevivencia', texto: 'Não posso abrir mão do que já construí.' },
    ],
  },
  {
    ordem: 14,
    pergunta: 'Se alguém me pedisse hoje para descrever meu propósito em poucas palavras, eu diria:',
    alternativas: [
      { perfil: 'sobrevivencia', texto: 'Servir é o meu propósito.' },
      { perfil: 'prosperidade',  texto: 'Uma jornada mágica, que conecta quem eu sou com o que posso oferecer ao mundo.' },
      { perfil: 'desordem',      texto: 'Depende do dia. Ora tenho dúvida, ora convicção.' },
      { perfil: 'validacao',     texto: 'Quero me sentir útil e realizada cumprindo meu propósito.' },
      { perfil: 'medo',          texto: 'Não sei ao certo… e isso me constrange mais do que eu gostaria de admitir.' },
    ],
  },
  {
    ordem: 15,
    pergunta: 'Se eu partisse hoje, o que acredito que deixaria para os outros:',
    alternativas: [
      { perfil: 'sobrevivencia', texto: 'Uma pessoa que venceu muitas lutas e adversidades.' },
      { perfil: 'prosperidade',  texto: 'Exemplo de fé, transformação e sementes plantadas.' },
      { perfil: 'desordem',      texto: 'Nada claro. Vivo dia após dia fazendo meu melhor.' },
      { perfil: 'medo',          texto: 'Deixaria pouco, mas com orgulho de que conquistei com luta e honestidade.' },
      { perfil: 'validacao',     texto: 'A imagem de alguém que quis acertar embora nem sempre conseguisse.' },
    ],
  },
];

const PERFIS_VALIDOS = ['medo', 'desordem', 'sobrevivencia', 'validacao', 'prosperidade'];

// Rótulos legíveis (para o painel admin e relatórios)
const PERFIS_LABELS = {
  medo:          'Medo',
  desordem:      'Desordem',
  sobrevivencia: 'Sobrevivência',
  validacao:     'Validação',
  prosperidade:  'Prosperidade',
};

// Cores para badges/labels no admin
const PERFIS_CORES = {
  medo:          '#9b59b6',
  desordem:      '#e67e22',
  sobrevivencia: '#34495e',
  validacao:     '#e74c3c',
  prosperidade:  '#2ba5e8',
};

// ── Cálculo do perfil dominante ──────────────────────────────
function calcularPerfil(respostas) {
  const contagem = { medo: 0, desordem: 0, sobrevivencia: 0, validacao: 0, prosperidade: 0 };

  for (const r of respostas) {
    if (PERFIS_VALIDOS.includes(r.perfil)) {
      contagem[r.perfil]++;
    }
  }

  const total = respostas.length || 1;
  const percentuais = {};
  for (const p of PERFIS_VALIDOS) {
    percentuais[p] = Math.round((contagem[p] / total) * 100);
  }

  // Perfil dominante = maior contagem.
  // Em empate: prosperidade > validacao > sobrevivencia > desordem > medo
  const ordemPrioridade = ['prosperidade', 'validacao', 'sobrevivencia', 'desordem', 'medo'];
  let dominanteBruto = ordemPrioridade[0];
  for (const p of ordemPrioridade) {
    if (contagem[p] > contagem[dominanteBruto]) dominanteBruto = p;
  }

  // Se dominante = prosperidade, subdivide em níveis
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
    percentuais,
    perfil_dominante: perfilDominante,
    percentual_prosperidade: percProsp,
    nivel_prosperidade: nivelProsperidade,
  };
}

module.exports = {
  PERGUNTAS,
  PERFIS_VALIDOS,
  PERFIS_LABELS,
  PERFIS_CORES,
  calcularPerfil,
};
