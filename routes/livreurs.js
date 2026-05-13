// routes/livreurs.js — KibaAlo v2
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

// ── PUT /api/livreurs/availability ───────────────────────
router.put('/availability', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { isAvailable, latitude, longitude } = req.body;
    const updates = {
      is_available: !!isAvailable,
      last_seen: new Date().toISOString(),
    };
    if (latitude)  updates.current_lat = parseFloat(latitude);
    if (longitude) updates.current_lng = parseFloat(longitude);

    await supabaseAdmin.from('livreurs').update(updates).eq('id', req.user.id);

    // Notifier via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('livreur_status', { livreurId: req.user.id, isAvailable: !!isAvailable });
    }

    res.json({
      success: true,
      message: isAvailable ? '🟢 Vous êtes disponible' : '🔴 Vous êtes indisponible',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut' });
  }
});

// ── PUT /api/livreurs/location ───────────────────────────
router.put('/location', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { latitude, longitude, speed, heading } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'latitude et longitude requis' });
    }

    await supabaseAdmin.from('livreurs').update({
      current_lat: parseFloat(latitude),
      current_lng: parseFloat(longitude),
      last_seen: new Date().toISOString(),
    }).eq('id', req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur position GPS' });
  }
});

// ── GET /api/livreurs/earnings ───────────────────────────
router.get('/earnings', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', req.user.id).single();

    const { data: livreur } = await supabaseAdmin
      .from('livreurs').select('total_deliveries, rating, rating_count, earnings_total, acceptance_rate')
      .eq('id', req.user.id).single();

    const now = new Date();
    const startOfDay   = new Date(now.setHours(0,0,0,0)).toISOString();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfWeek  = new Date(now.setDate(now.getDate() - now.getDay())).toISOString();

    const { data: deliveries } = await supabaseAdmin
      .from('orders')
      .select('delivered_at, delivery_fee, created_at')
      .eq('livreur_id', req.user.id)
      .eq('status', 'delivered')
      .gte('created_at', startOfMonth)
      .order('delivered_at', { ascending: false });

    const today = (deliveries||[]).filter(d => d.delivered_at >= startOfDay);
    const week  = (deliveries||[]).filter(d => d.delivered_at >= startOfWeek);
    const month = deliveries || [];

    // Gains par jour sur 7 jours
    const earningsByDay = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      const dayEarnings = month.filter(o => (o.delivered_at||'').startsWith(dayStr))
        .reduce((s, o) => s + (o.delivery_fee || 0), 0);
      earningsByDay.push({
        date: dayStr,
        earnings: dayEarnings,
        label: ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][d.getDay()],
        deliveries: month.filter(o => (o.delivered_at||'').startsWith(dayStr)).length,
      });
    }

    res.json({
      success: true,
      data: {
        walletBalance:    wallet?.balance || 0,
        todayDeliveries:  today.length,
        todayEarnings:    today.reduce((s,d) => s + (d.delivery_fee||0), 0),
        weekDeliveries:   week.length,
        weekEarnings:     week.reduce((s,d) => s + (d.delivery_fee||0), 0),
        monthDeliveries:  month.length,
        monthEarnings:    month.reduce((s,d) => s + (d.delivery_fee||0), 0),
        totalDeliveries:  livreur?.total_deliveries || 0,
        rating:           livreur?.rating || 0,
        ratingCount:      livreur?.rating_count || 0,
        acceptanceRate:   livreur?.acceptance_rate || 100,
        earningsByDay,
      },
    });
  } catch (err) {
    console.error('[livreur earnings]', err);
    res.status(500).json({ success: false, message: 'Erreur gains' });
  }
});

// ── GET /api/livreurs/profile ────────────────────────────
router.get('/profile', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('livreurs').select('*').eq('id', req.user.id).single();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur profil livreur' });
  }
});

// ── PUT /api/livreurs/profile ────────────────────────────
router.put('/profile', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { vehicleType, vehicleBrand, vehiclePlate, vehicleYear, cities } = req.body;
    const updates = {};
    if (vehicleType)  updates.vehicle_type  = vehicleType;
    if (vehicleBrand) updates.vehicle_brand = vehicleBrand;
    if (vehiclePlate) updates.vehicle_plate = vehiclePlate;
    if (vehicleYear)  updates.vehicle_year  = parseInt(vehicleYear);
    if (cities)       updates.cities        = cities;

    const { data } = await supabaseAdmin
      .from('livreurs').update(updates).eq('id', req.user.id).select().single();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour profil' });
  }
});

