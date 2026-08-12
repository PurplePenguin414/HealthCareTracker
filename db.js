const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const db = new Database(path.join(__dirname, 'data', 'healthcare.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('therapy','dietitian','doctor','other')),
  provider_name TEXT,
  appointment_date TEXT NOT NULL,        -- ISO date
  appointment_time TEXT,                 -- HH:MM, optional
  location TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','completed','cancelled')),
  notes TEXT,                            -- free-form notes
  reminder_enabled INTEGER NOT NULL DEFAULT 1,
  next_appointment_id INTEGER,           -- optional link to a follow-up appointment
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (next_appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);

-- Type-specific structured fields, one row per appointment, only the
-- relevant columns for that appointment's type get populated.
CREATE TABLE IF NOT EXISTS appointment_details (
  appointment_id INTEGER PRIMARY KEY,

  -- Therapy/EMDR
  topics_covered TEXT,
  homework_assigned TEXT,
  target_memory TEXT,

  -- Dietitian
  meal_plan_changes TEXT,
  goals_discussed TEXT,
  measurements TEXT,

  -- Doctor
  reason_for_visit TEXT,
  diagnosis_findings TEXT,
  prescriptions_referrals TEXT,
  follow_up_needed TEXT,

  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

-- "Other" tab custom key/value fields (flexible, user-labeled per entry)
CREATE TABLE IF NOT EXISTS appointment_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL,
  field_label TEXT NOT NULL,
  field_value TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL,
  filename TEXT NOT NULL,        -- stored filename on disk
  original_name TEXT NOT NULL,   -- user-facing name
  mime_type TEXT,
  size_bytes INTEGER,
  uploaded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
);

-- Therapy-only EMDR question bank / prep checklist
CREATE TABLE IF NOT EXISTS question_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,     -- soft-hide instead of delete
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-appointment checked state of question bank items (for prep view history)
CREATE TABLE IF NOT EXISTS appointment_question_checks (
  appointment_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (appointment_id, question_id),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES question_bank(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appointments_type ON appointments(type);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
`);

// Seed a default user only if none exists yet (username/password set via env on first run)
function ensureDefaultUser() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c === 0) {
    const username = process.env.DEFAULT_USERNAME || 'megan';
    const password = process.env.DEFAULT_PASSWORD || 'changeme';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Created default user "${username}" — CHANGE THIS PASSWORD after first login.`);
  }
}
ensureDefaultUser();

module.exports = db;
