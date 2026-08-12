const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/questions  (active only by default)
router.get('/', (req, res) => {
  const includeInactive = req.query.all === 'true';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM question_bank ORDER BY sort_order, id').all()
    : db.prepare('SELECT * FROM question_bank WHERE active = 1 ORDER BY sort_order, id').all();
  res.json(rows);
});

// POST /api/questions  { question_text }
router.post('/', (req, res) => {
  const { question_text } = req.body;
  if (!question_text || !question_text.trim()) {
    return res.status(400).json({ error: 'question_text is required' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM question_bank').get().m;
  const result = db.prepare('INSERT INTO question_bank (question_text, sort_order) VALUES (?, ?)')
    .run(question_text.trim(), maxOrder + 1);
  res.status(201).json(db.prepare('SELECT * FROM question_bank WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/questions/:id  { question_text?, active?, sort_order? }
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM question_bank WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { question_text, active, sort_order } = req.body;
  db.prepare(`
    UPDATE question_bank SET
      question_text = ?, active = ?, sort_order = ?
    WHERE id = ?
  `).run(
    question_text ?? existing.question_text,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    sort_order ?? existing.sort_order,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM question_bank WHERE id = ?').get(req.params.id));
});

// DELETE /api/questions/:id  (hard delete — use PUT active:false to soft-hide instead)
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM question_bank WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
