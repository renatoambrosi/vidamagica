/* ============================================================
   VIDA MÁGICA — routes/seed-caderno.js
   Seed inicial do Caderno da Mentalização + Gamificação.

   Banco: poolComunicacao.

   Roda 1x no boot (controlado por seed_log). Pra re-rodar, apaga
   a linha de seed_log correspondente.

   Inclui:
   - 15 prompts iniciais (perguntas guiadas pro scripting)
   - 15 afirmações iniciais (3 categorias × 5)
   - 3 áudios de foco (placeholder URLs — substituir pelos arquivos
     finais via admin assim que Renato subir no Cloudinary)
   - 30 entradas em gam_premios_config (mensal 1-30 + bônus 7/15/30)
   - 3 entradas adicionais (trimestral 60, 90; ciclo fechado mensal)
   - 2 entradas (ofensiva rápida 3, 7)
   - 3 entradas (ranking mensal top_1 / top_2_3 / top_4_10)
   - 4 missões exemplo (1 por jornada + 1 universal)

   Valores são placeholders. Renato edita TUDO pelo admin.
   ============================================================ */

const { poolComunicacao } = require('../db');

// ── PROMPTS (15) ──────────────────────────────────────────
const PROMPTS_INICIAIS = [
  { texto: 'Qual sentimento você quer materializar hoje?', categoria: 'sentimentos' },
  { texto: 'Descreva como será o seu dia ideal, do despertar até a noite.', categoria: 'visualizacao' },
  { texto: 'Que pessoa você está se tornando? Escreva como se já fosse.', categoria: 'identidade' },
  { texto: 'O que está pronto pra entrar na sua vida agora?', categoria: 'manifestacao' },
  { texto: 'Pelo que você é mais grata neste momento?', categoria: 'gratidao' },
  { texto: 'Escreva uma cena do seu futuro como se ela já tivesse acontecido.', categoria: 'visualizacao' },
  { texto: 'Que crença antiga você está pronta pra soltar hoje?', categoria: 'reprogramacao' },
  { texto: 'Como você se sente sabendo que tudo já está conspirando a seu favor?', categoria: 'sentimentos' },
  { texto: 'Que verdade sobre você o universo está confirmando agora?', categoria: 'identidade' },
  { texto: 'Descreva a versão mais próspera de você no detalhe.', categoria: 'identidade' },
  { texto: 'Qual é a maior bênção que você quer receber esta semana?', categoria: 'manifestacao' },
  { texto: 'Liste 3 sinais de que o seu desejo já está se materializando.', categoria: 'gratidao' },
  { texto: 'O que você diria pra sua versão de 1 ano atrás hoje?', categoria: 'reprogramacao' },
  { texto: 'Como é o seu lar dos sonhos? Descreva cada cômodo.', categoria: 'visualizacao' },
  { texto: 'Que abundância você está pronta pra receber sem culpa?', categoria: 'manifestacao' },
];

// ── AFIRMAÇÕES (15: prosperidade, autoestima, relacionamentos) ──
const AFIRMACOES_INICIAIS = [
  // Prosperidade financeira (5)
  { texto: 'Sou um canal aberto pra abundância infinita do universo.', categoria: 'prosperidade' },
  { texto: 'O dinheiro flui pra mim de forma constante e crescente.', categoria: 'prosperidade' },
  { texto: 'Eu mereço prosperar em todas as áreas da minha vida.', categoria: 'prosperidade' },
  { texto: 'Quanto mais eu recebo, mais eu posso compartilhar.', categoria: 'prosperidade' },
  { texto: 'A riqueza é meu direito divino e eu a aceito agora.', categoria: 'prosperidade' },
  // Autoestima (5)
  { texto: 'Eu sou inteira, completa e suficiente exatamente como sou.', categoria: 'autoestima' },
  { texto: 'Meu valor não depende da opinião de ninguém.', categoria: 'autoestima' },
  { texto: 'Eu confio na minha sabedoria interior.', categoria: 'autoestima' },
  { texto: 'Eu sou amada e aceita pelo simples fato de existir.', categoria: 'autoestima' },
  { texto: 'Cada dia eu me torno uma versão mais bonita de mim mesma.', categoria: 'autoestima' },
  // Relacionamentos (5)
  { texto: 'Eu atraio pessoas que enxergam e celebram minha luz.', categoria: 'relacionamentos' },
  { texto: 'Todos os meus relacionamentos são saudáveis e amorosos.', categoria: 'relacionamentos' },
  { texto: 'Eu sou digna de receber amor verdadeiro e profundo.', categoria: 'relacionamentos' },
  { texto: 'As conexões certas chegam até mim no tempo certo.', categoria: 'relacionamentos' },
  { texto: 'Eu amo e sou amada em abundância.', categoria: 'relacionamentos' },
];

