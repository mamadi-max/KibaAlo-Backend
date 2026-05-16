// routes/auth.js — KibaAlo CORRIGÉ — Login par email
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role, email: user.email },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

const userPublic = (u) => ({
  id: u.id, email: u.email, phone: u.phone,
  firstName: u.first_name, lastName: u.last_name,
  role: u.role, country: u.country, city: u.city,
  avatarUrl: u.avatar_url, isEmailVerified: u.is_email_verified,
  kycStatus: u.kyc_status, premiumUntil: u.premium_until,
  language: u.language, createdAt: u.created_at,
});

async function getShopId(userId) {
  try {
    const { data } = await supabaseAdmin
      .from('shops').select('id').eq('owner_id', userId).eq('is_active', true).limit(1).single();
    return data?.id || null;
  } catch { return null; }
}

// ── POST /register ──────────────────────────────────────
router.post('/register', [
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('firstName').notEmpty().withMessage('Prénom requis'),
  body('lastName').notEmpty().withMessage('Nom requis'),
  body('password').isLength({ min: 8 }).withMessage('Minimum 8 caractères'),
  body('role').isIn(['client','livreur','commercant']).withMessage('Rôle invalide'),
  body('country').notEmpty().withMessage('Pays requis'),
  body('city').notEmpty().withMessage('Ville requise'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { email, phone, firstName, lastName, password, role, country, city, address,
            shopName, shopCategory, shopDescription, shopPhone, shopWhatsapp,
            vehicleType, vehicleBrand, vehiclePlate } = req.body;

    // Vérifier unicité email
    const { data: existing } = await supabaseAdmin
      .from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existing) return res.status(409).json({ success: false, message: 'Cet email est déjà enregistré. Connectez-vous.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken  = crypto.randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24*60*60*1000).toISOString();

    const { data: user, error: userErr } = await supabaseAdmin.from('users').insert({
      email: email.toLowerCase(), phone: phone || null,
      first_name: firstName, last_name: lastName,
      password_hash: passwordHash, role, country, city,
      address: address || null,
      email_verify_token: verifyToken,
      email_verify_expiry: verifyExpiry,
      is_email_verified: false,
      kyc_status: 'pending', language: 'fr',
    }).select().single();

    if (userErr) throw userErr;

    // Portefeuille
    await supabaseAdmin.from('wallets').insert({ user_id: user.id, balance: 0 });

    // Profil rôle
    let shopId = null;
    if (role === 'livreur') {
      await supabaseAdmin.from('livreurs').insert({
        id: user.id, vehicle_type: vehicleType || 'moto',
        vehicle_brand: vehicleBrand || null, vehicle_plate: vehiclePlate || null, countries: [country],
      });
    }
    if (role === 'commercant') {
      const { data: shop } = await supabaseAdmin.from('shops').insert({
        owner_id: user.id,
        name: shopName || `Boutique de ${firstName}`,
        description: shopDescription || null,
        category: shopCategory || 'other',
        phone: shopPhone || phone || null,
        whatsapp: shopWhatsapp || phone || null,
        city, country, is_active: true, is_open: true,
      }).select('id').single();
      shopId = shop?.id || null;
    }

    const token = signToken(user);
    return res.status(201).json({
      success: true, message: 'Compte créé ! Vérifiez votre email.',
      token, user: userPublic(user), shopId,
    });
  } catch (err) {
    console.error('[register]', err);
    if (err.code === '23505') return res.status(409).json({ success: false, message: 'Email déjà enregistré.' });
    res.status(500).json({ success: false, message: 'Erreur inscription. Réessayez.' });
  }
});

// ── POST /login — EMAIL uniquement ──────────────────────
router.post('/login', [
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').notEmpty().withMessage('Mot de passe requis'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { email, password } = req.body;

    const { data: user } = await supabaseAdmin
      .from('users').select('*').eq('email', email.toLowerCase()).maybeSingle();

    if (!user) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    if (!user.is_active)   return res.status(403).json({ success: false, message: 'Compte désactivé.' });
    if (user.is_suspended) return res.status(403).json({ success: false, message: user.suspend_reason || 'Compte suspendu.' });

    const pwdOk = await bcrypt.compare(password, user.password_hash);
    if (!pwdOk) return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });

    await supabaseAdmin.from('users').update({
      last_login: new Date().toISOString(), login_count: (user.login_count || 0) + 1,
    }).eq('id', user.id);

    // Récupérer shopId pour commerçant
    let shopId = null;
    if (user.role === 'commercant') {
      shopId = await getShopId(user.id);
      console.log('[login] shopId récupéré:', shopId);
    }

    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', user.id).maybeSingle();

    const token = signToken(user);
    return res.json({
      success: true, message: 'Connexion réussie',
      token, user: userPublic(user), shopId,
      walletBalance: wallet?.balance || 0,
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur. Réessayez.' });
  }
});

// ── GET /me ─────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', req.user.id).maybeSingle();
    const { count: unread } = await supabaseAdmin
      .from('notifications').select('id', { count:'exact', head:true })
      .eq('user_id', req.user.id).eq('is_read', false);

    let shopId = null;
    if (req.user.role === 'commercant') shopId = await getShopId(req.user.id);

    res.json({
      success: true, user: userPublic(req.user),
      walletBalance: wallet?.balance || 0,
      unreadNotifications: unread || 0, shopId,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ── PUT /profile ────────────────────────────────────────
router.put('/profile', authenticate, async (req, res) => {
  try {
    const updates = {};
    if (req.body.firstName) updates.first_name = req.body.firstName;
    if (req.body.lastName)  updates.last_name  = req.body.lastName;
    if (req.body.phone !== undefined) updates.phone = req.body.phone || null;
    if (req.body.city)      updates.city       = req.body.city;
    if (req.body.address !== undefined) updates.address = req.body.address || null;
    if (req.body.language)  updates.language   = req.body.language;

    const { data: user, error } = await supabaseAdmin
      .from('users').update(updates).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, user: userPublic(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour profil' });
  }
});

// ── PUT /password ───────────────────────────────────────
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { data: user } = await supabaseAdmin
      .from('users').select('password_hash').eq('id', req.user.id).single();
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ success: false, message: 'Mot de passe actuel incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await supabaseAdmin.from('users').update({ password_hash: hash }).eq('id', req.user.id);
    res.json({ success: true, message: '✅ Mot de passe mis à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;
