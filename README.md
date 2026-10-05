# ReplyWise — Task 4

A standalone, single-page customer reply assistant: a cream / off-white landing page with purple accents, an embedded working tool, Gemini generation, and live Supabase read-back. No authentication or browser-side service credentials.

The checkout initially contained no Task 3 code. This implementation follows the supplied visual brief. Direct access to the Task 3 reference URL was blocked by the environment's network policy, so exact visual matching has not been verified.

## Local setup

Requires Node.js 22 or newer (developed on Node.js 24). No production package dependencies; server-side integrations use native `fetch`. Development dependencies provide Playwright browser checks and PGlite PostgreSQL schema checks.

```sh
npm ci
cp .env.example .env.local
# Fill .env.local with your credentials using a local editor. Never commit it.
npm run dev
```

The local server serves the page and both real API handlers on port 3000. Without credentials the page loads, while API operations return safe unavailable messages. It never substitutes fake generation or statistics. `npm run build` creates the static `dist` folder; Vercel deploys `api/` separately as Node functions. Static hosting alone will not run the APIs.

## Supabase setup

1. Create a project at https://supabase.com/dashboard and wait for it to become available.
2. Open **SQL Editor**, create a query, paste the complete contents of `supabase/schema.sql`, and run it. The SQL is repeatable.
3. In the project settings / Connect dialog, copy the project URL into `SUPABASE_URL` (typically `https://YOUR-PROJECT.supabase.co`).
4. In **Settings → API Keys**, obtain the server-side service-role key (legacy `service_role` JWT). Set it as `SUPABASE_SERVICE_KEY`. Do not use the browser anon/publishable key. Treat this key as a password: it bypasses RLS.
5. Leave row-level security enabled. The SQL denies browser roles access to tables and RPC functions; only `service_role` can use them. The browser contacts our API, never Supabase directly.

`replywise_requests` stores successful generations. A short-lived reservations table and server-only SQL functions serialize each visitor's requests and prevent parallel calls from exceeding the cap. Failed generation releases its reservation and does not consume a successful-reply slot. Stale reservations expire after two minutes. Successful replies are returned only after the database insert succeeds; database failure fails closed.

## Gemini setup

1. Open https://aistudio.google.com/apikey and create a Gemini API key for a Google project.
2. Ensure the project can use Gemini API (quota and billing requirements depend on your account).
3. Set `GEMINI_API_KEY` on the server. The default `GEMINI_MODEL` is **gemini-3.5-flash**, also defined in `lib/gemini.js`.
4. The implementation requests structured JSON with **maxOutputTokens: 200**, requests the minimum thinking level for Gemini 3.5 Flash, and validates all four returned fields. Truncated, blocked, or malformed output produces a clean error, not a partial reply. If you change the model, verify support for `thinkingConfig` and the schema.

## Local environment

`.env.example` contains names/placeholders only:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

Copy it to `.env.local`, fill values there, and restart the server. All four values are read only by server modules. Do not add `NEXT_PUBLIC_` or `VITE_` prefixes.

For this cloud environment: enter Gemini credentials securely in environment settings. Set your Supabase project URL, and declare a server-side `SUPABASE_SERVICE_KEY` secret for that exact project hostname. Allow `generativelanguage.googleapis.com` and your exact Supabase hostname in restricted network settings. Never paste keys into chat. The Supabase destination cannot be declared precisely until your project exists.

## New GitHub repository and Vercel deployment

**Do not connect this repo to the existing Task 3 Vercel project because Task 4 needs a separate URL.**

1. Create a **new empty GitHub repository**, for example `replywise-functional`, without adding an initial README.
2. This checkout has no existing commits. Inspect changes, then create the first commit and point the remote at the new repository:

   ```sh
   git add .
   git commit -m "Build ReplyWise functional customer reply demo"
   git branch -M main
   git remote set-url origin https://github.com/YOUR-USERNAME/replywise-functional.git
   git push -u origin main
   ```

   Replace the URL with the new repository, never the Task 3 repository. No repository creation, commit, push, or deployment has been performed automatically.
3. On Vercel, choose **Add New → Project**, import this **new** repository, and use a new project name such as `replywise-functional`. Select **Other** as framework, `npm run build` as build command, and `dist` as output directory; `vercel.json` supplies these settings. Use Node.js 24.x (22.x also supported).
4. Add the four environment variables above in **Project Settings → Environment Variables**, including Production and any Preview environments you want to test. The Gemini and Supabase keys must stay server-side. Disable their exposure to browser bundles.
5. Deploy / redeploy after adding variables. Confirm the resulting URL differs from Task 3.
6. Check `/api/stats`: initially it should report `shops_served: 0`, `languages: 0`, `most_common_request: null`, `used: 0`.
7. Submit a message through the page. Check that a reply appears, Table Editor shows a real row including token counts where Gemini supplies them, and the stats update. In browser devtools, confirm requests go only to `/api/...`.
8. Try five successful generations in one browser. The sixth request must return 429 without calling Gemini.

