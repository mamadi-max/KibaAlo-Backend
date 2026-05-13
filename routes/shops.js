// routes/shops.js — KibaAlo v2 — Boutiques + Filtres avancés + Produits digitaux
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// ── GET /api/shops — Recherche & Filtres avancés ─────────
router.get('/', async (req, res) => {
  try {
    const {
      q, category, subcategory, city, country,
      minRating, maxDeliveryFee, freeDelivery,
      isOpen, isFeatured, isVerified,
      sortBy = 'rating', sortDir = 'desc',
      page = 1, limit = 20,
      lat, lng, radius = 15,
    } = req.query;

    const offset = (parseInt(page)-1) * parseInt(limit);

    let query = supabaseAdmin
      .from('shops')
      .select(`
        id, name, slug, description, category, subcategory,
        logo_url, cover_url, emoji, phone, whatsapp,
        city, country, address, latitude, longitude,
        delivery_fee, free_delivery_min, estimated_time, min_order,
        rating, rating_count, total_orders, is_open, is_verified, is_featured,
        payment_methods, opening_hours
      `, { count: 'exact' })
      .eq('is_active', true)
      .range(offset, offset + parseInt(limit) - 1);

    // ── Filtres ───────────────────────────────────────────
    if (category && category !== 'all') query = query.eq('category', category);
    if (subcategory)  query = query.eq('subcategory', subcategory);
    if (city)         query = query.ilike('city', `%${city}%`);
    if (country)      query = query.eq('country', country);
    if (isOpen === 'true')     query = query.eq('is_open', true);
    if (isFeatured === 'true') query = query.eq('is_featured', true);
    if (isVerified === 'true') query = query.eq('is_verified', true);
    if (minRating)    query = query.gte('rating', parseFloat(minRating));
    if (maxDeliveryFee) query = query.lte('delivery_fee', parseInt(maxDeliveryFee));
    if (freeDelivery === 'true') query = query.eq('delivery_fee', 0);

    // Recherche textuelle
    if (q) {
      query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
    }

    // Tri
    const sortableColumns = { rating:'rating', orders:'total_orders', name:'name', delivery:'delivery_fee', time:'estimated_time' };
    const col = sortableColumns[sortBy] || 'rating';
    query = query.order(col, { ascending: sortDir === 'asc' });

    const { data, error, count } = await query;
    if (error) throw error;

    // Filtre par distance GPS (si lat/lng fournis)
    let filteredData = data || [];
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxKm   = parseFloat(radius);
      filteredData = filteredData
        .filter(s => {
          if (!s.latitude || !s.longitude) return true; // inclure ceux sans coords
          const d = haversineKm(userLat, userLng, s.latitude, s.longitude);
          return d <= maxKm;
        })
        .map(s => ({
          ...s,
          distance_km: s.latitude ? Math.round(haversineKm(userLat, userLng, s.latitude, s.longitude) * 10) / 10 : null,
        }))
        .sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
    }

    res.json({ success: true, data: filteredData, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[shops]', err);
    res.status(500).json({ success: false, message: 'Erreur chargement boutiques' });
  }
});

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// ── GET /api/shops/categories ─────────────────────────────
router.get('/categories', async (req, res) => {
  const categories = [
    { id:'food',        emoji:'🍔', label:'Restauration',    sub:['Maquis','Fast food','Pâtisserie','Pizzeria'] },
    { id:'grocery',     emoji:'🛒', label:'Épicerie',         sub:['Supermarché','Épicerie','Bio','Import'] },
    { id:'pharma',      emoji:'💊', label:'Pharmacie',        sub:['Médicaments','Parapharmacie','Optique'] },
    { id:'tech',        emoji:'📱', label:'Téléphonie/Tech',  sub:['Téléphones','Accessoires','Réparation','Ordinateurs'] },
    { id:'fashion',     emoji:'👗', label:'Mode',             sub:['Vêtements','Chaussures','Maroquinerie','Bijoux'] },
    { id:'beauty',      emoji:'💄', label:'Beauté',           sub:['Cosmétiques','Coiffure','Soins','Parfums'] },
    { id:'electronics', emoji:'📺', label:'Électroménager',   sub:['TV','Réfrigérateur','Climatiseur','Cuisine'] },
    { id:'health',      emoji:'🏥', label:'Santé',            sub:['Clinique','Dentiste','Optique','Sport'] },
    { id:'books',       emoji:'📚', label:'Livres/Presse',    sub:['Romans','Scolaire','Magazines','Papeterie'] },
    { id:'home',        emoji:'🏠', label:'Maison',           sub:['Meubles','Décoration','Jardinage','Quincaillerie'] },
    { id:'auto',        emoji:'🚗', label:'Auto/Moto',        sub:['Pièces','Garage','Accessoires','Location'] },
    { id:'digital',     emoji:'💻', label:'Produits Digitaux',sub:['Formations','Documents','Logiciels','Templates'] },
    { id:'services',    emoji:'🔧', label:'Services',         sub:['Plomberie','Électricité','Informatique','Ménage'] },
    { id:'other',       emoji:'📦', label:'Autre',            sub:[] },
  ];
  res.json({ success: true, data: categories });
});

// ── GET /api/shops/:idOrSlug ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const idOrSlug = req.params.id;
    let query = supabaseAdmin
      .from('shops')
      .select(`*, owner:users!owner_id(first_name, last_name, phone, avatar_url, kyc_status)`)
      .eq('is_active', true);

    // UUID ou slug
    if (idOrSlug.match(/^[0-9a-f-]{36}$/i)) query = query.eq('id', idOrSlug);
    else query = query.eq('slug', idOrSlug);

    const { data: shop, error } = await query.single();
    if (error || !shop) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    // Charger les produits
    const { data: products } = await supabaseAdmin
      .from('products').select('*').eq('shop_id', shop.id).eq('is_available', true)
      .order('is_featured', { ascending: false }).order('created_at', { ascending: false });

    // Stats
    const { count: reviewCount } = await supabaseAdmin
      .from('reviews').select('id', { count:'exact', head:true }).eq('shop_id', shop.id);

    res.json({ success: true, data: { ...shop, products: products || [], reviewCount: reviewCount || 0 } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ── POST /api/shops ───────────────────────────────────────
router.post('/', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const {
      name, description, category, subcategory,
      phone, whatsapp, email, website,
      address, city, country, latitude, longitude,
      deliveryFee, freeDeliveryMin, minOrder, estimatedTime, deliveryRadius,
      openingHours, paymentMethods, autoAcceptOrders,
    } = req.body;

    if (!name || !category || !city || !country) {
      return res.status(400).json({ success: false, message: 'name, category, city, country requis' });
    }

    const { data: shop, error } = await supabaseAdmin
      .from('shops').insert({
        owner_id: req.user.id, name, description, category,
        subcategory: subcategory || null,
        phone: phone || req.user.phone, whatsapp: whatsapp || phone,
        email: email || req.user.email, website: website || null,
        address, city, country,
        latitude: latitude || null, longitude: longitude || null,
        delivery_fee: deliveryFee || 500,
        free_delivery_min: freeDeliveryMin || 0,
        min_order: minOrder || 0,
        estimated_time: estimatedTime || 30,
        delivery_radius: deliveryRadius || 15,
        opening_hours: openingHours || undefined,
        payment_methods: paymentMethods || undefined,
        auto_accept_orders: autoAcceptOrders || false,
      }).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, data: shop, message: '🏪 Boutique créée avec succès !' });
  } catch (err) {
    console.error('[shops create]', err);
    res.status(500).json({ success: false, message: 'Erreur création boutique' });
  }
});

