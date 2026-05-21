/* Análise temporária do treasure-chest.json — lista cada camada (layer)
   com índice, nome, tipo e cor primária pra identificar quem é "luz" e
   quem é "tampa" antes de reordenar. */

const fs = require('fs');
const path = require('path');

const arquivo = path.join(__dirname, '..', 'public', 'assets', 'treasure-chest.json');
const lottie = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

const TIPOS = { 0: 'precomp', 1: 'solid', 2: 'image', 3: 'null', 4: 'shape', 5: 'text', 6: 'audio' };

function corDeShape(shape) {
  // Procura recursivamente uma cor de fill nos shapes
  if (!shape) return null;
  if (Array.isArray(shape)) {
    for (const s of shape) {
      const c = corDeShape(s);
      if (c) return c;
    }
    return null;
  }
  if (shape.ty === 'fl' && shape.c && shape.c.k) {
    const rgb = shape.c.k;
    if (Array.isArray(rgb) && rgb.length >= 3) {
      const [r, g, b] = rgb.map(v => Math.round(v * 255));
      return `rgb(${r},${g},${b})`;
    }
  }
  if (shape.it) return corDeShape(shape.it);
  return null;
}

function todasCoresDeShape(shape, acc = []) {
  if (!shape) return acc;
  if (Array.isArray(shape)) { for (const s of shape) todasCoresDeShape(s, acc); return acc; }
  if (shape.ty === 'fl' && shape.c && shape.c.k) {
    const rgb = shape.c.k;
    if (Array.isArray(rgb) && rgb.length >= 3) {
      const [r, g, b] = rgb.map(v => Math.round(v * 255));
      acc.push(`rgb(${r},${g},${b})`);
    }
  }
  if (shape.ty === 'st' && shape.c && shape.c.k) {
    const rgb = shape.c.k;
    if (Array.isArray(rgb) && rgb.length >= 3) {
      const [r, g, b] = rgb.map(v => Math.round(v * 255));
      acc.push(`stroke ${r},${g},${b}`);
    }
  }
  if (shape.it) todasCoresDeShape(shape.it, acc);
  return acc;
}

function posicaoLayer(layer) {
  const p = layer.ks && layer.ks.p;
  if (!p || !p.k) return '—';
  if (Array.isArray(p.k) && typeof p.k[0] === 'number') return `(${Math.round(p.k[0])}, ${Math.round(p.k[1])})`;
  return '(animada)';
}

function escalaLayer(layer) {
  const s = layer.ks && layer.ks.s;
  if (!s || !s.k) return '—';
  if (Array.isArray(s.k) && typeof s.k[0] === 'number') return `${Math.round(s.k[0])}%`;
  return '(animada)';
}

console.log(`Lottie: ${lottie.nm || '(sem nome)'}  ${lottie.w}x${lottie.h}px  fr=${lottie.fr}  total layers=${lottie.layers.length}\n`);
console.log('# ordem  ind  tipo     nome                       cor primária    posição      escala  frames');
console.log('-----------------------------------------------------------------------------------------------------');

lottie.layers.forEach((layer, idx) => {
  const tipo = TIPOS[layer.ty] || `ty=${layer.ty}`;
  const nome = (layer.nm || '').padEnd(25).slice(0, 25);
  const cor = (corDeShape(layer.shapes) || '—').padEnd(15);
  const pos = posicaoLayer(layer).padEnd(12);
  const esc = escalaLayer(layer).padEnd(7);
  const frames = `${layer.ip}→${layer.op}`;
  console.log(`${String(idx).padStart(5)}  ${String(layer.ind).padStart(3)}  ${tipo.padEnd(7)}  ${nome}  ${cor}  ${pos}  ${esc}  ${frames}`);
});

console.log('\n--- Todas as cores por layer (pra identificar amarelos/raios) ---');
lottie.layers.forEach((layer, idx) => {
  const cores = todasCoresDeShape(layer.shapes);
  if (cores.length > 0) {
    console.log(`  [${idx}] ${layer.nm || '?'}: ${[...new Set(cores)].slice(0, 5).join(', ')}`);
  }
});
