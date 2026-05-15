// routes/auth.js — KibaAlo v2 — CORRIGÉ
// Bugs corrigés:
//   1. Login par email uniquement (pas de numéro de téléphone requis)
//   2. shopId récupéré et renvoyé après login ET après register
//   3. Boutique créée automatiquement pour commerçant à l'inscription
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const EmailService = require('../services/email');
const upload = require('../middleware/upload');

// ── Helpers ──────────────────────────────────────────────
const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role, email: user.email },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

const userPublic = (u) => ({
  id:             u.id,
  email:          u.email,
  phone:          u.phone,
  firstName:      u.first_name,
  lastName:       u.last_name,
  role:           u.role,
  country:        u.country,
  city:           u.city,
  avatarUrl:      u.avatar_url,
  isEmailVerified:u.is_email_verified,
  kycStatus:      u.kyc_status,
  premiumUntil:   u.premium_until,
  premiumPlan:    u.premium_plan,
  language:       u.language,
  createdAt:      u.created_at,
});

const generateToken = () => crypto.randomBytes(32).toString('hex');

// ── Récupérer le shopId d'un commerçant ──────────────────
async function getShopId(userId) {
  try {
    const { data } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();
    return data?.id || null;
  } catch { return null; }
}

// ════════════════════════════════════════════════════════
// POST /api/auth/register
// ════════════════════════════════════════════════════════
router.post('/register', [
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('firstName').notEmpty().withMessage('Prénom requis'),
  body('lastName').notEmpty().withMessage('Nom requis'),
  body('password').isLength({ min: 8 }).withMessage('Mot de passe: minimum 8 caractères'),
  body('role').isIn(['client','livreur','commercant']).withMessage('Rôle invalide'),
  body('country').notEmpty().withMessage('Pays requis'),
  body('city').notEmpty().withMessage('Ville requise'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      email, phone, firstName, lastName, password, role,
      country, city, address,
      shopName, shopCategory, shopDescription, shopPhone, shopWhatsapp,
      vehicleType, vehicleBrand, vehiclePlate,
    } = req.body;

    // Vérifier unicité email
    const { data: existing } = await supabaseAdmin
      .from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (existing) {
      return res.status(409).json({ success: false, message: 'Cet email est déjà enregistré. Connectez-vous.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken  = generateToken();
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Créer l'utilisateur
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .insert({
        email:               email.toLowerCase(),
        phone:               phone || null,
        first_name:          firstName,
        last_name:           lastName,
        password_hash:       passwordHash,
        role,
        country,
        city,
        address:             address || null,
        email_verify_token:  verifyToken,
        email_verify_expiry: verifyExpiry,
        is_email_verified:   false,
        kyc_status:          'pending',
        language:            'fr',
      })
      .select()
      .single();

    if (userErr) {
      console.error('[register] user insert error:', userErr);
      throw userErr;
    }

    // Créer le portefeuille
    await supabaseAdmin.from('wallets').insert({ user_id: user.id, balance: 0 });

    // Profil livreur
    let shopId = null;
    if (role === 'livreur') {
      await supabaseAdmin.from('livreurs').insert({
        id:            user.id,
        vehicle_type:  vehicleType  || 'moto',
        vehicle_brand: vehicleBrand || null,
        vehicle_plate: vehiclePlate || null,
        countries:     [country],
      });
    }

    // Boutique pour commerçant
    if (role === 'commercant') {
      const name = shopName || `Boutique de ${firstName}`;
      const { data: shop, error: shopErr } = await supabaseAdmin
        .from('shops')
        .insert({
          owner_id:    user.id,
          name,
          description: shopDescription || null,
          category:    shopCategory    || 'other',
          phone:       shopPhone       || phone  || null,
          whatsapp:    shopWhatsapp    || phone  || null,
          city,
          country,
          is_active:   true,
          is_open:     true,
        })
        .select('id')
        .single();

      if (shopErr) {
        console.error('[register] shop insert error:', shopErr);
      } else {
        shopId = shop.id;
        console.log('[register] boutique créée, shopId:', shopId);
      }
    }

    // Emails
    try {
      await EmailService.sendVerification(email, firstName, verifyToken);
      await EmailService.sendWelcome(email, firstName, role);
    } catch (mailErr) {
      console.warn('[register] email error (non bloquant):', mailErr.message);
    }

    // Notification de bienvenue
    await supabaseAdmin.from('notifications').insert({
      user_id: user.id,
      type:    'welcome',
      title:   `🎉 Bienvenue ${firstName} !`,
      body:    role === 'commercant'
        ? `Votre boutique "${shopName || 'Boutique'}" est prête. Ajoutez vos premiers produits !`
        : 'Vérifiez votre email pour activer votre compte.',
    });

    const token = signToken(user);
    return res.status(201).json({
      success:   true,
      message:   'Compte créé avec succès ! Vérifiez votre email.',
      token,
      user:      userPublic(user),
      shopId,
      emailSent: true,
    });

  } catch (err) {
    console.error('[register]', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Cet email est déjà enregistré.' });
    }
    res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription. Réessayez.' });
  }
});

// ════════════════════════════════════════════════════════
// POST /api/auth/login
// CORRIGÉ: login par email uniquement, shopId renvoyé
// ════════════════════════════════════════════════════════
router.post('/login', [
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').notEmpty().withMessage('Mot de passe requis'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { email, password } = req.body;

    // Chercher par email uniquement
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Compte désactivé. Contactez le support.' });
    }
    if (user.is_suspended) {
      return res.status(403).json({ success: false, message: user.suspend_reason || 'Compte suspendu.' });
    }

    // Vérifier le mot de passe
    const pwdOk = await bcrypt.compare(password, user.password_hash);
    if (!pwdOk) {
      return res.status(401).json({ success: false, message: 'Email ou mot de passe incorrect' });
    }

    // Mettre à jour last_login
    await supabaseAdmin.from('users').update({
      last_login:  new Date().toISOString(),
      login_count: (user.login_count || 0) + 1,
    }).eq('id', user.id);

    // Récupérer le shopId si commerçant
    let shopId = null;
    if (user.role === 'commercant') {
      shopId = await getShopId(user.id);
      console.log('[login] commerçant shopId:', shopId);
    }

    // Solde portefeuille
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', user.id).maybeSingle();

    // Notifications non lues
    const { count: unreadNotifs } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    const token = signToken(user);
    return res.json({
      success:              true,
      message:              'Connexion réussie',
      token,
      user:                 userPublic(user),
      shopId,
      walletBalance:        wallet?.balance || 0,
      unreadNotifications:  unreadNotifs   || 0,
    });

  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ success: false, message: 'Erreur serveur. Réessayez.' });
  }
});

