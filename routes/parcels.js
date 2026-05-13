// routes/parcels.js — KibaAlo v2 — Expédition 16 pays Afrique de l'Ouest
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, optionalAuth } = require('../middleware/auth');

// ================================================================
// DONNÉES — 16 pays Afrique de l'Ouest + villes et transporteurs
// ================================================================
const WEST_AFRICA = {
  BF: {
    name: 'Burkina Faso', flag: '🇧🇫', currency: 'XOF', phone_code: '+226',
    cities: {
      'Ouagadougou':  ['STMB','SOTRACO','TCV','Rakieta Transport','Air Burkina Fret'],
      'Bobo-Dioulasso':['STMB','Trans Voyageurs','Burkina Faso Express'],
      'Koudougou':    ['STMB','TCV'],
      'Ouahigouya':   ['STMB','Rakieta Transport'],
      'Banfora':      ['STMB','Trans Voyageurs'],
      'Dédougou':     ['STMB'],
      'Kaya':         ['STMB','TCV'],
      'Tenkodogo':    ['STMB'],
      "Fada N'Gourma":['STMB'],
      'Ziniaré':      ['STMB','SOTRACO'],
      'Dori':         ['STMB','Sahel Transport'],
      'Nouna':        ['STMB'],
      'Tougan':       ['STMB'],
      'Gaoua':        ['STMB'],
      'Manga':        ['STMB'],
      'Djibo':        ['STMB'],
      'Houndé':       ['STMB'],
      'Kombissiri':   ['STMB','SOTRACO'],
      'Yako':         ['STMB'],
      'Kongoussi':    ['STMB'],
    }
  },
  NE: {
    name: 'Niger', flag: '🇳🇪', currency: 'XOF', phone_code: '+227',
    cities: {
      'Niamey':       ['RIMBO Transport','SNTV Niger','Air Niger Fret'],
      'Zinder':       ['RIMBO Transport','EHGM Transport'],
      'Maradi':       ['RIMBO Transport','SNTV Niger'],
      'Agadez':       ['RIMBO Transport','Azalay Transport'],
      'Tahoua':       ['RIMBO Transport','SNTV Niger'],
      'Dosso':        ['RIMBO Transport'],
      'Diffa':        ['RIMBO Transport'],
      'Arlit':        ['RIMBO Transport'],
      "Birni-N'Konni":['RIMBO Transport','SNTV Niger'],
      'Madaoua':      ['RIMBO Transport'],
      'Tessaoua':     ['SNTV Niger'],
      'Mirriah':      ['SNTV Niger'],
      "N'Guigmi":     ['RIMBO Transport'],
      'Dakoro':       ['SNTV Niger'],
      'Filingué':     ['SNTV Niger'],
      'Gaya':         ['RIMBO Transport'],
      'Dogondoutchi': ['SNTV Niger'],
      'Tillabéri':    ['SNTV Niger'],
      'Say':          ['SNTV Niger'],
    }
  },
  ML: {
    name: 'Mali', flag: '🇲🇱', currency: 'XOF', phone_code: '+223',
    cities: {
      'Bamako':       ['Bani Transport','Somatra','Air Mali Fret'],
      'Sikasso':      ['Bani Transport','Somatra'],
      'Ségou':        ['Bani Transport'],
      'Mopti':        ['Bani Transport'],
      'Kayes':        ['Somatra'],
      'Gao':          ['Bani Transport'],
      'Koutiala':     ['Bani Transport'],
      "Ségou":        ['Bani Transport'],
    }
  },
  SN: {
    name: 'Sénégal', flag: '🇸🇳', currency: 'XOF', phone_code: '+221',
    cities: {
      'Dakar':        ['DHL Sénégal','Chronopost','Gaye Transport','Air Sénégal Fret'],
      'Thiès':        ['Gaye Transport','Ndiambour Express'],
      'Kaolack':      ['Gaye Transport'],
      'Ziguinchor':   ['Casamance Voyages'],
      'Saint-Louis':  ['Ndiambour Express'],
      'Touba':        ['Gaye Transport','Mouride Express'],
      'Diourbel':     ['Gaye Transport'],
      'Tambacounda':  ['Gaye Transport'],
      'Kolda':        ['Casamance Voyages'],
    }
  },
  CI: {
    name: "Côte d'Ivoire", flag: '🇨🇮', currency: 'XOF', phone_code: '+225',
    cities: {
      'Abidjan':      ['UTB','STIF','DHL CI','Air CI Fret'],
      'Bouaké':       ['UTB','STIF'],
      'Korhogo':      ['UTB'],
      'Yamoussoukro': ['UTB'],
      'San-Pédro':    ['UTB','STIF'],
      'Man':          ['UTB'],
      'Daloa':        ['UTB'],
      'Gagnoa':       ['UTB'],
    }
  },
  GH: {
    name: 'Ghana', flag: '🇬🇭', currency: 'GHS', phone_code: '+233',
    cities: {
      'Accra':        ['DHL Ghana','Courier Plus','Ghana Post'],
      'Kumasi':       ['Courier Plus','VIP Bus'],
      'Tamale':       ['Ghana Post'],
      'Takoradi':     ['Courier Plus'],
      'Tema':         ['DHL Ghana'],
    }
  },
  NG: {
    name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', phone_code: '+234',
    cities: {
      'Lagos':        ['DHL Nigeria','GIG Logistics','Kwik Delivery'],
      'Abuja':        ['DHL Nigeria','GIG Logistics'],
      'Kano':         ['GIG Logistics'],
      'Ibadan':       ['GIG Logistics'],
      'Port Harcourt':['DHL Nigeria'],
    }
  },
  GN: {
    name: 'Guinée', flag: '🇬🇳', currency: 'GNF', phone_code: '+224',
    cities: {
      'Conakry':      ['Sahel Express','DHL Guinée'],
      'Kankan':       ['Sahel Express'],
      'Labé':         ['Sahel Express'],
      'Kindia':       ['Sahel Express'],
      'Nzérékoré':    ['Sahel Express'],
    }
  },
  CM: {
    name: 'Cameroun', flag: '🇨🇲', currency: 'XAF', phone_code: '+237',
    cities: {
      'Yaoundé':      ['Campost','DHL Cameroun','General Express'],
      'Douala':       ['DHL Cameroun','General Express'],
      'Bamenda':      ['General Express'],
      'Garoua':       ['General Express'],
      'Maroua':       ['Campost'],
    }
  },
  TG: {
    name: 'Togo', flag: '🇹🇬', currency: 'XOF', phone_code: '+228',
    cities: {
      'Lomé':         ['CTLE','DHL Togo','Atlantic Express'],
      'Sokodé':       ['CTLE'],
      'Kara':         ['CTLE'],
      'Atakpamé':     ['CTLE'],
    }
  },
  BJ: {
    name: 'Bénin', flag: '🇧🇯', currency: 'XOF', phone_code: '+229',
    cities: {
      'Cotonou':      ['DHL Bénin','SBEE Express','Inatrans'],
      'Porto-Novo':   ['Inatrans'],
      'Parakou':      ['SBEE Express'],
      'Abomey':       ['Inatrans'],
    }
  },
  MR: {
    name: 'Mauritanie', flag: '🇲🇷', currency: 'MRU', phone_code: '+222',
    cities: {
      'Nouakchott':   ['SONATAM','Air Mauritanie Fret'],
      'Nouadhibou':   ['SONATAM'],
      'Kiffa':        ['SONATAM'],
      'Rosso':        ['SONATAM'],
    }
  },
  GM: {
    name: 'Gambie', flag: '🇬🇲', currency: 'GMD', phone_code: '+220',
    cities: {
      'Banjul':       ['Gampost','GPTC'],
      'Serekunda':    ['Gampost'],
      'Brikama':      ['GPTC'],
    }
  },
  SL: {
    name: 'Sierra Leone', flag: '🇸🇱', currency: 'SLL', phone_code: '+232',
    cities: {
      'Freetown':     ['SL Post','DHL Sierra Leone'],
      'Bo':           ['SL Post'],
      'Kenema':       ['SL Post'],
    }
  },
  LR: {
    name: 'Libéria', flag: '🇱🇷', currency: 'LRD', phone_code: '+231',
    cities: {
      'Monrovia':     ['LiberPost','DHL Libéria'],
      'Gbarnga':      ['LiberPost'],
      'Buchanan':     ['LiberPost'],
    }
  },
  GW: {
    name: 'Guinée-Bissau', flag: '🇬🇼', currency: 'XOF', phone_code: '+245',
    cities: {
      'Bissau':       ['Correios Guinée-Bissau'],
      'Bafatá':       ['Correios Guinée-Bissau'],
      'Gabú':         ['Correios Guinée-Bissau'],
    }
  },
};

