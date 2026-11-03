CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  language_code TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  year INTEGER,
  price_stars INTEGER NOT NULL DEFAULT 0,
  vip_only BOOLEAN NOT NULL DEFAULT FALSE,
  cover_url TEXT,
  content_url TEXT,
  rights_status TEXT NOT NULL DEFAULT 'pending',
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
  status TEXT NOT NULL DEFAULT 'inactive',
  provider TEXT NOT NULL DEFAULT 'telegram_stars',
  subscription_charge_id TEXT,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  book_id TEXT NOT NULL REFERENCES books(id),
  telegram_payment_charge_id TEXT UNIQUE NOT NULL,
  total_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XTR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
  book_id TEXT NOT NULL REFERENCES books(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (telegram_id, book_id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGSERIAL PRIMARY KEY,
  telegram_payment_charge_id TEXT UNIQUE NOT NULL,
  telegram_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
