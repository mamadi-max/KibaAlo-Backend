// routes/orders.js — KibaAlo v2 — Commandes + Factures + Produits digitaux
const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');
const EmailService  = require('../services/email');
const InvoiceService = require('../services/invoice');
const PaymentService = require('../services/payment');

const genOrderNumber = () => {
  const ts   = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `KBA-${ts}${rand}`;
};

const genDownloadPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pwd = '';
  for (let i = 0; i < 8; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd.slice(0,4) + '-' + pwd.slice(4);
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// ── POST /api/orders ─────────────────────────────────────
router.post('/', authenticate, requireRole('client'), async (req, res) => {
  try {
    const {
      shopId, items, deliveryAddress, deliveryCity, deliveryCountry,
      deliveryLat, deliveryLng, deliveryInstructions,
      paymentMethod, promoCode, notes,
    } = req.body;

    if (!shopId || !items?.length) {
      return res.status(400).json({ success: false, message: 'shopId et items requis' });
    }

    // Charger la boutique
    const { data: shop } = await supabaseAdmin
      .from('shops').select('*').eq('id', shopId).eq('is_active', true).single();
    if (!shop) return res.status(404).json({ success: false, message: 'Boutique introuvable ou inactive' });
    if (!shop.is_open) return res.status(400).json({ success: false, message: `${shop.name} est actuellement fermée` });

    // Valider et valoriser les articles
    const productIds = items.map(i => i.productId);
    const { data: products } = await supabaseAdmin
      .from('products').select('*').in('id', productIds);

    const orderItems = [];
    let subtotal = 0;
    let hasDigital = false;

    for (const item of items) {
      const product = products?.find(p => p.id === item.productId);
      if (!product || !product.is_available) {
        return res.status(400).json({ success: false, message: `Produit indisponible: ${item.productId}` });
      }
      const qty = parseInt(item.qty) || 1;
      const price = product.is_promo && product.promo_percent > 0
        ? Math.floor(product.price * (1 - product.promo_percent / 100))
        : product.price;

      orderItems.push({
        product_id: product.id, name: product.name,
        price, qty, emoji: product.emoji || '📦',
        total: price * qty,
        is_digital: product.is_digital || false,
        digital_file_url: product.digital_file_url,
        digital_file_type: product.digital_file_type,
        digital_password_template: product.digital_password_template,
      });
      subtotal += price * qty;
      if (product.is_digital) hasDigital = true;
    }

    // Appliquer le code promo
    let discountAmount = 0;
    let promoData = null;
    if (promoCode) {
      const { data: promo } = await supabaseAdmin
        .from('promo_codes')
        .select('*').eq('code', promoCode.toUpperCase()).eq('is_active', true)
        .gte('expires_at', new Date().toISOString()).single();

      if (promo && subtotal >= promo.min_order) {
        if (promo.type === 'percent') discountAmount = Math.floor(subtotal * promo.value / 100);
        else if (promo.type === 'fixed') discountAmount = promo.value;
        if (promo.max_discount) discountAmount = Math.min(discountAmount, promo.max_discount);
        promoData = promo;
      }
    }

    const deliveryFee = hasDigital ? 0 : (shop.delivery_fee || 500);
    const total = subtotal - discountAmount + deliveryFee;

    // Vérifier solde si paiement wallet
    const method = paymentMethod || 'wallet';
    if (method === 'wallet') {
      const { data: wallet } = await supabaseAdmin
        .from('wallets').select('balance').eq('user_id', req.user.id).single();
      if (!wallet || wallet.balance < total) {
        return res.status(400).json({
          success: false,
          message: `Solde insuffisant. Requis: ${total.toLocaleString()} F. Disponible: ${(wallet?.balance||0).toLocaleString()} F`,
        });
      }
    }

    // Générer numéro de facture
    const invoiceNumber = InvoiceService.generateNumber(shopId);

    // Créer la commande
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders').insert({
        order_number: genOrderNumber(),
        client_id: req.user.id,
        shop_id: shopId,
        status: shop.auto_accept_orders ? 'confirmed' : 'pending',
        items: orderItems,
        subtotal, delivery_fee: deliveryFee,
        discount_amount: discountAmount,
        promo_code: promoCode || null,
        total,
        payment_method: method,
        payment_status: method === 'wallet' ? 'paid' : 'pending',
        delivery_address: deliveryAddress || null,
        delivery_city: deliveryCity || req.user.city,
        delivery_country: deliveryCountry || req.user.country,
        delivery_lat: deliveryLat || null,
        delivery_lng: deliveryLng || null,
        delivery_instructions: deliveryInstructions || null,
        estimated_time: hasDigital ? 5 : (shop.estimated_time || 45),
        invoice_number: invoiceNumber,
        notes: notes || null,
        confirmed_at: shop.auto_accept_orders ? new Date().toISOString() : null,
      }).select().single();
    if (orderErr) throw orderErr;

    // ── Paiement ─────────────────────────────────────────
    if (method === 'wallet') {
      const { data: wallet } = await supabaseAdmin
        .from('wallets').select('id, balance').eq('user_id', req.user.id).single();
      const newBalance = wallet.balance - total;

      await supabaseAdmin.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
      await supabaseAdmin.from('transactions').insert({
        wallet_id: wallet.id, user_id: req.user.id,
        type: 'debit', amount: total,
        balance_before: wallet.balance, balance_after: newBalance,
        description: `Commande ${order.order_number}`, order_id: order.id,
      });
      await supabaseAdmin.from('payments').insert({
        order_id: order.id, user_id: req.user.id,
        amount: total, provider: 'wallet',
        status: 'completed', completed_at: new Date().toISOString(),
      });

    } else {
      // Paiement mobile money
      const paymentResult = await PaymentService.initiate({
        provider: method, amount: total,
        phone: req.user.phone || req.body.paymentPhone,
        orderId: order.id, country: req.user.country,
        callbackUrl: `${process.env.FRONTEND_URL}/payment/callback?orderId=${order.id}`,
      });

      await supabaseAdmin.from('payments').insert({
        order_id: order.id, user_id: req.user.id,
        amount: total, provider: method,
        provider_reference: paymentResult.reference,
        status: paymentResult.simulated ? 'completed' : 'processing',
        phone_number: req.user.phone,
        country: req.user.country,
      });

      // Si simulation, marquer comme payé
      if (paymentResult.simulated) {
        await supabaseAdmin.from('orders')
          .update({ payment_status: 'paid', payment_reference: paymentResult.reference })
          .eq('id', order.id);
      }

      // Retourner les infos de paiement
      if (paymentResult.paymentUrl) {
        return res.status(201).json({
          success: true, data: order,
          payment: { url: paymentResult.paymentUrl, reference: paymentResult.reference },
          message: 'Redirection vers le paiement...',
        });
      }
      if (paymentResult.message) {
        return res.status(201).json({
          success: true, data: order,
          payment: { message: paymentResult.message, reference: paymentResult.reference },
        });
      }
    }

    // ── Mise à jour promo code ────────────────────────────
    if (promoData) {
      await supabaseAdmin.from('promo_codes')
        .update({ used_count: promoData.used_count + 1 }).eq('id', promoData.id);
    }

    // ── Produits digitaux ─────────────────────────────────
    if (hasDigital) {
      for (const item of orderItems.filter(i => i.is_digital)) {
        const password  = genDownloadPassword();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

        const { data: digitalPurchase } = await supabaseAdmin.from('digital_purchases').insert({
          order_id: order.id,
          product_id: item.product_id,
          client_id: req.user.id,
          client_email: req.user.email,
          download_password: password,
          download_url: item.digital_file_url,
          max_downloads: 5,
          expires_at: expiresAt.toISOString(),
        }).select().single();

        // Envoyer par email
        const product = products.find(p => p.id === item.product_id);
        if (product) {
          await EmailService.sendDigitalProduct(req.user.email, req.user.first_name, product, digitalPurchase);
          await supabaseAdmin.from('digital_purchases')
            .update({ email_sent: true, email_sent_at: new Date().toISOString() })
            .eq('id', digitalPurchase.id);
        }
      }
    }

    // ── Générer la facture ────────────────────────────────
    try {
      const { data: u } = await supabaseAdmin
        .from('users').select('first_name, last_name, email, phone, city').eq('id', req.user.id).single();

      const invoiceData = {
        invoice_number: invoiceNumber,
        order_id: order.id, client_id: req.user.id, shop_id: shopId,
        client_name:    `${u.first_name} ${u.last_name}`,
        client_email:   u.email, client_phone: u.phone,
        client_address: deliveryAddress || u.city,
        shop_name:      shop.name, shop_address: shop.address,
        shop_phone:     shop.phone,
        items: orderItems, subtotal, delivery_fee: deliveryFee,
        discount_amount: discountAmount, total,
        payment_method: method, currency: 'XOF',
        is_paid: true, paid_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      const pdfBuffer = await InvoiceService.generate(invoiceData);

      // Sauvegarder en DB
      const { data: inv } = await supabaseAdmin.from('invoices')
        .insert({ ...invoiceData, status: 'generated' }).select().single();

      // Mettre à jour la commande avec le flag facture
      await supabaseAdmin.from('orders')
        .update({ invoice_number: invoiceNumber, invoice_generated: true }).eq('id', order.id);

      // Envoyer la facture par email
      await EmailService.sendInvoice(u.email, u.first_name, invoiceData, pdfBuffer);

    } catch (invoiceErr) {
      console.error('[invoice]', invoiceErr.message); // Non bloquant
    }

    // ── Notifications ─────────────────────────────────────
    await supabaseAdmin.from('notifications').insert([
      {
        user_id: req.user.id, type: 'order_created',
        title: `📦 Commande ${order.order_number} passée !`,
        body: `Total: ${total.toLocaleString()} F CFA. ${hasDigital ? 'Vos fichiers ont été envoyés par email.' : 'Livraison en ~45 min.'}`,
        data: { orderId: order.id },
      },
      {
        user_id: shop.owner_id, type: 'new_order',
        title: '🆕 Nouvelle commande !',
        body: `${order.order_number} — ${total.toLocaleString()} F CFA`,
        data: { orderId: order.id },
      },
    ]);

    // ── Envoyer email confirmation ────────────────────────
    const { data: userFull } = await supabaseAdmin
      .from('users').select('email, first_name').eq('id', req.user.id).single();
    await EmailService.sendOrderConfirmation(userFull.email, userFull.first_name, {
      ...order, shopName: shop.name,
    });

    // ── Assigner un livreur (si non digital) ─────────────
    if (!hasDigital && deliveryLat && deliveryLng) {
      const maxRadius = parseFloat(process.env.MAX_DELIVERY_RADIUS_KM || '15');
      const { data: livreurs } = await supabaseAdmin
        .from('livreurs').select('id, current_lat, current_lng')
        .eq('is_available', true).eq('is_validated', true)
        .not('current_lat', 'is', null);

      const nearest = (livreurs||[])
        .map(l => ({ ...l, dist: haversineKm(deliveryLat, deliveryLng, l.current_lat, l.current_lng) }))
        .filter(l => l.dist <= maxRadius)
        .sort((a,b) => a.dist - b.dist)[0];

      if (nearest) {
        await supabaseAdmin.from('orders').update({ livreur_id: nearest.id }).eq('id', order.id);
        await supabaseAdmin.from('notifications').insert({
          user_id: nearest.id, type: 'new_delivery',
          title: '🛵 Nouvelle course !',
          body: `Livraison depuis ${shop.name} — ${deliveryFee.toLocaleString()} F`,
          data: { orderId: order.id },
        });
      }
    }

    res.status(201).json({
      success: true, data: order,
      message: hasDigital
        ? '✅ Commande passée ! Vos fichiers ont été envoyés par email.'
        : `✅ Commande ${order.order_number} passée avec succès !`,
    });

  } catch (err) {
    console.error('[orders create]', err);
    res.status(500).json({ success: false, message: 'Erreur création commande' });
  }
});