// Calcul du tarif
const calcPrice = (fromCountry, toCountry, weightKg) => {
  const w = parseFloat(weightKg) || 1;
  if (fromCountry === toCountry)   return { price: Math.max(2000,  Math.round(w * 1500)), days: '2-4 jours' };
  // Pays voisins (zone CEDEAO)
  const ecowas = ['BF','NE','ML','SN','CI','GN','GH','NG','TG','BJ','MR','GM','SL','LR','GW','CM'];
  if (ecowas.includes(fromCountry) && ecowas.includes(toCountry)) {
    return { price: Math.max(5000,  Math.round(w * 3500)), days: '3-7 jours' };
  }
  return { price: Math.max(15000, Math.round(w * 8000)), days: '7-14 jours' };
};

// ── GET /api/parcels/countries ────────────────────────────
router.get('/countries', (req, res) => {
  const data = Object.entries(WEST_AFRICA).map(([code, info]) => ({
    code,
    name: info.name,
    flag: info.flag,
    currency: info.currency,
    phone_code: info.phone_code,
    cities: Object.keys(info.cities),
    cityCount: Object.keys(info.cities).length,
  }));
  res.json({ success: true, data, total: data.length });
});

// ── GET /api/parcels/countries/:code/cities ───────────────
router.get('/countries/:code/cities', (req, res) => {
  const country = WEST_AFRICA[req.params.code.toUpperCase()];
  if (!country) return res.status(404).json({ success: false, message: 'Pays introuvable' });

  const cities = Object.entries(country.cities).map(([city, companies]) => ({
    city, companies, hasStation: companies.length > 0,
  }));
  res.json({ success: true, data: cities, country: { code: req.params.code, ...country } });
});