// ── ÁUDIOS DE FOCO (3 — placeholders YouTube/SoundCloud) ──
// IMPORTANTE: estas URLs são EXEMPLO. Renato vai trocar pelos arquivos
// finais (próprios ou licenciados) via /admin → Caderno → Áudios.
const AUDIOS_INICIAIS = [
  {
    titulo: '432 Hz — Frequência da Prosperidade',
    tipo: 'hz',
    url: 'https://www.youtube.com/embed/HEXWRTEbj1I',
    duracao_seg: 3600,
    ordem: 1,
  },
  {
    titulo: 'Ruído Branco Suave — Foco Profundo',
    tipo: 'branco',
    url: 'https://www.youtube.com/embed/nMfPqeZjc2c',
    duracao_seg: 3600,
    ordem: 2,
  },
  {
    titulo: 'Binaural 528 Hz — Cura e Manifestação',
    tipo: 'binaural',
    url: 'https://www.youtube.com/embed/Ujr2MqDgFNo',
    duracao_seg: 3600,
    ordem: 3,
  },
];

// ── CONFIG DE PRÊMIOS — STREAK MENSAL (30 dias) ──
// Dias 1-6 e 8-14 e 16-29: 1 semente. Bônus em 7, 15, 30.
function montarConfigStreakMensal() {
  const linhas = [];
  for (let d = 1; d <= 30; d++) {
    let sementes = 1;
    let rotulo = `Dia ${d} da ofensiva mensal`;
    if (d === 7)  { sementes = 5;  rotulo = '🌟 7 dias de ofensiva — primeiro marco'; }
    if (d === 15) { sementes = 15; rotulo = '🌟 15 dias de ofensiva — meio do caminho'; }
    if (d === 30) { sementes = 50; rotulo = '🏆 Prêmio máximo — ciclo de 30 dias completo!'; }
    linhas.push({
      tipo: 'streak_30', marco: `dia_${d}`, sementes, rotulo,
    });
  }
  return linhas;
}

// ── CONFIG DE PRÊMIOS — STREAK TRIMESTRAL ──
const STREAK_TRIMESTRAL = [
  { tipo: 'streak_90', marco: 'dia_60', sementes: 100, rotulo: '🌟 60 dias trimestral — manter o ritmo' },
  { tipo: 'streak_90', marco: 'dia_90', sementes: 250, rotulo: '🏆 90 dias trimestral — disciplina máxima' },
];

// ── CONFIG DE PRÊMIOS — CICLO FECHADO ──
const CICLO_FECHADO = [
  { tipo: 'ciclo_fechado', marco: 'mensal', sementes: 30,
    rotulo: '✨ Bônus por fechar o ciclo mensal completo',
    descricao: 'Prêmio garantido a quem completou os 30 marcos do ciclo.' },
];

// ── CONFIG DE PRÊMIOS — OFENSIVA RÁPIDA ──
const OFENSIVA_RAPIDA = [
  { tipo: 'rapida', marco: 'consecutivo_3', sementes: 3,
    rotulo: '⚡ 3 dias seguidos — pegando ritmo' },
  { tipo: 'rapida', marco: 'consecutivo_7', sementes: 10,
    rotulo: '⚡ 7 dias seguidos — uma semana inteira' },
];

// ── CONFIG DE PRÊMIOS — RANKING MENSAL ──
const RANKING_MENSAL = [
  { tipo: 'ranking_mensal', marco: 'top_1',    sementes: 200,
    rotulo: '👑 Top 1 do mês — rainha da consistência' },
  { tipo: 'ranking_mensal', marco: 'top_2_3',  sementes: 100,
    rotulo: '🥈 Top 2 e 3 do mês' },
  { tipo: 'ranking_mensal', marco: 'top_4_10', sementes: 50,
    rotulo: '🌟 Top 4 a 10 do mês' },
];

