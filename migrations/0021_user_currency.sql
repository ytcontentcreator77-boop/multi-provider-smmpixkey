ALTER TABLE users ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
UPDATE users SET currency='USD' WHERE currency NOT IN ('USD','INR');
