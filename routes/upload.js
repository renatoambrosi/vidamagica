/* ============================================================
   VIDA MÁGICA — routes/upload.js
   Upload de áudio e imagem via Cloudinary
   ============================================================ */

const express  = require('express');
const router   = express.Router();
const cloudinary = require('cloudinary').v2;
const multer   = require('multer');

// Configura Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer — armazena em memória (sem disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB máximo
});

// Faz upload do buffer para o Cloudinary
function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

/* ── POST /api/upload/audio ── */
router.post('/audio', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const result = await uploadBuffer(req.file.buffer, {
      resource_type: 'video', // Cloudinary usa 'video' para áudio também
      folder:        'vidamagica/audio',
      format:        'mp3',   // converte para mp3 para compatibilidade
      transformation: [{ quality: 'auto' }],
    });
    res.json({
      url:      result.secure_url,
      duracao:  Math.round(result.duration || 0),
      public_id: result.public_id,
    });
  } catch (err) {
    console.error('[Upload] audio:', err.message);
    res.status(500).json({ error: 'Erro ao fazer upload do áudio' });
  }
});

/* ── POST /api/upload/imagem ── */
router.post('/imagem', upload.single('imagem'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  try {
    const result = await uploadBuffer(req.file.buffer, {
      resource_type: 'image',
      folder:        'vidamagica/imagens',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    console.error('[Upload] imagem:', err.message);
    res.status(500).json({ error: 'Erro ao fazer upload da imagem' });
  }
});

module.exports = router;
