// routes/auth.js
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

// ─── Helpers ───────────────────────────────────────────────
const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role, phone: user.phone },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const userPublic = (u) => ({
  id: u.id, phone: u.phone, email: u.email,
  firstName: u.first_name, lastName: u.last_name,
  role: u.role, country: u.country, city: u.city,
  avatarUrl: u.avatar_url, isVerified: u.is_verified,
  premiumUntil: u.premium_until, createdAt: u.created_at
});

// ─── POST /api/auth/register ────────────────────────────────
router.post('/register', [
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('firstName').notEmpty().withMessage('Prénom requis'),
  body('lastName').notEmpty().withMessage('Nom requis'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe: 6 caractères minimum'),
  body('role').isIn(['client', 'livreur', 'commercant']).withMessage('Rôle invalide'),
  body('country').isIn(['BF', 'NE']).withMessage('Pays invalide (BF ou NE)'),
  body('city').notEmpty().withMessage('Ville requise'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { phone, firstName, lastName, email, password, role, country, city, shopName, shopCategory, vehicleType } = req.body;

    // Vérifier unicité du téléphone
    const { data: existing } = await supabaseAdmin
      .from('users').select('id').eq('phone', phone).single();

    if (existing) {
      return res.status(409).json({ success: false, message: 'Ce numéro de téléphone est déjà enregistré' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 10);

    // Créer l'utilisateur
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        phone, email: email || null,
        first_name: firstName, last_name: lastName,
        password_hash: passwordHash,
        role, country, city
      })
      .select()
      .single();

    if (userError) throw userError;

    // Créer le portefeuille
    await supabaseAdmin.from('wallets').insert({ user_id: user.id, balance: 0 });

    // Profil spécifique au rôle
    if (role === 'livreur') {
      await supabaseAdmin.from('livreurs').insert({
        id: user.id,
        vehicle_type: vehicleType || 'moto'
      });
    }

    // ==========================================================
    // CRÉATION AUTOMATIQUE DE LA BOUTIQUE POUR COMMERÇANT
    // ==========================================================
    if (role === 'commercant' && shopName) {
      const { error: shopError } = await supabaseAdmin
        .from('shops')
        .insert({
          owner_id: user.id,
          name: shopName,
          category: shopCategory || 'Autre',
          city: city || 'Ouagadougou',
          country: country || 'BF',
          delivery_fee: 500,
          is_active: true
        });
      
      if (shopError) {
        console.error('Erreur création boutique auto:', shopError);
      }
    }

    // Notification de bienvenue
    await supabaseAdmin.from('notifications').insert({
      user_id: user.id,
      type: 'welcome',
      title: 'Bienvenue sur KibaAlo !',
      body: `Bonjour ${firstName} ! Votre compte est créé avec succès.`
    });

    const token = signToken(user);

    // Récupérer le shopId si commerçant
    let shopId = null;
    if (user.role === 'commercant') {
      const { data: shop } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .single();
      shopId = shop?.id || null;
    }

    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      token,
      user: userPublic(user),
      shopId
    });

  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'inscription' });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────
router.post('/login', [
  body('phone').notEmpty().withMessage('Téléphone requis'),
  body('password').notEmpty().withMessage('Mot de passe requis'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { phone, password } = req.body;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: 'Numéro de téléphone ou mot de passe incorrect' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Compte désactivé. Contactez le support.' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ success: false, message: 'Numéro de téléphone ou mot de passe incorrect' });
    }

    // Mettre à jour last_seen pour les livreurs
    if (user.role === 'livreur') {
      await supabaseAdmin.from('livreurs')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', user.id);
    }

    const token = signToken(user);
    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      user: userPublic(user)
    });

  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la connexion' });
  }
});

// ─── GET /api/auth/me ───────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', req.user.id).single();

    const { data: notifCount } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact' })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    res.json({
      success: true,
      user: userPublic(req.user),
      walletBalance: wallet?.balance || 0,
      unreadNotifications: notifCount?.length || 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ─── PUT /api/auth/profile ──────────────────────────────────
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { firstName, lastName, email, city } = req.body;
    const updates = {};
    if (firstName) updates.first_name = firstName;
    if (lastName)  updates.last_name  = lastName;
    if (email)     updates.email      = email;
    if (city)      updates.city       = city;

    const { data: user, error } = await supabaseAdmin
      .from('users').update(updates).eq('id', req.user.id).select().single();

    if (error) throw error;
    res.json({ success: true, user: userPublic(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour profil' });
  }
});

// ─── PUT /api/auth/password ─────────────────────────────────
router.put('/password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const { data: user } = await supabaseAdmin
      .from('users').select('password_hash').eq('id', req.user.id).single();

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ success: false, message: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(newPassword, 10);
    await supabaseAdmin.from('users').update({ password_hash: hash }).eq('id', req.user.id);

    res.json({ success: true, message: 'Mot de passe mis à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;