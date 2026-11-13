/* ============================================================
   VIDA MÁGICA — core/teste-leitura.js
   Leitura do resultado do Teste do Subconsciente para o ADMIN
   (botão "Abrir resultado admin" da aba Resultados do Teste, que
   abre public/resultado-admin.html).
   Só o Renato vê. Nada daqui aparece para a aluna.

   Conteúdo (rascunho de 2026-11-13; o Renato corrige aqui):
   - AREAS: cada uma das 15 perguntas pertence a uma área da vida.
   - PALAVRAS: para cada resposta (pergunta + energia), a palavra que
     a frase implica (adjetivo ou prática, nunca o nome da trava) e o
     texto complementar que abre ao expandir.
   - PALAVRAS_DO_RESULTADO: para cada energia predominante, as palavras
     que o texto do resultado (o textão) usa para descrever essa energia,
     cada uma com o trecho do texto. Tiradas dos textos guardados em
     privado/texto-resultado-*.html e privado/texto-expansao.html.
     Mudou o texto do resultado no admin, revise aqui. Plenitude ainda
     não tem (não há texto guardado).

   A chave é a ordem da pergunta + a energia da resposta: vale para
   qualquer versão do Teste enquanto a pergunta tiver o mesmo sentido.
   Mudou o sentido de uma pergunta no admin, revise a palavra aqui.

   Não usa banco. Quem busca o teste é routes/admin.js.
   ============================================================ */

const { PERFIS_VALIDOS, PERFIS_LABELS } = require('./teste-conteudo');

// ── Áreas da vida (ordem de exibição) ───────────────────────
const AREAS = [
  { slug: 'dinheiro',        nome: 'Dinheiro',        perguntas: [1, 2] },
  { slug: 'relacionamentos', nome: 'Relacionamentos', perguntas: [3] },
  { slug: 'saude',           nome: 'Saúde',           perguntas: [4, 5, 6] },
  { slug: 'mente',           nome: 'Mente',           perguntas: [7, 8, 9] },
  { slug: 'emocoes',         nome: 'Emoções',         perguntas: [10, 11, 12] },
  { slug: 'proposito',       nome: 'Propósito',       perguntas: [13, 14, 15] },
];

