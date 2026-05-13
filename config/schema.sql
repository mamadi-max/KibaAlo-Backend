-- ================================================================
-- KibaAlo v2.0 — Schéma Base de données COMPLET
-- Afrique de l'Ouest — 16 pays
-- Exécutez dans Supabase > SQL Editor
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- TABLE: users (étendue)
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               VARCHAR(255) UNIQUE NOT NULL,
  phone               VARCHAR(25),
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL,
  password_hash       VARCHAR(255) NOT NULL,
  role                VARCHAR(20) NOT NULL CHECK (role IN ('client','livreur','commercant','admin')),
  country             VARCHAR(5) NOT NULL,
  city                VARCHAR(100) NOT NULL,
  address             TEXT,
  avatar_url          TEXT,
  -- Vérification
  is_email_verified   BOOLEAN DEFAULT FALSE,
  email_verify_token  VARCHAR(255),
  email_verify_expiry TIMESTAMPTZ,
  -- Réinitialisation mot de passe
  reset_password_token  VARCHAR(255),
  reset_password_expiry TIMESTAMPTZ,
  -- Vérification identité (KYC)
  kyc_status          VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending','submitted','verified','rejected')),
  kyc_id_type         VARCHAR(30),
  kyc_id_number       VARCHAR(100),
  kyc_id_front_url    TEXT,
  kyc_id_back_url     TEXT,
  kyc_selfie_url      TEXT,
  kyc_submitted_at    TIMESTAMPTZ,
  kyc_verified_at     TIMESTAMPTZ,
  kyc_reject_reason   TEXT,
  -- Statut
  is_active           BOOLEAN DEFAULT TRUE,
  is_suspended        BOOLEAN DEFAULT FALSE,
  suspend_reason      TEXT,
  -- Premium
  premium_plan        VARCHAR(20),
  premium_until       TIMESTAMPTZ,
  -- Préférences
  language            VARCHAR(5) DEFAULT 'fr',
  push_token          TEXT,
  notification_prefs  JSONB DEFAULT '{"email":true,"push":true,"sms":true}',
  -- Métadonnées
  last_login          TIMESTAMPTZ,
  login_count         INTEGER DEFAULT 0,
  device_info         JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: shops (étendue)
-- ================================================================
CREATE TABLE IF NOT EXISTS shops (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  slug              VARCHAR(200) UNIQUE,
  description       TEXT,
  category          VARCHAR(50) NOT NULL CHECK (category IN (
    'food','grocery','pharma','tech','fashion','beauty','services',
    'digital','electronics','books','health','home','auto','other'
  )),
  subcategory       VARCHAR(100),
  logo_url          TEXT,
  cover_url         TEXT,
  phone             VARCHAR(25),
  whatsapp          VARCHAR(25),
  email             VARCHAR(255),
  website           TEXT,
  address           TEXT,
  city              VARCHAR(100) NOT NULL,
  country           VARCHAR(5) NOT NULL,
  latitude          DECIMAL(10,8),
  longitude         DECIMAL(11,8),
  -- Horaires
  opening_hours     JSONB DEFAULT '{"mon":"08:00-20:00","tue":"08:00-20:00","wed":"08:00-20:00","thu":"08:00-20:00","fri":"08:00-20:00","sat":"09:00-18:00","sun":"closed"}',
  is_open           BOOLEAN DEFAULT TRUE,
  is_active         BOOLEAN DEFAULT TRUE,
  is_verified       BOOLEAN DEFAULT FALSE,
  is_featured       BOOLEAN DEFAULT FALSE,
  -- Livraison
  delivery_fee      INTEGER DEFAULT 500,
  free_delivery_min INTEGER DEFAULT 0,
  delivery_radius   INTEGER DEFAULT 15,
  min_order         INTEGER DEFAULT 0,
  estimated_time    INTEGER DEFAULT 30,
  -- Stats
  rating            DECIMAL(3,2) DEFAULT 0,
  rating_count      INTEGER DEFAULT 0,
  total_sales       INTEGER DEFAULT 0,
  total_orders      INTEGER DEFAULT 0,
  -- Paiements acceptés
  payment_methods   JSONB DEFAULT '["wallet","orange_money","moov_money","wave","mtn_money","cash"]',
  -- Paramètres
  auto_accept_orders BOOLEAN DEFAULT FALSE,
  commission_rate   DECIMAL(5,2) DEFAULT 10.00,
  bank_details      JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: products (étendue)
-- ================================================================
CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255),
  description     TEXT,
  long_description TEXT,
  price           INTEGER NOT NULL,
  compare_price   INTEGER,
  cost_price      INTEGER,
  category        VARCHAR(100),
  subcategory     VARCHAR(100),
  tags            TEXT[],
  image_url       TEXT,
  images          TEXT[],
  emoji           VARCHAR(10) DEFAULT '📦',
  stock           INTEGER DEFAULT -1,
  low_stock_alert INTEGER DEFAULT 5,
  unit            VARCHAR(30) DEFAULT 'unité',
  weight_kg       DECIMAL(6,2),
  -- Produit digital
  is_digital      BOOLEAN DEFAULT FALSE,
  digital_file_url TEXT,
  digital_file_type VARCHAR(30) CHECK (digital_file_type IN ('pdf','word','excel','powerpoint','video','audio','zip','other')),
  digital_file_size INTEGER,
  digital_password_template VARCHAR(255),
  digital_delivery_email BOOLEAN DEFAULT TRUE,
  -- Attributs
  attributes      JSONB,
  variants        JSONB,
  -- Statut
  is_available    BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,
  is_new          BOOLEAN DEFAULT FALSE,
  is_promo        BOOLEAN DEFAULT FALSE,
  promo_percent   INTEGER DEFAULT 0,
  promo_end       TIMESTAMPTZ,
  -- Stats
  view_count      INTEGER DEFAULT 0,
  order_count     INTEGER DEFAULT 0,
  rating          DECIMAL(3,2) DEFAULT 0,
  rating_count    INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: orders (étendue)
