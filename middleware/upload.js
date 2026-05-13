// middleware/upload.js — KibaAlo v2 — Upload Cloudinary
const multer    = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Si Cloudinary non configuré, utiliser le stockage mémoire
let storage;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
      folder: `kibaalo/${req.uploadFolder || 'misc'}`,
      allowed_formats: ['jpg','jpeg','png','gif','webp','pdf','mp4'],
      resource_type: file.mimetype.startsWith('video/') || file.originalname.endsWith('.mp4') ? 'video' : 'auto',
      transformation: file.fieldname === 'avatar'  ? [{ width:400,  height:400,  crop:'fill', quality:'auto' }] :
                      file.fieldname === 'logo'    ? [{ width:400,  height:400,  crop:'fill', quality:'auto' }] :
                      file.fieldname === 'cover'   ? [{ width:1200, height:400,  crop:'fill', quality:'auto' }] :
                      file.fieldname === 'id_front' ||
                      file.fieldname === 'id_back' ||
                      file.fieldname === 'selfie'  ? [{ quality:'auto' }] : [],
    }),
  });
} else {
  storage = multer.memoryStorage();
  console.warn('⚠️ Cloudinary non configuré — stockage en mémoire (dev only)');
}

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4','video/mpeg','video/webm',
    'application/zip','application/x-zip-compressed',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error(`Type de fichier non supporté: ${file.mimetype}`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
});

// Middleware pour définir le dossier de destination
upload.setFolder = (folder) => (req, res, next) => {
  req.uploadFolder = folder;
  next();
};

module.exports = upload;


// ================================================================
// middleware/auth.js — KibaAlo v2
// ================================================================
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token d\'authentification manquant' });
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