// ════════════════════════════════════════════════════════
// GET /api/auth/verify-email?token=xxx
// ════════════════════════════════════════════════════════
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token manquant' });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, email_verify_expiry, is_email_verified')
      .eq('email_verify_token', token)
      .maybeSingle();

    if (!user) return res.status(400).json({ success: false, message: 'Token invalide ou déjà utilisé' });
    if (user.is_email_verified) return res.json({ success: true, message: 'Email déjà vérifié ✅' });
    if (new Date(user.email_verify_expiry) < new Date()) {
      return res.status(400).json({ success: false, message: 'Token expiré. Demandez un nouveau lien.' });
    }

    await supabaseAdmin.from('users').update({
      is_email_verified:   true,
      email_verify_token:  null,
      email_verify_expiry: null,
    }).eq('id', user.id);

    res.json({ success: true, message: '✅ Email vérifié ! Vous pouvez maintenant vous connecter.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur vérification email' });
  }
});

// ════════════════════════════════════════════════════════
// POST /api/auth/resend-verification
// ════════════════════════════════════════════════════════
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email requis' });

    const { data: user } = await supabaseAdmin
      .from('users').select('id, first_name, is_email_verified').eq('email', email.toLowerCase()).maybeSingle();

    if (!user) return res.json({ success: true, message: 'Si cet email existe, un lien a été envoyé.' });
    if (user.is_email_verified) return res.json({ success: true, message: 'Email déjà vérifié' });

    const verifyToken  = generateToken();
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from('users').update({ email_verify_token: verifyToken, email_verify_expiry: verifyExpiry }).eq('id', user.id);
    await EmailService.sendVerification(email, user.first_name, verifyToken);

    res.json({ success: true, message: 'Email de vérification renvoyé !' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ════════════════════════════════════════════════════════
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Email invalide'),
], async (req, res) => {
  try {
    const { email } = req.body;
    const { data: user } = await supabaseAdmin
      .from('users').select('id, first_name, email').eq('email', email.toLowerCase()).maybeSingle();

    // Toujours répondre OK pour ne pas révéler si l'email existe
    if (!user) return res.json({ success: true, message: 'Si cet email existe, vous recevrez un lien.' });

    const resetToken  = generateToken();
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from('users').update({ reset_password_token: resetToken, reset_password_expiry: resetExpiry }).eq('id', user.id);
    await EmailService.sendPasswordReset(user.email, user.first_name, resetToken);

    res.json({ success: true, message: 'Si cet email existe, vous recevrez un lien de réinitialisation.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ════════════════════════════════════════════════════════
// POST /api/auth/reset-password
// ════════════════════════════════════════════════════════
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token requis'),
  body('password').isLength({ min: 8 }).withMessage('Minimum 8 caractères'),
], async (req, res) => {
  try {
    const { token, password } = req.body;
    const { data: user } = await supabaseAdmin
      .from('users').select('id, reset_password_expiry').eq('reset_password_token', token).maybeSingle();

    if (!user) return res.status(400).json({ success: false, message: 'Lien invalide ou déjà utilisé' });
    if (new Date(user.reset_password_expiry) < new Date()) {
      return res.status(400).json({ success: false, message: 'Lien expiré. Faites une nouvelle demande.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await supabaseAdmin.from('users').update({
      password_hash:        hash,
      reset_password_token:  null,
      reset_password_expiry: null,
    }).eq('id', user.id);

    res.json({ success: true, message: '✅ Mot de passe réinitialisé ! Connectez-vous.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ════════════════════════════════════════════════════════
// GET /api/auth/me — Renvoie l'utilisateur connecté + shopId
// ════════════════════════════════════════════════════════
router.get('/me', authenticate, async (req, res) => {
  try {
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', req.user.id).maybeSingle();

    const { count: unreadNotifs } = await supabaseAdmin
      .from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id).eq('is_read', false);

    let shopId = null;
    if (req.user.role === 'commercant') {
      shopId = await getShopId(req.user.id);
    }

    res.json({
      success:             true,
      user:                userPublic(req.user),
      walletBalance:       wallet?.balance        || 0,
      unreadNotifications: unreadNotifs           || 0,
      shopId,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ════════════════════════════════════════════════════════
// PUT /api/auth/profile
// ════════════════════════════════════════════════════════
router.put('/profile', authenticate, async (req, res) => {
  try {
    const updates = {};
    if (req.body.firstName)         updates.first_name         = req.body.firstName;
    if (req.body.lastName)          updates.last_name          = req.body.lastName;
    if (req.body.phone !== undefined) updates.phone            = req.body.phone || null;
    if (req.body.city)              updates.city               = req.body.city;
    if (req.body.address !== undefined) updates.address        = req.body.address || null;
    if (req.body.language)          updates.language           = req.body.language;
    if (req.body.notificationPrefs) updates.notification_prefs = req.body.notificationPrefs;
    if (req.body.pushToken)         updates.push_token         = req.body.pushToken;

    const { data: user, error } = await supabaseAdmin
      .from('users').update(updates).eq('id', req.user.id).select().single();
    if (error) throw error;

    res.json({ success: true, user: userPublic(user) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur mise à jour profil' });
  }
});

// ════════════════════════════════════════════════════════
// POST /api/auth/avatar
// ════════════════════════════════════════════════════════
router.post('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier envoyé' });
    const avatarUrl = req.file.path || req.file.secure_url || null;
    if (!avatarUrl) return res.status(400).json({ success: false, message: 'Upload échoué' });
    await supabaseAdmin.from('users').update({ avatar_url: avatarUrl }).eq('id', req.user.id);
    res.json({ success: true, avatarUrl, message: 'Photo de profil mise à jour ✅' });
  } catch (err) {
    console.error('[avatar]', err);
    res.status(500).json({ success: false, message: 'Erreur upload photo' });
  }
});

// ════════════════════════════════════════════════════════
// PUT /api/auth/password
// ════════════════════════════════════════════════════════
router.put('/password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
  body('newPassword').isLength({ min: 8 }).withMessage('Nouveau mot de passe: minimum 8 caractères'),
], async (req, res) => {
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

// ════════════════════════════════════════════════════════
// POST /api/auth/kyc
// ════════════════════════════════════════════════════════
router.post('/kyc', authenticate, upload.fields([
  { name: 'id_front', maxCount: 1 },
  { name: 'id_back',  maxCount: 1 },
  { name: 'selfie',   maxCount: 1 },
]), async (req, res) => {
  try {
    const { idType, idNumber } = req.body;
    if (!idType || !idNumber) {
      return res.status(400).json({ success: false, message: 'Type et numéro de pièce requis' });
    }
    const files   = req.files || {};
    const updates = {
      kyc_status:       'submitted',
      kyc_id_type:      idType,
      kyc_id_number:    idNumber,
      kyc_submitted_at: new Date().toISOString(),
    };
    if (files.id_front?.[0]) updates.kyc_id_front_url = files.id_front[0].path || files.id_front[0].secure_url;
    if (files.id_back?.[0])  updates.kyc_id_back_url  = files.id_back[0].path  || files.id_back[0].secure_url;
    if (files.selfie?.[0])   updates.kyc_selfie_url   = files.selfie[0].path   || files.selfie[0].secure_url;

    await supabaseAdmin.from('users').update(updates).eq('id', req.user.id);

    try {
      await EmailService.sendKycSubmitted(req.user.email, req.user.first_name);
    } catch { /* non bloquant */ }

    await supabaseAdmin.from('notifications').insert({
      user_id: req.user.id,
      type:    'kyc_submitted',
      title:   '📋 Documents soumis',
      body:    'Vos documents sont en cours de vérification (24-48h).',
    });

    res.json({ success: true, message: '📋 Documents envoyés ! Vérification sous 24-48h.' });
  } catch (err) {
    console.error('[kyc]', err);
    res.status(500).json({ success: false, message: 'Erreur soumission documents' });
  }
});

// ════════════════════════════════════════════════════════
// GET & POST /api/auth/addresses
// ════════════════════════════════════════════════════════
router.get('/addresses', authenticate, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('saved_addresses').select('*').eq('user_id', req.user.id).order('is_default', { ascending: false });
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement adresses' });
  }
});

router.post('/addresses', authenticate, async (req, res) => {
  try {
    const { label, address, city, country, latitude, longitude, isDefault } = req.body;
    if (!label || !address) return res.status(400).json({ success: false, message: 'Label et adresse requis' });

    if (isDefault) {
      await supabaseAdmin.from('saved_addresses').update({ is_default: false }).eq('user_id', req.user.id);
    }
    const { data } = await supabaseAdmin.from('saved_addresses').insert({
      user_id:    req.user.id,
      label, address, city: city || null,
      country:    country    || req.user.country,
      latitude:   latitude   || null,
      longitude:  longitude  || null,
      is_default: !!isDefault,
    }).select().single();

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur ajout adresse' });
  }
});

module.exports = router;