-- ================================================================
CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number        VARCHAR(25) UNIQUE NOT NULL,
  client_id           UUID NOT NULL REFERENCES users(id),
  shop_id             UUID NOT NULL REFERENCES shops(id),
  livreur_id          UUID REFERENCES users(id),
  -- Statut
  status              VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','confirmed','preparing','ready','picked_up',
    'in_route','delivered','cancelled','refunded','disputed'
  )),
  -- Articles
  items               JSONB NOT NULL,
  -- Prix
  subtotal            INTEGER NOT NULL,
  delivery_fee        INTEGER NOT NULL DEFAULT 500,
  discount_amount     INTEGER DEFAULT 0,
  promo_code          VARCHAR(50),
  tax_amount          INTEGER DEFAULT 0,
  total               INTEGER NOT NULL,
  -- Paiement
  payment_method      VARCHAR(30) DEFAULT 'wallet',
  payment_status      VARCHAR(20) DEFAULT 'pending',
  payment_reference   VARCHAR(100),
  payment_provider    VARCHAR(30),
  payment_paid_at     TIMESTAMPTZ,
  -- Facture
  invoice_number      VARCHAR(50),
  invoice_url         TEXT,
  invoice_generated   BOOLEAN DEFAULT FALSE,
  -- Livraison
  delivery_address    TEXT,
  delivery_city       VARCHAR(100),
  delivery_country    VARCHAR(5),
  delivery_lat        DECIMAL(10,8),
  delivery_lng        DECIMAL(11,8),
  delivery_instructions TEXT,
  -- Timing
  estimated_time      INTEGER DEFAULT 45,
  confirmed_at        TIMESTAMPTZ,
  preparing_at        TIMESTAMPTZ,
  ready_at            TIMESTAMPTZ,
  picked_up_at        TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,
  -- Évaluation
  is_reviewed         BOOLEAN DEFAULT FALSE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: digital_purchases (achats produits digitaux)
-- ================================================================
CREATE TABLE IF NOT EXISTS digital_purchases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES orders(id),
  product_id      UUID NOT NULL REFERENCES products(id),
  client_id       UUID NOT NULL REFERENCES users(id),
  client_email    VARCHAR(255) NOT NULL,
  download_password VARCHAR(100) NOT NULL,
  download_url    TEXT NOT NULL,
  download_count  INTEGER DEFAULT 0,
  max_downloads   INTEGER DEFAULT 5,
  expires_at      TIMESTAMPTZ,
  email_sent      BOOLEAN DEFAULT FALSE,
  email_sent_at   TIMESTAMPTZ,
  last_downloaded TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: invoices (factures)