// ── Palavra de cada resposta: [palavra, texto complementar] ──
const PALAVRAS = {
  1: {
    desordem:      ['frustração',   'Pessoa desanimada, que já tentou de tudo e acha que nada muda.'],
    sobrevivencia: ['pragmatismo',  'Pessoa para quem o fim justifica os meios.'],
    prosperidade:  ['determinação', 'Pessoa que quer crescer com preparo e princípios, com o pé no chão.'],
    validacao:     ['comparação',   'Pessoa que se mede pelo que o outro conseguiu.'],
    medo:          ['revolta',      'Pessoa que se sente injustiçada.'],
  },
  2: {
    desordem:      ['desorientação',          'Pessoa perdida, que não sabe qual é o primeiro passo.'],
    medo:          ['dúvida',                 'Pessoa que não acredita que a sua realidade permite crescer.'],
    prosperidade:  ['confiança',              'Pessoa que acredita que pode crescer em qualquer lugar.'],
    validacao:     ['busca de reconhecimento', 'Pessoa que só se sente realizada quando alcança um nível que os outros reconhecem.'],
    sobrevivencia: ['racionalidade',          'Pessoa que confia só no próprio foco e na lógica.'],
  },
  3: {
    sobrevivencia: ['indiferença', 'Pessoa que deixa a relação de lado e segue para os seus objetivos.'],
    prosperidade:  ['empatia',     'Pessoa que conversa com calma e busca entender o lado do outro.'],
    desordem:      ['descontrole', 'Pessoa que fala demais ou se cala e acaba piorando a situação.'],
    medo:          ['esquiva',     'Pessoa que foge da conversa para não desagradar.'],
    validacao:     ['mágoa',       'Pessoa que fica chateada quando não consegue resolver.'],
  },
  4: {
    validacao:     ['fragilidade',  'Pessoa que se sente frágil e pede o amparo dos outros.'],
    sobrevivencia: ['automedicação', 'Pessoa que resolve sozinha, com remédio por conta própria.'],
    medo:          ['preocupação',  'Pessoa preocupada em excesso.'],
    prosperidade:  ['autocuidado',  'Pessoa tranquila, que se cuida para se recuperar bem.'],
    desordem:      ['negligência',  'Pessoa que ignora o problema até não dar mais.'],
  },
  5: {
    validacao:     ['insatisfação', 'Pessoa insatisfeita ou envergonhada com o próprio corpo.'],
    desordem:      ['inconstância', 'Pessoa que começa e para, sem conseguir manter a rotina.'],
    prosperidade:  ['constância',   'Pessoa que pratica com frequência e respeita os próprios limites.'],
    medo:          ['desânimo',     'Pessoa que não faz por desânimo, receio de se machucar ou vergonha.'],
    sobrevivencia: ['rigor',        'Pessoa extremamente disciplinada, exigente consigo mesma.'],
  },
  6: {
    sobrevivencia: ['força de vontade', 'Pessoa que só muda quando precisa mesmo, e aí vai na firmeza.'],
    validacao:     ['fome emocional',   'Pessoa que come bem ou mal conforme o estado emocional.'],
    prosperidade:  ['consistência',     'Pessoa que muda aos poucos e mantém.'],
    desordem:      ['impulsividade',    'Pessoa que muda tudo de uma vez e desiste rápido.'],
    medo:          ['ansiedade',        'Pessoa ansiosa, que tenta mudar e não consegue.'],
  },
  7: {
    validacao:     ['impotência',           'Pessoa que se sente inútil e sem força para mudar as coisas.'],
    sobrevivencia: ['senso de injustiça',   'Pessoa que vê a vida como injusta.'],
    prosperidade:  ['responsabilidade',     'Pessoa que assume o que planta e fica em paz.'],
    medo:          ['resistência à mudança', 'Pessoa que acha qualquer mudança difícil demais.'],
    desordem:      ['distração',            'Pessoa que se ocupa com várias coisas para não encarar o problema.'],
  },
  8: {
    prosperidade:  ['aceitação',    'Pessoa que aceita com calma e reorganiza as ações.'],
    validacao:     ['inquietação',  'Pessoa que fica incomodada com o que a atrapalha.'],
    medo:          ['ansiedade',    'Pessoa ansiosa, que pensa nas consequências negativas.'],
    sobrevivencia: ['independência', 'Pessoa que resolve sozinha para não depender de ninguém.'],
    desordem:      ['confusão',     'Pessoa que se perde e não sabe por onde recomeçar.'],
  },
  9: {
    validacao:     ['necessidade de agradar', 'Pessoa que decide de um jeito que não contrarie os outros.'],
    desordem:      ['improviso',              'Pessoa que decide na hora e só depois vê se acertou.'],
    sobrevivencia: ['agilidade',              'Pessoa que avalia rápido e decide sozinha.'],
    medo:          ['procrastinação',         'Pessoa que adia a decisão até o último segundo.'],
    prosperidade:  ['planejamento',           'Pessoa que põe no papel, pensa e age com o que tem em mãos.'],
  },
  10: {
    prosperidade:  ['aprendizado',   'Pessoa que tira lição dos próprios erros.'],
    validacao:     ['autopunição',   'Pessoa que se castiga pelos erros.'],
    desordem:      ['evitação',      'Pessoa que evita pensar no erro porque dói lembrar.'],
    sobrevivencia: ['perfeccionismo', 'Pessoa que não tolera errar.'],
    medo:          ['culpa',         'Pessoa que carrega até hoje a culpa de erros antigos.'],
  },
  11: {
    desordem:      ['bagunça',     'Pessoa que deixa tudo desarrumar quando está mal e depois tenta arrumar.'],
    prosperidade:  ['lucidez',     'Pessoa que separa a emoção da realidade.'],
    validacao:     ['autocrítica', 'Pessoa que chora e revive todas as falhas de uma vez.'],
    sobrevivencia: ['firmeza',     'Pessoa que aguenta firme e busca resolver rápido.'],
    medo:          ['retraimento', 'Pessoa que se recolhe com receio de errar mais.'],
  },
  12: {
    prosperidade:  ['autoavaliação',       'Pessoa que revê onde errou e ajusta com calma.'],
    desordem:      ['acomodação',          'Pessoa que se incomoda, mas deixa para quando der.'],
    validacao:     ['sensação de fracasso', 'Pessoa que se sente fracassada quando não cumpre a meta.'],
    medo:          ['fuga',                'Pessoa que quer sumir para não encarar as consequências.'],
    sobrevivencia: ['compensação',         'Pessoa que corre para compensar o atraso.'],
  },
  13: {
    desordem:      ['correria',      'Pessoa sem tempo, tomada pelas obrigações do dia a dia.'],
    validacao:     ['invisibilidade', 'Pessoa que sente que ninguém a enxerga.'],
    prosperidade:  ['paciência',     'Pessoa que está aprendendo a esperar o tempo das respostas.'],
    medo:          ['descrença',     'Pessoa que acha que é tarde demais ou que não tem propósito.'],
    sobrevivencia: ['apego',         'Pessoa que não abre mão do que já construiu.'],
  },
  14: {
    sobrevivencia: ['serviço',                 'Pessoa que vê o próprio propósito como servir.'],
    prosperidade:  ['clareza',                 'Pessoa que liga quem ela é ao que pode oferecer ao mundo.'],
    desordem:      ['oscilação',               'Pessoa que ora tem dúvida, ora tem convicção, conforme o dia.'],
    validacao:     ['necessidade de ser útil', 'Pessoa que precisa se sentir útil para se sentir realizada.'],
    medo:          ['constrangimento',         'Pessoa que não sabe o próprio propósito e sente vergonha disso.'],
  },
  15: {
    sobrevivencia: ['superação',    'Pessoa que se define pelas lutas e adversidades que venceu.'],
    prosperidade:  ['legado',       'Pessoa que deixa exemplo de fé, transformação e sementes plantadas.'],
    desordem:      ['indefinição',  'Pessoa que vive um dia de cada vez, sem nada claro para deixar.'],
    medo:          ['sacrifício',   'Pessoa que acha que deixaria pouco e que tudo veio com luta.'],
    validacao:     ['boa intenção', 'Pessoa preocupada com a imagem de quem quis acertar.'],
  },
};

