# Telegram Digital Key Store

A Telegram Mini App and bot storefront for selling digital license keys through configured reseller APIs. Built on Preact, Hono, Cloudflare Workers and D1.

## Key-store features added

- Admin-managed platforms, categories, products, exact provider PIDs and duration plans.
- Product-specific and provider-wide Android ID requirements.
- Reseller V1 API adapter using HTTPS POST form fields `api_key`, `action=buy`, `product_id`, `duration`, `quantity` and optional `android_id`, with `x-master-key` header.
- Bulk purchases from 1 to 100 keys; accepts the provider's `keys[]` response and single-key compatibility field.
- Customer key delivery in the Mini App and Telegram chat, copy-key actions, and key order history.
- Ambiguous provider responses are placed into an admin review queue rather than automatically retrying a potentially paid request.
- USD is the default wallet display currency; users can switch between USD and INR. Wallet values remain stored as micro-USD and are converted for display. Telegram Stars remains a separate payment option. Per-user selected-currency storage is not included in this update.
- Manual payment methods can be added, edited, enabled/disabled and removed when they have no deposit history. Manual deposits accept a transaction reference/proof and are credited after admin approval.
- Existing user accounts, USD wallet balances, Telegram settings, languages, broadcasts, branding and historic SMM order data are retained by additive migrations.

## Provider setup

1. In Telegram, open Admin → Providers.
2. Add a provider with API type **Reseller V1 · Key delivery**.
3. Enter the HTTPS endpoint, API token and master key as server-side provider credentials.
4. Do not put API tokens or master keys in source files, screenshots, public messages or client-side code.
5. In Admin → Key shop, add platforms, categories, products and duration plans. Enter each exact PID and exact duration string from the provider's product table.
6. Set the selling price in USD. The admin UI converts the entered decimal USD amount into integer micro-USD for storage.

For device-bound products, enable **Require customer Android ID** on the product. Do not enable it for products that do not require it.

## Purchase and delivery safety

- The customer must have enough wallet balance before an order can be submitted.
- A provider response must contain the requested number of keys. The app does not mark incomplete responses as delivered.
- A timeout, malformed response or key-count mismatch is ambiguous: the order enters **review** and the funds remain reserved until an admin checks the provider dashboard. Do not manually retry the same order until the provider confirms whether it charged the request.
- Admins can refund review-state key orders to the customer's USD wallet after checking the provider result.
- API credentials are never returned in full by the admin provider listing.

## Manual deposits

Admin → Payment methods supports adding multiple manual methods, editing their display name/currency/instructions/minimum/fee, enabling/disabling them, and reviewing pending deposits. Manual deposit approval credits the wallet using the configured currency conversion rate. Telegram Stars is kept separate from wallet display currency.

## Deployment and checks

- Node.js 24 or newer
- Cloudflare Workers and D1
- Telegram bot token from @BotFather

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The Worker applies new SQL migrations automatically. New migrations are additive; they do not delete existing user or wallet records.

## Important integration limitation

The reseller API's product table in the supplied account text did not include actual PID values. Add the real PID and exact duration string in Admin → Key shop before enabling a product. Never guess missing PIDs or duration labels.
