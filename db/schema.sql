CREATE TABLE users (
  telegram_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  language_code TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  price_stars INTEGER DEFAULT 0,
  vip_only BOOLEAN DEFAULT FALSE,
  cover_url TEXT,
  content_url TEXT,
  rights_status TEXT DEFAULT 'pending',
  is_published BOOLEAN DEFAULT FALSE
);

CREATE TABLE memberships (
  telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
  status TEXT DEFAULT 'inactive',
  expires_at TIMESTAMPTZ
);

CREATE TABLE purchases (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT REFERENCES users(telegram_id),
  book_id TEXT REFERENCES books(id),
  telegram_payment_charge_id TEXT UNIQUE,
  total_amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'XTR'
);

CREATE TABLE favorites (
  telegram_id BIGINT REFERENCES users(telegram_id),
  book_id TEXT REFERENCES books(id),
  PRIMARY KEY (telegram_id, book_id)
);