// ── Palavras do texto do resultado, por energia predominante ──
// [palavra, trecho do texto do resultado]
// A ligação dessas palavras com as respostas (bloco "Probabilidade") foi
// tirada em 2026-11-13: o Renato não aprovou. Está guardada em
// privado/pendente-2026-11-13-probabilidade/.
const PALAVRAS_DO_RESULTADO = {
  medo: [
    ['freio de mão puxado', 'Muitos me falam que se sentem como se vivessem com o freio de mão puxado. Como se tivesse uma barreira invisível que impedisse de romper na vida.'],
    ['dúvida',              'Ele não chega gritando. Chega como dúvida. Como aquela sensação de que agora não é o momento.'],
    ['prudência',           'Você não chama isso de medo. Às vezes diz que é "bom senso", entende como ver a realidade, às vezes se convence de que é só prudência e responsabilidade.'],
    ['modo de defesa',      'Você aprendeu a viver no modo de defesa. Evita risco, evita conflito, evita desconforto.'],
    ['hesitação',           'Você pensa demais, e por causa disso hesita demais, ou o tempo passa e você vê que não fez.'],
    ['procrastinação',      'Quantos passos decisivos você adiou esperando se sentir "pronto"?'],
    ['paralisia',           'O medo não apenas paralisa, ele atrai justamente o que você teme.'],
  ],
  desordem: [
    ['aceleração',        'A sensação é que você está sempre acelerado. Tentando resolver isso e aquilo, correndo pra não esquecer nada, ou pra não atrasar ainda mais.'],
    ['apagar incêndio',   'Você não está no controle — está só apagando incêndio.'],
    ['pouca eficácia',    'Age muito, mas é pouco eficaz. Faz muito mas parece ter pouco resultado.'],
    ['falta de foco',     'O problema é que a energia que te move é confusa, fragmentada, sem foco.'],
    ['reatividade',       'Você age sob pressão, toma decisões reativas, e no fim das contas, tem a sensação constante de estar atrasado na própria vida.'],
    ['urgência',          'Você vive respondendo urgências — mas nunca toca naquilo que realmente importa.'],
    ['falta de clareza',  'Falta de clareza sobre o que é prioridade.'],
    ['exaustão',          'Cansaço que não passa. Só que por dentro… você sabe que está exausto.'],
  ],
  validacao: [
    ['desejo de ser notado',     'Você cresceu com um desejo sincero: ser amado. Ser notado. Ser importante pra alguém.'],
    ['nunca o bastante',         'É como se, por mais que você fizesse, nunca fosse o bastante.'],
    ['invisibilidade',           'Se sentia invisível.'],
    ['inadequação',              'E o sentimento cruel de estar sempre errado, inadequado. Pensando errado. Fazendo errado.'],
    ['comparação',               'A sensação de ser ignorado, a comparação que irrita, a vergonha de sonhar alto e ouvir que era "ilusão".'],
    ['necessidade de se provar', 'Você passou a acreditar que precisava se provar o tempo todo, para você e para outros.'],
    ['sensação de fracasso',     '"Sou um fracasso mesmo. Sou uma inútil. Não sirvo pra nada."'],
    ['rejeição',                 'Essa é a energia que vem da rejeição. Não como lembrança apenas. Mas como sistema de crença interior.'],
  ],
  sobrevivencia: [
    ['se virar sozinho',   'Você aprendeu a se virar sozinho. Na falta de apoio, desenvolveu soluções.'],
    ['força',              'Na dor, virou força. Mas agora você sente o peso de ter que ser forte o tempo todo.'],
    ['luta',               'Você venceu lutando. E a luta virou o seu único jeito de viver.'],
    ['prontidão',          'Mesmo quando está tudo bem, alguma coisa aí dentro continua de prontidão.'],
    ['sobrecarga',         'Essa energia faz você prosperar do jeito mais cansativo possível. Você tem que pensar por todos. Decidir por todos. Executar por todos.'],
    ['controle',           'Você até tenta confiar… Mas se algo sai do controle, já pensa: "Deixa que eu resolvo".'],
    ['não conseguir parar', 'O problema é que você não consegue parar. E descansar parece perigoso.'],
    ['não pedir ajuda',    'Porque o fardo está pesado demais pra alguém que aprendeu a não pedir ajuda.'],
  ],
  prosperidade_nv1: [
    ['semente',          'Uma semente de prosperidade já brotou em você.'],
    ['potencial',        'Você já subiu um muro e conseguiu enxergar o campo da prosperidade. Isso mostra que existe um potencial vivo dentro de você.'],
    ['esforço',          'Você já busca o lado bom, mas sem a leveza e fluidez de quem vive isso de forma natural (ainda é com esforço).'],
    ['alternância',      'Vive dias iluminados, mas ainda alternando com dias nebulosos.'],
    ['inconsistência',   'Tem desejo de crescer, mas ainda sem consistência.'],
    ['hesitação',        'A hesitação pelas dúvidas, pressa ou ansiedade ainda atrapalham.'],
    ['meio do caminho',  'O risco não é voltar para trás. O risco é ficar nesse meio do caminho.'],
    ['pouca prática',    'Tornam-se profundos conhecedores, e com o tempo pouco praticantes.'],
    ['vida mediana',     'Sua vida não é ruim, mas também não é boa. É mediana, porque ainda tem coisas que te incomodam muito.'],
  ],
  prosperidade_nv2: [
    ['ponto de virada',  'Você está em um ponto de virada importante!'],
    ['testes',           'As outras energias (medo, desordem, sobrevivência, validação) quase não te paralisam mais, mas podem surgir como "testes".'],
    ['zona de conforto', 'Os maiores desafios são a zona de conforto versus a pressa.'],
    ['pressa',           'Talvez você sinta dúvida entre agir menos, por confiar no processo, e a tentação de acelerar na própria força, pensando: "Devo me esforçar mais?"'],
    ['intuição',         'E também a dificuldade em reconhecer e seguir a intuição: fazer o que você acha que deve fazer e o que tem vontade de fazer.'],
    ['alinhamento',      'Os resultados aceleram quando você para de forçar e entra em alinhamento.'],
    ['gratidão',         'Gratidão: reconhecer e celebrar suas conquistas.'],
    ['desapego',         'Desapego: confiar no processo, sem apego aos resultados.'],
  ],
  prosperidade_nv3: [],
};

