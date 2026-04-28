const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const name = `${Date.now()}-${safe}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20 GB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|mkv|webm|mov|avi)$/i;
    cb(null, allowed.test(file.originalname));
  },
});

app.use(express.static(path.join(__dirname, 'public')));

// Upload
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo inválido ou muito grande' });
  res.json({ filename: req.file.filename, originalname: req.file.originalname });
});

// Lista de vídeos
app.get('/videos', (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter(f => /\.(mp4|mkv|webm|mov|avi)$/i.test(f))
    .map(f => {
      const stat = fs.statSync(path.join(UPLOADS_DIR, f));
      return { filename: f, size: stat.size, date: stat.mtime };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(files);
});

// Delete vídeo
app.delete('/videos/:filename', (req, res) => {
  const file = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Não encontrado' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// Streaming com byte-range (essencial para vídeos grandes)
app.get('/stream/:filename', (req, res) => {
  const file = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).send('Não encontrado');

  const stat = fs.statSync(file);
  const total = stat.size;
  const range = req.headers.range;

  const ext = path.extname(file).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
  };
  const contentType = mimeTypes[ext] || 'video/mp4';

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 10 * 1024 * 1024 - 1, total - 1);
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(file).pipe(res);
  }
});

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
