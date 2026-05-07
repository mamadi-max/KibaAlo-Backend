// middleware/auth.js
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Middleware d'authentification JWT
 * Vérifie le token Bearer dans le header Authorization
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token d\'authentification manquant' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Vérifier que l'utilisateur existe encore en base
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, role, is_active, phone, first_name, last_name, country, city, premium_until')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Compte désactivé. Contactez le support.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expirée. Reconnectez-vous.' });
    }
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }
};

/**
 * Middleware de vérification de rôle
 * Usage: requireRole('commercant', 'admin')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Non authentifié' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Accès réservé aux : ${roles.join(', ')}`
    });
  }
  next();
};

/**
 * Middleware optionnel — n'échoue pas si pas de token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { data: user } = await supabaseAdmin
        .from('users').select('*').eq('id', decoded.id).single();
      req.user = user || null;
    }
  } catch { req.user = null; }
  next();
};

module.exports = { authenticate, requireRole, optionalAuth };
