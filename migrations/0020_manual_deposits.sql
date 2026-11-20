CREATE TABLE manual_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  method_id TEXT NOT NULL REFERENCES payment_methods(id),
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  credit INTEGER NOT NULL,
  proof TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX manual_deposits_status ON manual_deposits(status,id DESC);
CREATE INDEX manual_deposits_user ON manual_deposits(user_id,id DESC);
