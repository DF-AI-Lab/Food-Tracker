# Research: sending a monthly report email (issue #150)

Goal: one email a month to one Gmail address, free or near-free. App = static site on GitHub Pages, data in Firestore under `households/{h}/<collection>` (client-side SDK, rules in `firestore.rules`), plus a Cloudflare Worker (`worker/src/index.js`) that already uses KV, verifies Firebase ID tokens, calls the Claude API and already has `FIREBASE_PROJECT_ID`. Web facts below were checked 2026-10-16; vendor limits change, so confirm on the vendor pricing page before building.

## How any server-side option gets the month's data

The browser SDK rules require `request.auth` (a signed-in member), so a cron job has no user. Options:

1. **Service account + Firestore REST (recommended).** Create a service account (Firebase console > Project settings > Service accounts, or GCP IAM) with role `Cloud Datastore User`. Store its JSON key as a Worker secret (`wrangler secret put GOOGLE_SA_JSON`). The Worker signs a JWT (RS256, WebCrypto, no npm needed; scope `https://www.googleapis.com/auth/datastore`), exchanges it at `https://oauth2.googleapis.com/token`, then calls the existing `FS_URL` base: `GET .../households/{h}/{collection}` or `:runQuery` with a date filter. Service-account calls bypass security rules, so no rule change is needed. Firestore reads for one month of one household are a few hundred reads at most, well inside the free quota (50k reads/day) and Spark plan.
2. **Worker already holds the data in KV?** Only the Claude cost log is in KV (`costKey`), not meal/food data, so this is not enough for a real report.
3. **Client pushes a summary.** The app (when the owner opens it) writes a month summary to the Worker, which stores it in KV and mails it later. No service account, but the email only goes out if the app was opened. Weaker.

Risk of option 1: the key is powerful (read/write all Firestore). Keep it as a secret only, scope the role down, rotate if leaked. Need the household id(s): hard-code one in an env var (one owner) or list `households` via the service account.

## Option A: Worker cron trigger + Resend (best fit)

- Cron: `[triggers] crons = ["0 7 1 * *"]` in `wrangler.toml` and a `scheduled()` handler. Cron triggers are free on the Workers free plan.
- Email: `POST https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>` (Worker secret), `to: [owner@gmail.com]`.
- Cost: free tier is 3,000 emails/month with a 100/day cap (sources agree; domain count on free plan reported inconsistently, 1 vs 3). One mail a month is nowhere near it. Over-limit on free pauses sending, no surprise bill.
- Hand setup: (1) sign up at resend.com, create API key. (2) Without a domain you can only send from the shared `onboarding@resend.dev` and, per Resend's testing rules, only to the account owner's own email. If the Gmail address is the Resend signup email, **no domain is needed at all**. (3) If a different recipient or a nicer From is wanted, verify a domain (add SPF + DKIM DNS records); a domain costs roughly 10 USD/year. (4) `wrangler secret put RESEND_API_KEY`, `GOOGLE_SA_JSON`, `REPORT_TO`.
- Risks: from `resend.dev` mail may land in Gmail spam the first time (mark "not spam" once); vendor free-tier terms can change; the key is a secret to guard.

## Option B: Worker cron + Cloudflare Email Service (`send_email` binding)