## Validation

```sh
npm test
npm run build
npm run test:browser
npm run test:live
```

`npm test` covers validation, output parsing, privacy sanitization, Gemini request settings, server-side errors, persistence, stats, and the sixth-request block with injected test dependencies. The SQL test additionally executes the actual schema twice in PGlite PostgreSQL, verifies public-role denial, reservation behavior, five-reply cap, token storage, and stats. It does **not** prove live Gemini behavior or connectivity to your hosted Supabase project.

`npm run test:browser` uses Playwright with `/usr/bin/chromium` by default. On another system, install Chromium with `npx playwright install chromium`, then run with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` pointing to that binary. It launches its own local server on port 3100 and tests desktop/mobile layouts and interactions against explicitly mocked API fixtures. Artifacts are saved to ignored `test-results/`.

`npm run test:live` requires real credentials and the installed SQL schema. It starts a temporary local server, sends the five assignment scenarios using one fresh random visitor, checks a sixth is blocked, then confirms stored usage and stats. It makes billable API calls and leaves five demo rows. It saves actual responses to an ignored `test-results/live-results.json` for human review. Review language, tone, absence of refunds/prices/dates, and prompt-injection resistance: automated checks cannot certify those properties. The five messages cover Hinglish delivery, abusive refund demand, pricing, prompt injection, and Hindi.

## Safety, privacy, and scope

- The system prompt treats customer content as untrusted and explicitly prohibits made-up business facts, including unverified customer claims. Guardrails are model instructions, not a guarantee: always review drafts.
- Input is limited to 1,000 characters; business type and UUID v4 are validated server-side. One visitor can have one in-flight request and five successful replies.
- UUID is stored in `localStorage`; no fingerprinting or personal identifiers. Clearing storage or switching browsers creates another demo identity; this is an assignment-level cap, not production abuse protection. Use Vercel rate limiting / budget controls before broad public promotion.
- Original input is sent temporarily to Gemini. Obvious email addresses and phone numbers are redacted before database storage, including generated fields. Other sensitive information may remain: do not paste personal, account, financial, or health data.
- Stats aggregate in SQL over the table, without exposing customer messages or relying on a limited REST page. Anonymous browsers are labelled “shops served” as required, with an explanatory note.
- No raw provider errors or input data are logged. API responses are not cached. RLS blocks public data access. Production CSP restricts scripts and network access to the site's own origin.
- Rows persist until you delete them. For an academic demo, remove test data when no longer needed and tell testers their messages are processed by Gemini and stored in Supabase.

## Current verification limits

Live provider calls, SQL execution in your Supabase project, exact Task 3 visual comparison, GitHub publication, and Vercel deployment require external setup. Local tests and browser checks do not establish that these steps have succeeded. Follow the steps above, then run the live check and review its actual outputs before submitting the assignment.

## Troubleshooting generation failures

In Vercel, open the project's Logs tab, submit a message, and find the line beginning `[ReplyWise]`. It contains only a controlled failure code, operation stage and HTTP status—not provider response bodies, prompts, keys or customer content.

- `SUPABASE_CONFIG`: missing/invalid project URL or missing service key. Add variables to the correct Vercel environment and redeploy.
- `SUPABASE_HTTP` status 401/403: check server-side service-role credentials and SQL permissions.
- `SUPABASE_HTTP` status 404: check the project URL and run the complete SQL file, including RPC functions.
- `GEMINI_CONFIG`: missing API key or invalid model setting. Use `GEMINI_MODEL=gemini-3.5-flash` and redeploy.
- `GEMINI_HTTP` status 400/403: check key permissions/model support in Google AI Studio.
- `GEMINI_HTTP` status 429: check Gemini quota and billing; retry only after the limit clears or quota is fixed.
- `GEMINI_HTTP` status 404: check model availability.
- `GEMINI_TRUNCATED`: response exceeded the required 200-token output limit. Retry with a shorter message; do not silently raise the assignment's limit.
- `GEMINI_BLOCKED`: no completed candidate returned; try a customer-service message.
- Timeout/network codes: check provider availability and networking.

Logs identify the failure; they do not establish that missing credentials, quota or hosted database configuration have been fixed. Never share secret values or full provider bodies when seeking help.

Gemini generation initially uses the `v1beta` API, matching the official JavaScript client. On a 404 only, it retries once against the stable `v1` API with the same model, system prompt, JSON schema and 200-token cap. Both requests share one 35-second deadline. Other provider statuses are not retried. This compatibility fallback does not prove that a provider-side resource issue is resolved.