const AREA_DA_PERGUNTA = new Map();
for (const a of AREAS) for (const p of a.perguntas) AREA_DA_PERGUNTA.set(p, a);

// Monta a leitura a partir das respostas gravadas no teste
// ([{ pergunta_ordem, perfil }]). `textos` é opcional:
// { perguntas: Map(ordem → texto), alternativas: Map('ordem|perfil' → texto) }.
function montarLeitura(respostas, textos = {}) {
  const lista = (Array.isArray(respostas) ? respostas : [])
    .map(r => ({ ordem: parseInt(r.pergunta_ordem, 10), perfil: r.perfil }))
    .filter(r => Number.isInteger(r.ordem) && PERFIS_VALIDOS.includes(r.perfil))
    .sort((a, b) => a.ordem - b.ordem);

  const itens = lista.map(r => {
    const area = AREA_DA_PERGUNTA.get(r.ordem) || null;
    const par = (PALAVRAS[r.ordem] && PALAVRAS[r.ordem][r.perfil]) || null;
    return {
      pergunta_ordem: r.ordem,
      pergunta: (textos.perguntas && textos.perguntas.get(r.ordem)) || null,
      resposta: (textos.alternativas && textos.alternativas.get(r.ordem + '|' + r.perfil)) || null,
      perfil: r.perfil,
      perfil_label: PERFIS_LABELS[r.perfil] || r.perfil,
      area: area ? area.slug : null,
      area_nome: area ? area.nome : 'Sem área',
      palavra: par ? par[0] : null,
      texto: par ? par[1] : null,
    };
  });

  const areas = AREAS.map(a => {
    const dela = itens.filter(i => i.area === a.slug);
    const contagem = {};
    for (const p of PERFIS_VALIDOS) contagem[p] = dela.filter(i => i.perfil === p).length;
    return {
      slug: a.slug,
      nome: a.nome,
      perguntas: a.perguntas.length,
      respondidas: dela.length,
      contagem,
      travas: dela.length - contagem.prosperidade, // respostas fora de Prosperidade
    };
  });

  return { areas, itens };
}

// Palavras do texto do resultado da energia predominante (slug do resultado:
// medo, desordem, sobrevivencia, validacao, prosperidade_nv1/2/3).
function palavrasDoResultado(perfilDominante) {
  return (PALAVRAS_DO_RESULTADO[perfilDominante] || []).map(([palavra, trecho]) => ({ palavra, trecho }));
}

module.exports = { AREAS, PALAVRAS, PALAVRAS_DO_RESULTADO, montarLeitura, palavrasDoResultado };
