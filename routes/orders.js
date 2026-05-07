// routes/orders.js
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

// Générer un numéro de commande unique
const generateOrderNumber = () => {
  const ts = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `KBA-${ts}${rand}`;
};

// Calculer la distance entre deux points GPS (formule Haversine)
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// ─── POST /api/orders ───────────────────────────────────────
// Créer une commande
router.post('/', authenticate, requireRole('client'), async (req, res) => {
  try {
    const { shopId, items, deliveryAddress, deliveryCity, deliveryLat, deliveryLng, paymentMethod, notes } = req.body;

    if (!shopId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'shopId et items sont requis' });
    }

    // Charger la boutique
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops').select('*').eq('id', shopId).eq('is_active', true).single();

    if (shopError || !shop) {
      return res.status(404).json({ success: false, message: 'Boutique introuvable ou fermée' });
    }

    if (!shop.is_open) {
      return res.status(400).json({ success: false, message: 'Cette boutique est actuellement fermée' });
    }

    // Vérifier et valoriser les items
    const productIds = items.map(i => i.productId);
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('id, name, price, emoji, is_available')
      .in('id', productIds);

    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = products?.find(p => p.id === item.productId);
      if (!product || !product.is_available) {
        return res.status(400).json({ success: false, message: `Produit indisponible: ${item.productId}` });
      }
      const qty = parseInt(item.qty) || 1;
      orderItems.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        qty,
        emoji: product.emoji,
        total: product.price * qty
      });
      subtotal += product.price * qty;
    }

    const deliveryFee = shop.delivery_fee || 500;
    const total = subtotal + deliveryFee;

    // Vérifier le solde si paiement par portefeuille
    const method = paymentMethod || 'wallet';
    if (method === 'wallet') {
      const { data: wallet } = await supabaseAdmin
        .from('wallets').select('balance').eq('user_id', req.user.id).single();

      if (!wallet || wallet.balance < total) {
        return res.status(400).json({
          success: false,
          message: `Solde insuffisant. Requis: ${total.toLocaleString()} F. Disponible: ${(wallet?.balance||0).toLocaleString()} F`
        });
      }
    }

    // Créer la commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_number: generateOrderNumber(),
        client_id: req.user.id,
        shop_id: shopId,
        status: 'pending',
        items: orderItems,
        subtotal, delivery_fee: deliveryFee, total,
        payment_method: method,
        payment_status: method === 'wallet' ? 'paid' : 'pending',
        delivery_address: deliveryAddress,
        delivery_city: deliveryCity || req.user.city,
        delivery_lat: deliveryLat || null,
        delivery_lng: deliveryLng || null,
        notes: notes || null,
        estimated_time: 45
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Débiter le portefeuille si paiement wallet
    if (method === 'wallet') {
      const { data: wallet } = await supabaseAdmin
        .from('wallets').select('balance').eq('user_id', req.user.id).single();

      await supabaseAdmin.from('wallets')
        .update({ balance: wallet.balance - total })
        .eq('user_id', req.user.id);

      await supabaseAdmin.from('transactions').insert({
        wallet_id: (await supabaseAdmin.from('wallets').select('id').eq('user_id', req.user.id).single()).data?.id,
        user_id: req.user.id,
        type: 'debit',
        amount: total,
        balance_before: wallet.balance,
        balance_after: wallet.balance - total,
        description: `Commande ${order.order_number}`,
        order_id: order.id
      });
    }

    // Notifier le commerçant
    await supabaseAdmin.from('notifications').insert({
      user_id: shop.owner_id,
      type: 'new_order',
      title: '🆕 Nouvelle commande !',
      body: `Commande ${order.order_number} — ${total.toLocaleString()} F CFA`,
      data: { orderId: order.id, orderNumber: order.order_number }
    });

    // Chercher un livreur disponible dans un rayon de 15 km
    if (deliveryLat && deliveryLng) {
      const { data: availableLivreurs } = await supabaseAdmin
        .from('livreurs')
        .select('id, current_lat, current_lng')
        .eq('is_available', true)
        .eq('is_validated', true)
        .not('current_lat', 'is', null);

      const MAX_RADIUS = parseFloat(process.env.MAX_DELIVERY_RADIUS_KM) || 15;
      const nearbyLivreur = (availableLivreurs || [])
        .map(l => ({
          ...l,
          dist: haversineKm(deliveryLat, deliveryLng, l.current_lat, l.current_lng)
        }))
        .filter(l => l.dist <= MAX_RADIUS)
        .sort((a, b) => a.dist - b.dist)[0];

      if (nearbyLivreur) {
        await supabaseAdmin.from('orders')
          .update({ livreur_id: nearbyLivreur.id })
          .eq('id', order.id);

        await supabaseAdmin.from('notifications').insert({
          user_id: nearbyLivreur.id,
          type: 'delivery_request',
          title: '🛵 Nouvelle course disponible !',
          body: `Livraison de ${shop.name} — ${deliveryFee.toLocaleString()} F`,
          data: { orderId: order.id }
        });
      }
    }

    res.status(201).json({ success: true, data: order, message: 'Commande créée avec succès' });

  } catch (err) {
    console.error('[orders create]', err);
    res.status(500).json({ success: false, message: 'Erreur création commande' });
  }
});

