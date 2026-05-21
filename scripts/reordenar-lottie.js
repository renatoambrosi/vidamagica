/* Reordena as camadas do treasure-chest.json:
   - Rays 02 (luzes) sobe pra ficar NA FRENTE da tampa (Group 7)
   - Box bottom (base) também sobe pra ficar NA FRENTE dos Rays, garantindo
     que a parte inferior dos raios fique escondida atrás da base.

   Ordem final (do mais à frente pro mais atrás):
     Sparkles (0-3) → Box bottom → Rays 02 → Group 7 (tampa interna) →
     Dollar Coins → Shdow → Layer 30 (tampa fechada inicial) → Layer 4 (tampa traseira)

   Faz backup do arquivo original antes de sobrescrever. */

const fs = require('fs');
const path = require('path');

const arquivo = path.join(__dirname, '..', 'public', 'assets', 'treasure-chest.json');
const backup = path.join(__dirname, '..', 'public', 'assets', 'treasure-chest.original.json');

// Backup só se ainda não existir (preserva o original verdadeiro)
if (!fs.existsSync(backup)) {
  fs.copyFileSync(arquivo, backup);
  console.log(`✓ Backup criado: treasure-chest.original.json`);
}

const lottie = JSON.parse(fs.readFileSync(arquivo, 'utf8'));

// Identifica as camadas pelos nomes que vimos na análise
function acharIndice(nome) {
  return lottie.layers.findIndex(l => l.nm === nome);
}

const idxRays = acharIndice('Rays 02');
const idxBase = acharIndice('Box bottom');
const idxGroup7 = acharIndice('Group 7');

console.log(`\nAntes da reordenação:`);
lottie.layers.forEach((l, i) => console.log(`  ${i}: ${l.nm}`));

console.log(`\n  Rays 02 está em ${idxRays}`);
console.log(`  Box bottom está em ${idxBase}`);
console.log(`  Group 7 está em ${idxGroup7}`);

if (idxRays === -1 || idxBase === -1 || idxGroup7 === -1) {
  console.error('Não achei uma das camadas críticas. Aborta.');
  process.exit(1);
}

// Remove Rays 02 e Box bottom da posição atual; vamos reinserir antes de Group 7
const rays = lottie.layers.splice(idxRays, 1)[0];
// Após o splice, recalcular o índice de Box bottom (pode ter mudado)
const novoIdxBase = lottie.layers.findIndex(l => l.nm === 'Box bottom');
const base = lottie.layers.splice(novoIdxBase, 1)[0];

// Agora insere os dois antes de Group 7
const novoIdxGroup7 = lottie.layers.findIndex(l => l.nm === 'Group 7');
// Ordem desejada: base PRIMEIRO (renderiza por cima dos raios) → raios DEPOIS → Group 7
// No array Bodymovin: primeira posição = mais à frente. Então base vai antes (índice menor).
lottie.layers.splice(novoIdxGroup7, 0, base, rays);

console.log(`\nDepois da reordenação:`);
lottie.layers.forEach((l, i) => console.log(`  ${i}: ${l.nm}`));

fs.writeFileSync(arquivo, JSON.stringify(lottie));
console.log(`\n✓ Arquivo salvo: treasure-chest.json (${Math.round(fs.statSync(arquivo).size / 1024)}KB)`);
console.log(`✓ Pra reverter: copiar de volta treasure-chest.original.json`);
