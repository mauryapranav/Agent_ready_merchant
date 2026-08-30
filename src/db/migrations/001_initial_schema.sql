-- Settle Database Schema v1
-- Core tables for persistent state

-- Merchants / Tenants
CREATE TABLE IF NOT EXISTS merchants (
  merchant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  razorpay_key_id TEXT,
  razorpay_key_secret TEXT,
  razorpay_webhook_secret TEXT,
  razorpay_env TEXT NOT NULL DEFAULT 'test',
  floor_margin_pct INT NOT NULL DEFAULT 12,
  max_releases_per_day INT NOT NULL DEFAULT 50,
  daily_release_budget_paise BIGINT NOT NULL DEFAULT 500000,
  cooldown_minutes INT NOT NULL DEFAULT 30,
  waterfall_config JSONB NOT NULL DEFAULT '[
    {"step": "funded_campaign", "enabled": true},
    {"step": "rail_offer", "enabled": true},
    {"step": "bundle_swap", "enabled": true},
    {"step": "price_cut", "enabled": true}
  ]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaigns (brand-funded or merchant-marketing)
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  flat_off_paise BIGINT NOT NULL,
  min_cart_paise BIGINT NOT NULL,
  funded_by TEXT NOT NULL CHECK (funded_by IN ('brand', 'merchant_marketing')),
  remaining_budget_paise BIGINT NOT NULL,
  total_budget_paise BIGINT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rail Offers (bank/network funded discounts)
CREATE TABLE IF NOT EXISTS rail_offers (
  offer_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  rail TEXT NOT NULL CHECK (rail IN ('upi', 'card', 'netbanking', 'wallet')),
  label TEXT NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL,
  max_discount_paise BIGINT NOT NULL,
  funded_by TEXT NOT NULL CHECK (funded_by IN ('bank', 'network', 'merchant')),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products / Catalog
CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  price_paise BIGINT NOT NULL,
  cost_paise BIGINT NOT NULL,
  image_hint TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Swap Alternatives (for bundle_swap step)
CREATE TABLE IF NOT EXISTS swap_alternatives (
  from_sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  to_sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  PRIMARY KEY (from_sku, to_sku)
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  sku TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  total_qty INT NOT NULL DEFAULT 0,
  reserved_qty INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inventory Reservations
CREATE TABLE IF NOT EXISTS inventory_reservations (
  reservation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sku TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  qty INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'released', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (checkout sessions)
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  mandate_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  cart_items JSONB NOT NULL,
  cart_total_paise BIGINT NOT NULL,
  cart_hash TEXT NOT NULL,
  hard_cap_paise BIGINT NOT NULL,
  flex_rule JSONB,
  attachment_criteria JSONB,
  allowed_rails TEXT[] NOT NULL,
  policy_snapshot JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'offered', 'accepted', 'paid', 'aborted', 'paused_for_human')),
  outcome TEXT,
  final_total_paise BIGINT,
  paid_via TEXT,
  razorpay_order_id TEXT,
  offer_snapshot JSONB,
  buyer_ledger JSONB,
  merchant_ledger JSONB,
  tip_signatures JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Release Ledger (merchant discount releases)
CREATE TABLE IF NOT EXISTS release_ledger (
  id BIGSERIAL PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  step TEXT NOT NULL CHECK (step IN ('funded_campaign', 'rail_offer', 'bundle_swap', 'price_cut')),
  discount_paise BIGINT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Events (for both buyer and merchant ledgers)
CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('buyer', 'merchant')),
  session_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  event_data JSONB NOT NULL,
  chain_hash TEXT NOT NULL,
  signature TEXT,
  key_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Signing Keys (for key rotation)
CREATE TABLE IF NOT EXISTS signing_keys (
  key_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  private_key_pem TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'Ed25519',
  epoch_start TIMESTAMPTZ NOT NULL,
  epoch_end TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin Users (for merchant console auth)
CREATE TABLE IF NOT EXISTS admin_users (
  user_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys (for programmatic access)
CREATE TABLE IF NOT EXISTS api_keys (
  key_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_merchant_active ON campaigns(merchant_id, is_active, valid_to);
CREATE INDEX IF NOT EXISTS idx_rail_offers_merchant_active ON rail_offers(merchant_id, is_active, valid_to);
CREATE INDEX IF NOT EXISTS idx_products_merchant_active ON products(merchant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_session ON inventory_reservations(session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expires ON inventory_reservations(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sessions_merchant ON sessions(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_release_ledger_merchant_date ON release_ledger(merchant_id, released_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events(session_id, ledger_type, created_at);
CREATE INDEX IF NOT EXISTS idx_signing_keys_merchant_active ON signing_keys(merchant_id, is_active, epoch_start);