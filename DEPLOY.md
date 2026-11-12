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
| `AIRTABLE_PERSONAL_ACCESS_TOKEN` | Airtable token with read access to the **Student Pipeline** base (proof of payment for the Closed Won Check / Commission Calculator) |

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

## Slack (optional)
Set `SLACK_WEBHOOK_URL` (a Slack Incoming Webhook for the channel) in Vercel → Environment Variables, then redeploy.
The daily report is then also posted to that channel, once a day, right after the e-mail (its own once-a-day record, retried until it posts).
The weekly report is posted there too; set `SLACK_WEEKLY=false` to stop that.

## Commission (Closed Won Check, Commission Calculator, Discrepancies)
- A Closed Won deal is **verified** when it has proof of conversation (a Granola note owned by the deal's rep, with a transcript,
  where the client is an attendee/invitee, or matched to the rep's HubSpot meeting with the client) **and** proof of payment
  (Airtable Student Pipeline → Research Scholar Application with Follow Up Status = Client, matched on student or parent e-mail).
- Counsellor vs Direct = Airtable "Counselor Source" ("Direct" or empty = Direct). Commission month = Airtable "Client Date".
- Rules per rep: `COMMISSION` in `lib/config.js`.
- Discrepancies are stored in the Airtable base **Commission Discrepancies** (`appMn20DaFCQaMPig`, table `Discrepancies`).
  Reps raise them on the portal. Managers resolve them **only in Airtable** by changing **Status**
  (Open / Accepted / Rejected); the portal has no accept / reject.
- Every raised discrepancy is e-mailed to `DISPUTE_NOTIFY_TO` (comma-separated; default yash@riseresearch.com) via the same SMTP as the reports.
  A mail failure is logged and does not undo the raise. The portal re-reads the table within ~20 seconds. Override with `DISPUTES_BASE` / `DISPUTES_TABLE`.
- Optional overrides: `AIRTABLE_BASE`, `AIRTABLE_CLIENTS_TABLE`, `AIRTABLE_CLIENTS_VIEW` (use a view instead of the Follow Up Status filter), `AIRTABLE_COUNSELORS_TABLE`.
- Tests: `npm test`.
