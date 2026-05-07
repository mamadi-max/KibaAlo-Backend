-- =======================================================
-- KibaAlo — Schéma complet de la base de données Supabase
-- Exécutez ce script dans Supabase > SQL Editor
-- =======================================================

-- Extension pour les UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis"; -- pour la géolocalisation (activez dans Supabase)

-- ======================
-- TABLE: users
-- ======================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone         VARCHAR(20) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('client', 'livreur', 'commercant')),
  country       VARCHAR(5) NOT NULL CHECK (country IN ('BF', 'NE')),
  city          VARCHAR(100) NOT NULL,
  avatar_url    TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  is_verified   BOOLEAN DEFAULT FALSE,
  premium_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: shops (commerçants)
-- ======================
CREATE TABLE IF NOT EXISTS shops (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  category      VARCHAR(50) NOT NULL CHECK (category IN (
    'food', 'grocery', 'pharma', 'tech', 'fashion', 'beauty', 'services', 'other'
  )),
  logo_url      TEXT,
  cover_url     TEXT,
  phone         VARCHAR(20),
  address       TEXT,
  city          VARCHAR(100) NOT NULL,
  country       VARCHAR(5) NOT NULL CHECK (country IN ('BF', 'NE')),
  latitude      DECIMAL(10,8),
  longitude     DECIMAL(11,8),
  is_open       BOOLEAN DEFAULT TRUE,
  is_active     BOOLEAN DEFAULT TRUE,
  delivery_fee  INTEGER DEFAULT 500,    -- en F CFA
  min_order     INTEGER DEFAULT 0,
  rating        DECIMAL(3,2) DEFAULT 0,
  rating_count  INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: products
-- ======================
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  price         INTEGER NOT NULL,        -- en F CFA
  category      VARCHAR(100),
  image_url     TEXT,
  emoji         VARCHAR(10) DEFAULT '📦',
  stock         INTEGER DEFAULT -1,      -- -1 = illimité
  is_available  BOOLEAN DEFAULT TRUE,
  is_featured   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: orders
-- ======================
CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number    VARCHAR(20) UNIQUE NOT NULL,
  client_id       UUID NOT NULL REFERENCES users(id),
  shop_id         UUID NOT NULL REFERENCES shops(id),
  livreur_id      UUID REFERENCES users(id),
  status          VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'in_route', 'delivered', 'cancelled', 'refunded'
  )),
  items           JSONB NOT NULL,         -- [{product_id, name, price, qty, emoji}]
  subtotal        INTEGER NOT NULL,
  delivery_fee    INTEGER NOT NULL DEFAULT 500,
  total           INTEGER NOT NULL,
  payment_method  VARCHAR(30) DEFAULT 'wallet',
  payment_status  VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  delivery_address TEXT,
  delivery_city   VARCHAR(100),
  delivery_lat    DECIMAL(10,8),
  delivery_lng    DECIMAL(11,8),
  notes           TEXT,
  estimated_time  INTEGER,               -- minutes
  confirmed_at    TIMESTAMPTZ,
  picked_up_at    TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: order_tracking (positions GPS)
-- ======================
CREATE TABLE IF NOT EXISTS order_tracking (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  livreur_id  UUID NOT NULL REFERENCES users(id),
  latitude    DECIMAL(10,8) NOT NULL,
  longitude   DECIMAL(11,8) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: livreurs (profils livreurs)
-- ======================
CREATE TABLE IF NOT EXISTS livreurs (
  id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type    VARCHAR(20) DEFAULT 'moto' CHECK (vehicle_type IN ('moto', 'velo', 'voiture', 'pied')),
  vehicle_plate   VARCHAR(30),
  id_card_url     TEXT,
  is_available    BOOLEAN DEFAULT FALSE,
  is_validated    BOOLEAN DEFAULT FALSE,
  current_lat     DECIMAL(10,8),
  current_lng     DECIMAL(11,8),
  last_seen       TIMESTAMPTZ DEFAULT NOW(),
  total_deliveries INTEGER DEFAULT 0,
  rating          DECIMAL(3,2) DEFAULT 0,
  rating_count    INTEGER DEFAULT 0,
  earnings_total  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: wallets
-- ======================
CREATE TABLE IF NOT EXISTS wallets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance    INTEGER NOT NULL DEFAULT 0,    -- en F CFA
  currency   VARCHAR(5) DEFAULT 'XOF',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: transactions
-- ======================
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  type            VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'debit', 'refund', 'withdrawal', 'fee')),
  amount          INTEGER NOT NULL,
  balance_before  INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  description     VARCHAR(255),
  reference       VARCHAR(100),
  order_id        UUID REFERENCES orders(id),
  payment_provider VARCHAR(30),
  status          VARCHAR(20) DEFAULT 'completed',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: services
