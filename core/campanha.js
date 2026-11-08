/* ============================================================
   VIDA MÁGICA — core/campanha.js
   Campanhas do site, ligadas pelo admin (aba Campanhas).
   Hoje só existe a Black November.

   Banco: poolComunicacao, tabela `config`, chave 'campanha_black'.
   dados = { ativa: boolean, fim: ISO com fuso (ex. 2026-11-30T23:59:59-03:00) }

   Regras (Renato, 2026-11-08):
   - A Black NÃO tem preço próprio: usa a Promo ligada de cada produto.
     Produto da Black = produto com a Promo ligada (aba Produtos).
   - Ligada e antes da data final = no ar. Passou da data, sai sozinha.
   - Sem configuração salva ou com erro de leitura = desligada (site normal).
   - Este módulo só lê e grava a própria chave. Não mexe em preço nenhum.

   A página /black é montada aqui a partir do index.html (mesma navbar,
   relatos e rodapé), com as ofertas de public/campanha/black-ofertas.html.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { poolComunicacao } = require('../db');

const CHAVE_BLACK = 'campanha_black';
const FIM_PADRAO = '2026-11-30T23:59:59-03:00';
const CACHE_MS = 30 * 1000;

let cache = null;
let cacheEm = 0;

function normalizar(dados) {
  const d = dados || {};
  const fim = typeof d.fim === 'string' && !isNaN(Date.parse(d.fim)) ? d.fim : FIM_PADRAO;
  return { ativa: d.ativa === true, fim };
}

// Configuração gravada (para o admin).
async function lerConfigBlack() {
  try {
    const r = await poolComunicacao.query(`SELECT dados FROM config WHERE chave = $1`, [CHAVE_BLACK]);
    return normalizar(r.rows[0] && r.rows[0].dados);
  } catch (e) {
    console.warn('⚠️ [campanha] falha ao ler a Black, mantendo desligada:', e.message);
    return normalizar(null);
  }
}

// Estado público: no ar só se ligada e antes da data final. Cache de 30s.
async function lerBlackNoAr() {
  if (cache && Date.now() - cacheEm < CACHE_MS) return cache;
  const c = await lerConfigBlack();
  const noAr = c.ativa && Date.now() < Date.parse(c.fim);
  cache = { ativa: noAr, nome: 'Black November', fim: c.fim };
  cacheEm = Date.now();
  return cache;
}

async function salvarConfigBlack({ ativa, fim }) {
  const dados = normalizar({ ativa, fim });
  await poolComunicacao.query(
    `INSERT INTO config (chave, dados, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave) DO UPDATE SET dados = $2, atualizado_em = NOW()`,
    [CHAVE_BLACK, JSON.stringify(dados)]
  );
  cache = null;
  return dados;
}

// ── Página /black ──
const PUBLIC = path.join(__dirname, '..', 'public');

function montarPaginaBlack() {
  let h = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const ofertas = fs.readFileSync(path.join(PUBLIC, 'campanha', 'black-ofertas.html'), 'utf8');
  const iniHero = h.indexOf('<section class="hero-home">');
  const iniRelatos = h.indexOf('<section class="validacao-social" id="relatos">');
  const iniNumeros = h.indexOf('<section class="validacao-social" id="numeros">');
  const iniRodape = h.indexOf('<footer class="rodape">');
  if ([iniHero, iniRelatos, iniNumeros, iniRodape].some((i) => i < 0)) {
    throw new Error('home mudou: marcadores da página /black não encontrados');
  }
  h = h.slice(0, iniHero) + ofertas + '\n\n  ' + h.slice(iniRelatos, iniNumeros) + h.slice(iniRodape);
  return h
    .replace(/<title>[^<]*<\/title>/, '<title>Black November | Vida Mágica - Suellen Seragi</title>')
    .replace('<script src="/utm.js" data-padrao="VM"></script>', '<script src="/utm.js" data-padrao="VmBlack" data-conteudo="black"></script>')
    .replace('<script src="/campanha/campanha.js" data-pagina="home" defer></script>', '<script src="/campanha/campanha.js" data-pagina="black" defer></script>')
    .replace('<body class="lp-index">', '<body class="lp-index pagina-black">')
    .replace('href="#quem-somos"', 'href="/#quem-somos"')
    .replace('href="#numeros"', 'href="/#numeros"');
}

module.exports = {
  lerConfigBlack,
  lerBlackNoAr,
  salvarConfigBlack,
  montarPaginaBlack,
};
