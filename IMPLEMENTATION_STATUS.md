# Implementation status — key-store conversion

## Implemented in this source update

- Converted the primary Mini App route to the Digital Key Store.
- Added database schema for configurable key platforms, categories, products, exact provider PID mappings, duration plans, key orders and delivered key records.
- Added reseller V1 API support with server-side `api_key` and `x-master-key`, HTTPS-only endpoint validation, optional device Android ID and quantity 1–100.
- Added admin API routes and a Key shop admin screen for platforms, categories, products, plans, prices and review/refund queue.
- Added customer key catalog, purchase confirmation, Telegram key delivery with copy buttons, and key order history.
- Added USD/INR customer wallet display preference. Internal balance remains micro-USD; Telegram Stars is a payment method, not a wallet currency.
- Added manual deposit submission, admin approval/rejection, and add/edit/enable/disable/delete controls for manual payment methods.
- Kept existing users, wallet balances, language, branding, broadcast, referral and legacy SMM order data. New migrations are additive.

## Validation performed

- All 23 SQL migrations applied successfully to an in-memory SQLite database.
- TypeScript/TSX syntax transpilation passed for all 100 non-declaration source files.
- Full TypeScript typecheck, unit tests and production build were not completed: dependencies were not installed in this environment, and the runtime Node version is 22 while this project requires Node 24 or newer. Run the commands in README on Node 24+ before deployment.

## Required setup before live sales

- Rotate the reseller API token and master key that were pasted into chat.
- Add the replacement credentials in Admin → Providers; no credentials are hardcoded in this source.
- The supplied product table had blank PID columns. Enter verified PIDs and exact duration names in Admin → Key shop.
- Test with a provider-approved low-risk test product before opening sales.
- Configure and test manual payment instructions and conversion rates before accepting deposits.

## Not yet fully wired

- The earlier requested behavior of storing each wallet balance in the user's selected currency is not implemented in this update. This version keeps a canonical USD micro-unit balance and converts the display to INR. Changing the stored wallet denomination requires a separate accounting migration covering purchases, deposits, refunds, referral credits and ledger history.

- Manual deposit proof currently accepts a transaction reference/text value; image upload of payment receipts is not yet implemented.
- Key-store-specific editable Telegram message templates and bulk promotional message variables are not yet connected to the new delivery messages.
- The legacy SMM order/admin modules remain in source for historic data compatibility, but they are removed from the primary customer route and main admin navigation.
- Automated reconciliation of ambiguous provider timeouts is not possible unless the reseller API exposes an order lookup/idempotency endpoint. Admin review is intentionally required to prevent duplicate purchases.
