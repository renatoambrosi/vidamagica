/* ============================================================
   VIDA MÁGICA — Cena Three.js
   Árvore com shader de vento + sistema de folhas caindo
   ============================================================ */

import * as THREE from 'three';

// CONFIG
const ARVORE_URL = '/app/assets/arvore.webp';
const ARVORE_FALLBACK_URL = '/app/assets/arvore.png';

const VENTO = {
  intensidade: 0.012,
  velocidade: 1.2,
  frequencia: 2.5,
};

// SETUP
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
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

let camera;
function criarCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
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

// SHADER
const arvoreVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensidade;
  uniform float uVelocidade;
  uniform float uFrequencia;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float peso = smoothstep(0.25, 0.95, uv.y);
    peso = pow(peso, 1.4);
    float onda1 = sin(uTime * uVelocidade + uv.x * uFrequencia + uv.y * 1.5);
    float onda2 = sin(uTime * uVelocidade * 0.7 + uv.x * uFrequencia * 0.5) * 0.4;
    float vento = (onda1 + onda2) * peso * uIntensidade;
    pos.x += vento;
    pos.y += vento * 0.3;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const arvoreFragmentShader = /* glsl */ `
  uniform sampler2D uTextura;
  varying vec2 vUv;

  void main() {
    vec4 cor = texture2D(uTextura, vUv);
    if (cor.a < 0.01) discard;
    gl_FragColor = cor;
  }
`;

// CARREGAR ÁRVORE
const loader = new THREE.TextureLoader();
let arvoreMesh = null;
let arvoreUniforms = null;

function carregarArvore() {
  loader.load(
    ARVORE_URL,
    onTexturaCarregada,
    undefined,
    () => {
      console.warn('[Vida Mágica] WebP falhou, usando PNG');
      loader.load(ARVORE_FALLBACK_URL, onTexturaCarregada);
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

  const aspectArvore = textura.image.width / textura.image.height;
  const alturaArvore = 1.4;
  const larguraArvore = alturaArvore * aspectArvore;

  const geometria = new THREE.PlaneGeometry(larguraArvore, alturaArvore, 32, 32);

  arvoreMesh = new THREE.Mesh(geometria, material);
  arvoreMesh.position.y = -0.05;
  scene.add(arvoreMesh);

  posicionarArvore();
  console.log('[Vida Mágica] Árvore carregada e renderizando');
}

function posicionarArvore() {
  if (!arvoreMesh) return;
  const w = window.innerWidth;
  const escalaBase = w < 640 ? 0.95 : (w < 1024 ? 0.75 : 0.6);
  arvoreMesh.scale.setScalar(escalaBase);
  arvoreMesh.position.x = 0;
  arvoreMesh.position.y = w < 640 ? 0.05 : 0.0;
}

carregarArvore();

// FOLHAS
const FOLHA_COUNT = 6;
const folhas = [];

function criarFolhas() {
  for (let i = 0; i < FOLHA_COUNT; i++) {
    const geo = new THREE.PlaneGeometry(0.04, 0.04);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.85, 0.7, 0.4),
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
  folha.x = (Math.random() - 0.5) * 1.0;
  folha.y = 0.4 + Math.random() * 0.3;
  folha.vx = (Math.random() - 0.5) * 0.05;
  folha.vy = -0.04 - Math.random() * 0.03;
  folha.rot = Math.random() * Math.PI * 2;
  folha.vrot = (Math.random() - 0.5) * 1.5;
  folha.vida = 0;
  folha.vidaMax = 8 + Math.random() * 4;
  folha.mesh.visible = true;
  folha.mesh.scale.setScalar(0.7 + Math.random() * 0.5);
  const tom = 0.55 + Math.random() * 0.25;
  folha.mesh.material.color.setRGB(tom + 0.3, tom + 0.15, tom * 0.7);
}

function atualizarFolhas(dt, tempo) {
  folhas.forEach(folha => {
    if (!folha.ativo) {
      folha.proximoSpawn -= dt;
      if (folha.proximoSpawn <= 0) {
        spawnFolha(folha);
        folha.proximoSpawn =