// ── GET /api/orders ──────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const { role, id } = req.user;

    let query = supabaseAdmin
      .from('orders')
      .select(`
        id, order_number, status, items, subtotal, delivery_fee,
        discount_amount, total, payment_method, payment_status,
        delivery_address, delivery_city, estimated_time,
        invoice_number, invoice_generated,
        confirmed_at, delivered_at, created_at,
        shops!shop_id(id, name, logo_url, emoji, phone),
        client:users!client_id(id, first_name, last_name, phone, avatar_url),
        livreur:users!livreur_id(id, first_name, last_name, phone)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (role === 'client')     query = query.eq('client_id', id);
    else if (role === 'livreur') query = query.eq('livreur_id', id);
    else if (role === 'commercant') {
      const { data: shop } = await supabaseAdmin
        .from('shops').select('id').eq('owner_id', id).limit(1).single();
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

// ── GET /api/orders/:id ──────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { data: order, error } = await supabaseAdmin
      .from('orders').select(`
        *,
        shops!shop_id(id, name, logo_url, phone, address, latitude, longitude, emoji),
        client:users!client_id(id, first_name, last_name, phone, avatar_url, email),
        livreur:users!livreur_id(id, first_name, last_name, phone, avatar_url),
        livreur_profile:livreurs!livreur_id(vehicle_type, vehicle_plate, rating, total_deliveries)
      `).eq('id', req.params.id).single();

    if (error || !order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    // Vérifier l'accès
    const hasAccess =
      order.client_id === req.user.id ||
      order.livreur_id === req.user.id ||
      req.user.role === 'commercant' || req.user.role === 'admin';
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Accès refusé' });

    // Dernière position GPS
    const { data: tracking } = await supabaseAdmin
      .from('order_tracking').select('latitude, longitude, recorded_at')
      .eq('order_id', order.id)
      .order('recorded_at', { ascending: false }).limit(1).single();

    res.json({ success: true, data: { ...order, lastPosition: tracking || null } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ── PATCH /api/orders/:id/status ─────────────────────────
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, cancelReason } = req.body;
    const { role, id: userId } = req.user;

    const { data: order, error } = await supabaseAdmin
      .from('orders').select(`*, shops!shop_id(owner_id, name, commission_rate)`).eq('id', req.params.id).single();
    if (error || !order) return res.status(404).json({ success: false, message: 'Commande introuvable' });

    const transitions = {
      commercant: { pending:['confirmed','cancelled'], confirmed:['preparing'], preparing:['ready'] },
      livreur:    { ready:['picked_up'], picked_up:['in_route'], in_route:['delivered'] },
      client:     { pending:['cancelled'], confirmed:['cancelled'] },
      admin:      { pending:['confirmed','cancelled'], confirmed:['preparing','cancelled'], preparing:['ready','cancelled'], ready:['picked_up','cancelled'], picked_up:['in_route'], in_route:['delivered','cancelled'] },
    };

    const allowed = transitions[role]?.[order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Transition invalide: ${order.status} → ${status}` });
    }

    const updates = { status };
    const now = new Date().toISOString();
    if (status === 'confirmed')  updates.confirmed_at  = now;
    if (status === 'preparing')  updates.preparing_at  = now;
    if (status === 'ready')      updates.ready_at       = now;
    if (status === 'picked_up')  updates.picked_up_at  = now;
    if (status === 'cancelled') { updates.cancelled_at = now; updates.cancel_reason = cancelReason || ''; }
    if (status === 'delivered') {
      updates.delivered_at = now;
      const commission = order.shops?.commission_rate || 10;
      const shopShare   = Math.floor(order.subtotal * (1 - commission/100));
      const livreurShare = order.delivery_fee;

      // Créditer le commerçant
      const { data: shopWallet } = await supabaseAdmin
        .from('wallets').select('id, balance').eq('user_id', order.shops.owner_id).single();
      if (shopWallet) {
        await supabaseAdmin.from('wallets').update({ balance: shopWallet.balance + shopShare }).eq('id', shopWallet.id);
        await supabaseAdmin.from('transactions').insert({
          wallet_id: shopWallet.id, user_id: order.shops.owner_id,
          type: 'credit', amount: shopShare,
          balance_before: shopWallet.balance, balance_after: shopWallet.balance + shopShare,
          description: `Vente ${order.order_number}`, order_id: order.id,
        });
      }

      // Créditer le livreur
      if (order.livreur_id) {
        const { data: livreurWallet } = await supabaseAdmin
          .from('wallets').select('id, balance').eq('user_id', order.livreur_id).single();
        if (livreurWallet) {
          await supabaseAdmin.from('wallets').update({ balance: livreurWallet.balance + livreurShare }).eq('id', livreurWallet.id);
          await supabaseAdmin.from('livreurs')
            .update({ total_deliveries: supabaseAdmin.rpc('coalesce', {}) }).eq('id', order.livreur_id);
        }
      }
    }

    await supabaseAdmin.from('orders').update(updates).eq('id', order.id);

    // Notifications
    const statusMessages = {
      confirmed:  '✅ Votre commande est confirmée !',
      preparing:  '👨‍🍳 Votre commande est en préparation',
      ready:      '📦 Votre commande est prête pour la livraison',
      picked_up:  '🛵 Le livreur a récupéré votre commande',
      in_route:   '🛵 Votre commande est en route !',
      delivered:  '🎉 Commande livrée ! Bonne dégustation !',
      cancelled:  '❌ Votre commande a été annulée',
    };

    if (statusMessages[status]) {
      await supabaseAdmin.from('notifications').insert({
        user_id: order.client_id, type: `order_${status}`,
        title: statusMessages[status],
        body: `Commande ${order.order_number}`,
        data: { orderId: order.id },
      });
    }

    res.json({ success: true, message: `Statut: ${status}` });
  } catch (err) {
    console.error('[order status]', err);
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut' });
  }
});

