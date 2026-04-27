/* ============================================================
   VIDA MÁGICA — Cena Three.js
   Árvore com shader de vento + sistema de folhas caindo
   ============================================================ */

import * as THREE from 'three';

// ───────────────────────────────────────────────────────────
// CONFIG
// ───────────────────────────────────────────────────────────

const ARVORE_URL = '/public/app/assets/arvore.webp';
const ARVORE_FALLBACK_URL = '/public/app/assets/arvore.png';

// Parâmetros do vento (ajustáveis)
const VENTO = {
  intensidade: 0.012,    // amplitude do balanço (0.005 sutil — 0.025 forte)
  velocidade: 1.2,       // quão rápido oscila
  frequencia: 2.5,       // quantas ondas atravessam a árvore
};

// ───────────────────────────────────────────────────────────
// SETUP
// ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas-arvore');
if (!canvas) {
  console.error('[Vida Mágica] canvas-arvore não encontrado');
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0); // transparente

const scene = new THREE.Scene();

// Câmera ortográfica (2D-like)
let camera;
function criarCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  // unidades do mundo: 2 unidades de altura visível
  const altura = 2;
  camera = new THREE.OrthographicCamera(
    -altura * aspect / 2,
     altura * aspect / 2,
     altura / 2,
    -altura / 2,
    -10, 10
  );
  camera.position.z = 1;
}
criarCamera();

// ───────────────────────────────────────────────────────────
// SHADER DA ÁRVORE — vento aplicado verticalmente (mais nas folhas, menos no tronco)
// ───────────────────────────────────────────────────────────

const arvoreVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensidade;
  uniform float uVelocidade;
  uniform float uFrequencia;

  varying vec2 vUv;

  void main() {
    vUv = uv;

    vec3 pos = position;

    // "Peso do vento": 0 na base (tronco/raízes), 1 no topo (copa)
    // uv.y vai de 0 (base) a 1 (topo)
    // suaviza com curva — o tronco quase não se mexe, a copa balança bem
    float peso = smoothstep(0.25, 0.95, uv.y);
    peso = pow(peso, 1.4);

    // Onda de vento: combinação de duas senóides com frequências diferentes
    // pra dar sensação orgânica (não periódico óbvio)
    float onda1 = sin(uTime * uVelocidade + uv.x * uFrequencia + uv.y * 1.5);
    float onda2 = sin(uTime * uVelocidade * 0.7 + uv.x * uFrequencia * 0.5) * 0.4;
    float vento = (onda1 + onda2) * peso * uIntensidade;

    // Aplica deslocamento horizontal (vento empurra pro lado)
    pos.x += vento;

    // Pequeno deslocamento vertical (folhas sobem/descem com o vento)
    pos.y += vento * 0.3;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const arvoreFragmentShader = /* glsl */ `
  uniform sampler2D uTextura;
  varying vec2 vUv;

  void main() {
    vec4 cor = texture2D(uTextura, vUv);
    // descarta pixels totalmente transparentes (otimização)
    if (cor.a < 0.01) discard;
    gl_FragColor = cor;
  }
`;

// ───────────────────────────────────────────────────────────
// CARREGAR ÁRVORE
// ───────────────────────────────────────────────────────────

const loader = new THREE.TextureLoader();
let arvoreMesh = null;
let arvoreUniforms = null;

function carregarArvore() {
  // tenta WebP primeiro, fallback PNG
  loader.load(
    ARVORE_URL,
    onTexturaCarregada,
    undefined,
    () => {
      console.warn('[Vida Mágica] WebP falhou, usando PNG');
      loader.load(ARVORE_URL.replace('.webp', '.png'), onTexturaCarregada);
    }
  );
}

function onTexturaCarregada(textura) {
  textura.minFilter = THREE.LinearFilter;
  textura.magFilter = THREE.LinearFilter;
  textura.colorSpace = THREE.SRGBColorSpace;

  arvoreUniforms = {
    uTextura:      { value: textura },
    uTime:         { value: 0 },
    uIntensidade:  { value: VENTO.intensidade },
    uVelocidade:   { value: VENTO.velocidade },
    uFrequencia:   { value: VENTO.frequencia },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: arvoreUniforms,
    vertexShader: arvoreVertexShader,
    fragmentShader: arvoreFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Geometria da árvore — plano subdividido (necessário pra deformar com shader)
  // 32x32 vertices = movimento bem suave sem custar nada
  const aspectArvore = textura.image.width / textura.image.height; // ~1.54
  const alturaArvore = 1.4;
  const larguraArvore = alturaArvore * aspectArvore;

  const geometria = new THREE.PlaneGeometry(larguraArvore, alturaArvore, 32, 32);

  arvoreMesh = new THREE.Mesh(geometria, material);
  arvoreMesh.position.y = -0.05; // ligeiramente acima do centro pra "plantar" no chão
  scene.add(arvoreMesh);

  posicionarArvore();
  console.log('[Vida Mágica] Árvore carregada e renderizando');
}

// Posiciona a árvore baseado no tamanho da tela
function posicionarArvore() {
  if (!arvoreMesh) return;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;

  // Em mobile (vertical), árvore ocupa mais % da largura
  // Em desktop, menos (deixa mais respiração)
  const escalaBase = w < 640 ? 0.95 : (w < 1024 ? 0.75 : 0.6);
  arvoreMesh.scale.setScalar(escalaBase);

  // Centraliza horizontalmente
  arvoreMesh.position.x = 0;

  // Posição vertical: a árvore tem que aparecer "abraçando" a área de cima do dashboard
  // Em mobile a tela é menor → arvore sobe um pouco; em desktop, fica mais centrada
  arvoreMesh.position.y = w < 640 ? 0.05 : 0.0;
}

carregarArvore();

// ───────────────────────────────────────────────────────────
// FOLHAS CAINDO (sistema simples de partículas)
// ───────────────────────────────────────────────────────────
// Cada folha é um pequeno plano com a textura da árvore (samplea uma região da copa)
// Solta a cada N segundos, cai com gravidade leve, balança no vento.

const FOLHA_COUNT = 6; // máximo simultâneo
const folhas = [];

function criarFolhas() {
  for (let i = 0; i < FOLHA_COUNT; i++) {
    const geo = new THREE.PlaneGeometry(0.04, 0.04);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.85, 0.7, 0.4), // tom dourado médio
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    folhas.push({
      mesh,
      ativo: false,
      x: 0, y: 0,
      vx: 0, vy: 0,
      rot: 0, vrot: 0,
      vida: 0,
      vidaMax: 0,
      proximoSpawn: Math.random() * 8 + 2,
    });
  }
}
criarFolhas();

function spawnFolha(folha) {
  folha.ativo = true;
  folha.x = (Math.random() - 0.5) * 1.0;     // posição X dentro da copa
  folha.y = 0.4 + Math.random() * 0.3;        // topo da copa
  folha.vx = (Math.random() - 0.5) * 0.05;
  folha.vy = -0.04 - Math.random() * 0.03;
  folha.rot = Math.random() * Math.PI * 2;
  folha.vrot = (Math.random() - 0.5) * 1.5;
  folha.vida = 0;
  folha.vidaMax = 8 + Math.random() * 4;     // 8-12s de queda
  folha.mesh.visible = true;
  folha.mesh.scale.setScalar(0.7 + Math.random() * 0.5);
  // Cor com leve variação dourada
  const tom = 0.55 + Math.random() * 0.25;
  folha.mesh.material.color.setRGB(tom + 0.3, tom + 0.15, tom * 0.7);
}

function atualizarFolhas(dt, tempo) {
  folhas.forEach(folha => {
    if (!folha.ativo) {
      folha.proximoSpawn -= dt;
      if (folha.proximoSpawn <= 0) {
        spawnFolha(folha);
        folha.proximoSpawn = 4 + Math.random() * 8;
      }
      return;
    }

    folha.vida += dt;
    if (folha.vida >= folha.vidaMax || folha.y < -0.7) {
      folha.ativo = false;
      folha.mesh.visible = false;
      return;
    }

    // Vento horizontal oscilante
    const ventoX = Math.sin(tempo * 0.8 + folha.y * 3) * 0.03;

    folha.x += (folha.vx + ventoX) * dt;
    folha.y += folha.vy * dt;
    folha.rot += folha.vrot * dt;

    // Fade in/out
    const fadeIn = Math.min(folha.vida / 0.5, 1);
    const fadeOut = Math.min((folha.vidaMax - folha.vida) / 1.5, 1);
    const opacidade = Math.min(fadeIn, fadeOut) * 0.85;

    folha.mesh.position.set(folha.x, folha.y, 0.1);
    folha.mesh.rotation.z = folha.rot;
    folha.mesh.material.opacity = opacidade;
  });
}

// ───────────────────────────────────────────────────────────
// LOOP DE ANIMAÇÃO
// ───────────────────────────────────────────────────────────

const clock = new THREE.Clock();
let pausado = false;

function loop() {
  if (pausado) return;

  const dt = Math.min(clock.getDelta(), 0.1); // clampa pra evitar saltos
  const tempo = clock.getElapsedTime();

  if (arvoreUniforms) {
    arvoreUniforms.uTime.value = tempo;
  }

  atualizarFolhas(dt, tempo);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ───────────────────────────────────────────────────────────
// RESIZE
// ───────────────────────────────────────────────────────────

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  criarCamera();
  posicionarArvore();
}

window.addEventListener('resize', resize);
resize();

// ───────────────────────────────────────────────────────────
// PAUSA QUANDO ABA ESCONDIDA (economia de bateria)
// ───────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pausado = true;
  } else if (pausado) {
    pausado = false;
    clock.getDelta(); // reseta delta pra não saltar
    loop();
  }
});

// Inicia
loop();

// ───────────────────────────────────────────────────────────
// API EXPORTADA — pra o app.js mexer no vento se quiser
// ───────────────────────────────────────────────────────────

window.VidaMagicaCena = {
  setVentoIntensidade: (v) => { if (arvoreUniforms) arvoreUniforms.uIntensidade.value = v; },
  setVentoVelocidade:  (v) => { if (arvoreUniforms) arvoreUniforms.uVelocidade.value = v; },
  pausar:  () => { pausado = true; },
  retomar: () => { if (pausado) { pausado = false; clock.getDelta(); loop(); } },
};