-- ================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number  VARCHAR(50) UNIQUE NOT NULL,
  order_id        UUID NOT NULL REFERENCES orders(id),
  client_id       UUID NOT NULL REFERENCES users(id),
  shop_id         UUID NOT NULL REFERENCES shops(id),
  -- Données facture
  client_name     VARCHAR(255),
  client_email    VARCHAR(255),
  client_phone    VARCHAR(25),
  client_address  TEXT,
  shop_name       VARCHAR(255),
  shop_address    TEXT,
  shop_phone      VARCHAR(25),
  -- Montants
  subtotal        INTEGER NOT NULL,
  delivery_fee    INTEGER DEFAULT 0,
  discount        INTEGER DEFAULT 0,
  tax_rate        DECIMAL(5,2) DEFAULT 0,
  tax_amount      INTEGER DEFAULT 0,
  total           INTEGER NOT NULL,
  currency        VARCHAR(5) DEFAULT 'XOF',
  -- Fichier
  pdf_url         TEXT,
  -- Statut
  status          VARCHAR(20) DEFAULT 'generated',
  is_paid         BOOLEAN DEFAULT FALSE,
  paid_at         TIMESTAMPTZ,
  due_date        DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: payments (paiements détaillés)
-- ================================================================
CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID REFERENCES orders(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  amount              INTEGER NOT NULL,
  currency            VARCHAR(5) DEFAULT 'XOF',
  provider            VARCHAR(30) NOT NULL CHECK (provider IN (
    'orange_money','moov_money','wave','mtn_money','airtel_money',
    'free_money','card','wallet','cash','bank_transfer'
  )),
  provider_reference  VARCHAR(255),
  provider_response   JSONB,
  status              VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
    'pending','processing','completed','failed','cancelled','refunded'
  )),
  phone_number        VARCHAR(25),
  country             VARCHAR(5),
  initiated_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      TEXT,
  refunded_at         TIMESTAMPTZ,
  refund_amount       INTEGER,
  metadata            JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: wallets
-- ================================================================
CREATE TABLE IF NOT EXISTS wallets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance     INTEGER NOT NULL DEFAULT 0,
  locked      INTEGER NOT NULL DEFAULT 0,
  currency    VARCHAR(5) DEFAULT 'XOF',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: transactions
