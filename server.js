// server.js — KibaAlo Backend Principal
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');

// ─── Routes ────────────────────────────────────────────────
const authRoutes    = require('./routes/auth');
const shopsRoutes   = require('./routes/shops');
const ordersRoutes  = require('./routes/orders');
const walletRoutes  = require('./routes/wallet');
const parcelsRoutes = require('./routes/parcels');
const livreursRoutes = require('./routes/livreurs');

const app    = express();
const server = http.createServer(app);

// ─── Socket.IO (temps réel) ─────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// Rooms par commande pour le tracking GPS en temps réel
io.on('connection', (socket) => {
  console.log(`🔌 Socket connecté: ${socket.id}`);

  // Client rejoint la room de sa commande
  socket.on('join_order', (orderId) => {
    socket.join(`order:${orderId}`);
    console.log(`📦 Socket ${socket.id} rejoint order:${orderId}`);
  });

  // Livreur envoie sa position GPS
  socket.on('livreur_location', ({ orderId, lat, lng }) => {
    // Diffuser à tous les clients qui suivent cette commande
    io.to(`order:${orderId}`).emit('location_update', { lat, lng, timestamp: Date.now() });
  });

  // Mise à jour de statut en temps réel
  socket.on('order_status', ({ orderId, status, userId }) => {
    io.to(`order:${orderId}`).emit('status_update', { status, timestamp: Date.now() });
  });

  // Livreur en ligne
  socket.on('livreur_online', ({ livreurId }) => {
    socket.join(`livreur:${livreurId}`);
    io.emit('livreur_available', { livreurId });
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket déconnecté: ${socket.id}`);
  });
});

// Rendre io accessible dans les routes
app.set('io', io);

// ─── Middlewares globaux ────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate limiting ──────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Seulement 10 tentatives de login par 15min
  message: { success: false, message: 'Trop de tentatives de connexion. Attendez 15 minutes.' }
});

app.use('/api', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Routes API ─────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/shops',     shopsRoutes);
app.use('/api/orders',    ordersRoutes);
app.use('/api/wallet',    walletRoutes);
app.use('/api/parcels',   parcelsRoutes);
app.use('/api/livreurs',  livreursRoutes);

// Routes extraites du module livreurs
app.use('/api/notifications', livreursRoutes.notifRouter);
app.use('/api/premium',       livreursRoutes.premiumRouter);

// ─── Route de santé ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'KibaAlo API',
    version: '1.0.0',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    countries: ['🇧🇫 Burkina Faso', '🇳🇪 Niger']
  });
});

// ─── Documentation API ──────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'KibaAlo API',
    version: '1.0.0',
    description: 'API de livraison et services pour le Burkina Faso et le Niger',
    endpoints: {
      auth: {
        'POST /api/auth/register':  'Créer un compte (client, livreur, commerçant)',
        'POST /api/auth/login':     'Se connecter',
        'GET  /api/auth/me':        'Profil utilisateur connecté',
        'PUT  /api/auth/profile':   'Mettre à jour le profil',
        'PUT  /api/auth/password':  'Changer le mot de passe'
      },
      shops: {
        'GET  /api/shops':                      'Lister les boutiques',
        'GET  /api/shops/:id':                  'Détail boutique + produits',
        'POST /api/shops':                      'Créer une boutique (commerçant)',
        'PUT  /api/shops/:id':                  'Modifier une boutique',
        'GET  /api/shops/:id/products':         'Produits d\'une boutique',
        'POST /api/shops/:id/products':         'Ajouter un produit',
        'PUT  /api/shops/:id/products/:pid':    'Modifier un produit',
        'DELETE /api/shops/:id/products/:pid':  'Désactiver un produit',
        'GET  /api/shops/my/dashboard':         'Dashboard commerçant'
      },
      orders: {
        'POST  /api/orders':                  'Passer une commande',
        'GET   /api/orders':                  'Mes commandes',
        'GET   /api/orders/:id':              'Détail commande + tracking',
        'PATCH /api/orders/:id/status':       'Mettre à jour le statut',
        'POST  /api/orders/:id/tracking':     'Envoyer position GPS (livreur)',
        'POST  /api/orders/:id/review':       'Donner un avis'
      },
      wallet: {
        'GET  /api/wallet':           'Solde et transactions',
        'POST /api/wallet/recharge':  'Recharger le portefeuille',
        'POST /api/wallet/withdraw':  'Retirer des fonds'
      },
      parcels: {
        'GET  /api/parcels/cities':       'Villes et compagnies de transport',
        'POST /api/parcels/estimate':     'Estimer le tarif d\'expédition',
        'POST /api/parcels':              'Enregistrer un colis',
        'GET  /api/parcels/track/:code':  'Suivre un colis',
        'GET  /api/parcels':              'Mes colis'
      },
      livreurs: {
        'PUT /api/livreurs/availability': 'Basculer disponibilité',
        'PUT /api/livreurs/location':     'Envoyer position GPS',
        'GET /api/livreurs/earnings':     'Gains et statistiques'
      },
      notifications: {
        'GET   /api/notifications':         'Mes notifications',
        'PATCH /api/notifications/read-all':'Tout marquer comme lu',
        'PATCH /api/notifications/:id/read':'Marquer une notification'
      },
      premium: {
        'GET  /api/premium/plans':    'Plans disponibles',
        'POST /api/premium/subscribe':'S\'abonner à un plan'
      },
      realtime: {
        'socket join_order':       'Rejoindre la room d\'une commande',
        'socket livreur_location': 'Envoyer la position GPS',
        'socket order_status':     'Notifier un changement de statut',
        'event location_update':   'Recevoir la position du livreur',
        'event status_update':     'Recevoir le statut en temps réel'
      }
    }
  });
});

// ─── Gestion des erreurs 404 ────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route introuvable: ${req.method} ${req.path}`
  });
});

// ─── Gestion globale des erreurs ────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erreur non gérée:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Erreur interne du serveur'
      : err.message
  });
});

// ─── Démarrage du serveur ────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('');
  console.log('  🛵 ─────────────────────────────────────────');
  console.log('  🇧🇫  KibaAlo API — Livraison & Services     ');
  console.log('  🇳🇪  Burkina Faso & Niger                   ');
  console.log('  ─────────────────────────────────────────────');
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const wsUrl = process.env.RENDER_EXTERNAL_URL?.replace('https', 'wss') || `ws://localhost:${PORT}`;

console.log(`  🚀  Serveur: ${baseUrl}`);
console.log(`  📖  Docs:    ${baseUrl}/api`);
console.log(`  💚  Santé:   ${baseUrl}/health`);
console.log(`  ⚡  Socket:  ${wsUrl}`);
  console.log(`  🌍  Env:     ${process.env.NODE_ENV || 'development'}`);
  console.log('  ─────────────────────────────────────────────');
  console.log('');
});

module.exports = { app, server, io };