// ─── GET /api/orders ────────────────────────────────────────
// Liste des commandes (filtrée par rôle)
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { role, id } = req.user;

    let query = supabaseAdmin
      .from('orders')
      .select(`
        id, order_number, status, items, subtotal, delivery_fee, total,
        payment_method, payment_status, delivery_address, delivery_city,
        estimated_time, created_at, delivered_at,
        shops!shop_id(id, name, logo_url, category),
        users!client_id(id, first_name, last_name, phone),
        livreur:users!livreur_id(id, first_name, last_name, phone)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    // Filtrer selon le rôle
    if (role === 'client') {
      query = query.eq('client_id', id);
    } else if (role === 'livreur') {
      query = query.eq('livreur_id', id);
    } else if (role === 'commercant') {
      const { data: shop } = await supabaseAdmin
        .from('shops').select('id').eq('owner_id', id).single();
      if (shop) query = query.eq('shop_id', shop.id);
    }

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ success: true, data, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('[orders list]', err);
    res.status(500).json({ success: false, message: 'Erreur chargement commandes' });
  }
});

// ─── GET /api/orders/:id ────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        shops!shop_id(id, name, logo_url, phone, address, latitude, longitude),
        users!client_id(id, first_name, last_name, phone),
        livreur:users!livreur_id(id, first_name, last_name, phone),
        livreur_profile:livreurs!livreur_id(vehicle_type, vehicle_plate, rating)
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !order) {
      return res.status(404).json({ success: false, message: 'Commande introuvable' });
    }

    // Vérifier accès
    const hasAccess = order.client_id === req.user.id ||
      order.livreur_id === req.user.id ||
      req.user.role === 'commercant';

    if (!hasAccess) return res.status(403).json({ success: false, message: 'Accès refusé' });

    // Dernière position GPS du livreur
    const { data: tracking } = await supabaseAdmin
      .from('order_tracking')
      .select('latitude, longitude, recorded_at')
      .eq('order_id', order.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    res.json({ success: true, data: { ...order, lastPosition: tracking || null } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ─── PATCH /api/orders/:id/status ───────────────────────────
// Mise à jour du statut d'une commande
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const { role, id: userId } = req.user;

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`*, shops!shop_id(owner_id)`)
      .eq('id', req.params.id)
      .single();

    if (error || !order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    // Permissions par rôle
    const allowedTransitions = {
      commercant: { pending: ['confirmed','cancelled'], confirmed: ['preparing'], preparing: ['ready'] },
      livreur:    { ready: ['picked_up'], picked_up: ['in_route'], in_route: ['delivered'] },
      client:     { pending: ['cancelled'] }
    };

    const allowed = allowedTransitions[role]?.[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Transition invalide: ${order.status} → ${status}`
      });
    }

    const updates = { status };
    if (status === 'picked_up') updates.picked_up_at = new Date().toISOString();
    if (status === 'delivered') {
      updates.delivered_at = new Date().toISOString();
      // Créditer le commerçant (80% du total)
      const shopShare = Math.floor(order.subtotal * 0.80);
      const livreurShare = order.delivery_fee;
      const { data: shopWallet } = await supabaseAdmin
        .from('wallets').select('id,balance').eq('user_id', order.shops.owner_id).single();

      if (shopWallet) {
        await supabaseAdmin.from('wallets')
          .update({ balance: shopWallet.balance + shopShare })
          .eq('id', shopWallet.id);

        await supabaseAdmin.from('transactions').insert({
          wallet_id: shopWallet.id,
          user_id: order.shops.owner_id,
          type: 'credit', amount: shopShare,
          balance_before: shopWallet.balance,
          balance_after: shopWallet.balance + shopShare,
          description: `Vente commande ${order.order_number}`,
          order_id: order.id
        });
      }

      if (order.livreur_id) {
        const { data: livreurWallet } = await supabaseAdmin
          .from('wallets').select('id,balance').eq('user_id', order.livreur_id).single();

        if (livreurWallet) {
          await supabaseAdmin.from('wallets')
            .update({ balance: livreurWallet.balance + livreurShare })
            .eq('id', livreurWallet.id);

          await supabaseAdmin.from('livreurs')
            .update({ total_deliveries: supabaseAdmin.rpc('increment', {row_id: order.livreur_id}) })
            .eq('id', order.livreur_id);
        }
      }
    }

    if (status === 'cancelled') updates.cancelled_at = new Date().toISOString();

    await supabaseAdmin.from('orders').update(updates).eq('id', order.id);

    // Notifier le client
    const statusMessages = {
      confirmed: '✅ Votre commande est confirmée !',
      preparing: '👨‍🍳 Votre commande est en préparation',
      ready: '📦 Votre commande est prête',
      picked_up: '🛵 Le livreur a récupéré votre commande',
      in_route: '🛵 Votre commande est en route !',
      delivered: '🎉 Commande livrée ! Bon appétit !',
      cancelled: '❌ Votre commande a été annulée'
    };

    if (statusMessages[status]) {
      await supabaseAdmin.from('notifications').insert({
        user_id: order.client_id,
        type: `order_${status}`,
        title: statusMessages[status],
        body: `Commande ${order.order_number}`,
        data: { orderId: order.id }
      });
    }

    res.json({ success: true, message: `Statut mis à jour: ${status}` });
  } catch (err) {
    console.error('[order status]', err);
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut' });
  }
});

