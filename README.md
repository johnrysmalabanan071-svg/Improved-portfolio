# John Rys Clanor — Rys Automate

A complete replacement portfolio for GitHub → Vercel deployment. Plain HTML, CSS, and JavaScript on the client; Node.js functions on Vercel; Supabase for durable lead records; Resend for email. There are no npm runtime dependencies and no client-side credentials.

## Deploy in this order

1. **Unzip this package.** Upload the contents of `rys-automate/` to the root of your GitHub repository. Include `public`, `api`, `lib`, `scripts`, `database`, `tests`, `package.json`, `vercel.json`, `.gitignore`, and `.env.example`. Do not upload real secrets. If you upload the folder itself, set Vercel's Root Directory to `rys-automate`.
2. **Create a Supabase project.** Paste all of `database/schema.sql` into its SQL Editor and run it. This creates lead records, delivery jobs, rate limits, and server-only database functions. Do not create public access policies for these tables.
3. **Set up Resend.** Verify a domain you control and obtain an API key. Choose a sender on that verified domain. Your Gmail address can receive notifications and replies, but cannot be used as the verified sender. Resend's testing sender is restricted; use a verified domain for real visitors.
4. **Import the GitHub repository into Vercel.** Framework preset: **Other**. Node.js: **24.x**. Build command: `npm run build`. Output directory: `dist`. The included configuration sets these build options. The `/api` functions must also deploy; GitHub Pages or another static-only host will not run the intake pipeline.
5. **Add the variables listed below** in Vercel → Project Settings → Environment Variables. Use Production scope for your public site. Redeploy after changing them.
6. **Test with your own email address.** Submit one brief. Confirm one row in Supabase `leads`, two `sent` rows in `lead_deliveries`, an acknowledgment in your inbox, and a notification in your owner inbox. If using the optional webhook, expect a third delivery row and one record downstream.

The portfolio and demo work immediately. **The intake cannot save leads or send email until you complete steps 2–5.** It displays an honest setup error if required settings are missing. No live third-party accounts were connected during development.

## Environment variables

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your project's `https://…supabase.co` URL |
| `SUPABASE_SECRET_KEY` | A modern `sb_secret_…` key from Supabase → Settings → API Keys. This is a server secret, not the publishable/anon key. |
| `RESEND_API_KEY` | A Resend sending API key |
| `EMAIL_FROM` | `John Rys Clanor <hello@your-verified-domain.com>` |
| `OWNER_EMAIL` | `johnrysclanor22@gmail.com`, or your preferred destination |
| `ALLOWED_ORIGINS` | Exact comma-separated origins, e.g. `https://your-project.vercel.app,https://yourdomain.com`. No trailing slashes. Include localhost only for local testing. |
| `RATE_LIMIT_SECRET` | A random secret of at least 32 characters |
| `CRON_SECRET` | A different random secret of at least 32 characters |
| `LEAD_WEBHOOK_URL` | Optional HTTPS endpoint for n8n, Make, or another workflow service |
| `LEAD_WEBHOOK_SECRET` | Optional shared secret. Required whenever a webhook URL is set. |

Generate each random secret separately:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Never put secret values in `public/`, GitHub, or a variable prefixed with `NEXT_PUBLIC_` or `VITE_`. Add preview origins explicitly if testing form submissions on a Vercel preview URL. Do not use a wildcard origin.

## What the site includes

- 11 rewritten case studies with a plain-language problem, solution, modeled outcome, human checkpoint, and expandable architecture.
- Platform filters and three featured projects; the full collection is one click away.
- An interactive, deterministic lead-routing demonstration with three scenarios and clickable steps. It runs locally using sample data; it does not call an AI model or send messages.
- A four-step intake: project type and role → process and existing tools → budget and timeline → contact, review, and consent.
- Project/service links that preselect a relevant intake category.
- Mobile navigation, native modal dialogs with keyboard dismissal, visible focus states, reduced-motion support, and validation/error/success states.
- Original portrait, nine source workflow overview images, résumé, and all 11 certificates, included locally. Two other projects use their written architecture without a source screenshot.

Project copy was adapted from the existing portfolio and provided screenshots. These remain **self-directed builds**, not client case studies. No revenue, time-savings, or reliability results have been invented. Before publishing, review the rewritten copy and production-validation suggestions for accuracy.

## How the intake works

```text
Guided form
  → Vercel /api/intake
  → Validate + verify origin + check rate limits
  → ONE database transaction: lead + acknowledgment job + owner-notification job
  → Attempt delivery immediately
       ├─ Resend: acknowledgment to the visitor
       ├─ Resend: project brief to the owner
       └─ Optional webhook: the structured record
  → Persist delivery status; retry outstanding jobs on schedule
```

Lead fields include name, email, company, role, project type, challenge, existing tools, process frequency, budget, timeline, consent version, creation time, readiness score, route, and qualification reason. `status` starts as `new` and can be managed directly in Supabase's Table Editor.

The readiness score is a transparent server-side rule: defined area (+30), frequent process (+20), implementation budget (+25), and active timeline (+25). It organizes follow-up; it never discards a valid inquiry. Recruiter inquiries use a separate career route. Edit these rules in `lib/validation.js`.

There is a five-submission limit per network address per UTC hour, and a three-submission limit per email per UTC day. Network addresses and emails used for rate limiting are HMAC-hashed; the lead's contact email is retained normally. Old rate-limit records are removed by the retry job. Consent is required, no marketing opt-in is assumed, and form contents are not saved in browser storage.

Repeated requests using the same submission ID and payload return the same record. Changed payloads cannot overwrite an accepted brief under the same ID. The current page keeps its ID when retrying after an uncertain network response. Reloading starts a new inquiry; deduplication is not global email deduplication.

