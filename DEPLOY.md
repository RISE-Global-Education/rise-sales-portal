# Deploying to Vercel

## 1. Create a PRIVATE Blob store
Vercel dashboard -> Storage -> Create -> Blob -> choose **Private** (the mode can't be changed later).
Connect it to the project; Vercel adds `BLOB_READ_WRITE_TOKEN` automatically.

## 2. Environment variables (Project -> Settings -> Environment Variables)
| Name | Value |
|---|---|
| `REQUIRE_LOGIN` | leave unset for an open portal (current setting); `true` turns the password page back on |
| `PORTAL_PASSWORD` | the password used when `REQUIRE_LOGIN=true` |
| `CRON_SECRET` | any long random string (required; Vercel sends it to the cron endpoints) |
| `HUBSPOT_TOKEN` | HubSpot private app token (rotate the one used in development) |
| `GRANOLA_API_KEY` | Granola API key (rotate the one in the Apps Script) |
| `HS_CLOSED_WON_STAGE` | `4028500709` |
| `REPORT_TZ` | `Asia/Kolkata` |
| `REFRESH_STALE_MS` | `600000` (so the 15-minute refresh isn't skipped) |
| `REPORTS_ENABLED` | `true` when ready to email (leave `false` until then) |
| `DAILY_TO`, `WEEKLY_TO` | comma-separated recipients |
| `SMTP_USER`, `SMTP_PASS` | sending address + Gmail App Password |

## 3. Deploy
```
npm i -g vercel
vercel          # first deploy, then: vercel --prod
```

## 4. First data load
Open `https://<your-app>/api/cron/refresh` with the header `Authorization: Bearer <CRON_SECRET>`
(e.g. `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/refresh`).
The first run pulls everything (~4-5 min); if it returns `"complete": false`, call it again — it resumes.

## Schedules (vercel.json, UTC)
| Job | Cron | India time |
|---|---|---|
| refresh data | `0 * * * *` | every hour, on the hour |
| daily email | `30 4 * * *` | 10:00 daily |
| weekly email | `0 5 * * 0` | 10:30 Sunday |

The refresh runs every hour (Vercel Pro allows more often, e.g. `*/15 * * * *`). On the free Hobby plan, change it back to `0 4 * * *` (one run per day).
Also add the environment variable `REFRESH_STALE_MS=600000` so each 15-minute run actually refetches
(by default a data part refreshed in the last 2 hours is skipped).

## Limits to know
- `maxDuration` is 300s for cron functions. If the deploy complains it exceeds your plan, lower it
  (e.g. 60) - the refresh is resumable, just call `/api/cron/refresh` more than once.
- Local run still works: `node server.js` (uses ./data instead of Blob).
