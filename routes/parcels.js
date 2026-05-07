// routes/parcels.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

// Compagnies de transport par ville
const TRANSPORT_COMPANIES = {
  BF: {
    'Ouagadougou': ['STMB', 'SOTRACO', 'TCV', 'Air Burkina Fret'],
    'Bobo-Dioulasso': ['STMB', 'TRANS VOYAGEURS', 'Air Burkina Fret'],
    'Koudougou': ['STMB', 'TCV'],
    'Ouahigouya': ['STMB', 'RAKIETA Transport'],
    'Banfora': ['STMB', 'TRANS VOYAGEURS'],
    'Dori': ['STMB', 'SAHEL Transport'],
    'Fada N\'Gourma': ['STMB', 'EST Transport'],
    'default': ['STMB', 'Transport Local']
  },
  NE: {
    'Niamey': ['RIMBO Transport', 'SNTV Niger', 'Air Niger Fret'],
    'Zinder': ['RIMBO Transport', 'EHGM Transport'],
    'Maradi': ['RIMBO Transport', 'SNTV Niger'],
    'Agadez': ['RIMBO Transport', 'Azalay Transport'],
    'Tahoua': ['RIMBO Transport', 'SNTV Niger'],
    'default': ['RIMBO Transport', 'Transport Local']
  }
};

// Calcul tarif expédition
const calcShippingPrice = (originCountry, destCountry, weightKg) => {
  const w = parseFloat(weightKg) || 1;
  if (originCountry === destCountry) {
    return Math.max(2000, Math.round(w * 1500)); // national: 1500 F/kg min 2000
  }
  return Math.max(8000, Math.round(w * 5000)); // international: 5000 F/kg min 8000
};

// ─── GET /api/parcels/cities ─────────────────────────────────
// Liste des villes avec compagnies de transport
router.get('/cities', (req, res) => {
  res.json({
    success: true,
    data: {
      BF: {
        name: '🇧🇫 Burkina Faso',
        cities: Object.keys(TRANSPORT_COMPANIES.BF).filter(k => k !== 'default').map(city => ({
          city,
          companies: TRANSPORT_COMPANIES.BF[city] || TRANSPORT_COMPANIES.BF.default
        }))
      },
      NE: {
        name: '🇳🇪 Niger',
        cities: Object.keys(TRANSPORT_COMPANIES.NE).filter(k => k !== 'default').map(city => ({
          city,
          companies: TRANSPORT_COMPANIES.NE[city] || TRANSPORT_COMPANIES.NE.default
        }))
      }
    }
  });
});

// ─── POST /api/parcels/estimate ──────────────────────────────
// Estimer le prix d'un envoi sans créer de colis
router.post('/estimate', async (req, res) => {
  try {
    const { originCountry, destCountry, weightKg } = req.body;
    if (!originCountry || !destCountry) {
      return res.status(400).json({ success: false, message: 'originCountry et destCountry requis' });
    }

    const price = calcShippingPrice(originCountry, destCountry, weightKg || 1);
    const isInternational = originCountry !== destCountry;

    res.json({
      success: true,
      data: {
        estimatedPrice: price,
        estimatedDays: isInternational ? '5-10 jours' : '2-4 jours',
        isInternational,
        currency: 'XOF'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur estimation' });
  }
});

// ─── POST /api/parcels ───────────────────────────────────────
// Enregistrer un colis
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      senderName, senderPhone,
      receiverName, receiverPhone,
      originCity, originCountry,
      destCity, destCountry,
      weightKg, transportCompany, notes
    } = req.body;

    const required = { senderName, senderPhone, receiverName, receiverPhone, originCity, originCountry, destCity, destCountry };
    for (const [k, v] of Object.entries(required)) {
      if (!v) return res.status(400).json({ success: false, message: `Champ requis: ${k}` });
    }

    const price = calcShippingPrice(originCountry, destCountry, weightKg || 1);
    const isInt = originCountry !== destCountry;
    const tracking_code = `KBA-${Date.now().toString().slice(-8).toUpperCase()}`;

    const { data: parcel, error } = await supabaseAdmin
      .from('parcels')
      .insert({
        tracking_code,
        sender_id: req.user.id,
        sender_name: senderName,
        sender_phone: senderPhone,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        origin_city: originCity,
        origin_country: originCountry,
        dest_city: destCity,
        dest_country: destCountry,
        weight_kg: weightKg || 1,
        transport_company: transportCompany ||
          (TRANSPORT_COMPANIES[originCountry]?.[originCity] || TRANSPORT_COMPANIES[originCountry]?.default || ['Transport Local'])[0],
        price,
        estimated_days: isInt ? 7 : 3,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;

    // Déduire du portefeuille si assez de solde
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id,balance').eq('user_id', req.user.id).single();

    if (wallet && wallet.balance >= price) {
      await supabaseAdmin.from('wallets')
        .update({ balance: wallet.balance - price }).eq('id', wallet.id);

      await supabaseAdmin.from('transactions').insert({
        wallet_id: wallet.id,
        user_id: req.user.id,
        type: 'debit', amount: price,
        balance_before: wallet.balance,
        balance_after: wallet.balance - price,
        description: `Expédition colis ${tracking_code}`
      });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: req.user.id,
      type: 'parcel_registered',
      title: '📦 Colis enregistré !',
      body: `Code de suivi: ${tracking_code}. Délai estimé: ${isInt ? '5-10' : '2-4'} jours.`,
      data: { parcelId: parcel.id, trackingCode: tracking_code }
    });

    res.status(201).json({
      success: true,
      data: parcel,
      message: `Colis enregistré. Code de suivi: ${tracking_code}`
    });
  } catch (err) {
    console.error('[parcels create]', err);
    res.status(500).json({ success: false, message: 'Erreur enregistrement colis' });
  }
});

// ─── GET /api/parcels/track/:code ───────────────────────────
// Suivi public d'un colis
router.get('/track/:code', async (req, res) => {
  try {
    const { data: parcel, error } = await supabaseAdmin
      .from('parcels')
      .select('tracking_code, status, origin_city, origin_country, dest_city, dest_country, receiver_name, transport_company, estimated_days, created_at, updated_at')
      .eq('tracking_code', req.params.code)
      .single();

    if (error || !parcel) {
      return res.status(404).json({ success: false, message: 'Code de suivi introuvable' });
    }

    const statusLabels = {
      registered: 'Enregistré en agence',
      collected: 'Collecté par le transporteur',
      in_transit: 'En transit',
      at_station: 'Arrivé en gare de destination',
      delivered: 'Livré au destinataire',
      returned: 'Retourné à l\'expéditeur'
    };

    res.json({
      success: true,
      data: { ...parcel, statusLabel: statusLabels[parcel.status] || parcel.status }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suivi colis' });
  }
});

// ─── GET /api/parcels ────────────────────────────────────────
// Mes colis
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('parcels').select('*')
      .eq('sender_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement colis' });
  }
});

module.exports = router;
