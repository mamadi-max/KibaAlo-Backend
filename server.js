// server.js — KibaAlo Backend CORRIGÉ
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const authRoutes     = require('./routes/auth');
const shopsRoutes    = require('./routes/shops');
const ordersRoutes   = require('./routes/orders');
const walletRoutes   = require('./routes/wallet');
const parcelsRoutes  = require('./routes/parcels');
const livreursRoutes = require('./routes/livreurs');

const app    = express();
const server = http.createServer(app);

// ── Socket.IO ─────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling'],
});

const connectedUsers = new Map();

io.on('connection', (socket) => {
  socket.on('auth', ({ userId, role }) => {
    connectedUsers.set(userId, socket.id);
    socket.userId = userId;
    socket.join('user:' + userId);
  });
  socket.on('join_order', (orderId) => socket.join('order:' + orderId));
  socket.on('livreur_location', ({ orderId, lat, lng }) => {
    io.to('order:' + orderId).emit('location_update', { lat, lng, timestamp: Date.now() });
  });
  socket.on('disconnect', () => {
    if (socket.userId) connectedUsers.delete(socket.userId);
  });
});

app.set('io', io);

// ── CORS — Accepter TOUTES les origines ───────────
// (nécessaire car Render bloque sinon)
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
  credentials: false,
}));

// Répondre aux preflight OPTIONS
app.options('*', cors());

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate Limiting ─────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  message: { success: false, message: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  skip: (req) => req.path === '/health',
});
app.use('/api', limiter);

// ── Routes ────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/shops',    shopsRoutes);
app.use('/api/orders',   ordersRoutes);
app.use('/api/wallet',   walletRoutes);
app.use('/api/parcels',  parcelsRoutes);
app.use('/api/livreurs', livreursRoutes);

// Notifications & Premium (depuis livreurs.js)
if (livreursRoutes.notifRouter)   app.use('/api/notifications', livreursRoutes.notifRouter);
if (livreursRoutes.premiumRouter) app.use('/api/premium',       livreursRoutes.premiumRouter);

// ── Health ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'KibaAlo API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()) + 's',
  });
});

app.get('/api', (req, res) => {
  res.json({ name: 'KibaAlo API', version: '2.0.0', status: 'running' });
});

// ── 404 ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route introuvable: ' + req.method + ' ' + req.path });
});

// ── Erreurs ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erreur:', err.message);
  res.status(500).json({ success: false, message: err.message || 'Erreur interne' });
});

// ── Démarrage ─────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('\n🛵 KibaAlo API v2.0');
  console.log('🚀 Port:', PORT);
  console.log('🌍 CORS: * (toutes origines)');
  console.log('💚 Health: /health\n');
});

process.on('unhandledRejection', (err) => console.error('Unhandled:', err.message));
process.on('uncaughtException',  (err) => { console.error('Uncaught:', err.message); process.exit(1); });

module.exports = { app, server, io };