// ── PUT /api/shops/:id ────────────────────────────────────
router.put('/:id', authenticate, requireRole('commercant','admin'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin
      .from('shops').select('owner_id').eq('id', req.params.id).single();
    if (!shop || (shop.owner_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const allowed = ['name','description','category','subcategory','phone','whatsapp','email','website',
      'address','city','latitude','longitude','delivery_fee','free_delivery_min','min_order',
      'estimated_time','delivery_radius','opening_hours','payment_methods','auto_accept_orders','is_open'];
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

// ── POST /api/shops/:id/logo ──────────────────────────────
router.post('/:id/logo', authenticate, requireRole('commercant'), upload.single('logo'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', req.params.id).single();
    if (!shop || shop.owner_id !== req.user.id) return res.status(403).json({ success: false, message: 'Accès refusé' });
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier' });

    const logoUrl = req.file.path || req.file.secure_url;
    await supabaseAdmin.from('shops').update({ logo_url: logoUrl }).eq('id', req.params.id);
    res.json({ success: true, logoUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur upload logo' });
  }
});

// ── GET /api/shops/:id/products ───────────────────────────
router.get('/:id/products', async (req, res) => {
  try {
    const { category, isDigital, isFeatured, minPrice, maxPrice, q, sortBy = 'created_at', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);

    let query = supabaseAdmin
      .from('products').select('*', { count:'exact' })
      .eq('shop_id', req.params.id)
      .eq('is_available', true)
      .range(offset, offset+parseInt(limit)-1);

    if (category)             query = query.eq('category', category);
    if (isDigital === 'true') query = query.eq('is_digital', true);
    if (isDigital === 'false')query = query.eq('is_digital', false);
    if (isFeatured === 'true')query = query.eq('is_featured', true);
    if (minPrice)             query = query.gte('price', parseInt(minPrice));
    if (maxPrice)             query = query.lte('price', parseInt(maxPrice));
    if (q)                    query = query.ilike('name', `%${q}%`);

    const sortMap = { created_at:'created_at', price:'price', name:'name', rating:'rating', orders:'order_count' };
    query = query.order(sortMap[sortBy]||'created_at', { ascending: false });
    query = query.order('is_featured', { ascending: false });

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ success: true, data: data || [], total: count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement produits' });
  }
});

// ── POST /api/shops/:id/products ──────────────────────────
router.post('/:id/products', authenticate, requireRole('commercant'), upload.array('images', 5), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', req.params.id).single();
    if (!shop || shop.owner_id !== req.user.id) return res.status(403).json({ success: false, message: 'Accès refusé' });

    const {
      name, description, longDescription, price, comparePrice, costPrice,
      category, subcategory, tags, emoji, stock, unit, weightKg,
      isDigital, digitalFileUrl, digitalFileType, digitalFileSize,
      isFeatured, isNew, isPromo, promoPercent, attributes, variants,
    } = req.body;

    if (!name || !price) return res.status(400).json({ success: false, message: 'name et price requis' });

    // Gérer les images uploadées
    const imageUrls = (req.files || []).map(f => f.path || f.secure_url);

    const { data: product, error } = await supabaseAdmin
      .from('products').insert({
        shop_id: req.params.id, name,
        description: description || null,
        long_description: longDescription || null,
        price: parseInt(price),
        compare_price: comparePrice ? parseInt(comparePrice) : null,
        cost_price: costPrice ? parseInt(costPrice) : null,
        category: category || null,
        subcategory: subcategory || null,
        tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
        image_url: imageUrls[0] || null,
        images: imageUrls,
        emoji: emoji || '📦',
        stock: stock !== undefined ? parseInt(stock) : -1,
        unit: unit || 'unité',
        weight_kg: weightKg ? parseFloat(weightKg) : null,
        // Digital
        is_digital: isDigital === true || isDigital === 'true',
        digital_file_url: digitalFileUrl || null,
        digital_file_type: digitalFileType || null,
        digital_file_size: digitalFileSize ? parseInt(digitalFileSize) : null,
        // Flags
        is_featured: isFeatured === 'true' || !!isFeatured,
        is_new: isNew === 'true' || !!isNew,
        is_promo: isPromo === 'true' || !!isPromo,
        promo_percent: promoPercent ? parseInt(promoPercent) : 0,
        // Variantes
        attributes: attributes ? JSON.parse(attributes) : null,
        variants: variants ? JSON.parse(variants) : null,
      }).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, data: product, message: '✅ Produit ajouté !' });
  } catch (err) {
    console.error('[products create]', err);
    res.status(500).json({ success: false, message: 'Erreur ajout produit' });
  }
});

// ── PUT /api/shops/:id/products/:pid ─────────────────────
router.put('/:id/products/:pid', authenticate, requireRole('commercant','admin'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', req.params.id).single();
    if (!shop || (shop.owner_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const allowed = ['name','description','long_description','price','compare_price','category',
      'subcategory','tags','emoji','stock','unit','is_available','is_featured','is_new',
      'is_promo','promo_percent','image_url','images','attributes','variants',
      'digital_file_url','digital_file_type','is_digital'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data, error } = await supabaseAdmin
      .from('products').update(updates).eq('id', req.params.pid).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour produit' });
  }
});

// ── DELETE /api/shops/:id/products/:pid ──────────────────
router.delete('/:id/products/:pid', authenticate, requireRole('commercant','admin'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', req.params.id).single();
    if (!shop || (shop.owner_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }
    await supabaseAdmin.from('products').update({ is_available: false }).eq('id', req.params.pid);
    res.json({ success: true, message: 'Produit désactivé' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suppression' });
  }
});

// ── GET /api/shops/my/dashboard ───────────────────────────
router.get('/my/dashboard', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { data: shop } = await supabaseAdmin
      .from('shops').select('*').eq('owner_id', req.user.id).limit(1).single();
    if (!shop) return res.status(404).json({ success: false, message: 'Boutique introuvable' });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfWeek  = new Date(now.setDate(now.getDate() - now.getDay())).toISOString();
    const startOfDay   = new Date(new Date().setHours(0,0,0,0)).toISOString();

    const [
      { data: allOrders },
      { data: pendingOrders },
      { data: weekOrders },
      { data: products },
      { data: reviews },
    ] = await Promise.all([
      supabaseAdmin.from('orders').select('total, status, created_at').eq('shop_id', shop.id).gte('created_at', startOfMonth),
      supabaseAdmin.from('orders').select(`id, order_number, status, total, items, created_at, users!client_id(first_name, last_name, phone, avatar_url)`).eq('shop_id', shop.id).in('status', ['pending','confirmed','preparing','ready']).order('created_at', { ascending: false }).limit(20),
      supabaseAdmin.from('orders').select('total, status, created_at').eq('shop_id', shop.id).gte('created_at', startOfWeek),
      supabaseAdmin.from('products').select('id, name, price, stock, order_count, is_available').eq('shop_id', shop.id).order('order_count', { ascending: false }).limit(5),
      supabaseAdmin.from('reviews').select('shop_rating').eq('shop_id', shop.id).gte('created_at', startOfMonth),
    ]);

    const completed = (allOrders||[]).filter(o => o.status === 'delivered');
    const monthRevenue = completed.reduce((s,o) => s + o.total, 0);
    const weekRevenue  = (weekOrders||[]).filter(o => o.status === 'delivered').reduce((s,o) => s + o.total, 0);
    const avgRating    = reviews?.length ? reviews.reduce((s,r) => s + r.shop_rating, 0) / reviews.length : 0;

    // Chiffre d'affaires par jour (7 derniers jours)
    const revenueByDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const dayStr = d.toISOString().split('T')[0];
      const dayRevenue = (allOrders||[])
        .filter(o => o.status === 'delivered' && o.created_at.startsWith(dayStr))
        .reduce((s,o) => s + o.total, 0);
      revenueByDay.push({ date: dayStr, revenue: dayRevenue, label: ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][d.getDay()] });
    }

    res.json({
      success: true,
      data: {
        shopId: shop.id,
        shop,
        monthRevenue,
        weekRevenue,
        monthOrders: allOrders?.length || 0,
        deliveredOrders: completed.length,
        pendingOrders: pendingOrders || [],
        topProducts: products || [],
        avgRating: Math.round(avgRating * 10) / 10,
        revenueByDay,
      },
    });
  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ success: false, message: 'Erreur dashboard' });
  }
});

