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

  LEAD_DAYS.forEach(leadDays => {
    const targetDate = addDays(today, leadDays);
    const appts = db.prepare(`
      SELECT * FROM appointments
      WHERE appointment_date = ? AND status = 'upcoming' AND reminder_enabled = 1
    `).all(targetDate);

    appts.forEach(appt => {
      postToDiscord(buildEmbed(appt, leadDays));
    });
  });
}

function startReminderScheduler() {
  // Daily at 8:00 AM America/Detroit — same convention as MedsTracker
  cron.schedule('0 8 * * *', () => {
    console.log('Running appointment reminder check...');
    checkAndSendReminders();
  }, { timezone: 'America/Detroit' });

  console.log(`Reminder scheduler started (lead days: ${LEAD_DAYS.join(', ')}, timezone: America/Detroit)`);
}

module.exports = { startReminderScheduler, checkAndSendReminders };
