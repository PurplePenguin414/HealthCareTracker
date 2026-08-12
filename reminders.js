const cron = require('node-cron');
const https = require('https');
const db = require('./db');

const WEBHOOK_URL = process.env.DISCORD_APPT_WEBHOOK_URL; // separate from MedsTracker's webhook
const APP_URL = process.env.APP_URL || 'http://localhost:3040';
const LEAD_DAYS = (process.env.REMINDER_LEAD_DAYS || '1,3').split(',').map(n => parseInt(n.trim()));

const TYPE_LABELS = {
  therapy: 'Therapy / EMDR',
  dietitian: 'Dietitian',
  doctor: 'Doctor',
  other: 'Other'
};

function todayStr() {
  // America/Detroit, matches the convention used across the rest of the home lab
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' });
  const d = new Date(now);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function postToDiscord(payload) {
  if (!WEBHOOK_URL) {
    console.log('DISCORD_APPT_WEBHOOK_URL not set — skipping reminder send. Payload was:', JSON.stringify(payload));
    return;
  }
  const url = new URL(WEBHOOK_URL);
  const data = JSON.stringify(payload);
  const req = https.request({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, (res) => {
    if (res.statusCode >= 300) {
      console.error(`Discord webhook returned status ${res.statusCode}`);
    }
  });
  req.on('error', (err) => console.error('Discord webhook error:', err.message));
  req.write(data);
  req.end();
}

function buildEmbed(appt, daysUntil) {
  const label = TYPE_LABELS[appt.type] || appt.type;
  const dueText = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;

  return {
    embeds: [{
      title: `Upcoming ${label} Appointment`,
      description: `You have a ${label.toLowerCase()} appointment ${dueText}.`,
      fields: [
        { name: 'Date', value: appt.appointment_date, inline: true },
        { name: 'Time', value: appt.appointment_time || 'Not set', inline: true },
        { name: 'Provider', value: appt.provider_name || 'Not listed', inline: true },
        { name: 'Location', value: appt.location || 'Not listed', inline: false }
      ],
      url: `${APP_URL}/`,
      color: 0x4a6fa5,
      timestamp: new Date().toISOString()
    }]
  };
}

function checkAndSendReminders() {
  const today = todayStr();
  const maxLead = Math.max(...LEAD_DAYS, 0);

  // Widened window: instead of only matching an exact lead-day date, catch anything
  // from today through the furthest lead day out. Each appointment still only gets
  // reminded once per lead-day threshold it crosses (tracked via reminder_log).
  LEAD_DAYS.forEach(leadDays => {
    const targetDate = addDays(today, leadDays);
    const appts = db.prepare(`
      SELECT * FROM appointments
      WHERE appointment_date <= ? AND appointment_date >= ?
        AND status = 'upcoming' AND reminder_enabled = 1
    `).all(targetDate, today);

    appts.forEach(appt => {
      const daysUntil = daysBetween(today, appt.appointment_date);
      // Only send if this appointment's actual days-until matches a configured
      // lead day, or if we're at/past a lead day and haven't sent for it yet
      // (covers the case where the app was off on the exact lead day).
      const alreadySent = db.prepare(`
        SELECT 1 FROM reminder_log WHERE appointment_id = ? AND lead_days = ?
      `).get(appt.id, leadDays);

      if (!alreadySent && daysUntil <= leadDays) {
        postToDiscord(buildEmbed(appt, daysUntil));
        db.prepare(`
          INSERT INTO reminder_log (appointment_id, lead_days, sent_at)
          VALUES (?, ?, datetime('now'))
        `).run(appt.id, leadDays);
      }
    });
  });
}

function daysBetween(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + 'T00:00:00');
  const to = new Date(toDateStr + 'T00:00:00');
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function startReminderScheduler() {
  // Run once immediately on startup — catches anything due while the app was off
  // (e.g. laptop shut down over the exact 8am cron window).
  console.log('Running startup reminder catch-up check...');
  checkAndSendReminders();

  // Daily at 8:00 AM America/Detroit — same convention as MedsTracker
  cron.schedule('0 8 * * *', () => {
    console.log('Running appointment reminder check...');
    checkAndSendReminders();
  }, { timezone: 'America/Detroit' });

  console.log(`Reminder scheduler started (lead days: ${LEAD_DAYS.join(', ')}, timezone: America/Detroit)`);
}

module.exports = { startReminderScheduler, checkAndSendReminders };
