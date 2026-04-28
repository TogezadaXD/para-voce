const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 },
});

// Estado das conversões em memória
const conversions = {};

app.use(express.static(path.join(__dirname, 'public')));

// Diagnóstico
app.get('/diag', (req, res) => {
  const { execSync } = require('child_process');
  let ffmpegVersion = 'não encontrado';
  try { ffmpegVersion = execSync('ffmpeg -version 2>&1').toString().split('\n')[0]; } catch (_) {}
  res.json({
    ffmpeg: ffmpegVersion,
    uploadsDir: UPLOADS_DIR,
    uploadsDirExists: fs.existsSync(UPLOADS_DIR),
    files: fs.existsSync(UPLOADS_DIR) ? fs.readdirSync(UPLOADS_DIR) : [],
  });
});

// Upload
app.post('/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido' });
    res.json({ filename: req.file.filename, originalname: req.file.originalname });
  });
});

// Lista de vídeos
app.get('/videos', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => /\.(mp4|mkv|webm|mov|avi|m4v)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        return {
          filename: f,
          size: stat.size,
          date: stat.mtime,
          converting: conversions[f]?.status === 'converting',
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// Converter MKV → MP4 em background
app.post('/convert/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const inputFile = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(inputFile)) return res.status(404).json({ error: 'Não encontrado' });
  if (conversions[filename]?.status === 'converting') return res.json({ status: 'converting' });

  const outputFilename = filename.replace(/\.[^.]+$/, '') + '_converted.mp4';
  const outputFile = path.join(UPLOADS_DIR, outputFilename);

  conversions[filename] = { status: 'converting', output: outputFilename };

  const ffmpeg = spawn('ffmpeg', [
    '-i', inputFile,
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-preset', 'fast',
    '-movflags', '+faststart',
    '-y',
    outputFile,
  ]);

  let ffmpegErr = '';
  ffmpeg.stderr.on('data', d => { ffmpegErr += d.toString(); });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      conversions[filename] = { status: 'done', output: outputFilename };
      try { fs.unlinkSync(inputFile); } catch (_) {}
    } else {
      console.error('FFmpeg error (code', code, '):\n', ffmpegErr.slice(-2000));
      conversions[filename] = { status: 'error', log: ffmpegErr.slice(-500) };
    }
  });

  res.json({ status: 'converting', output: outputFilename });
});

// Status da conversão
app.get('/convert-status/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  res.json(conversions[filename] || { status: 'idle' });
});

// Delete vídeo
app.delete('/videos/:filename', (req, res) => {
  const file = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Não encontrado' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// Streaming com byte-range
app.get('/stream/:filename', (req, res) => {
  const file = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).send('Não encontrado');

  const stat = fs.statSync(file);
  const total = stat.size;
  const range = req.headers.range;

  const mimeTypes = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska',
    '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.m4v': 'video/mp4',
  };
  const contentType = mimeTypes[path.extname(file).toLowerCase()] || 'video/mp4';

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 10 * 1024 * 1024 - 1, total - 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
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