// ── MISSÕES INICIAIS ──
const MISSOES_INICIAIS = [
  {
    slug: 'caderno_primeira_escrita',
    titulo: 'Sua primeira escrita no Caderno',
    descricao: 'Abra o Caderno da Mentalização e escreva sua primeira mensagem.',
    jornada_slug: null, // todas as jornadas
    tipo: 'jornada',
    alvo_tipo: 'caderno_escrita',
    alvo_qtd: 1,
    sementes: 5,
    prioridade: 1,
  },
  {
    slug: 'caderno_7_escritas',
    titulo: 'Escreva 7 vezes no Caderno',
    descricao: 'Construa o hábito da escrita criativa. Vale qualquer dia.',
    jornada_slug: null,
    tipo: 'jornada',
    alvo_tipo: 'caderno_escrita',
    alvo_qtd: 7,
    sementes: 15,
    prioridade: 5,
  },
  {
    slug: 'tesouro_3_resgates',
    titulo: 'Resgate 3 tesouros do Baú da Su',
    descricao: 'Visite o Baú do Tesouro 3 dias diferentes e resgate.',
    jornada_slug: null,
    tipo: 'jornada',
    alvo_tipo: 'tesouro_resgatado',
    alvo_qtd: 3,
    sementes: 10,
    prioridade: 10,
  },
  {
    slug: 'caderno_hoje',
    titulo: 'Escreva no Caderno hoje',
    descricao: 'Missão relâmpago — vale só hoje.',
    jornada_slug: null,
    tipo: 'diaria_relampago',
    alvo_tipo: 'caderno_escrita',
    alvo_qtd: 1,
    sementes: 2,
    prioridade: 1,
  },
];

// ── EXECUÇÃO DO SEED ──────────────────────────────────────

async function seedCadernoEGamificacao() {
  const SEED_KEY = 'caderno_gamificacao_v1';

  const checkR = await poolComunicacao.query(
    `SELECT 1 FROM seed_log WHERE seed_key = $1`, [SEED_KEY]
  );
  if (checkR.rows[0]) {
    return { ja_rodou: true };
  }

  const client = await poolComunicacao.connect();
  try {
    await client.query('BEGIN');

    // Prompts
    let promptsIns = 0;
    for (let i = 0; i < PROMPTS_INICIAIS.length; i++) {
      const p = PROMPTS_INICIAIS[i];
      const r = await client.query(
        `INSERT INTO caderno_prompts (texto, categoria, ordem)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [p.texto, p.categoria, i + 1]
      );
      if (r.rowCount > 0) promptsIns++;
    }

    // Afirmações
    let afirmacoesIns = 0;
    for (let i = 0; i < AFIRMACOES_INICIAIS.length; i++) {
      const a = AFIRMACOES_INICIAIS[i];
      const r = await client.query(
        `INSERT INTO caderno_afirmacoes (texto, categoria, ordem)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [a.texto, a.categoria, i + 1]
      );
      if (r.rowCount > 0) afirmacoesIns++;
    }

    // Áudios
    let audiosIns = 0;
    for (const a of AUDIOS_INICIAIS) {
      const r = await client.query(
        `INSERT INTO caderno_audios_foco (titulo, tipo, url, duracao_seg, ordem)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [a.titulo, a.tipo, a.url, a.duracao_seg, a.ordem]
      );
      if (r.rowCount > 0) audiosIns++;
    }

    // Config de prêmios (todos os tipos)
    const todosPremios = [
      ...montarConfigStreakMensal(),
      ...STREAK_TRIMESTRAL,
      ...CICLO_FECHADO,
      ...OFENSIVA_RAPIDA,
      ...RANKING_MENSAL,
    ];
    let premiosIns = 0;
    for (const p of todosPremios) {
      const r = await client.query(
        `INSERT INTO gam_premios_config (tipo, marco, sementes, rotulo, descricao)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tipo, marco) DO NOTHING
         RETURNING id`,
        [p.tipo, p.marco, p.sementes, p.rotulo, p.descricao || null]
      );
      if (r.rowCount > 0) premiosIns++;
    }

    // Missões
    let missoesIns = 0;
    for (const m of MISSOES_INICIAIS) {
      const r = await client.query(
        `INSERT INTO gam_missoes
           (slug, titulo, descricao, jornada_slug, tipo, alvo_tipo, alvo_qtd, sementes, prioridade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [m.slug, m.titulo, m.descricao, m.jornada_slug, m.tipo, m.alvo_tipo, m.alvo_qtd, m.sementes, m.prioridade]
      );
      if (r.rowCount > 0) missoesIns++;
    }

    // Marca como rodado
    await client.query(
      `INSERT INTO seed_log (seed_key) VALUES ($1) ON CONFLICT DO NOTHING`,
      [SEED_KEY]
    );

    await client.query('COMMIT');
    console.log(`✅ Seed Caderno+Gamificação: ${promptsIns} prompts, ${afirmacoesIns} afirmações, ${audiosIns} áudios, ${premiosIns} prêmios, ${missoesIns} missões`);
    return {
      ok: true,
      prompts: promptsIns,
      afirmacoes: afirmacoesIns,
      audios: audiosIns,
      premios: premiosIns,
      missoes: missoesIns,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro no seed Caderno+Gamificação:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { seedCadernoEGamificacao };
