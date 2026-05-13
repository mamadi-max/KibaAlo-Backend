// middleware/auth.js
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Vérifie et décode le token JWT
 * @param {string} token - Le token JWT
 * @returns {Promise<Object|null>} - Utilisateur décodé ou null
 */
const verifyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, role, is_active, phone, first_name, last_name, email, country, city, avatar_url, premium_until, created_at')
      .eq('id', decoded.id)
      .single();

    if (error || !user) return null;
    if (!user.is_active) return null;
    
    return user;
  } catch (error) {
    return null;
  }
};

/**
 * Middleware d'authentification JWT
 * Vérifie le token Bearer dans le header Authorization
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token d\'authentification manquant',
        code: 'MISSING_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];
    const user = await verifyToken(token);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token invalide ou utilisateur introuvable',
        code: 'INVALID_TOKEN'
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Session expirée. Veuillez vous reconnecter.',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    console.error('[Auth Error]', err.message);
    return res.status(401).json({ 
      success: false, 
      message: 'Token invalide',
      code: 'INVALID_TOKEN'
    });
  }
};

/**
 * Middleware de vérification de rôle
 * @param {...string} roles - Rôles autorisés
 * @example requireRole('commercant', 'admin')
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Non authentifié',
      code: 'UNAUTHENTICATED'
    });
  }
  
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Accès réservé aux : ${roles.join(', ')}`,
      code: 'FORBIDDEN_ROLE',
      yourRole: req.user.role
    });
  }
  
  next();
};

/**
 * Middleware pour les livreurs uniquement
 */
const requireLivreur = requireRole('livreur');

/**
 * Middleware pour les commerçants uniquement
 */
const requireCommercant = requireRole('commercant');

/**
 * Middleware pour les clients uniquement
 */
const requireClient = requireRole('client');

/**
 * Middleware optionnel — n'échoue pas si pas de token
 * Utile pour les routes qui peuvent fonctionner sans authentification
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const user = await verifyToken(token);
      req.user = user || null;
    } else {
      req.user = null;
    }
  } catch (error) {
    req.user = null;
  }
  next();
};

/**
 * Rafraîchir le token (prolonger la session)
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token manquant' });
    }
    
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const user = await verifyToken(decoded.id);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });
    }
    
    const newToken = jwt.sign(
      { id: user.id, role: user.role, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    
    res.json({ success: true, token: newToken });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Refresh token invalide' });
  }
};

module.exports = { 
  authenticate, 
  requireRole, 
  optionalAuth,
  requireLivreur,
  requireCommercant,
  requireClient,
  refreshToken,
  verifyToken
};
