// middleware/auth.js — KibaAlo v2
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: "Token d'authentification manquant" });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, role, is_active, is_suspended, email, phone, first_name, last_name, country, city, kyc_status, premium_until, premium_plan, avatar_url')
      .eq('id', decoded.id).single();

    if (error || !user) return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });
    if (!user.is_active)   return res.status(403).json({ success: false, message: 'Compte désactivé' });
    if (user.is_suspended) return res.status(403).json({ success: false, message: 'Compte suspendu. Contactez le support.' });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Session expirée. Reconnectez-vous.' });
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Non authentifié' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: `Accès réservé aux : ${roles.join(', ')}` });
  }
  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { data: user } = await supabaseAdmin
        .from('users').select('id, role, email, first_name').eq('id', decoded.id).single();
      req.user = user || null;
    } else { req.user = null; }
  } catch { req.user = null; }
  next();
};

module.exports = { authenticate, requireRole, optionalAuth };