- Binding `send_email` in `wrangler.toml`, call `env.EMAIL.send()`. Email Service entered public beta around April 2026.
- Cost: third-party comparison says the 3,000 included emails/month need the $5/month Workers Paid plan, then about $0.35 per 1,000. Not verified on an official pricing page.
- Hand setup: needs a domain on Cloudflare DNS, onboarding with `wrangler email sending enable yourdomain.com`. Before upgrading, sends only go to verified destination addresses (the owner's Gmail can be verified, so that works for one recipient); paid accounts can send to anyone.
- The older Email Routing `send_email` binding only forwards to verified destination addresses and needs the domain's Email Routing set up too.
- Risks: beta product, free-plan eligibility unclear, requires owning a domain. Everything stays inside Cloudflare, which is the only plus.

## Option C: Worker cron + MailChannels

- The old free MailChannels-for-Workers service ended in 2024 (many tutorials online are stale). The current MailChannels Email API has a free plan of 100 emails/day per MailChannels' support pages, but needs an account, API key and SPF/Domain Lockdown DNS records for a domain. Works but gives no advantage over Resend and needs a domain. Not recommended.

## Option D: Firebase "Trigger Email from Firestore" extension

- Requires the **Blaze (pay-as-you-go) plan** plus SMTP credentials from a mail provider (SendGrid, Mailgun, Gmail SMTP app password). Blaze has the same free quotas as Spark for most things but needs a billing card; the extension runs a Cloud Function.
- It only sends when a document is written to a `mail` collection, so something still has to run monthly and write that document (the Worker cron via REST, or a scheduled Cloud Function). That means two moving parts to send one email.
- Risks: card on file and billing exposure, Cloud Functions need Blaze anyway. Rejected: the Worker can already do the whole job.

## Option E: Google Apps Script (time-driven trigger)

- Free, runs as the owner's Google account, so mail is sent from the owner's own Gmail (`GmailApp.sendEmail` / `MailApp`), no domain, no DNS, no third-party vendor, and deliverability to Gmail is perfect. Consumer quota is about 100 recipients/day, plenty.
- A monthly time-driven trigger is set up in the Apps Script UI. Data: `UrlFetchApp.fetch` to the Firestore REST API with `ScriptApp.getOAuthToken()` and the `https://www.googleapis.com/auth/datastore` scope added in `appsscript.json`. That token is the owner's user, so the owner's Google account needs IAM access to the Firebase project (it does if they own it) and the script's linked GCP project must have the Firestore API enabled; user OAuth bypasses security rules via IAM. No service-account key to store anywhere.
- Hand setup: create script at script.google.com, paste code, accept OAuth consent once, add a monthly trigger. Claude summary text (if wanted) needs the Anthropic key stored in Script Properties.
- Risks: code lives outside the repo (can keep a copy under `tools/` and paste in), the first OAuth grant can expire or be revoked, Google may show an "unverified app" warning for the owner's own script (click through), and script triggers silently stop if the account has issues. Different place to debug from the Worker.

## Comparison

| Option | Cost | Domain needed | Extra hand setup | Fits existing stack |
|---|---|---|---|---|
| A Worker cron + Resend | Free (3k/mo, 100/day) | No if sending to the Resend signup email; else yes (~10 USD/yr) | Resend key, service account key | Yes, best |
| B Cloudflare Email Service | ~5 USD/mo (Workers Paid) per third-party info | Yes | Domain on Cloudflare, onboarding | Yes, beta |
| C MailChannels | Free 100/day | Yes | Account, DNS records | Yes, no gain |
| D Firebase Trigger Email | Blaze plan (card) + SMTP provider | Depends on SMTP | Billing, extension install | No, two parts |
| E Apps Script | Free | No | Script + trigger + consent | Separate, but simplest |

## Recommendation

1. Best fit: **Worker cron trigger (1st of month) + Resend free tier**, reading Firestore through REST with a service account stored as a Worker secret. Free, all code stays in the repo with the existing Worker, and no domain is needed if the report goes to the same Gmail used to sign up to Resend.
2. Simplest no-code-in-Worker fallback: **Google Apps Script** monthly trigger, which sends from the owner's own Gmail with no vendor and no key, at the cost of living outside the repo.
3. Avoid the Firebase Trigger Email extension (Blaze billing, still needs a scheduler) and Cloudflare Email Service/MailChannels (need a domain, one is beta or paid).

Sources: Resend free-tier summaries (wpmailsmtp.com/resend-review, automationatlas.io), Cloudflare Email Service docs (developers.cloudflare.com/email-service, /email-routing/send-email), MailChannels end-of-life notice for Workers (support.mailchannels.com), Firebase Trigger Email extension page (firebase.google.com/products/extensions/firestore-send-email).
