/* ============================================================
   VIDA MÁGICA — routes/upload.js
   Upload de áudio e imagem via Cloudinary.

   Autenticação: aceita JWT da ALUNA (chat -> Suellen) OU
                 JWT do PAINEL ATENDIMENTO (Suellen -> aluna).
   Pra outros endpoints internos do admin, criar rota separada.

   Endpoints:
     POST /api/upload/imagem  (multipart, campo 'imagem')
     POST /api/upload/audio   (multipart, campo 'audio')
   ============================================================ */

const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../middleware/autenticar');
const { buscarSessaoAdmin } = require('../core/admins');

// Configura Cloudinary com vars do Railway
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

/**
 * Middleware híbrido: aceita JWT da aluna OU JWT do painel atendimento.
 * Apenas verifica que o token é válido — não amarra ao escopo.
 * Quem usa o upload (chat aluna OU chat atendimento) já está autenticado
 * pelo seu próprio router antes de gerar a URL via this endpoint.
 */
async function autenticarUpload(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  const token = auth.slice(7).trim();
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sessão expirada', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }

  // Caso 1: token de painel admin/atendimento — valida sessão no banco
  if (payload.role === 'admin') {
    if (!payload.sid) return res.status(401).json({ error: 'Token inválido (sem sessão)' });
    try {
      const sessao = await buscarSessaoAdmin(payload.sid);
      if (!sessao) return res.status(401).json({ error: 'Sessão revogada ou expirada', code: 'SESSION_EXPIRED' });
      req.upload_origem = `painel:${payload.escopo}`;
      return next();
    } catch (err) {
      console.error('❌ autenticarUpload (painel):', err.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  // Caso 2: token de aluna — payload tem sub (id do usuario), tel, plano, nome
  if (payload.sub && payload.tel) {
    req.upload_origem = 'aluna';
    req.usuario = payload;
    return next();
  }

  return res.status(403).json({ error: 'Token sem permissão para upload' });
}

router.post('/audio', autenticarUpload, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const result = await uploadBuffer(req.file.buffer, {
      resource_type: 'video',
      folder: 'vidamagica/audio',
      format: 'mp3',
      transformation: [{ quality: 'auto' }],
    });
    res.json({
      url: result.secure_url,
      duracao: Math.round(result.duration || 0),
      public_id: result.public_id,
    });
  } catch (err) {
    console.error('[Upload] audio:', err.message);
    res.status(500).json({ error: 'Erro ao fazer upload do áudio' });
  }
});

router.post('/imagem', autenticarUpload, upload.single('imagem'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const result = await uploadBuffer(req.file.buffer, {
      resource_type: 'image',
      folder: 'vidamagica/imagens',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    console.error('[Upload] imagem:', err.message);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
  }
});

module.exports = router;
