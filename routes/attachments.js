const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'text/plain'
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, PNG, JPEG, WEBP, HEIC, TXT'));
  }
});

// POST /api/attachments/:appointmentId  (multipart, field name "file")
router.post('/:appointmentId', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const appt = db.prepare('SELECT id FROM appointments WHERE id = ?').get(req.params.appointmentId);
    if (!appt) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const result = db.prepare(`
      INSERT INTO attachments (appointment_id, filename, original_name, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?)
    `).run(appt.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);

    res.status(201).json(db.prepare('SELECT id, original_name, mime_type, size_bytes, uploaded_at FROM attachments WHERE id = ?').get(result.lastInsertRowid));
  });
});

// GET /api/attachments/file/:id  (download/view)
router.get('/file/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(UPLOAD_DIR, att.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
  res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${att.original_name}"`);
  res.sendFile(filePath);
});

// DELETE /api/attachments/:id
router.delete('/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(UPLOAD_DIR, att.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});

module.exports = router;
