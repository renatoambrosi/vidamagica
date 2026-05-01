/* ============================================================
   VIDA MÁGICA — routes/upload.js
   Upload de áudio e imagem via Cloudinary.

   Autenticação: JWT atendimento (autenticarAtendimento).

   Endpoints:
     POST /api/upload/imagem  (multipart, campo 'imagem')
     POST /api/upload/audio   (multipart, campo 'audio')
   ============================================================ */

const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const { autenticarAtendimento } = require('../middleware/autenticar');

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

router.post('/audio', autenticarAtendimento, upload.single('audio'), async (req, res) => {
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

router.post('/imagem', autenticarAtendimento, upload.single('imagem'), async (req, res) => {
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