-- ======================
CREATE TABLE IF NOT EXISTS services (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL REFERENCES users(id),
  type        VARCHAR(30) NOT NULL CHECK (type IN ('informatique', 'location', 'expedition', 'menage', 'autre')),
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  price       INTEGER,
  city        VARCHAR(100),
  country     VARCHAR(5),
  status      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  client_id   UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: parcels (expédition de colis)
-- ======================
CREATE TABLE IF NOT EXISTS parcels (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_code    VARCHAR(30) UNIQUE NOT NULL,
  sender_id        UUID NOT NULL REFERENCES users(id),
  sender_name      VARCHAR(100) NOT NULL,
  sender_phone     VARCHAR(20) NOT NULL,
  receiver_name    VARCHAR(100) NOT NULL,
  receiver_phone   VARCHAR(20) NOT NULL,
  origin_city      VARCHAR(100) NOT NULL,
  origin_country   VARCHAR(5) NOT NULL,
  dest_city        VARCHAR(100) NOT NULL,
  dest_country     VARCHAR(5) NOT NULL,
  weight_kg        DECIMAL(6,2),
  transport_company VARCHAR(100),
  price            INTEGER NOT NULL,
  status           VARCHAR(30) DEFAULT 'registered' CHECK (status IN (
    'registered', 'collected', 'in_transit', 'at_station', 'delivered', 'returned'
  )),
  estimated_days   INTEGER,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: notifications
-- ======================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  data       JSONB,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: reviews
-- ======================
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id),
  client_id   UUID NOT NULL REFERENCES users(id),
  shop_id     UUID REFERENCES shops(id),
  livreur_id  UUID REFERENCES users(id),
  shop_rating    INTEGER CHECK (shop_rating BETWEEN 1 AND 5),
  livreur_rating INTEGER CHECK (livreur_rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- TABLE: rentals (location d'équipements)
-- ======================
CREATE TABLE IF NOT EXISTS rentals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id    UUID NOT NULL REFERENCES users(id),
  device_name  VARCHAR(200) NOT NULL,
  device_type  VARCHAR(50),
  price_per_day INTEGER NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  total_price  INTEGER NOT NULL,
  status       VARCHAR(20) DEFAULT 'pending',
  city         VARCHAR(100),
  country      VARCHAR(5),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ======================
-- INDEX pour les performances
-- ======================
CREATE INDEX IF NOT EXISTS idx_orders_client     ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop       ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_livreur    ON orders(livreur_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_products_shop     ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_shops_city        ON shops(city);
CREATE INDEX IF NOT EXISTS idx_shops_category    ON shops(category);
CREATE INDEX IF NOT EXISTS idx_livreurs_available ON livreurs(is_available);
CREATE INDEX IF NOT EXISTS idx_notifs_user       ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tracking_order    ON order_tracking(order_id);

-- ======================
-- TRIGGERS (mise à jour automatique de updated_at)
-- ======================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_shops_updated    BEFORE UPDATE ON shops    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_orders_updated   BEFORE UPDATE ON orders   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_parcels_updated  BEFORE UPDATE ON parcels  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ======================
-- ROW LEVEL SECURITY (RLS)
-- ======================
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Politique : chaque utilisateur ne voit que ses propres données
CREATE POLICY "users_own" ON users         FOR ALL USING (auth.uid()::text = id::text);
CREATE POLICY "wallet_own" ON wallets      FOR ALL USING (auth.uid()::text = user_id::text);
CREATE POLICY "notifs_own" ON notifications FOR ALL USING (auth.uid()::text = user_id::text);

-- Les boutiques et produits sont publics en lecture
CREATE POLICY "shops_public_read"    ON shops    FOR SELECT USING (is_active = true);
CREATE POLICY "products_public_read" ON products FOR SELECT USING (is_available = true);

-- Commerçant peut gérer ses propres boutiques et produits
CREATE POLICY "shops_owner" ON shops    FOR ALL USING (auth.uid()::text = owner_id::text);
CREATE POLICY "products_owner" ON products FOR ALL USING (
  EXISTS (SELECT 1 FROM shops WHERE shops.id = products.shop_id AND shops.owner_id::text = auth.uid()::text)
);

-- Orders : client, commerçant, et livreur concernés
CREATE POLICY "orders_access" ON orders FOR ALL USING (
  auth.uid()::text = client_id::text OR
  auth.uid()::text = livreur_id::text OR
  EXISTS (SELECT 1 FROM shops WHERE shops.id = orders.shop_id AND shops.owner_id::text = auth.uid()::text)
);

-- ======================
-- DONNÉES DE TEST (seed)
-- ======================
-- Nota: les mots de passe seront hachés par l'API au vrai démarrage
-- Ces données servent juste pour les tests Supabase SQL Editor

INSERT INTO users (id, phone, first_name, last_name, password_hash, role, country, city) VALUES
  ('00000000-0000-0000-0000-000000000001', '+22670000001', 'Admin', 'KibaAlo', '$2b$10$example_hash', 'commercant', 'BF', 'Ouagadougou'),
  ('00000000-0000-0000-0000-000000000002', '+22670000002', 'Moussa',  'Kaboré',  '$2b$10$example_hash', 'livreur',    'BF', 'Ouagadougou'),
  ('00000000-0000-0000-0000-000000000003', '+22670000003', 'Aminata', 'Sawadogo','$2b$10$example_hash', 'client',     'BF', 'Bobo-Dioulasso')
ON CONFLICT DO NOTHING;

INSERT INTO wallets (user_id, balance) VALUES
  ('00000000-0000-0000-0000-000000000001', 150000),
  ('00000000-0000-0000-0000-000000000002', 48200),
  ('00000000-0000-0000-0000-000000000003', 47500)
ON CONFLICT DO NOTHING;