-- ================================================================
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  type            VARCHAR(20) NOT NULL CHECK (type IN (
    'credit','debit','refund','withdrawal','fee','commission','cashback','bonus'
  )),
  amount          INTEGER NOT NULL,
  balance_before  INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  description     VARCHAR(255),
  reference       VARCHAR(100),
  order_id        UUID REFERENCES orders(id),
  payment_id      UUID REFERENCES payments(id),
  status          VARCHAR(20) DEFAULT 'completed',
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: livreurs
-- ================================================================
CREATE TABLE IF NOT EXISTS livreurs (
  id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type      VARCHAR(20) DEFAULT 'moto' CHECK (vehicle_type IN ('moto','velo','voiture','tricycle','pied')),
  vehicle_brand     VARCHAR(100),
  vehicle_plate     VARCHAR(30),
  vehicle_year      INTEGER,
  vehicle_photo_url TEXT,
  id_card_url       TEXT,
  license_url       TEXT,
  is_available      BOOLEAN DEFAULT FALSE,
  is_validated      BOOLEAN DEFAULT FALSE,
  current_lat       DECIMAL(10,8),
  current_lng       DECIMAL(11,8),
  last_seen         TIMESTAMPTZ DEFAULT NOW(),
  total_deliveries  INTEGER DEFAULT 0,
  total_km          DECIMAL(10,2) DEFAULT 0,
  rating            DECIMAL(3,2) DEFAULT 0,
  rating_count      INTEGER DEFAULT 0,
  earnings_total    INTEGER DEFAULT 0,
  acceptance_rate   DECIMAL(5,2) DEFAULT 100.00,
  countries         TEXT[] DEFAULT ARRAY['BF'],
  cities            TEXT[],
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: parcels (étendue)
-- ================================================================
CREATE TABLE IF NOT EXISTS parcels (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_code     VARCHAR(30) UNIQUE NOT NULL,
  sender_id         UUID NOT NULL REFERENCES users(id),
  sender_name       VARCHAR(100) NOT NULL,
  sender_phone      VARCHAR(25) NOT NULL,
  sender_email      VARCHAR(255),
  receiver_name     VARCHAR(100) NOT NULL,
  receiver_phone    VARCHAR(25) NOT NULL,
  receiver_email    VARCHAR(255),
  origin_city       VARCHAR(100) NOT NULL,
  origin_country    VARCHAR(5) NOT NULL,
  dest_city         VARCHAR(100) NOT NULL,
  dest_country      VARCHAR(5) NOT NULL,
  weight_kg         DECIMAL(6,2),
  dimensions        JSONB,
  content_desc      TEXT,
  is_fragile        BOOLEAN DEFAULT FALSE,
  is_declared       BOOLEAN DEFAULT FALSE,
  declared_value    INTEGER,
  transport_company VARCHAR(100),
  price             INTEGER NOT NULL,
  insurance_amount  INTEGER DEFAULT 0,
  status            VARCHAR(30) DEFAULT 'registered' CHECK (status IN (
    'registered','collected','in_transit','at_station','out_for_delivery','delivered','returned','lost'
  )),
  estimated_days    INTEGER,
  tracking_history  JSONB DEFAULT '[]',
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: promo_codes
-- ================================================================
CREATE TABLE IF NOT EXISTS promo_codes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            VARCHAR(50) UNIQUE NOT NULL,
  type            VARCHAR(20) CHECK (type IN ('percent','fixed','free_delivery')),
  value           INTEGER NOT NULL,
  min_order       INTEGER DEFAULT 0,
  max_discount    INTEGER,
  shop_id         UUID REFERENCES shops(id),
  usage_limit     INTEGER,
  used_count      INTEGER DEFAULT 0,
  user_limit      INTEGER DEFAULT 1,
  is_active       BOOLEAN DEFAULT TRUE,
  starts_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: reviews
-- ================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES orders(id),
  client_id       UUID NOT NULL REFERENCES users(id),
  shop_id         UUID REFERENCES shops(id),
  livreur_id      UUID REFERENCES users(id),
  product_id      UUID REFERENCES products(id),
  shop_rating     INTEGER CHECK (shop_rating BETWEEN 1 AND 5),
  livreur_rating  INTEGER CHECK (livreur_rating BETWEEN 1 AND 5),
  product_rating  INTEGER CHECK (product_rating BETWEEN 1 AND 5),
  comment         TEXT,
  photos          TEXT[],
  is_verified     BOOLEAN DEFAULT TRUE,
  helpful_count   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: notifications
-- ================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  image_url   TEXT,
  action_url  TEXT,
  data        JSONB,
  is_read     BOOLEAN DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: services (services à domicile)
-- ================================================================
CREATE TABLE IF NOT EXISTS services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id   UUID NOT NULL REFERENCES users(id),
  type          VARCHAR(50) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  price         INTEGER,
  price_type    VARCHAR(20) DEFAULT 'fixed' CHECK (price_type IN ('fixed','hourly','quote')),
  city          VARCHAR(100),
  country       VARCHAR(5),
  rating        DECIMAL(3,2) DEFAULT 0,
  is_available  BOOLEAN DEFAULT TRUE,
  images        TEXT[],
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: service_requests
-- ================================================================
CREATE TABLE IF NOT EXISTS service_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id    UUID REFERENCES services(id),
  client_id     UUID NOT NULL REFERENCES users(id),
  provider_id   UUID NOT NULL REFERENCES users(id),
  description   TEXT,
  address       TEXT,
  scheduled_at  TIMESTAMPTZ,
  price         INTEGER,
  status        VARCHAR(20) DEFAULT 'pending',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: rentals
-- ================================================================
CREATE TABLE IF NOT EXISTS rentals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES users(id),
  device_name   VARCHAR(255) NOT NULL,
  device_type   VARCHAR(50),
  brand         VARCHAR(100),
  price_per_day INTEGER NOT NULL,
  deposit       INTEGER DEFAULT 0,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  total_days    INTEGER,
  total_price   INTEGER NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending',
  city          VARCHAR(100),
  country       VARCHAR(5),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: order_tracking
-- ================================================================
CREATE TABLE IF NOT EXISTS order_tracking (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  livreur_id  UUID NOT NULL REFERENCES users(id),
  latitude    DECIMAL(10,8) NOT NULL,
  longitude   DECIMAL(11,8) NOT NULL,
  speed       DECIMAL(5,2),
  heading     INTEGER,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: saved_addresses
-- ================================================================
CREATE TABLE IF NOT EXISTS saved_addresses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       VARCHAR(50) NOT NULL,
  address     TEXT NOT NULL,
  city        VARCHAR(100),
  country     VARCHAR(5),
  latitude    DECIMAL(10,8),
  longitude   DECIMAL(11,8),
  is_default  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: wishlists (favoris)
-- ================================================================
CREATE TABLE IF NOT EXISTS wishlists (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- ================================================================
-- TABLE: search_history
-- ================================================================
CREATE TABLE IF NOT EXISTS search_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query       VARCHAR(255) NOT NULL,
  results_count INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- TABLE: admin_logs
-- ================================================================
CREATE TABLE IF NOT EXISTS admin_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id   UUID,
  details     JSONB,
  ip_address  VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone        ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role);
CREATE INDEX IF NOT EXISTS idx_shops_owner        ON shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_shops_category     ON shops(category);
CREATE INDEX IF NOT EXISTS idx_shops_city         ON shops(city, country);
CREATE INDEX IF NOT EXISTS idx_shops_active       ON shops(is_active, is_open);
CREATE INDEX IF NOT EXISTS idx_products_shop      ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_digital   ON products(is_digital);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available);
CREATE INDEX IF NOT EXISTS idx_orders_client      ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop        ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_livreur     ON orders(livreur_id);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order     ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user      ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);
CREATE INDEX IF NOT EXISTS idx_invoices_order     ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client    ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_digital_order      ON digital_purchases(order_id);
CREATE INDEX IF NOT EXISTS idx_digital_client     ON digital_purchases(client_id);
CREATE INDEX IF NOT EXISTS idx_tracking_order     ON order_tracking(order_id);
CREATE INDEX IF NOT EXISTS idx_notifs_user        ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_txn_user           ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishlists_user     ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_search_user        ON search_history(user_id, created_at DESC);

-- ================================================================
-- FULL TEXT SEARCH sur produits et boutiques
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_products_fts ON products
  USING gin(to_tsvector('french', coalesce(name,'') || ' ' || coalesce(description,'')));

CREATE INDEX IF NOT EXISTS idx_shops_fts ON shops
  USING gin(to_tsvector('french', coalesce(name,'') || ' ' || coalesce(description,'')));

-- ================================================================
-- TRIGGERS
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_upd    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_shops_upd    BEFORE UPDATE ON shops    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_products_upd BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_upd   BEFORE UPDATE ON orders   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_parcels_upd  BEFORE UPDATE ON parcels  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: générer le slug de boutique
CREATE OR REPLACE FUNCTION generate_shop_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(NEW.id::text, 1, 8);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shop_slug BEFORE INSERT ON shops FOR EACH ROW EXECUTE FUNCTION generate_shop_slug();

-- ================================================================
-- ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_purchases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_addresses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlists          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own"          ON users              FOR ALL USING (auth.uid()::text = id::text);
CREATE POLICY "wallet_own"         ON wallets            FOR ALL USING (auth.uid()::text = user_id::text);
CREATE POLICY "notifs_own"         ON notifications      FOR ALL USING (auth.uid()::text = user_id::text);
CREATE POLICY "addresses_own"      ON saved_addresses    FOR ALL USING (auth.uid()::text = user_id::text);
CREATE POLICY "wishlists_own"      ON wishlists          FOR ALL USING (auth.uid()::text = user_id::text);
CREATE POLICY "digital_own"        ON digital_purchases  FOR ALL USING (auth.uid()::text = client_id::text);
CREATE POLICY "shops_public_read"  ON shops              FOR SELECT USING (is_active = true);
CREATE POLICY "products_pub_read"  ON products           FOR SELECT USING (is_available = true);
CREATE POLICY "shops_owner_write"  ON shops              FOR ALL USING (auth.uid()::text = owner_id::text);
CREATE POLICY "products_owner"     ON products           FOR ALL USING (
  EXISTS (SELECT 1 FROM shops WHERE shops.id = products.shop_id AND shops.owner_id::text = auth.uid()::text)
);
CREATE POLICY "orders_access"      ON orders             FOR ALL USING (
  auth.uid()::text = client_id::text OR auth.uid()::text = livreur_id::text OR
  EXISTS (SELECT 1 FROM shops WHERE shops.id = orders.shop_id AND shops.owner_id::text = auth.uid()::text)
);
