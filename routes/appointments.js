const express = require('express');
const router = express.Router();
const db = require('../db');

const DETAIL_FIELDS_BY_TYPE = {
  therapy: ['topics_covered', 'homework_assigned', 'target_memory'],
  dietitian: ['meal_plan_changes', 'goals_discussed', 'measurements'],
  doctor: ['reason_for_visit', 'diagnosis_findings', 'prescriptions_referrals', 'follow_up_needed'],
  other: [] // handled via appointment_custom_fields instead
};

function getFullAppointment(id) {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) return null;

  const detailFields = DETAIL_FIELDS_BY_TYPE[appt.type] || [];
  let details = {};
  if (detailFields.length) {
    const row = db.prepare('SELECT * FROM appointment_details WHERE appointment_id = ?').get(id);
    if (row) {
      detailFields.forEach(f => { details[f] = row[f]; });
    }
  }

  const customFields = appt.type === 'other'
    ? db.prepare('SELECT id, field_label, field_value, sort_order FROM appointment_custom_fields WHERE appointment_id = ? ORDER BY sort_order, id').all(id)
    : [];

  const attachments = db.prepare('SELECT id, original_name, mime_type, size_bytes, uploaded_at FROM attachments WHERE appointment_id = ? ORDER BY uploaded_at').all(id);

  let questionChecks = [];
  if (appt.type === 'therapy') {
    questionChecks = db.prepare(`
      SELECT qb.id AS question_id, qb.question_text, COALESCE(aqc.checked, 0) AS checked
      FROM question_bank qb
      LEFT JOIN appointment_question_checks aqc
        ON aqc.question_id = qb.id AND aqc.appointment_id = ?
      WHERE qb.active = 1
      ORDER BY qb.sort_order, qb.id
    `).all(id);
  }

  return { ...appt, details, customFields, attachments, questionChecks };
}

// GET /api/appointments?type=therapy&status=upcoming
router.get('/', (req, res) => {
  const { type, status } = req.query;
  let query = 'SELECT * FROM appointments WHERE 1=1';
  const params = [];
  if (type) { query += ' AND type = ?'; params.push(type); }
  if (status) { query += ' AND status = ?'; params.push(status); }
  query += ' ORDER BY appointment_date DESC, appointment_time DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/appointments/history/:type  (last 5 days only, most recent first)
router.get('/history/:type', (req, res) => {
  const { type } = req.params;
  if (!DETAIL_FIELDS_BY_TYPE.hasOwnProperty(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  const rows = db.prepare(`
    SELECT * FROM appointments
    WHERE type = ? AND status = 'completed'
      AND appointment_date >= date('now', '-5 days')
      AND appointment_date <= date('now')
    ORDER BY appointment_date DESC, appointment_time DESC
  `).all(type);
  res.json(rows.map(r => getFullAppointment(r.id)));
});

// GET /api/appointments/:id
router.get('/:id', (req, res) => {
  const appt = getFullAppointment(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  res.json(appt);
});

// POST /api/appointments
router.post('/', (req, res) => {
  const {
    type, provider_name, appointment_date, appointment_time,
    location, status, notes, reminder_enabled,
    details, customFields
  } = req.body;

  if (!type || !DETAIL_FIELDS_BY_TYPE.hasOwnProperty(type)) {
    return res.status(400).json({ error: 'Invalid or missing appointment type' });
  }
  if (!appointment_date) {
    return res.status(400).json({ error: 'appointment_date is required' });
  }

  const insertAppt = db.prepare(`
    INSERT INTO appointments (type, provider_name, appointment_date, appointment_time, location, status, notes, reminder_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insertAppt.run(
    type,
    provider_name || null,
    appointment_date,
    appointment_time || null,
    location || null,
    status || 'upcoming',
    notes || null,
    reminder_enabled === false ? 0 : 1
  );
  const apptId = result.lastInsertRowid;

  const detailFields = DETAIL_FIELDS_BY_TYPE[type];
  if (detailFields.length && details) {
    const cols = detailFields.filter(f => details[f] !== undefined);
    if (cols.length) {
      const placeholders = cols.map(() => '?').join(', ');
      const colNames = cols.join(', ');
      db.prepare(`INSERT INTO appointment_details (appointment_id, ${colNames}) VALUES (?, ${placeholders})`)
        .run(apptId, ...cols.map(c => details[c]));
    }
  }

  if (type === 'other' && Array.isArray(customFields)) {
    const insertField = db.prepare('INSERT INTO appointment_custom_fields (appointment_id, field_label, field_value, sort_order) VALUES (?, ?, ?, ?)');
    customFields.forEach((f, idx) => {
      insertField.run(apptId, f.field_label, f.field_value || null, idx);
    });
  }

  res.status(201).json(getFullAppointment(apptId));
});

// PUT /api/appointments/:id
router.put('/:id', (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    provider_name, appointment_date, appointment_time,
    location, status, notes, reminder_enabled,
    details, customFields
  } = req.body;

  db.prepare(`
    UPDATE appointments SET
      provider_name = ?, appointment_date = ?, appointment_time = ?,
      location = ?, status = ?, notes = ?, reminder_enabled = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    provider_name ?? existing.provider_name,
    appointment_date ?? existing.appointment_date,
    appointment_time ?? existing.appointment_time,
    location ?? existing.location,
    status ?? existing.status,
    notes ?? existing.notes,
    reminder_enabled === false ? 0 : (reminder_enabled === true ? 1 : existing.reminder_enabled),
    id
  );

  const detailFields = DETAIL_FIELDS_BY_TYPE[existing.type];
  if (detailFields.length && details) {
    const cols = detailFields.filter(f => details[f] !== undefined);
    if (cols.length) {
      const setClause = cols.map(c => `${c} = ?`).join(', ');
      const upsert = db.prepare(`
        INSERT INTO appointment_details (appointment_id, ${cols.join(', ')})
        VALUES (?, ${cols.map(() => '?').join(', ')})
        ON CONFLICT(appointment_id) DO UPDATE SET ${setClause}
      `);
      upsert.run(id, ...cols.map(c => details[c]), ...cols.map(c => details[c]));
    }
  }

  if (existing.type === 'other' && Array.isArray(customFields)) {
    db.prepare('DELETE FROM appointment_custom_fields WHERE appointment_id = ?').run(id);
    const insertField = db.prepare('INSERT INTO appointment_custom_fields (appointment_id, field_label, field_value, sort_order) VALUES (?, ?, ?, ?)');
    customFields.forEach((f, idx) => {
      insertField.run(id, f.field_label, f.field_value || null, idx);
    });
  }

  res.json(getFullAppointment(id));
});

// PUT /api/appointments/:id/question-checks  { question_id: boolean, ... }
router.put('/:id/question-checks', (req, res) => {
  const id = req.params.id;
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) return res.status(404).json({ error: 'Not found' });
  if (appt.type !== 'therapy') return res.status(400).json({ error: 'Question checks only apply to therapy appointments' });

  const checks = req.body; // { "3": true, "5": false }
  const upsert = db.prepare(`
    INSERT INTO appointment_question_checks (appointment_id, question_id, checked)
    VALUES (?, ?, ?)
    ON CONFLICT(appointment_id, question_id) DO UPDATE SET checked = excluded.checked
  `);
  Object.entries(checks).forEach(([qId, checked]) => {
    upsert.run(id, qId, checked ? 1 : 0);
  });

  res.json(getFullAppointment(id));
});

// DELETE /api/appointments/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