// ── GET /api/livreurs/available — pour le système d'assignation
router.get('/available', authenticate, async (req, res) => {
  try {
    const { lat, lng, radius = 15, country } = req.query;

    let query = supabaseAdmin.from('livreurs')
      .select('id, current_lat, current_lng, vehicle_type, rating, total_deliveries, last_seen, users!id(first_name, last_name, phone, avatar_url)')
      .eq('is_available', true)
      .eq('is_validated', true)
      .not('current_lat', 'is', null);

    const { data: livreurs } = await query;

    let result = livreurs || [];

    // Filtrer par distance si coords fournies
    if (lat && lng) {
      const haversine = (lat1, lon1, lat2, lon2) => {
        const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };
      result = result
        .map(l => ({ ...l, distance_km: haversine(parseFloat(lat), parseFloat(lng), l.current_lat, l.current_lng) }))
        .filter(l => l.distance_km <= parseFloat(radius))
        .sort((a, b) => a.distance_km - b.distance_km);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// ================================================================
// NOTIFICATIONS ROUTER
// ================================================================
const notifRouter = express.Router();

notifRouter.get('/', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);

    const { data, error, count } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;
    const unreadCount = (data||[]).filter(n => !n.is_read).length;
    res.json({ success: true, data: data||[], unreadCount, total: count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur notifications' });
  }
});

notifRouter.patch('/read-all', authenticate, async (req, res) => {
  try {
    await supabaseAdmin.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', req.user.id).eq('is_read', false);
    res.json({ success: true, message: 'Toutes lues' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

notifRouter.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await supabaseAdmin.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

notifRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    await supabaseAdmin.from('notifications')
      .delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur' });
  }
});

// ================================================================
// PREMIUM ROUTER
// ================================================================
const premiumRouter = express.Router();

const PLANS = {
  monthly: { price: 2500,  days: 30,  name: 'Mensuel',
    features: ['5 livraisons gratuites/mois','Priorité de livraison','Support prioritaire'] },
  quarterly: { price: 6500, days: 90,  name: 'Trimestriel',
    features: ['15 livraisons gratuites','Cashback 3%','Priorité élevée','Support prioritaire'] },
  annual:  { price: 20000, days: 365, name: 'Annuel',
    features: ['Livraisons gratuites illimitées','Cashback 5%','Priorité maximale','Support VIP 24/7','Accès bêta anticipé','Badge vérifié'] },
};

premiumRouter.get('/plans', (req, res) => {
  res.json({ success: true, data: PLANS });
});

premiumRouter.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { plan } = req.body;
    const planInfo = PLANS[plan];
    if (!planInfo) return res.status(400).json({ success: false, message: 'Plan invalide: monthly, quarterly, annual' });

    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id, balance').eq('user_id', req.user.id).single();

    if (!wallet || wallet.balance < planInfo.price) {
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant. Requis: ${planInfo.price.toLocaleString()} F CFA. Disponible: ${(wallet?.balance||0).toLocaleString()} F`,
      });
    }

    const currentPremium = req.user.premium_until && new Date(req.user.premium_until) > new Date()
      ? new Date(req.user.premium_until)
      : new Date();
    const premiumUntil = new Date(currentPremium);
    premiumUntil.setDate(premiumUntil.getDate() + planInfo.days);

    // Débiter le portefeuille
    const newBalance = wallet.balance - planInfo.price;
    await supabaseAdmin.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    await supabaseAdmin.from('transactions').insert({
      wallet_id: wallet.id, user_id: req.user.id,
      type: 'debit', amount: planInfo.price,
      balance_before: wallet.balance, balance_after: newBalance,
      description: `Abonnement Premium ${planInfo.name}`,
    });

    // Mettre à jour l'utilisateur
    await supabaseAdmin.from('users').update({
      premium_plan: plan,
      premium_until: premiumUntil.toISOString(),
    }).eq('id', req.user.id);

    await supabaseAdmin.from('notifications').insert({
      user_id: req.user.id, type: 'premium_activated',
      title: '👑 Premium activé !',
      body: `Abonnement ${planInfo.name} actif jusqu'au ${premiumUntil.toLocaleDateString('fr-FR')}`,
    });

    res.json({
      success: true,
      message: `👑 Abonnement ${planInfo.name} activé !`,
      premiumUntil,
      plan: planInfo,
    });
  } catch (err) {
    console.error('[premium]', err);
    res.status(500).json({ success: false, message: 'Erreur abonnement' });
  }
});

premiumRouter.post('/cancel', authenticate, async (req, res) => {
  try {
    await supabaseAdmin.from('users')
      .update({ premium_plan: null, premium_until: null }).eq('id', req.user.id);
    res.json({ success: true, message: 'Abonnement annulé' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur annulation' });
  }
});

// Exporter les sous-routers
router.notifRouter   = notifRouter;
router.premiumRouter = premiumRouter;

module.exports = router;
