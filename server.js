// server.js — KibaAlo v2.0 — Serveur principal robuste
require('dotenv').config();

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const cron        = require('node-cron');

// ── Routes ────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const shopsRoutes     = require('./routes/shops');
const ordersRoutes    = require('./routes/orders');
const walletRoutes    = require('./routes/wallet');
const parcelsRoutes   = require('./routes/parcels');
const livreursRoutes  = require('./routes/livreurs');
const paymentsRoutes  = require('./routes/payments');
const searchRoutes    = require('./routes/search');
const adminRoutes     = require('./routes/admin');

// ── Services ──────────────────────────────────────────────
const EmailService   = require('./services/email');
const { supabaseAdmin } = require('./config/supabase');

const app    = express();
const server = http.createServer(app);

// ================================================================
// SOCKET.IO — Temps réel
// ================================================================
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET','POST'], credentials: true },
  transports: ['websocket','polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Map des connexions actives
const connectedUsers  = new Map(); // userId → socketId
const onlineLivreurs  = new Map(); // livreurId → { socketId, lat, lng }

io.on('connection', (socket) => {
  console.log(`🔌 Socket: ${socket.id}`);

  // Authentification socket
  socket.on('auth', ({ userId, role }) => {
    connectedUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.userRole = role;
    if (role === 'livreur') {
      socket.join('livreurs');
      onlineLivreurs.set(userId, { socketId: socket.id, lat: null, lng: null });
    }
    socket.join(`user:${userId}`);
    console.log(`👤 ${role} connecté: ${userId}`);
  });

  // Rejoindre la room d'une commande (client, livreur, commerçant)
  socket.on('join_order', (orderId) => {
    socket.join(`order:${orderId}`);
  });
  socket.on('leave_order', (orderId) => {
    socket.leave(`order:${orderId}`);
  });

  // Position GPS du livreur en temps réel
  socket.on('livreur_location', async ({ orderId, lat, lng }) => {
    if (socket.userId) {
      onlineLivreurs.set(socket.userId, { socketId: socket.id, lat, lng });
      // Diffuser à tous les clients qui suivent cette commande
      io.to(`order:${orderId}`).emit('location_update', { lat, lng, timestamp: Date.now() });
      // Sauvegarder en DB (toutes les 30s pour ne pas surcharger)
      const now = Date.now();
      if (!socket._lastDbSave || now - socket._lastDbSave > 30000) {
        socket._lastDbSave = now;
        supabaseAdmin.from('livreurs')
          .update({ current_lat: lat, current_lng: lng, last_seen: new Date().toISOString() })
          .eq('id', socket.userId).then(() => {});
      }
    }
  });

  // Mise à jour de statut de commande
  socket.on('order_status', ({ orderId, status }) => {
    io.to(`order:${orderId}`).emit('status_update', { status, timestamp: Date.now() });
  });

  // Notification push en temps réel
  socket.on('mark_notif_read', async ({ notifId }) => {
    if (socket.userId) {
      await supabaseAdmin.from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notifId).eq('user_id', socket.userId);
    }
  });

  // Chat livreur ↔ client
  socket.on('chat_message', ({ orderId, message, senderId }) => {
    io.to(`order:${orderId}`).emit('chat_message', { message, senderId, timestamp: Date.now() });
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      connectedUsers.delete(socket.userId);
      onlineLivreurs.delete(socket.userId);
    }
    console.log(`🔌 Déconnexion: ${socket.id}`);
  });
});

// Rendre io et les maps accessibles dans les routes
app.set('io', io);
app.set('connectedUsers', connectedUsers);
app.set('onlineLivreurs', onlineLivreurs);

// ================================================================
// MIDDLEWARES GLOBAUX
// ================================================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: (origin, cb) => {
    const allowed = (process.env.FRONTEND_URL || '').split(',').concat(['http://localhost:3000','http://localhost:5173']);
    if (!origin || allowed.includes(origin) || process.env.NODE_ENV !== 'production') cb(null, true);
    else cb(new Error('CORS non autorisé'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  message: { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path === '/health',
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15,
  message: { success: false, message: 'Trop de tentatives. Attendez 15 minutes.' },
});
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, max: 60,
  message: { success: false, message: 'Trop de recherches. Attendez 1 minute.' },
});

app.use('/api', globalLimiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/search', searchLimiter);

// ================================================================
// ROUTES
// ================================================================
app.use('/api/auth',      authRoutes);
app.use('/api/shops',     shopsRoutes);
app.use('/api/orders',    ordersRoutes);
app.use('/api/wallet',    walletRoutes);
app.use('/api/parcels',   parcelsRoutes);
app.use('/api/livreurs',  livreursRoutes);
app.use('/api/payments',  paymentsRoutes);
app.use('/api/search',    searchRoutes);
app.use('/api/admin',     adminRoutes);

// Routes extraites du module livreurs
app.use('/api/notifications', livreursRoutes.notifRouter);
app.use('/api/premium',       livreursRoutes.premiumRouter);

// ── Santé ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok', app: 'KibaAlo API v2',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()) + 's',
    countries: ['BF','NE','ML','SN','CI','GN','GH','NG','CM','TG','BJ','MR','GM','SL','LR','GW'],
    onlineLivreurs: onlineLivreurs.size,
    connectedUsers: connectedUsers.size,
  });
});

