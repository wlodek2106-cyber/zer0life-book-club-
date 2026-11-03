# Zer0Life Book Club — deployment-ready MVP scaffold (v0.2)

## Deployment architecture
- **GitHub Pages** serves the static Telegram Mini App at `bookclub.zer0lifelabs.com`.
- **Render** (or another Node host) runs `server.js` as the API + Telegram Bot webhook.
- **PostgreSQL** stores users, books, memberships, purchases, favorites and payment events.
- Telegram Stars (`XTR`) is used for digital books and the recurring VIP membership.

GitHub Pages alone cannot run the Node backend or store secrets. Keep BOT_TOKEN and DATABASE_URL only in the backend host's secret environment variables.

## Local run
1. Node.js 20+
2. `cp .env.example .env`, fill credentials.
3. Create PostgreSQL DB and run `psql "$DATABASE_URL" -f db/schema.sql`.
4. `npm install && npm start`.
5. Open `http://localhost:3000`.

## GitHub Pages
1. Create a GitHub repository and push this project to branch `main`.
2. In repo Settings → Pages, choose **GitHub Actions** as the build/deploy source.
3. The included workflow publishes `public/`.
4. Set custom domain `bookclub.zer0lifelabs.com` in Pages settings; DNS provider: add CNAME `bookclub` → `<github-user>.github.io`.
5. Enable HTTPS after DNS validation.
6. Edit `public/config.js` and set `window.ZER0LIFE_API_BASE` to the deployed API origin.

## Backend (Render)
1. Create a Render Web Service from the same repository, root directory `/`, build `npm install`, start `npm start`.
2. Create a managed PostgreSQL database and set `DATABASE_URL`.
3. Set `BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_TELEGRAM_IDS`, `VIP_PRICE_STARS`, `PUBLIC_APP_URL`, `API_BASE_URL`.
4. Run `db/schema.sql` against the database.
5. Deploy. Verify `GET /api/health`.

## Telegram bot and Mini App
1. Create bot with `@BotFather`; retain token privately.
2. Configure the Mini App URL to `https://bookclub.zer0lifelabs.com`.
3. Configure the bot menu button / Main Mini App URL in BotFather.
4. Set webhook (replace placeholders):
   `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<backend-host>/telegram/webhook/<WEBHOOK_SECRET>`
5. Ensure the webhook secret is unguessable. For stronger validation, also set Telegram's `secret_token` webhook option and validate `X-Telegram-Bot-Api-Secret-Token` in the server.
6. Set numeric Telegram admin IDs in `ADMIN_TELEGRAM_IDS`.

## Stars payments
- Book invoices use currency `XTR`, empty `provider_token`, and integer Stars amount.
- VIP invoice uses `subscription_period=2592000` (30 days). Configure the Stars price in `VIP_PRICE_STARS`; `$15` is a positioning target, not a direct USD conversion. The app must display the actual Stars amount before confirmation.
- Test successful payment, pre-checkout, recurring renewal, cancellation, expiry and refund handling before launch.
- Production hardening still needed: validate payload ownership and invoice amount/currency against DB, process subscription renewal/expiration/refund updates, reconcile entitlements, and handle duplicate/out-of-order webhook events. Never unlock access merely because the client says payment succeeded.

## Admin
- `GET /api/admin/stats`, `GET /api/admin/books`, `POST /api/admin/books` require valid Telegram `initData` and an ID in `ADMIN_TELEGRAM_IDS`.
- Book records default to `rights_status=pending`, `is_published=false`. Only publish material with `rights_status` `licensed`, `public_domain`, or `original`.
- Upload/storage UI and role management are not included yet; admin API foundation is present.

## Legal / privacy
Only distribute public-domain books, original works or works with explicit distribution rights. Store only necessary Telegram profile fields. Publish privacy policy, terms, contact and deletion process before release.

## Admin panel preview
Open `https://bookclub.zer0lifelabs.com/admin.html` from Telegram while logged in with an ID on the admin allowlist. The panel shows core stats and supports adding/updating book metadata. File upload, private object storage and richer moderation workflows remain follow-up work.
