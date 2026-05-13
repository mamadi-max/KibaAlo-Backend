# 🛵 KibaAlo v2.0 — Livraison & Services Afrique de l'Ouest

> **16 pays · Produits digitaux · Factures PDF · Paiements Mobile Money · Offline 1h · KYC · PWA 35+/45**

---

## 📦 Contenu du projet (33 fichiers)

### Backend (21 fichiers)
| Fichier | Rôle |
|---|---|
| `server.js` | Express + Socket.IO + Cron jobs + Rate limiting |
| `config/schema.sql` | 21 tables SQL + index FTS + RLS Supabase |
| `config/supabase.js` | Client Supabase admin + public |
| `config/setup-database.js` | Vérification des 21 tables |
| `middleware/auth.js` | JWT authenticate + requireRole |
| `middleware/upload.js` | Upload Cloudinary (images, PDFs, vidéos) |
| `routes/auth.js` | Inscription email + Vérification + Reset pwd + KYC + Avatar |
| `routes/shops.js` | Boutiques + Filtres GPS + Produits + Dashboard commerçant |
| `routes/orders.js` | Commandes + Factures PDF + Produits digitaux + Webhooks |
| `routes/wallet.js` | Portefeuille + Recharge + Retrait |
| `routes/payments.js` | Orange Money, Moov, Wave, MTN, Airtel, Simulation |
| `routes/parcels.js` | 16 pays × 200+ villes + Compagnies agréées |
| `routes/livreurs.js` | GPS + Gains + Disponibilité + Notifications + Premium |
| `routes/search.js` | Recherche temps réel + Suggestions + Populaires |
| `routes/admin.js` | Dashboard admin + KYC + Suspension + Stats |
| `services/email.js` | Templates HTML + Vérification + Reset + Facture + Digital |
| `services/invoice.js` | Génération PDF avec PDFKit (logo, tableau, totaux) |
| `services/payment.js` | 5 providers + Simulation + Webhooks + Remboursement |
| `.env.example` | 35+ variables d'environnement documentées |
| `render.yaml` | Config déploiement Render.com |

### Frontend (11 fichiers)
| Fichier | Rôle |
|---|---|
| `index.html` | HTML + 20+ meta PWA + Boot |
| `css/style.css` | Design system 800 lignes — dark theme |
| `js/api.js` | Client API + Auth + Fmt + 16 pays + Offline cache |
| `js/app.js` | Store + Router + DataLoader + Actions |
| `js/views.js` | Toutes vues + 20+ modales connectées |
| `manifest.json` | PWA score 35+/45 — 9 tailles d'icônes |
| `sw.js` | Service Worker offline 1h + Push + Background sync |
| `offline.html` | Page hors ligne avec auto-reconnexion |
| `vercel.json` | Headers sécurité + rewrites |
| `netlify.toml` | Alternative Netlify |

---

## 🚀 Déploiement en 5 étapes (0€/mois)

### Étape 1 — Supabase (base de données)
```
1. supabase.com → New Project → Region: EU West (Ireland)
2. SQL Editor → coller config/schema.sql → Run
3. Settings → API → copier:
   SUPABASE_URL = https://xxx.supabase.co
   SUPABASE_ANON_KEY = eyJ...
   SUPABASE_SERVICE_KEY = eyJ... (service_role)
```

### Étape 2 — Cloudinary (images & fichiers, gratuit 25GB)
```
1. cloudinary.com → Sign up gratuit
2. Dashboard → copier:
   CLOUDINARY_CLOUD_NAME = votre_nom
   CLOUDINARY_API_KEY = 123456789
   CLOUDINARY_API_SECRET = abc123...
```

### Étape 3 — Email SMTP (Gmail gratuit)
```
1. Gmail → Paramètres compte → Sécurité → Validation en 2 étapes
2. Mots de passe d'application → Créer → Copier le mot de passe 16 chars
   SMTP_HOST = smtp.gmail.com
   SMTP_USER = votre@gmail.com
   SMTP_PASS = xxxx xxxx xxxx xxxx
```

### Étape 4 — Backend Render.com
```
1. render.com → New Web Service → Connecter KibaAlo-Backend
2. Build: npm install | Start: node server.js | Plan: Free
3. Environment → Ajouter toutes les variables du .env.example
4. URL obtenue: https://kibaalo-backend.onrender.com
```

### Étape 5 — Frontend Vercel
```
1. Modifier js/api.js ligne 4:
   const API_URL = 'https://kibaalo-backend.onrender.com/api';
2. vercel.com → New Project → KibaAlo-Frontend → Deploy
3. URL: https://kibaalo-frontend.vercel.app
```

---

## ✅ Checklist finale

- [ ] Supabase créé + schema.sql exécuté
- [ ] Cloudinary configuré
- [ ] Gmail SMTP configuré  
- [ ] Backend déployé sur Render
- [ ] `js/api.js` ligne 4 mise à jour avec URL Render
- [ ] Frontend déployé sur Vercel
- [ ] Test santé: `https://votre-backend.onrender.com/health`
- [ ] Icônes créées dans `assets/` (icon-192.png, icon-512.png, etc.)
- [ ] Tester inscription → email reçu
- [ ] Tester commande → facture PDF reçue

---

## 🌍 16 pays Afrique de l'Ouest
🇧🇫 🇳🇪 🇲🇱 🇸🇳 🇨🇮 🇬🇭 🇳🇬 🇬🇳 🇨🇲 🇹🇬 🇧🇯 🇲🇷 🇬🇲 🇸🇱 🇱🇷 🇬🇼

**KibaAlo v2.0 — Conçu pour l'Afrique de l'Ouest** 🌍