## Delivery retries and monitoring

The initial request attempts delivery immediately. The included Vercel cron runs once daily, a frequency compatible with Hobby's cron restrictions. A daily job is an inexpensive fallback, **not a promise of rapid outage recovery**. It claims at most ten jobs per run, with 90-second leases and retry backoff. After eight unsuccessful attempts, a job becomes `needs_review`. Jobs in `sending` with an expired lease can be reclaimed.

For faster recovery and higher traffic, use a Vercel plan that permits frequent cron schedules and change the schedule to `*/5 * * * *`, or have a trusted scheduler call `/api/retry-deliveries` every five minutes with `Authorization: Bearer YOUR_CRON_SECRET`. Do not expose that secret in browser code. Review your hosting plan's permitted use and quotas before launch.

In Supabase, filter `lead_deliveries` for `pending`, stale `sending`, or `needs_review`. Confirm provider delivery history before replaying uncertain jobs. Fix configuration or provider errors first, then set an affected job's `status` to `pending`, `attempts` to `0`, `locked_until` to `null`, and `next_attempt_at` to the current time. Leave the job's `id` unchanged. The next scheduled run will claim it.

**Delivery is at-least-once, not exactly-once.** Resend deduplicates idempotency keys for 24 hours. If an email was accepted but saving its sent status failed, a retry after that window could send it again. A frequent retry schedule reduces this risk. Changing email templates, sender settings, or lead data between retries can also conflict with a previously used idempotency key. Check provider records before manual recovery. `sent` means accepted by the provider, not verified inbox delivery; bounces require checking Resend.

No automatic lead-deletion policy is imposed. Set your own retention period and update the privacy copy to match your actual practices and connected providers. Deleting a lead cascades to its local delivery jobs; delete copies in any downstream systems separately. The application includes baseline spam controls; if you encounter distributed abuse, add managed bot protection or Turnstile with server-side verification.

## Optional n8n / Make / CRM connection

Supabase is already the working lead database, so an additional CRM is optional.

1. Create a POST webhook that requires the `Authorization` header to equal `Bearer <your shared secret>`. Use n8n Header Auth or an equivalent guarded endpoint. Do not rely only on a hard-to-guess URL.
2. Set `LEAD_WEBHOOK_URL` and `LEAD_WEBHOOK_SECRET` on Vercel and redeploy.
3. Upsert your CRM/database record by `lead.id`, and track `eventId` so redelivery does not create duplicate records or trigger repeated downstream actions.
4. Map the structured fields to Airtable, HubSpot, GoHighLevel, or your preferred destination. Use `lead.route` for routing and `lead.qualification_reason` to explain it.
5. Return a 2xx response only after your workflow durably accepts the event. If you acknowledge receipt before processing, the workflow service must own its own retries. The Vercel worker has an eight-second delivery timeout.

Payload shape:

```json
{
  "event": "lead.created",
  "eventId": "stable-delivery-uuid",
  "createdAt": "ISO timestamp",
  "lead": {
    "id": "stable-submission-uuid",
    "name": "Visitor name",
    "email": "visitor@example.com",
    "project_type": "Lead response",
    "challenge": "The visitor's process description",
    "budget": "$1,500–$5,000",
    "timeline": "Within a month",
    "score": 100,
    "route": "Project discovery",
    "qualification_reason": "Defined project area; Recurring process; Implementation budget indicated; Active timeline"
  }
}
```

The actual `lead` object includes the remaining stored fields listed above. Delivery IDs and submission IDs are different, intentionally. The built-in pipeline already sends the acknowledgment and owner notification; do not send the same emails again in the optional workflow unless you intentionally replace the built-in email jobs.

## Local use and editing

Install Node.js 24. No dependency installation is needed.

```sh
npm run dev
# Open http://localhost:4173
npm test
npm run build
```

For live local API testing, copy `.env.example` to `.env.local`, fill its values, and include `http://localhost:4173` in `ALLOWED_ORIGINS`. Restart the server after environment changes. This will send real messages and write real records, so use a test project and addresses you control.

| Change | File |
| --- | --- |
| Page sections, profile, experience, privacy text | `public/index.html` |
| Colors, spacing, responsive layout | `public/styles.css` |
| All project case studies and services | `public/projects.js` |
| Demo and intake interactions | `public/app.js` |
| Field validation and readiness rules | `lib/validation.js` |
| Emails and outbound delivery | `lib/pipeline.js` |
| Storage, permissions, rate limits, queue | `database/schema.sql` |
| Hosting, security headers, retry schedule | `vercel.json` |

## Verification performed

- Build and JavaScript syntax checks passed; local links/assets checked.
- Ten automated tests cover validation, qualification, configuration failures, origin checks, methods, body limits, persistence failures, delivery retries, webhook contracts, and cron secrets.
- The SQL was executed in an isolated PostgreSQL-compatible PGlite engine: schema, atomic record/job insertion, duplicate suppression, conflicting retry rejection, rate limiting, lease recovery, and denied anonymous access passed.
- Browser checks covered the desktop layout, case-study filtering/opening, contextual intake handoff, form progression and review, and missing-configuration errors. The phone layout was rendered in a 390px test frame without horizontal overflow.
- Real Supabase, Resend, optional webhook delivery, and Vercel deployment require your accounts and are not live-verified in this package.

## Reference documentation

- [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Supabase server API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Resend idempotency behavior](https://resend.com/docs/dashboard/emails/idempotency-keys)

Original owner content and assets: https://rysautoamte.vercel.app/ (reviewed September 21, 2026). Resume and certificate files are preserved unchanged; workflow previews were recovered from the original site's optimized image assets.
