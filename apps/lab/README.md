# lab

Synthetic storefronts for Phantasm Sentinel demos. One Next.js app renders one of five fictional shops. `STOREFRONT_ID` selects `a`, `b`, `c`, `d`, or `e`. An empty value serves `a`.

The shops sell made-up goods. Checkout posts to `/api/checkout`, which leaves the request body unread and redirects to a decline page. Card fields are not processed, stored, or logged.

## Local

```sh
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:3001`. Change `STOREFRONT_ID` and restart the dev server to preview another shop.

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

## Five Vercel projects

Deploy this same app five times. Each project is one shop. The hostname is not read; `STOREFRONT_ID` is the switch. Set it for Production and Preview, then redeploy. Next.js reads the variable at build time, so a later env edit needs a new deployment.

For each project:

1. Import this Git repository.
2. Set **Root Directory** to `apps/lab`.
3. Framework preset: **Next.js**.
4. Install command: `pnpm install`.
5. Build command: `pnpm build`.
6. Leave the output on the Next.js server. A static export would drop `/api/checkout`.
7. Add the environment variable from the table.
8. Deploy.

| Project purpose | `STOREFRONT_ID` |
| --------------- | --------------- |
| Shop a          | `a`             |
| Shop b          | `b`             |
| Shop c          | `c`             |
| Shop d          | `d`             |
| Shop e          | `e`             |

Optional: attach a separate domain to each project.

Leave payment credentials unset. Publishable key strings, processor host names, and statement descriptors already live in `src/lib/storefronts.ts` as fictional labels.

Pages send `X-Phantasm-Lab: synthetic`, a `noindex` robots meta tag, and a footer line that reads `Synthetic lab target`. Keep those in place so the fixtures stay identifiable as a lab.
