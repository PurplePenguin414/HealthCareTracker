# HealthCareTracker

Self-hosted appointment tracker for Therapy/EMDR, Dietitian, Doctor, and Other visits.
Runs locally via Docker Desktop, no internet exposure required.

## Stack
Node.js/Express, better-sqlite3, bcrypt/session auth, vanilla HTML/CSS/JS, Docker + docker-compose.

## First-time setup

1. Copy the env template and fill in real values:
   ```
   cp .env.example .env
   ```
   At minimum, set:
   - `SESSION_SECRET` — generate with `openssl rand -hex 32`
   - `DEFAULT_USERNAME` / `DEFAULT_PASSWORD` — only used to seed the first login; change your password via Settings after first login
   - `DISCORD_APPT_WEBHOOK_URL` — a **new, separate** Discord webhook (not the MedsTracker one)

2. Build and start:
   ```
   docker compose up -d --build
   ```

3. Open **http://localhost:3040**, log in with your `DEFAULT_USERNAME`/`DEFAULT_PASSWORD`, then immediately go to Settings (⚙️) and change your password.

## Data & backups

All data lives in `./data/` on the host, mounted into the container:
- `data/healthcare.db` — SQLite database (appointments, question bank, etc.)
- `data/uploads/` — attached files (PDFs, images)

Back up the entire `./data/` folder periodically. Since this runs locally rather than on a Borg-backed VPS, there's no automatic backup — consider a periodic manual copy to an external drive or your existing backup routine.

## Updating

After making code changes:
```
docker compose build
docker rm -f healthcaretracker
docker compose up -d
```

(Standard `docker compose up -d --build` also works fine here since this uses Compose v2 syntax, unlike NWT-SVR01's older v1.29.2.)

## Testing Discord reminders

Reminders normally fire daily at 8:00 AM America/Detroit for appointments 1 and 3 days out (configurable via `REMINDER_LEAD_DAYS`). To test without waiting:

```
curl -X POST http://localhost:3040/api/test-reminder \
  -H "Cookie: <your session cookie>"
```

Easier: while logged into the app in your browser, open the browser console and run:
```js
fetch('/api/test-reminder', { method: 'POST' }).then(r => r.json()).then(console.log)
```

This only sends embeds for appointments that actually fall on a matching lead-day date — add a test appointment dated 1 or 3 days out with reminders enabled first.

## Notes

- Question bank (EMDR prep checklist) only applies to the Therapy tab.
- "Other" tab supports free-form custom label/value fields per appointment.
- No SUD/VOC scoring or standalone mood tracking, by design.
- PWA/home-screen icon support: not yet built, on the list for later.
