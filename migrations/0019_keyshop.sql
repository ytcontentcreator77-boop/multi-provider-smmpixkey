-- Key-store catalog and reseller API delivery. Existing users, wallets, ledger and SMM history are retained.
ALTER TABLE providers ADD COLUMN api_mode TEXT NOT NULL DEFAULT 'smm_v2';
ALTER TABLE providers ADD COLUMN master_key TEXT;
ALTER TABLE providers ADD COLUMN android_required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE key_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE key_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id INTEGER NOT NULL REFERENCES key_platforms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(platform_id, slug)
);
CREATE TABLE key_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES key_categories(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  product_pid TEXT NOT NULL,
  android_required INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX key_products_category ON key_products(category_id, enabled, sort);
CREATE TABLE key_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES key_products(id) ON DELETE CASCADE,
  duration_label TEXT NOT NULL,
  provider_duration TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price >= 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, provider_duration)
);
CREATE TABLE key_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES key_products(id),
  plan_id INTEGER NOT NULL REFERENCES key_plans(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  product_name TEXT NOT NULL,
  duration_label TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  charge INTEGER NOT NULL,
  provider_cost REAL,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX key_orders_user ON key_orders(user_id, id DESC);
CREATE INDEX key_orders_status ON key_orders(status, id DESC);
CREATE TABLE key_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES key_orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  key_value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX key_deliveries_user ON key_deliveries(user_id, id DESC);
