require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db');
const { startReminderScheduler } = require('./reminders');

const app = express();
const PORT = process.env.PORT || 3040;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    httpOnly: true
  }
}));

// ---- Auth middleware ----
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

// ---- Auth routes ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  res.json({ authenticated: false });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true });
});

// ---- Protected page routes ----
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manual trigger to test the Discord reminder webhook without waiting for the daily cron
app.post('/api/test-reminder', requireAuth, (req, res) => {
  const { checkAndSendReminders } = require('./reminders');
  checkAndSendReminders();
  res.json({ success: true, message: 'Reminder check triggered — check Discord (if any appointments match lead days) or server logs.' });
});

// ---- API route groups (mounted below, built out next) ----
app.use('/api/appointments', requireAuth, require('./routes/appointments'));
app.use('/api/questions', requireAuth, require('./routes/questions'));
app.use('/api/attachments', requireAuth, require('./routes/attachments'));

app.listen(PORT, () => {
  console.log(`HealthCareTracker running on port ${PORT}`);
  startReminderScheduler();
});