// ── GET /api/orders/:id/invoice ──────────────────────────
router.get('/:id/invoice', authenticate, async (req, res) => {
  try {
    const { data: order } = await supabaseAdmin
      .from('orders').select(`*, shops!shop_id(name, address, phone)`)
      .eq('id', req.params.id).single();

    if (!order || (order.client_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const { data: u } = await supabaseAdmin
      .from('users').select('first_name, last_name, email, phone, city').eq('id', order.client_id).single();

    const invoiceData = {
      invoice_number: order.invoice_number || InvoiceService.generateNumber(order.id),
      client_name:    `${u.first_name} ${u.last_name}`,
      client_email:   u.email, client_phone: u.phone,
      client_address: order.delivery_address || u.city,
      shop_name:      order.shops?.name, shop_address: order.shops?.address,
      shop_phone:     order.shops?.phone,
      items:          order.items || [],
      subtotal:       order.subtotal, delivery_fee: order.delivery_fee,
      discount_amount: order.discount_amount || 0,
      total:          order.total,
      payment_method: order.payment_method, currency: 'XOF',
      is_paid:        order.payment_status === 'paid',
      created_at:     order.created_at,
    };

    const pdfBuffer = await InvoiceService.generate(invoiceData);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="facture-${invoiceData.invoice_number}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[invoice download]', err);
    res.status(500).json({ success: false, message: 'Erreur génération facture' });
  }
});

// ── GET /api/orders/:id/digital ──────────────────────────
// Télécharger un produit digital
router.get('/:id/digital/:purchaseId', authenticate, async (req, res) => {
  try {
    const { password } = req.query;
    const { data: purchase } = await supabaseAdmin
      .from('digital_purchases')
      .select('*').eq('id', req.params.purchaseId).eq('order_id', req.params.id).single();

    if (!purchase) return res.status(404).json({ success: false, message: 'Achat introuvable' });
    if (purchase.client_id !== req.user.id) return res.status(403).json({ success: false, message: 'Accès refusé' });
    if (purchase.download_password !== password) return res.status(401).json({ success: false, message: 'Mot de passe incorrect' });
    if (purchase.download_count >= purchase.max_downloads) return res.status(403).json({ success: false, message: `Limite de téléchargements atteinte (${purchase.max_downloads} max)` });
    if (purchase.expires_at && new Date(purchase.expires_at) < new Date()) return res.status(403).json({ success: false, message: 'Lien de téléchargement expiré' });

    await supabaseAdmin.from('digital_purchases').update({
      download_count: purchase.download_count + 1,
      last_downloaded: new Date().toISOString(),
    }).eq('id', purchase.id);

    res.json({ success: true, downloadUrl: purchase.download_url });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur téléchargement' });
  }
});

// ── POST /api/orders/:id/tracking ────────────────────────
router.post('/:id/tracking', authenticate, requireRole('livreur'), async (req, res) => {
  try {
    const { latitude, longitude, speed, heading } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ success: false, message: 'Coordonnées requises' });

    await supabaseAdmin.from('order_tracking').insert({
      order_id: req.params.id, livreur_id: req.user.id,
      latitude, longitude, speed: speed||null, heading: heading||null,
    });
    await supabaseAdmin.from('livreurs').update({
      current_lat: latitude, current_lng: longitude,
      last_seen: new Date().toISOString(),
    }).eq('id', req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur tracking' });
  }
});

// ── POST /api/orders/:id/review ──────────────────────────
router.post('/:id/review', authenticate, requireRole('client'), async (req, res) => {
  try {
    const { shopRating, livreurRating, productRating, comment, photos } = req.body;
    const { data: order } = await supabaseAdmin
      .from('orders').select('*').eq('id', req.params.id).single();

    if (!order || order.client_id !== req.user.id) return res.status(403).json({ success: false, message: 'Accès refusé' });
    if (order.status !== 'delivered') return res.status(400).json({ success: false, message: 'Commande non encore livrée' });
    if (order.is_reviewed) return res.status(400).json({ success: false, message: 'Vous avez déjà noté cette commande' });

    await supabaseAdmin.from('reviews').insert({
      order_id: order.id, client_id: req.user.id,
      shop_id: order.shop_id, livreur_id: order.livreur_id,
      shop_rating: shopRating, livreur_rating: livreurRating,
      product_rating: productRating, comment, photos: photos || [],
    });
    await supabaseAdmin.from('orders').update({ is_reviewed: true }).eq('id', order.id);

    res.json({ success: true, message: '⭐ Merci pour votre avis !' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur soumission avis' });
  }
});

// ── POST /api/orders/webhook/payment ─────────────────────
router.post('/webhook/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const signature = req.headers['x-signature'] || req.headers['x-webhook-signature'];

    if (!PaymentService.verifyWebhookSignature(provider, req.body, signature)) {
      return res.status(401).json({ success: false, message: 'Signature invalide' });
    }

    const { reference, status, orderId } = req.body;
    if (status === 'completed' || status === 'SUCCESSFUL' || status === 'SUCCESS') {
      await supabaseAdmin.from('orders')
        .update({ payment_status: 'paid', payment_reference: reference, payment_paid_at: new Date().toISOString() })
        .eq('id', orderId);
      await supabaseAdmin.from('payments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('provider_reference', reference);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
