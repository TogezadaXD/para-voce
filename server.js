const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function applyFaststart(filePath) {
  return new Promise((resolve) => {
    const tmp = filePath + '.faststart.mp4';
    execFile('ffmpeg', ['-i', filePath, '-c', 'copy', '-movflags', '+faststart', '-y', tmp], (err) => {
      if (err) { fs.unlink(tmp, () => {}); return resolve(); }
      fs.rename(tmp, filePath, () => resolve());
    });
  });
}

// Upload
app.post('/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido' });
    if (path.extname(req.file.filename).toLowerCase() === '.mp4') {
      await applyFaststart(path.join(UPLOADS_DIR, req.file.filename));
    }
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
        return { filename: f, size: stat.size, date: stat.mtime };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(files);
  } catch (e) {
    res.json([]);
  }
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

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  // Aplica faststart em MP4s existentes que ainda não têm moov no início
  (async () => {
    try {
      const files = fs.readdirSync(UPLOADS_DIR).filter(f => /\.mp4$/i.test(f));
      for (const f of files) {
        const filePath = path.join(UPLOADS_DIR, f);
        const buf = Buffer.alloc(8);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, 8, 0);
        fs.closeSync(fd);
        const atom = buf.slice(4).toString('ascii');
        if (atom !== 'ftyp' && atom !== 'moov') {
          console.log(`Aplicando faststart: ${f}`);
          await applyFaststart(filePath);
          console.log(`Faststart concluído: ${f}`);
        }
      }
    } catch (e) {
      console.error('Erro no faststart de startup:', e.message);
    }
  })();
});
