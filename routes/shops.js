// routes/shops.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── GET /api/shops ─────────────────────────────────────────
// Liste des boutiques (filtrable par catégorie, ville, pays)
router.get('/', async (req, res) => {
  try {
    const { category, city, country, q, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabaseAdmin
      .from('shops')
      .select(`
        id, name, description, category, logo_url, cover_url,
        city, country, delivery_fee, min_order, rating, rating_count,
        is_open, phone, address, latitude, longitude
      `, { count: 'exact' })
      .eq('is_active', true)
      .order('rating', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (category && category !== 'all') query = query.eq('category', category);
    if (city)    query = query.ilike('city', `%${city}%`);
    if (country) query = query.eq('country', country);
    if (q)       query = query.ilike('name', `%${q}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ success: true, data, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[shops]', err);
    res.status(500).json({ success: false, message: 'Erreur chargement boutiques' });
  }
});

// ─── GET /api/shops/:id ─────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data: shop, error } = await supabaseAdmin
      .from('shops')
      .select(`*, users!owner_id(first_name, last_name, phone)`)
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single();

    if (error || !shop) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const { data: products } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('shop_id', req.params.id)
      .eq('is_available', true)
      .order('is_featured', { ascending: false });

    res.json({ success: true, data: { ...shop, products: products || [] } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ─── POST /api/shops ────────────────────────────────────────
// Créer une boutique (commerçants uniquement)
router.post('/', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { name, description, category, phone, address, city, country, latitude, longitude, deliveryFee, minOrder } = req.body;

    if (!name || !category || !city || !country) {
      return res.status(400).json({ success: false, message: 'Champs obligatoires: name, category, city, country' });
    }

    const { data: shop, error } = await supabaseAdmin
      .from('shops')
      .insert({
        owner_id: req.user.id, name, description, category,
        phone, address, city, country,
        latitude: latitude || null, longitude: longitude || null,
        delivery_fee: deliveryFee || 500,
        min_order: minOrder || 0
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data: shop });
  } catch (err) {
    console.error('[shops create]', err);
    res.status(500).json({ success: false, message: 'Erreur création boutique' });
  }
});

// ─── PUT /api/shops/:id ─────────────────────────────────────
router.put('/:id', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    // Vérifier propriété
    const { data: shop } = await supabaseAdmin
      .from('shops').select('owner_id').eq('id', req.params.id).single();

    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const allowed = ['name','description','category','phone','address','city','delivery_fee','min_order','is_open'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data, error } = await supabaseAdmin
      .from('shops').update(updates).eq('id', req.params.id).select().single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour boutique' });
  }
});

// ─── GET /api/shops/:id/products ────────────────────────────
router.get('/:id/products', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('shop_id', req.params.id)
      .eq('is_available', true)
      .order('is_featured', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement produits' });
  }
});

// ─── POST /api/shops/:id/products ───────────────────────────
router.post('/:id/products', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    // Vérifier que la boutique appartient au commerçant
    const { data: shop } = await supabaseAdmin
      .from('shops').select('owner_id').eq('id', req.params.id).single();

    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const { name, description, price, category, emoji, imageUrl, stock, isFeatured } = req.body;
    if (!name || !price) {
      return res.status(400).json({ success: false, message: 'name et price sont requis' });
    }

    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        shop_id: req.params.id,
        name, description, price: parseInt(price),
        category, emoji: emoji || '📦',
        image_url: imageUrl || null,
        stock: stock || -1,
        is_featured: isFeatured || false
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    console.error('[products create]', err);
    res.status(500).json({ success: false, message: 'Erreur création produit' });
  }
});

// ─── PUT /api/shops/:id/products/:productId ─────────────────
router.put('/:id/products/:productId', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin
      .from('shops').select('owner_id').eq('id', req.params.id).single();

    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const allowed = ['name','description','price','category','emoji','image_url','stock','is_available','is_featured'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data, error } = await supabaseAdmin
      .from('products').update(updates).eq('id', req.params.productId).select().single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour produit' });
  }
});

// ─── DELETE /api/shops/:id/products/:productId ──────────────
router.delete('/:id/products/:productId', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin
      .from('shops').select('owner_id').eq('id', req.params.id).single();

    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    await supabaseAdmin.from('products')
      .update({ is_available: false })
      .eq('id', req.params.productId);

    res.json({ success: true, message: 'Produit désactivé' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suppression produit' });
  }
});

// GET /api/shops/my-shop - Récupérer sa propre boutique
router.get('/my-shop', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { data: shop, error } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('owner_id', req.user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      return res.json({ success: true, data: null });
    }
    if (error) throw error;

    res.json({ success: true, data: shop });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement boutique' });
  }
});

// ─── GET /api/shops/my/dashboard ────────────────────────────
// Dashboard statistiques pour le commerçant
router.get('/my/dashboard', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { data: myShop } = await supabaseAdmin
      .from('shops').select('id').eq('owner_id', req.user.id).single();

    if (!myShop) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const shopId = myShop.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfDay   = new Date(now.setHours(0,0,0,0)).toISOString();

    // Commandes du mois
    const { data: monthOrders } = await supabaseAdmin
      .from('orders')
      .select('total, status, created_at')
      .eq('shop_id', shopId)
      .gte('created_at', startOfMonth);

    // Commandes du jour
    const { data: todayOrders } = await supabaseAdmin
      .from('orders')
      .select('id, status')
      .eq('shop_id', shopId)
      .gte('created_at', startOfDay);

    // Commandes en attente
    const { data: pendingOrders } = await supabaseAdmin
      .from('orders')
      .select(`
        id, order_number, status, total, items, created_at,
        users!client_id(first_name, last_name, phone)
      `)
      .eq('shop_id', shopId)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
      .order('created_at', { ascending: false })
      .limit(10);

    const revenue = (monthOrders || [])
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.total, 0);

    res.json({
      success: true,
      data: {
        shopId,
        monthRevenue: revenue,
        monthOrders: monthOrders?.length || 0,
        todayOrders: todayOrders?.length || 0,
        pendingOrders: pendingOrders || [],
        deliveredOrders: (monthOrders || []).filter(o => o.status === 'delivered').length
      }
    });
  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ success: false, message: 'Erreur dashboard' });
  }
});

module.exports = router;