// ── Documentation API ─────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'KibaAlo API v2.0',
    description: 'Livraison & Services — Afrique de l\'Ouest (16 pays)',
    version: '2.0.0',
    docs: 'https://docs.kibaalo.app',
    endpoints: {
      auth: [
        'POST /api/auth/register',
        'POST /api/auth/login',
        'GET  /api/auth/verify-email?token=',
        'POST /api/auth/resend-verification',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
        'GET  /api/auth/me',
        'PUT  /api/auth/profile',
        'POST /api/auth/avatar',
        'PUT  /api/auth/password',
        'POST /api/auth/kyc',
        'GET  /api/auth/addresses',
        'POST /api/auth/addresses',
      ],
      shops: [
        'GET  /api/shops?q=&category=&city=&country=&lat=&lng=&radius=&sortBy=',
        'GET  /api/shops/categories',
        'GET  /api/shops/:id',
        'POST /api/shops',
        'PUT  /api/shops/:id',
        'POST /api/shops/:id/logo',
        'GET  /api/shops/:id/products',
        'POST /api/shops/:id/products',
        'PUT  /api/shops/:id/products/:pid',
        'DELETE /api/shops/:id/products/:pid',
        'GET  /api/shops/my/dashboard',
        'GET  /api/shops/:id/reviews',
        'POST /api/shops/:id/promo',
        'POST /api/shops/validate-promo',
      ],
      orders: [
        'POST /api/orders',
        'GET  /api/orders',
        'GET  /api/orders/:id',
        'PATCH /api/orders/:id/status',
        'GET  /api/orders/:id/invoice (PDF)',
        'GET  /api/orders/:id/digital/:purchaseId?password=',
        'POST /api/orders/:id/tracking',
        'POST /api/orders/:id/review',
        'POST /api/orders/webhook/:provider',
      ],
      payments: [
        'POST /api/payments/initiate',
        'GET  /api/payments/status/:reference',
        'GET  /api/payments/providers/:country',
        'POST /api/payments/refund',
      ],
      search: [
        'GET /api/search?q=&type=&country=&city=',
        'GET /api/search/suggestions?q=',
        'GET /api/search/popular',
      ],
    },
  });
});

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route introuvable: ${req.method} ${req.path}` });
});

// ── Erreurs globales ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erreur:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Erreur interne du serveur' : err.message,
  });
});

// ================================================================
// TÂCHES PLANIFIÉES (CRON)
// ================================================================

// Nettoyage des tokens expirés — chaque nuit à 2h
cron.schedule('0 2 * * *', async () => {
  console.log('🕐 Nettoyage des tokens expirés...');
  await supabaseAdmin.from('users')
    .update({ email_verify_token: null, email_verify_expiry: null })
    .lt('email_verify_expiry', new Date().toISOString())
    .not('email_verify_expiry', 'is', null);
  await supabaseAdmin.from('users')
    .update({ reset_password_token: null, reset_password_expiry: null })
    .lt('reset_password_expiry', new Date().toISOString())
    .not('reset_password_expiry', 'is', null);
});

// Vérification des livreurs hors ligne — toutes les 5 min
cron.schedule('*/5 * * * *', async () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabaseAdmin.from('livreurs')
    .update({ is_available: false })
    .lt('last_seen', fiveMinAgo)
    .eq('is_available', true);
});

// Rapport quotidien des commerçants — chaque matin à 8h
cron.schedule('0 8 * * *', async () => {
  console.log('📊 Envoi des rapports quotidiens...');
  // TODO: envoyer résumé des ventes aux commerçants
});

// Annulation automatique des commandes non confirmées après 30 min
cron.schedule('*/10 * * * *', async () => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: staleOrders } = await supabaseAdmin
    .from('orders').select('id, order_number, client_id')
    .eq('status', 'pending').lt('created_at', thirtyMinAgo);

  for (const order of (staleOrders || [])) {
    await supabaseAdmin.from('orders').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: 'Annulée automatiquement (aucune confirmation du commerçant)',
    }).eq('id', order.id);

    await supabaseAdmin.from('notifications').insert({
      user_id: order.client_id, type: 'order_auto_cancelled',
      title: '❌ Commande annulée',
      body: `Commande ${order.order_number} annulée car non confirmée dans les délais.`,
    });
  }
});

// ================================================================
// DÉMARRAGE
// ================================================================
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log('\n  🛵 ─────────────────────────────────────────────');
  console.log('  🇧🇫  KibaAlo API v2.0 — Afrique de l\'Ouest     ');
  console.log('  ─────────────────────────────────────────────────');
  console.log(`  🚀  Serveur  : http://localhost:${PORT}`);
  console.log(`  📖  API Docs : http://localhost:${PORT}/api`);
  console.log(`  💚  Santé   : http://localhost:${PORT}/health`);
  console.log(`  ⚡  Socket  : ws://localhost:${PORT}`);
  console.log(`  🌍  Env     : ${process.env.NODE_ENV || 'development'}`);
  console.log('  ─────────────────────────────────────────────────\n');

  // Vérifier le service email
  await EmailService.verify();
});

// Gestion gracieuse des erreurs non capturées
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err.message);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  process.exit(1);
});

module.exports = { app, server, io };