// ── POST /api/parcels/estimate ────────────────────────────
router.post('/estimate', (req, res) => {
  try {
    const { originCountry, destCountry, weightKg } = req.body;
    if (!originCountry || !destCountry) {
      return res.status(400).json({ success: false, message: 'originCountry et destCountry requis' });
    }

    const { price, days } = calcPrice(originCountry, destCountry, weightKg || 1);
    const insurance = Math.floor(price * 0.05);

    const fromInfo = WEST_AFRICA[originCountry.toUpperCase()];
    const toInfo   = WEST_AFRICA[destCountry.toUpperCase()];

    res.json({
      success: true,
      data: {
        estimatedPrice: price,
        insuranceAmount: insurance,
        totalWithInsurance: price + insurance,
        estimatedDays: days,
        currency: 'XOF',
        isInternational: originCountry !== destCountry,
        fromCountry: fromInfo ? { name: fromInfo.name, flag: fromInfo.flag } : null,
        toCountry:   toInfo   ? { name: toInfo.name,   flag: toInfo.flag   } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur estimation' });
  }
});

// ── POST /api/parcels ─────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      senderName, senderPhone, senderEmail,
      receiverName, receiverPhone, receiverEmail,
      originCity, originCountry, destCity, destCountry,
      weightKg, dimensions, contentDesc, isFragile, isDeclared, declaredValue,
      transportCompany, withInsurance, notes,
    } = req.body;

    const required = { senderName, senderPhone, receiverName, receiverPhone, originCity, originCountry, destCity, destCountry };
    for (const [k, v] of Object.entries(required)) {
      if (!v) return res.status(400).json({ success: false, message: `${k} requis` });
    }

    const { price, days } = calcPrice(originCountry, destCountry, weightKg || 1);
    const insuranceAmount = withInsurance ? Math.floor(price * 0.05) : 0;
    const totalPrice = price + insuranceAmount;

    const trackingCode = `KBA-${originCountry}${destCountry}-${Date.now().toString().slice(-8).toUpperCase()}`;

    // Sélectionner la compagnie de transport
    const countryData  = WEST_AFRICA[originCountry.toUpperCase()];
    const cityCompanies = countryData?.cities[originCity] || ['Transport Local'];
    const company = transportCompany || cityCompanies[0];

    const { data: parcel, error } = await supabaseAdmin.from('parcels').insert({
      tracking_code: trackingCode,
      sender_id:      req.user.id,
      sender_name:    senderName,
      sender_phone:   senderPhone,
      sender_email:   senderEmail || req.user.email,
      receiver_name:  receiverName,
      receiver_phone: receiverPhone,
      receiver_email: receiverEmail || null,
      origin_city:    originCity,
      origin_country: originCountry.toUpperCase(),
      dest_city:      destCity,
      dest_country:   destCountry.toUpperCase(),
      weight_kg:      parseFloat(weightKg) || 1,
      dimensions:     dimensions || null,
      content_desc:   contentDesc || null,
      is_fragile:     !!isFragile,
      is_declared:    !!isDeclared,
      declared_value: declaredValue || null,
      transport_company: company,
      price,
      insurance_amount: insuranceAmount,
      estimated_days: parseInt(days.split('-')[0]),
      notes: notes || null,
      tracking_history: JSON.stringify([{
        status: 'registered',
        location: originCity,
        timestamp: new Date().toISOString(),
        note: 'Colis enregistré',
      }]),
    }).select().single();

    if (error) throw error;

    // Déduire du portefeuille
    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id, balance').eq('user_id', req.user.id).single();
    if (wallet && wallet.balance >= totalPrice) {
      await supabaseAdmin.from('wallets').update({ balance: wallet.balance - totalPrice }).eq('id', wallet.id);
      await supabaseAdmin.from('transactions').insert({
        wallet_id: wallet.id, user_id: req.user.id,
        type: 'debit', amount: totalPrice,
        balance_before: wallet.balance, balance_after: wallet.balance - totalPrice,
        description: `Expédition colis ${trackingCode}`,
      });
    }

    await supabaseAdmin.from('notifications').insert({
      user_id: req.user.id, type: 'parcel_registered',
      title: '📦 Colis enregistré !',
      body: `Code: ${trackingCode}. Délai estimé: ${days}.`,
      data: { parcelId: parcel.id, trackingCode },
    });

    res.status(201).json({
      success: true, data: parcel,
      message: `📦 Colis enregistré ! Code: ${trackingCode}`,
    });
  } catch (err) {
    console.error('[parcels]', err);
    res.status(500).json({ success: false, message: 'Erreur enregistrement colis' });
  }
});

