// routes/payments.js — KibaAlo v2
const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const PaymentService = require('../services/payment');
const { supabaseAdmin } = require('../config/supabase');

router.get('/providers/:country', (req, res) => {
  const providers = PaymentService.getProvidersByCountry(req.params.country.toUpperCase());
  res.json({ success: true, data: providers });
});

router.post('/initiate', authenticate, async (req, res) => {
  try {
    const { provider, amount, phone, orderId } = req.body;
    if (!provider || !amount) return res.status(400).json({ success: false, message: 'provider et amount requis' });
    const result = await PaymentService.initiate({
      provider, amount: parseInt(amount),
      phone: phone || req.user.phone,
      orderId: orderId || req.user.id,
      country: req.user.country,
      callbackUrl: `${process.env.FRONTEND_URL}/payment/callback`,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/status/:reference', authenticate, async (req, res) => {
  try {
    const { provider } = req.query;
    const status = await PaymentService.checkStatus(provider, req.params.reference);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur vérification statut' });
  }
});

router.post('/refund', authenticate, async (req, res) => {
  try {
    const { provider, reference, amount, orderId } = req.body;
    const result = await PaymentService.refund({ provider, reference, amount });
    if (result.success && orderId) {
      await supabaseAdmin.from('orders')
        .update({ payment_status: 'refunded' }).eq('id', orderId);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur remboursement' });
  }
});

// Webhooks paiement
router.post('/webhook/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const sig = req.headers['x-signature'] || req.headers['x-webhook-signature'] || '';
    if (!PaymentService.verifyWebhookSignature(provider, req.body, sig)) {
      return res.status(401).json({ success: false, message: 'Signature invalide' });
    }
    const { reference, status, orderId } = req.body;
    const isSuccess = ['completed','SUCCESSFUL','SUCCESS','successful'].includes(status);
    if (isSuccess) {
      await supabaseAdmin.from('orders').update({
        payment_status: 'paid',
        payment_reference: reference,
        payment_paid_at: new Date().toISOString(),
      }).eq('id', orderId);
      await supabaseAdmin.from('payments').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('provider_reference', reference);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;


// ================================================================
// FILE: routes/search.js
// ================================================================
const searchRouter = express.Router();

searchRouter.get('/', async (req, res) => {
  try {
    const { q, type = 'all', country, city, category, isDigital, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
    if (!q || q.trim().length < 2) return res.json({ success: true, data: { shops:[], products:[] }, query: q });

    const results = {};
    const searchTerm = q.trim();

    if (type === 'all' || type === 'shops') {
      let sq = supabaseAdmin.from('shops')
        .select('id, name, slug, category, logo_url, emoji, city, country, rating, delivery_fee, is_open, estimated_time, is_verified, is_featured')
        .eq('is_active', true)
        .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`)
        .limit(parseInt(limit));
      if (country)  sq = sq.eq('country', country.toUpperCase());
      if (city)     sq = sq.ilike('city', `%${city}%`);
      if (category) sq = sq.eq('category', category);
      sq = sq.order('rating', { ascending: false });
      const { data: shops } = await sq;
      results.shops = shops || [];
    }

    if (type === 'all' || type === 'products') {
      let pq = supabaseAdmin.from('products')
        .select(`id, name, price, compare_price, emoji, image_url, is_digital, is_promo, promo_percent, category, rating, shops!shop_id(id, name, city, country, is_open, delivery_fee)`)
        .eq('is_available', true)
        .or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%,tags.cs.{${searchTerm}}`)
        .limit(parseInt(limit));
      if (category)           pq = pq.eq('category', category);
      if (isDigital === 'true')  pq = pq.eq('is_digital', true);
      if (isDigital === 'false') pq = pq.eq('is_digital', false);
      if (minPrice) pq = pq.gte('price', parseInt(minPrice));
      if (maxPrice) pq = pq.lte('price', parseInt(maxPrice));
      pq = pq.order('order_count', { ascending: false });
      const { data: products } = await pq;

      results.products = (products || []).filter(p =>
        !country || p.shops?.country === country.toUpperCase()
      );
    }

    res.json({ success: true, data: results, query: searchTerm });
  } catch (err) {
    console.error('[search]', err);
    res.status(500).json({ success: false, message: 'Erreur de recherche' });
  }
});

searchRouter.get('/suggestions', async (req, res) => {
  try {
    const { q, country } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });
    const [{ data: shops }, { data: products }] = await Promise.all([
      supabaseAdmin.from('shops').select('name').eq('is_active', true).ilike('name', `%${q}%`).limit(4),
      supabaseAdmin.from('products').select('name').eq('is_available', true).ilike('name', `%${q}%`).limit(4),
    ]);
    const suggestions = [
      ...(shops||[]).map(s => ({ type:'shop',    text: s.name, icon: '🏪' })),
      ...(products||[]).map(p => ({ type:'product', text: p.name, icon: '📦' })),
    ].slice(0, 8);
    res.json({ success: true, data: suggestions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suggestions' });
  }
});

searchRouter.get('/popular', async (req, res) => {
  try {
    const { country } = req.query;
    let shopsQ = supabaseAdmin.from('shops')
      .select('id, name, emoji, rating, category, city, country, delivery_fee')
      .eq('is_active', true).eq('is_featured', true).limit(6);
    if (country) shopsQ = shopsQ.eq('country', country.toUpperCase());

    const [{ data: shops }, { data: products }, { data: digital }] = await Promise.all([
      shopsQ,
      supabaseAdmin.from('products').select('id, name, emoji, price, order_count, shops!shop_id(name)')
        .eq('is_available', true).eq('is_digital', false)
        .order('order_count', { ascending: false }).limit(8),
      supabaseAdmin.from('products').select('id, name, emoji, price, order_count, digital_file_type, shops!shop_id(name)')
        .eq('is_available', true).eq('is_digital', true)
        .order('order_count', { ascending: false }).limit(6),
    ]);

    res.json({ success: true, data: { featuredShops: shops||[], popularProducts: products||[], digitalProducts: digital||[] } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur popular' });
  }
});

// ================================================================
// FILE: routes/admin.js
// ================================================================
const adminRouter = express.Router();
const { requireRole } = require('../middleware/auth');

adminRouter.use(authenticate);
adminRouter.use(requireRole('admin'));

adminRouter.get('/stats', async (req, res) => {
  try {
    const [
      { count: totalUsers },
      { count: totalShops },
      { count: totalOrders },
      { count: pendingKyc },
      { count: activeDeliveries },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('id', { count:'exact', head:true }),
      supabaseAdmin.from('shops').select('id', { count:'exact', head:true }).eq('is_active', true),
      supabaseAdmin.from('orders').select('id', { count:'exact', head:true }),
      supabaseAdmin.from('users').select('id', { count:'exact', head:true }).eq('kyc_status', 'submitted'),
      supabaseAdmin.from('orders').select('id', { count:'exact', head:true }).in('status', ['in_route','picked_up']),
    ]);
    const { data: rev } = await supabaseAdmin.from('transactions')
      .select('amount').eq('type', 'debit');
    const totalRevenue = (rev||[]).reduce((s,t) => s + t.amount, 0);
    res.json({ success: true, data: { totalUsers, totalShops, totalOrders, pendingKyc, activeDeliveries, totalRevenue } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur stats' });
  }
});

adminRouter.get('/users', async (req, res) => {
  try {
    const { role, kyc_status, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = supabaseAdmin.from('users')
      .select('id, email, phone, first_name, last_name, role, country, city, kyc_status, is_active, is_suspended, is_email_verified, created_at, last_login', { count:'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset+parseInt(limit)-1);
    if (role)       q = q.eq('role', role);
    if (kyc_status) q = q.eq('kyc_status', kyc_status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

adminRouter.patch('/users/:id/kyc', async (req, res) => {
  try {
    const { action, reason } = req.body;
    const updates = action === 'verify'
      ? { kyc_status: 'verified', kyc_verified_at: new Date().toISOString() }
      : { kyc_status: 'rejected', kyc_reject_reason: reason || 'Documents non conformes' };
    await supabaseAdmin.from('users').update(updates).eq('id', req.params.id);
    const { data: u } = await supabaseAdmin.from('users').select('email, first_name').eq('id', req.params.id).single();
    const EmailService = require('../services/email');
    if (action === 'verify') await EmailService.sendKycVerified(u.email, u.first_name);
    await supabaseAdmin.from('notifications').insert({
      user_id: req.params.id, type: `kyc_${action}`,
      title: action === 'verify' ? '✅ Identité vérifiée !' : '❌ Vérification refusée',
      body: action === 'verify' ? 'Votre identité a été vérifiée.' : `Raison : ${reason}`,
    });
    res.json({ success: true, message: `KYC ${action === 'verify' ? 'validé ✅' : 'refusé ❌'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur KYC' });
  }
});

adminRouter.patch('/users/:id/suspend', async (req, res) => {
  try {
    const { reason, suspend } = req.body;
    await supabaseAdmin.from('users').update({
      is_suspended: !!suspend,
      suspend_reason: suspend ? reason : null,
    }).eq('id', req.params.id);
    res.json({ success: true, message: suspend ? 'Utilisateur suspendu' : 'Suspension levée' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suspension' });
  }
});

adminRouter.patch('/shops/:id/verify', async (req, res) => {
  try {
    await supabaseAdmin.from('shops').update({ is_verified: true, is_featured: req.body.featured || false }).eq('id', req.params.id);
    res.json({ success: true, message: 'Boutique vérifiée ✅' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

adminRouter.get('/orders', async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = supabaseAdmin.from('orders')
      .select('id, order_number, status, total, payment_status, created_at, shops!shop_id(name), users!client_id(first_name, last_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset+parseInt(limit)-1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// Exporter tous les sous-routers
router.searchRouter = searchRouter;
router.adminRouter  = adminRouter;
module.exports = router;
