# permitnative

Chicago building-permit leads for contractors, matched by trade and ZIP code,
with a $99/month Stripe subscription and an optional daily email digest.

## How it's deployed

The app is hosted on **Vercel**, and Vercel deploys it from GitHub:

- A push to `main` deploys to production.
- Any other branch or pull request gets its own preview URL.

| Piece | Where |
|---|---|
| Web app (`artifacts/permit-central`) | Vite static build, served by Vercel |
| API (`artifacts/api-server`) | Express app, runs as one Vercel function (`api/index.mjs`) for every `/api/*` request |
| Daily permit refresh + digests | Vercel Cron calls `/api/cron/daily` every day at 13:15 UTC (7:15/8:15 a.m. Chicago) |
| Database | Supabase Postgres |
| Auth / payments / email | Clerk, Stripe and Resend, using the keys in `.env.example` |

## Local development

Requires Node 24 and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp .env.example .env               # fill in the values
set -a; . ./.env; set +a           # load them into this shell

# terminal 1: API on :8080 (also imports recent permits and runs the daily job)
PORT=8080 pnpm --filter @workspace/api-server run dev

# terminal 2: web app on :5173, proxies /api to :8080
pnpm --filter @workspace/permit-central run dev
```

Other useful commands:

- `pnpm run typecheck` checks types across all packages.
- `pnpm --filter @workspace/db run push` applies schema changes in `lib/db/src/schema` to `DATABASE_URL`.
- `pnpm --filter @workspace/api-spec run codegen` regenerates the API client and Zod schemas from the OpenAPI spec.
