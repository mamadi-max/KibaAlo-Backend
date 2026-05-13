// routes/wallet.js — KibaAlo v2
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const PaymentService = require('../services/payment');

router.get('/', authenticate, async (req, res) => {
  try {
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('*').eq('user_id', req.user.id).single();
    const { data: txns } = await supabaseAdmin
      .from('transactions').select('*').eq('user_id', req.user.id)
      .order('created_at', { ascending: false }).limit(50);
    res.json({ success: true, data: { ...wallet, transactions: txns || [] } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur portefeuille' });
  }
});

router.post('/recharge', authenticate, async (req, res) => {
  try {
    const { amount, provider, phone } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ success: false, message: 'Montant minimum: 100 F' });

    const paymentResult = await PaymentService.initiate({
      provider: provider || 'orange_money',
      amount: parseInt(amount),
      phone: phone || req.user.phone,
      orderId: req.user.id,
      country: req.user.country,
    });

    // Si simulation ou paiement immédiat, créditer directement
    if (paymentResult.simulated || paymentResult.status === 'completed') {
      const { data: wallet } = await supabaseAdmin
        .from('wallets').select('id, balance').eq('user_id', req.user.id).single();
      const newBalance = wallet.balance + parseInt(amount);
      await supabaseAdmin.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
      await supabaseAdmin.from('transactions').insert({
        wallet_id: wallet.id, user_id: req.user.id,
        type: 'credit', amount: parseInt(amount),
        balance_before: wallet.balance, balance_after: newBalance,
        description: `Recharge via ${provider || 'Mobile Money'}`,
        payment_provider: provider,
      });
      return res.json({ success: true, message: `✅ +${parseInt(amount).toLocaleString()} F ajoutés`, newBalance });
    }

    res.json({ success: true, payment: paymentResult, message: paymentResult.message || 'Paiement initié' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/withdraw', authenticate, async (req, res) => {
  try {
    const { amount, phone, provider } = req.body;
    if (!amount || amount < 500) return res.status(400).json({ success: false, message: 'Retrait minimum: 500 F' });
    if (!phone) return res.status(400).json({ success: false, message: 'Numéro de téléphone requis' });

    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id, balance').eq('user_id', req.user.id).single();
    if (wallet.balance < parseInt(amount)) {
      return res.status(400).json({ success: false, message: 'Solde insuffisant' });
    }

    const newBalance = wallet.balance - parseInt(amount);
    await supabaseAdmin.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    await supabaseAdmin.from('transactions').insert({
      wallet_id: wallet.id, user_id: req.user.id,
      type: 'withdrawal', amount: parseInt(amount),
      balance_before: wallet.balance, balance_after: newBalance,
      description: `Retrait vers ${phone} via ${provider}`,
      payment_provider: provider,
    });

    res.json({ success: true, message: `✅ Retrait de ${parseInt(amount).toLocaleString()} F initié`, newBalance });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur retrait' });
  }
});

module.exports = router;


// ================================================================
// routes/payments.js
// ================================================================
const payRouter = express.Router();
const { requireRole } = require('../middleware/auth');

payRouter.get('/providers/:country', (req, res) => {
  const providers = PaymentService.getProvidersByCountry(req.params.country.toUpperCase());
  res.json({ success: true, data: providers });
});

payRouter.post('/initiate', authenticate, async (req, res) => {
  try {
    const { provider, amount, phone, orderId } = req.body;
    const result = await PaymentService.initiate({
      provider, amount: parseInt(amount),
      phone: phone || req.user.phone,
      orderId, country: req.user.country,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

payRouter.get('/status/:reference', authenticate, async (req, res) => {
  try {
    const { provider } = req.query;
    const status = await PaymentService.checkStatus(provider, req.params.reference);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur vérification statut' });
  }
});

router.paymentsRouter = payRouter;


// ================================================================
// routes/search.js — Recherche temps réel
// ================================================================
const searchRouter = express.Router();

searchRouter.get('/', async (req, res) => {
  try {
    const { q, type = 'all', country, city, category, page = 1, limit = 20 } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: { shops:[], products:[], services:[] } });

    const offset = (parseInt(page)-1) * parseInt(limit);
    const results = {};

    // Recherche boutiques
    if (type === 'all' || type === 'shops') {
      let shopQuery = supabaseAdmin.from('shops')
        .select('id, name, slug, category, logo_url, emoji, city, country, rating, delivery_fee, is_open')
        .eq('is_active', true)
        .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(parseInt(limit));
      if (country) shopQuery = shopQuery.eq('country', country);
      if (city)    shopQuery = shopQuery.ilike('city', `%${city}%`);
      const { data: shops } = await shopQuery;
      results.shops = shops || [];
    }

    // Recherche produits
    if (type === 'all' || type === 'products') {
      let prodQuery = supabaseAdmin.from('products')
        .select(`id, name, price, emoji, image_url, is_digital, category, shops!shop_id(id, name, city, country)`)
        .eq('is_available', true)
        .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(parseInt(limit));
      if (category) prodQuery = prodQuery.eq('category', category);
      const { data: products } = await prodQuery;

      // Filtrer par pays si spécifié
      results.products = (products || []).filter(p =>
        !country || p.shops?.country === country
      );
    }

    // Recherche produits digitaux
    if (type === 'digital') {
      const { data: digital } = await supabaseAdmin.from('products')
        .select(`*, shops!shop_id(id, name)`)
        .eq('is_available', true).eq('is_digital', true)
        .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(parseInt(limit));
      results.digital = digital || [];
    }

    // Sauvegarder la recherche (si utilisateur connecté)
    // Note: nécessite auth optionnel — simplifié ici

    res.json({ success: true, data: results, query: q });
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
      supabaseAdmin.from('shops').select('name').eq('is_active', true)
        .ilike('name', `%${q}%`).limit(5),
      supabaseAdmin.from('products').select('name').eq('is_available', true)
        .ilike('name', `%${q}%`).limit(5),
    ]);

    const suggestions = [
      ...(shops||[]).map(s => ({ type:'shop', text: s.name })),
      ...(products||[]).map(p => ({ type:'product', text: p.name })),
    ].slice(0, 8);

    res.json({ success: true, data: suggestions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suggestions' });
  }
});

searchRouter.get('/popular', async (req, res) => {
  try {
    const { country } = req.query;
    const [{ data: shops }, { data: products }] = await Promise.all([
      supabaseAdmin.from('shops').select('id, name, emoji, rating, category, city')
        .eq('is_active', true).eq('is_featured', true).limit(6),
      supabaseAdmin.from('products').select('id, name, emoji, price, order_count')
        .eq('is_available', true).order('order_count', { ascending: false }).limit(10),
    ]);
    res.json({ success: true, data: { featuredShops: shops||[], popularProducts: products||[] } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

router.searchRouter = searchRouter;


// ================================================================
// routes/admin.js
// ================================================================
const adminRouter = express.Router();

adminRouter.use(authenticate);
adminRouter.use(requireRole('admin'));

// Tableau de bord admin
adminRouter.get('/stats', async (req, res) => {
  try {
    const [
      { count: totalUsers },
      { count: totalShops },
      { count: totalOrders },
      { count: pendingKyc },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('id', { count:'exact', head:true }),
      supabaseAdmin.from('shops').select('id', { count:'exact', head:true }).eq('is_active', true),
      supabaseAdmin.from('orders').select('id', { count:'exact', head:true }),
      supabaseAdmin.from('users').select('id', { count:'exact', head:true }).eq('kyc_status', 'submitted'),
    ]);

    const { data: revenueData } = await supabaseAdmin
      .from('orders').select('total').eq('payment_status', 'paid');
    const totalRevenue = (revenueData||[]).reduce((s,o) => s + o.total, 0);

    res.json({ success: true, data: { totalUsers, totalShops, totalOrders, pendingKyc, totalRevenue } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur stats admin' });
  }
});

// Valider KYC
adminRouter.patch('/users/:id/kyc', async (req, res) => {
  try {
    const { action, reason } = req.body; // action: 'verify' | 'reject'
    const updates = action === 'verify'
      ? { kyc_status: 'verified', kyc_verified_at: new Date().toISOString() }
      : { kyc_status: 'rejected', kyc_reject_reason: reason };

    await supabaseAdmin.from('users').update(updates).eq('id', req.params.id);

    const { data: u } = await supabaseAdmin
      .from('users').select('email, first_name').eq('id', req.params.id).single();

    const EmailService = require('../services/email');
    if (action === 'verify') await EmailService.sendKycVerified(u.email, u.first_name);

    await supabaseAdmin.from('notifications').insert({
      user_id: req.params.id,
      type: `kyc_${action}`,
      title: action === 'verify' ? '✅ Compte vérifié !' : '❌ Vérification refusée',
      body: action === 'verify' ? 'Votre identité a été vérifiée avec succès.' : `Raison: ${reason}`,
    });

    res.json({ success: true, message: `KYC ${action === 'verify' ? 'validé' : 'refusé'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur KYC admin' });
  }
});

// Suspendre un utilisateur
adminRouter.patch('/users/:id/suspend', async (req, res) => {
  try {
    const { reason } = req.body;
    await supabaseAdmin.from('users').update({ is_suspended: true, suspend_reason: reason }).eq('id', req.params.id);
    res.json({ success: true, message: 'Utilisateur suspendu' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suspension' });
  }
});

// Valider une boutique
adminRouter.patch('/shops/:id/verify', async (req, res) => {
  try {
    await supabaseAdmin.from('shops').update({ is_verified: true }).eq('id', req.params.id);
    res.json({ success: true, message: 'Boutique vérifiée ✅' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur vérification boutique' });
  }
});

router.adminRouter = adminRouter;
module.exports = router;
