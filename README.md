# 🛵 KibaAlo — Backend API

> Plateforme de livraison et services pour le **Burkina Faso** 🇧🇫 et le **Niger** 🇳🇪

---

## 🏗️ Architecture

```
kibaalo-backend/
├── server.js              ← Point d'entrée, Express + Socket.IO
├── render.yaml            ← Config déploiement Render.com
├── .env.example           ← Variables d'environnement (template)
├── config/
│   ├── supabase.js        ← Client Supabase (admin + public)
│   └── schema.sql         ← Schéma complet de la base de données
├── middleware/
│   └── auth.js            ← JWT authenticate + requireRole
└── routes/
    ├── auth.js            ← Inscription, connexion, profil
    ├── shops.js           ← Boutiques, produits, dashboard commerçant
    ├── orders.js          ← Commandes, statuts, tracking GPS, avis
    ├── wallet.js          ← Portefeuille, recharge, retrait
    ├── parcels.js         ← Expédition colis (BF + NE)
    └── livreurs.js        ← Disponibilité, GPS, gains, notifications, premium
```

---

## 🚀 Déploiement en 15 minutes (100% gratuit)

### Étape 1 — Supabase (Base de données)

1. Créez un compte sur [supabase.com](https://supabase.com)
2. Cliquez **New Project** → Choisissez un nom (ex: `kibaalo`)
3. Notez votre **mot de passe de base de données**
4. Allez dans **SQL Editor** → collez le contenu de `config/schema.sql` → **Run**
5. Allez dans **Project Settings → API** et copiez :
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_KEY`

### Étape 2 — Backend sur Render.com

1. Créez un compte sur [render.com](https://render.com)
2. **New → Web Service**
3. Connectez votre repo GitHub (poussez ce dossier d'abord)
   ```bash
   git init
   git add .
   git commit -m "KibaAlo backend initial"
   git remote add origin https://github.com/VOTRE_USERNAME/kibaalo-backend.git
   git push -u origin main
   ```
4. Dans Render : sélectionnez votre repo
5. Configurez :
   - **Name**: `kibaalo-backend`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
6. Ajoutez les variables d'environnement (onglet **Environment**) :
   - `SUPABASE_URL` ← votre URL Supabase
   - `SUPABASE_ANON_KEY` ← votre clé anon
   - `SUPABASE_SERVICE_KEY` ← votre service key
   - `JWT_SECRET` ← cliquez "Generate" dans Render
   - `NODE_ENV` ← `production`
   - `FRONTEND_URL` ← votre URL Vercel (après étape 3)
7. Cliquez **Create Web Service** → attendez ~3 minutes
8. Votre API est disponible sur `https://kibaalo-backend.onrender.com`

### Étape 3 — Frontend sur Vercel

1. Créez un compte sur [vercel.com](https://vercel.com)
2. Dans le fichier `index.html` du frontend, modifiez :
   ```javascript
   const API_URL = 'https://kibaalo-backend.onrender.com/api';
   const SOCKET_URL = 'https://kibaalo-backend.onrender.com';
   ```
3. Créez un repo GitHub pour le frontend et poussez-le
4. Sur Vercel : **New Project** → importez votre repo → **Deploy**
5. Votre app est disponible sur `https://kibaalo.vercel.app`

---

## 💻 Développement local

```bash
# 1. Cloner et installer
git clone https://github.com/VOTRE_USERNAME/kibaalo-backend.git
cd kibaalo-backend
npm install

# 2. Configurer les variables d'environnement
cp .env.example .env
# Éditez .env avec vos vraies valeurs Supabase

# 3. Démarrer le serveur (avec rechargement automatique)
npm run dev

# Le serveur démarre sur http://localhost:5000
# Documentation API: http://localhost:5000/api
# Santé: http://localhost:5000/health
```

---

## 📡 API — Exemples d'utilisation

### S'inscrire comme client
```bash
curl -X POST https://kibaalo-backend.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+22670123456",
    "firstName": "Aminata",
    "lastName": "Sawadogo",
    "password": "monmotdepasse",
    "role": "client",
    "country": "BF",
    "city": "Ouagadougou"
  }'
```

### Se connecter
```bash
curl -X POST https://kibaalo-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone": "+22670123456", "password": "monmotdepasse"}'
# Réponse: {"success":true,"token":"eyJ...","user":{...}}
```

### Lister les boutiques
```bash
curl "https://kibaalo-backend.onrender.com/api/shops?city=Ouagadougou&category=food"
```

### Passer une commande
```bash
curl -X POST https://kibaalo-backend.onrender.com/api/orders \
  -H "Authorization: Bearer VOTRE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "shopId": "UUID_DE_LA_BOUTIQUE",
    "items": [{"productId": "UUID_PRODUIT", "qty": 2}],
    "deliveryAddress": "Secteur 15, Ouagadougou",
    "deliveryLat": 12.3648,
    "deliveryLng": -1.5336,
    "paymentMethod": "wallet"
  }'
```

### Estimer un envoi de colis
```bash
curl -X POST https://kibaalo-backend.onrender.com/api/parcels/estimate \
  -H "Content-Type: application/json" \
  -d '{"originCountry": "BF", "destCountry": "NE", "weightKg": 3}'
# Réponse: {"estimatedPrice": 15000, "estimatedDays": "5-10 jours"}
```

### Tracking Socket.IO (JavaScript)
```javascript
import { io } from 'socket.io-client';
const socket = io('https://kibaalo-backend.onrender.com');

// Client — rejoindre la room de sa commande
socket.emit('join_order', orderId);
socket.on('location_update', ({ lat, lng }) => {
  // Mettre à jour la carte avec la position du livreur
  map.setCenter({ lat, lng });
});

// Livreur — envoyer sa position GPS toutes les 10 secondes
setInterval(() => {
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    socket.emit('livreur_location', {
      orderId,
      lat: coords.latitude,
      lng: coords.longitude
    });
  });
}, 10000);
```

---

## 💰 Coûts (tout gratuit !)

| Service | Plan | Limites gratuites |
|---------|------|-------------------|
| **Supabase** | Free | 500MB DB, 2GB storage, 50K MAU |
| **Render.com** | Free | 512MB RAM, dort après 15min |
| **Vercel** | Hobby | 100GB bande passante |
| **Cloudinary** | Free | 25GB storage, 25GB bande passante |
| **Africa's Talking** | Sandbox | SMS gratuits en sandbox |
| **Total** | | **0 F CFA / mois** |

> ⚠️ **Note**: En production avec trafic réel, upgradez Render à 7$/mois (Starter) pour éviter les endormissements.

---

## 🔐 Sécurité en production

- [x] JWT avec expiration 7 jours
- [x] Hachage des mots de passe (bcrypt, salt 10)
- [x] Rate limiting (200 req/15min, 10 login/15min)
- [x] Helmet.js (headers sécurité)
- [x] CORS configuré
- [x] Row Level Security Supabase activé
- [x] Validation des entrées (express-validator)
- [ ] À ajouter: 2FA par SMS (Africa's Talking)
- [ ] À ajouter: Chiffrement HTTPS (automatique sur Render/Vercel)

---

## 📱 Intégration Frontend

Dans votre `index.html`, ajoutez en haut du script :

```javascript
const API_URL    = 'https://kibaalo-backend.onrender.com/api';
const SOCKET_URL = 'https://kibaalo-backend.onrender.com';
let authToken    = localStorage.getItem('kibaalo_token');

async function apiCall(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message);
  return data;
}

// Exemples :
// await apiCall('POST', '/auth/login', {phone, password})
// await apiCall('GET', '/shops?city=Ouagadougou')
// await apiCall('POST', '/orders', orderPayload)
```

---

## 🌍 Villes couvertes

**Burkina Faso (30 villes)**: Ouagadougou, Bobo-Dioulasso, Koudougou, Ouahigouya, Banfora, Dédougou, Kaya, Tenkodogo, Fada N'Gourma, Ziniaré, Manga, Réo, Kongoussi, Dori, Nouna, Tougan, Gaoua, Diébougou, Pô, Léo, Boulsa, Zorgho, Yako, Titao, Bogandé, Djibo, Gorom-Gorom, Kombissiri, Sapouy, Houndé

**Niger (30 villes)**: Niamey, Zinder, Maradi, Agadez, Tahoua, Dosso, Diffa, Arlit, Birni-N'Konni, Madaoua, Tessaoua, Mirriah, Matamey, Maine-Soroa, Gouré, N'Guigmi, Dakoro, Filingué, Illéla, Bouza, Keïta, Loga, Gaya, Dogondoutchi, Téra, Tillabéri, Say, Ouallam, Tera, Tillabéry

---

*KibaAlo v1.0.0 — Conçu pour le Sahel 🌍*
