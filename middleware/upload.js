// middleware/upload.js — KibaAlo v2 — Upload Cloudinary
const multer    = require('multer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

let storage;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
      folder: `kibaalo/${req.uploadFolder || 'misc'}`,
      allowed_formats: ['jpg','jpeg','png','gif','webp','pdf','mp4'],
      resource_type: file.mimetype.startsWith('video/') ? 'video' : 'auto',
      transformation:
        file.fieldname === 'avatar' ? [{ width:400, height:400, crop:'fill', quality:'auto' }] :
        file.fieldname === 'logo'   ? [{ width:400, height:400, crop:'fill', quality:'auto' }] :
        file.fieldname === 'cover'  ? [{ width:1200, height:400, crop:'fill', quality:'auto' }] : [],
    }),
  });
} else {
  storage = multer.memoryStorage();
  console.warn('⚠️ Cloudinary non configuré — stockage mémoire (dev only)');
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
  else cb(new Error(`Type non supporté: ${file.mimetype}`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
});

upload.setFolder = (folder) => (req, res, next) => {
  req.uploadFolder = folder;
  next();
};

module.exports = upload;