// ── GET /api/shops/:id/reviews ────────────────────────────
router.get('/:id/reviews', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('reviews')
      .select('*, client:users!client_id(first_name, avatar_url)')
      .eq('shop_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(20);
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement avis' });
  }
});

// ── POST /api/shops/:id/promo ──────────────────────────────
router.post('/:id/promo', authenticate, requireRole('commercant','admin'), async (req, res) => {
  try {
    const { code, type, value, minOrder, maxDiscount, usageLimit, expiresAt } = req.body;
    if (!code || !type || !value) return res.status(400).json({ success: false, message: 'code, type, value requis' });

    const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', req.params.id).single();
    if (!shop || shop.owner_id !== req.user.id) return res.status(403).json({ success: false, message: 'Accès refusé' });

    const { data, error } = await supabaseAdmin.from('promo_codes').insert({
      code: code.toUpperCase(), type, value: parseInt(value),
      min_order: minOrder || 0,
      max_discount: maxDiscount || null,
      shop_id: req.params.id,
      usage_limit: usageLimit || null,
      expires_at: expiresAt || null,
    }).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, data, message: `Code promo "${code}" créé !` });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Ce code existe déjà' });
    res.status(500).json({ success: false, message: 'Erreur création code promo' });
  }
});

// ── POST /api/shops/validate-promo ────────────────────────
router.post('/validate-promo', authenticate, async (req, res) => {
  try {
    const { code, shopId, orderAmount } = req.body;
    const { data: promo } = await supabaseAdmin
      .from('promo_codes').select('*')
      .eq('code', code.toUpperCase()).eq('is_active', true)
      .or(`shop_id.is.null,shop_id.eq.${shopId}`)
      .single();

    if (!promo) return res.status(404).json({ success: false, message: 'Code promo invalide' });
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.status(400).json({ success: false, message: 'Code promo expiré' });
    if (orderAmount < promo.min_order) return res.status(400).json({ success: false, message: `Commande minimum: ${promo.min_order.toLocaleString()} F` });
    if (promo.usage_limit && promo.used_count >= promo.usage_limit) return res.status(400).json({ success: false, message: 'Code promo épuisé' });

    let discount = 0;
    if (promo.type === 'percent') discount = Math.floor(orderAmount * promo.value / 100);
    else if (promo.type === 'fixed') discount = promo.value;
    if (promo.max_discount) discount = Math.min(discount, promo.max_discount);

    res.json({ success: true, data: promo, discount, message: `✅ Code valide ! Réduction: ${discount.toLocaleString()} F` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur validation code promo' });
  }
});

// GET /api/shops/my-shop - Récupérer sa propre boutique (pour commerçant)
router.get('/my-shop', authenticate, requireRole('commercant'), async (req, res) => {
  try {
    const { data: shop, error } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('owner_id', req.user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // Pas de boutique trouvée
      return res.json({ success: true, data: null });
    }
    if (error) throw error;

    res.json({ success: true, data: shop });
  } catch (err) {
    console.error('[my-shop]', err);
    res.status(500).json({ success: false, message: 'Erreur chargement boutique' });
  }
});
module.exports = router;