// ─── POST /api/orders/:id/tracking ──────────────────────────
// Le livreur envoie sa position GPS
router.post('/:id/tracking', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'latitude et longitude requis' });
    }

    await supabaseAdmin.from('order_tracking').insert({
      order_id: req.params.id,
      livreur_id: req.user.id,
      latitude, longitude
    });

    // Mettre à jour la position courante du livreur
    await supabaseAdmin.from('livreurs')
      .update({ current_lat: latitude, current_lng: longitude, last_seen: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur tracking' });
  }
});

// ─── POST /api/orders/:id/review ────────────────────────────
router.post('/:id/review', authenticate, requireRole('client'), async (req, res) => {
  try {
    const { shopRating, livreurRating, comment } = req.body;
    const { data: order } = await supabaseAdmin
      .from('orders').select('*').eq('id', req.params.id).single();

    if (!order || order.client_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    if (order.status !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Vous ne pouvez noter qu\'une commande livrée' });
    }

    await supabaseAdmin.from('reviews').insert({
      order_id: order.id,
      client_id: req.user.id,
      shop_id: order.shop_id,
      livreur_id: order.livreur_id,
      shop_rating: shopRating,
      livreur_rating: livreurRating,
      comment
    });

    res.json({ success: true, message: 'Merci pour votre avis !' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur soumission avis' });
  }
});

module.exports = router;
