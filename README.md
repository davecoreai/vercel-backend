# FloatixBot backend for Vercel

This directory is a standalone Vercel project root. Vercel deploys the handlers in `api/` as Node.js Functions. No Express server or extra npm dependency is required.

## Environment Variables

In **Vercel → Project → Settings → Environment Variables**, add these variables for the environments you deploy (Production and Preview as needed):

- `GEMINI_API_KEY`: API key created in Google AI Studio. Keep it on the server only.
- `GEMINI_MODEL`: `gemini-3.5-flash`
- `APP_TOKEN`: a random secret at least 32 bytes long. Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Redeploy after changing environment variables. Do not put real secrets in Git or in the Android APK.

## Deploy

1. Push the full FloatixBot project to a Git repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Set **Root Directory** to `vercel-backend` (enable editing the root directory if it is hidden).
4. Add the three environment variables above.
5. Deploy.

For a simple test, open `https://YOUR-VERCEL-PROJECT.vercel.app/api/health`. Expected output includes `"ok": true` and `"configured": true` when both secret variables exist. This endpoint does not verify Gemini credentials or make a billable model call.

## Connect FloatixBot Android

In FloatixBot → Pengaturan → Gemini API, set the endpoint URL to:

`https://YOUR-VERCEL-PROJECT.vercel.app/api/analyze`

Paste the exact same `APP_TOKEN` into **Token akses backend**, then save. Do not use `/analyze` without `/api` for this Vercel deployment.

The app's request uses `Authorization: Bearer <APP_TOKEN>` and JSON shaped like `{ "question": { "prompt": "...", "type": "AUTO", "options": [] } }`. Successful responses have `answer`, `explanation`, `confidence`, and `model` fields.

## Security notes

- The Gemini API key stays in Vercel Environment Variables.
- The API requires the bearer token, accepts only POST, validates prompt size, and does not log the prompt or generated answer.
- `APP_TOKEN` is a shared app-to-backend secret, not a user login. A person with a redistributed APK or access to the token may reuse it. Before public distribution, add per-user authentication and shared rate limiting (for example, backed by a managed store), plus usage/billing limits in Google AI Studio. Vercel function memory alone is not a reliable global rate limiter.
- `/api/health` reveals only service metadata and whether required variables exist; it does not reveal their values.