// ── GET /api/parcels/track/:code ──────────────────────────
router.get('/track/:code', async (req, res) => {
  try {
    const { data: parcel, error } = await supabaseAdmin
      .from('parcels').select('tracking_code, status, origin_city, origin_country, dest_city, dest_country, receiver_name, transport_company, estimated_days, weight_kg, is_fragile, tracking_history, created_at, updated_at')
      .eq('tracking_code', req.params.code.toUpperCase()).single();

    if (error || !parcel) return res.status(404).json({ success: false, message: 'Code de suivi introuvable' });

    const statusLabels = {
      registered:       '📋 Enregistré en agence',
      collected:        '✅ Collecté par le transporteur',
      in_transit:       '🚌 En transit',
      at_station:       '🏢 Arrivé en gare de destination',
      out_for_delivery: '🛵 En cours de livraison',
      delivered:        '🎉 Livré au destinataire',
      returned:         '↩️ Retourné à l\'expéditeur',
      lost:             '❌ Colis déclaré perdu',
    };

    res.json({
      success: true,
      data: {
        ...parcel,
        statusLabel: statusLabels[parcel.status] || parcel.status,
        history: typeof parcel.tracking_history === 'string'
          ? JSON.parse(parcel.tracking_history)
          : parcel.tracking_history || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur suivi colis' });
  }
});

// ── GET /api/parcels ──────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('parcels').select('*').eq('sender_id', req.user.id)
      .order('created_at', { ascending: false });
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur chargement colis' });
  }
});

module.exports = router;
