// routes/livreurs.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── PUT /api/livreurs/availability ─────────────────────────
router.put('/availability', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { isAvailable, latitude, longitude } = req.body;
    const updates = { is_available: !!isAvailable, last_seen: new Date().toISOString() };
    if (latitude) updates.current_lat = latitude;
    if (longitude) updates.current_lng = longitude;

    await supabaseAdmin.from('livreurs').update(updates).eq('id', req.user.id);
    res.json({ success: true, message: `Statut: ${isAvailable ? '🟢 Disponible' : '🔴 Indisponible'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut' });
  }
});

// ─── PUT /api/livreurs/location ──────────────────────────────
router.put('/location', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ success: false, message: 'latitude et longitude requis' });

    await supabaseAdmin.from('livreurs')
      .update({ current_lat: latitude, current_lng: longitude, last_seen: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur position GPS' });
  }
});

// ─── GET /api/livreurs/earnings ──────────────────────────────
router.get('/earnings', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', req.user.id).single();

    const { data: deliveries } = await supabaseAdmin
      .from('orders')
      .select('delivered_at, delivery_fee')
      .eq('livreur_id', req.user.id)
      .eq('status', 'delivered')
      .order('delivered_at', { ascending: false })
      .limit(50);

    const now = new Date();
    const startOfDay   = new Date(now.setHours(0,0,0,0)).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const today = (deliveries||[]).filter(d => d.delivered_at >= startOfDay);
    const month = (deliveries||[]).filter(d => d.delivered_at >= startOfMonth);

    res.json({
      success: true,
      data: {
        walletBalance: wallet?.balance || 0,
        todayDeliveries: today.length,
        todayEarnings: today.reduce((s,d) => s + d.delivery_fee, 0),
        monthDeliveries: month.length,
        monthEarnings: month.reduce((s,d) => s + d.delivery_fee, 0),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur gains' });
  }
});

module.exports = router;


// ─────────────────────────────────────────────────────────────
// routes/notifications.js
// ─────────────────────────────────────────────────────────────
const notifRouter = express.Router();

notifRouter.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    const unread = (data||[]).filter(n => !n.is_read).length;
    res.json({ success: true, data, unreadCount: unread });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur notifications' });
  }
});

notifRouter.patch('/read-all', authenticate, async (req, res) => {
  try {
    await supabaseAdmin.from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);
    res.json({ success: true, message: 'Toutes les notifications marquées comme lues' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

notifRouter.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await supabaseAdmin.from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

router.notifRouter = notifRouter;


// ─────────────────────────────────────────────────────────────
// routes/premium.js
// ─────────────────────────────────────────────────────────────
const premiumRouter = express.Router();

const PLANS = {
  monthly: { price: 2500, days: 30, name: 'Mensuel' },
  annual:  { price: 20000, days: 365, name: 'Annuel' }
};

premiumRouter.get('/plans', (req, res) => {
  res.json({ success: true, data: PLANS });
});

premiumRouter.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { plan } = req.body;
    const planInfo = PLANS[plan];
    if (!planInfo) return res.status(400).json({ success: false, message: 'Plan invalide: monthly ou annual' });

    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id,balance').eq('user_id', req.user.id).single();

    if (!wallet || wallet.balance < planInfo.price) {
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant. Requis: ${planInfo.price.toLocaleString()} F CFA`
      });
    }

    const premiumUntil = new Date();
    premiumUntil.setDate(premiumUntil.getDate() + planInfo.days);

    await supabaseAdmin.from('wallets')
      .update({ balance: wallet.balance - planInfo.price })
      .eq('id', wallet.id);

    await supabaseAdmin.from('users')
      .update({ premium_until: premiumUntil.toISOString() })
      .eq('id', req.user.id);

    await supabaseAdmin.from('transactions').insert({
      wallet_id: wallet.id,
      user_id: req.user.id,
      type: 'debit', amount: planInfo.price,
      balance_before: wallet.balance,
      balance_after: wallet.balance - planInfo.price,
      description: `Abonnement Premium ${planInfo.name}`,
      status: 'completed'
    });

    await supabaseAdmin.from('notifications').insert({
      user_id: req.user.id,
      type: 'premium_activated',
      title: '👑 Premium activé !',
      body: `Votre abonnement ${planInfo.name} est actif jusqu\'au ${premiumUntil.toLocaleDateString('fr-FR')}`
    });

    res.json({
      success: true,
      message: `Abonnement Premium ${planInfo.name} activé !`,
      premiumUntil
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur abonnement' });
  }
});

router.premiumRouter = premiumRouter;

module.exports = router;
