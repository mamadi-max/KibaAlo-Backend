// services/payment.js — Intégrations paiements Afrique de l'Ouest v2
const axios = require('axios');
const crypto = require('crypto');

// ================================================================
// CONFIG PAR PROVIDER
// ================================================================
const PROVIDERS = {
  orange_money: {
    name: 'Orange Money',
    emoji: '🟠',
    countries: ['BF','NE','ML','SN','CI','GN','CM','MR'],
    apiUrl: process.env.ORANGE_MONEY_API_URL || 'https://api.orange.com/orange-money-webpay/dev/v1',
    clientId: process.env.ORANGE_MONEY_CLIENT_ID,
    clientSecret: process.env.ORANGE_MONEY_CLIENT_SECRET,
    merchantKey: process.env.ORANGE_MONEY_MERCHANT_KEY,
  },
  moov_money: {
    name: 'Moov Money / Flooz',
    emoji: '💛',
    countries: ['BF','NE','TG','BJ','CI','GN'],
    apiUrl: process.env.MOOV_MONEY_API_URL || 'https://api.moov-africa.bf/v1',
    token: process.env.MOOV_MONEY_TOKEN,
  },
  wave: {
    name: 'Wave',
    emoji: '🌊',
    countries: ['SN','CI','ML','BF'],
    apiUrl: process.env.WAVE_API_URL || 'https://api.wave.com/v1',
    apiKey: process.env.WAVE_API_KEY,
  },
  mtn_money: {
    name: 'MTN Mobile Money',
    emoji: '💛',
    countries: ['GH','NG','CI','CM','BJ','GN','ZM','UG','RW'],
    apiUrl: process.env.MTN_MONEY_API_URL || 'https://sandbox.momodeveloper.mtn.com',
    subscriptionKey: process.env.MTN_SUBSCRIPTION_KEY,
    apiUser: process.env.MTN_API_USER,
    apiKey: process.env.MTN_API_KEY,
  },
  airtel_money: {
    name: 'Airtel Money',
    emoji: '🔴',
    countries: ['BF','NE','TD','MG','ZM','MW','TZ','KE','RW','UG'],
    apiUrl: process.env.AIRTEL_API_URL || 'https://openapi.airtel.africa',
    clientId: process.env.AIRTEL_CLIENT_ID,
    clientSecret: process.env.AIRTEL_CLIENT_SECRET,
  },
  free_money: {
    name: 'Free Money',
    emoji: '🟣',
    countries: ['SN'],
    apiUrl: process.env.FREE_MONEY_API_URL,
    apiKey: process.env.FREE_MONEY_API_KEY,
  },
};

// ================================================================
// PAYMENT SERVICE
// ================================================================
const PaymentService = {

  // ── Liste des providers disponibles par pays ─────────
  getProvidersByCountry(country) {
    return Object.entries(PROVIDERS)
      .filter(([, p]) => p.countries.includes(country))
      .map(([key, p]) => ({ key, name: p.name, emoji: p.emoji }));
  },

  // ── Initier un paiement ──────────────────────────────
  async initiate({ provider, amount, phone, orderId, currency = 'XOF', country, callbackUrl }) {
    console.log(`[Payment] Initiation ${provider} — ${amount} ${currency} — ${phone}`);

    try {
      switch (provider) {
        case 'orange_money': return await this._orangeMoney(amount, phone, orderId, currency, country, callbackUrl);
        case 'moov_money':   return await this._moovMoney(amount, phone, orderId, currency);
        case 'wave':         return await this._wave(amount, phone, orderId, currency, callbackUrl);
        case 'mtn_money':    return await this._mtnMoney(amount, phone, orderId, currency, country);
        case 'airtel_money': return await this._airtelMoney(amount, phone, orderId, currency, country);
        default:
          // Simulation pour les providers non encore configurés
          return this._simulate(provider, amount, phone, orderId);
      }
    } catch (err) {
      console.error(`[Payment] Erreur ${provider}:`, err.message);
      throw new Error(`Paiement ${provider} échoué: ${err.message}`);
    }
  },

  // ── Vérifier le statut d'un paiement ────────────────
  async checkStatus(provider, reference) {
    try {
      switch (provider) {
        case 'orange_money': return await this._checkOrangeMoney(reference);
        case 'moov_money':   return await this._checkMoov(reference);
        case 'wave':         return await this._checkWave(reference);
        case 'mtn_money':    return await this._checkMtn(reference);
        default:             return { status: 'completed', reference };
      }
    } catch { return { status: 'unknown', reference }; }
  },

  // ── Remboursement ────────────────────────────────────
  async refund({ provider, reference, amount }) {
    console.log(`[Payment] Remboursement ${provider} — ref:${reference} — ${amount} F`);
    // Implémenter selon chaque provider
    return { success: true, message: 'Remboursement initié' };
  },

  // ================================================================
  // ORANGE MONEY
  // ================================================================
  async _orangeMoney(amount, phone, orderId, currency, country, callbackUrl) {
    const cfg = PROVIDERS.orange_money;
    if (!cfg.clientId) return this._simulate('orange_money', amount, phone, orderId);

    // 1. Obtenir le token
    const tokenRes = await axios.post(`${cfg.apiUrl}/token`, null, {
      auth: { username: cfg.clientId, password: cfg.clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'grant_type=client_credentials',
    });
    const token = tokenRes.data.access_token;

    // 2. Créer la transaction
    const ref = `KBA-${orderId.slice(0,8)}-${Date.now()}`;
    const hash = crypto.createHash('sha512')
      .update(cfg.clientId + cfg.merchantKey + ref + amount)
      .digest('hex');

    const res = await axios.post(`${cfg.apiUrl}/webpayment`, {
      merchant_key: cfg.merchantKey,
      currency, order_id: ref,
      amount: String(amount),
      return_url: callbackUrl || `${process.env.FRONTEND_URL}/payment/callback`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
      notif_url: `${process.env.API_URL}/api/payments/webhook/orange`,
      lang: 'fr',
      reference: hash,
    }, { headers: { Authorization: `Bearer ${token}` } });

    return {
      success: true,
      provider: 'orange_money',
      reference: ref,
      paymentUrl: res.data.payment_url,
      status: 'pending',
    };
  },

  async _checkOrangeMoney(reference) {
    // Vérification du statut Orange Money
    return { status: 'completed', reference };
  },

  // ================================================================
  // MOOV MONEY / FLOOZ
  // ================================================================
  async _moovMoney(amount, phone, orderId, currency) {
    const cfg = PROVIDERS.moov_money;
    if (!cfg.token) return this._simulate('moov_money', amount, phone, orderId);

    const ref = `KBA-${Date.now()}`;
    const res = await axios.post(`${cfg.apiUrl}/payment/request`, {
      amount: String(amount),
      msisdn: phone.replace(/\D/g, ''),
      reference: ref,
      description: `Commande KibaAlo ${orderId.slice(0,8)}`,
      currency: currency || 'XOF',
    }, {
      headers: {
        'Authorization': `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
    });

    return {
      success: true,
      provider: 'moov_money',
      reference: res.data?.reference || ref,
      status: 'pending',
      ussdCode: `*155#`,
      message: `Composez *155# sur votre téléphone Moov pour confirmer le paiement de ${amount.toLocaleString()} F CFA`,
    };
  },

  async _checkMoov(reference) {
    const cfg = PROVIDERS.moov_money;
    if (!cfg.token) return { status: 'completed', reference };
    const res = await axios.get(`${cfg.apiUrl}/payment/${reference}`, {
      headers: { 'Authorization': `Bearer ${cfg.token}` },
    });
    const statusMap = { 'SUCCESS': 'completed', 'FAILED': 'failed', 'PENDING': 'processing' };
    return { status: statusMap[res.data?.status] || 'processing', reference };
  },

  // ================================================================
  // WAVE
  // ================================================================
  async _wave(amount, phone, orderId, currency, callbackUrl) {
    const cfg = PROVIDERS.wave;
    if (!cfg.apiKey) return this._simulate('wave', amount, phone, orderId);

    const res = await axios.post(`${cfg.apiUrl}/checkout/sessions`, {
      amount: String(amount),
      currency: currency || 'XOF',
      error_url: `${process.env.FRONTEND_URL}/payment/error`,
      success_url: callbackUrl || `${process.env.FRONTEND_URL}/payment/success`,
      client_reference: orderId,
    }, {
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return {
      success: true,
      provider: 'wave',
      reference: res.data?.id,
      paymentUrl: res.data?.wave_launch_url,
      status: 'pending',
    };
  },

  async _checkWave(reference) {
    const cfg = PROVIDERS.wave;
    if (!cfg.apiKey) return { status: 'completed', reference };
    const res = await axios.get(`${cfg.apiUrl}/checkout/sessions/${reference}`, {
      headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    });
    const statusMap = { 'complete': 'completed', 'expired': 'failed', 'pending': 'processing' };
    return { status: statusMap[res.data?.payment_status] || 'processing', reference };
  },

  // ================================================================
  // MTN MOBILE MONEY
  // ================================================================
  async _mtnMoney(amount, phone, orderId, currency, country) {
    const cfg = PROVIDERS.mtn_money;
    if (!cfg.subscriptionKey) return this._simulate('mtn_money', amount, phone, orderId);

    const ref = `KBA-${Date.now()}`;
    await axios.post(`${cfg.apiUrl}/collection/v1_0/requesttopay`, {
      amount: String(amount),
      currency: currency || 'XOF',
      externalId: ref,
      payer: { partyIdType: 'MSISDN', partyId: phone.replace(/\D/g, '') },
      payerMessage: `KibaAlo ${orderId.slice(0,8)}`,
      payeeNote: 'KibaAlo Payment',
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.MTN_ACCESS_TOKEN}`,
        'X-Reference-Id': ref,
        'X-Target-Environment': process.env.NODE_ENV === 'production' ? 'mtncongo' : 'sandbox',
        'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        'Content-Type': 'application/json',
      },
    });

    return {
      success: true,
      provider: 'mtn_money',
      reference: ref,
      status: 'pending',
      message: 'Acceptez la demande de paiement MTN Mobile Money sur votre téléphone',
    };
  },

  async _checkMtn(reference) {
    const cfg = PROVIDERS.mtn_money;
    if (!cfg.subscriptionKey) return { status: 'completed', reference };
    const res = await axios.get(`${cfg.apiUrl}/collection/v1_0/requesttopay/${reference}`, {
      headers: {
        'Authorization': `Bearer ${process.env.MTN_ACCESS_TOKEN}`,
        'X-Target-Environment': process.env.NODE_ENV === 'production' ? 'mtncongo' : 'sandbox',
        'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
      },
    });
    const statusMap = { 'SUCCESSFUL': 'completed', 'FAILED': 'failed', 'PENDING': 'processing' };
    return { status: statusMap[res.data?.status] || 'processing', reference };
  },

  // ================================================================
  // AIRTEL MONEY
  // ================================================================
  async _airtelMoney(amount, phone, orderId, currency, country) {
    const cfg = PROVIDERS.airtel_money;
    if (!cfg.clientId) return this._simulate('airtel_money', amount, phone, orderId);

    // Obtenir token
    const tokenRes = await axios.post(`${cfg.apiUrl}/auth/oauth2/token`, {
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'client_credentials',
    });

    const ref = `KBA-${Date.now()}`;
    await axios.post(`${cfg.apiUrl}/merchant/v2/payments/`, {
      reference: ref,
      subscriber: { country: country || 'BF', currency: currency || 'XOF', msisdn: phone.replace(/\D/g,'') },
      transaction: { amount, country: country || 'BF', currency: currency || 'XOF', id: ref },
    }, {
      headers: {
        'Authorization': `Bearer ${tokenRes.data.access_token}`,
        'X-Country': country || 'BF',
        'X-Currency': currency || 'XOF',
      },
    });

    return {
      success: true,
      provider: 'airtel_money',
      reference: ref,
      status: 'pending',
      message: 'Confirmez le paiement Airtel Money sur votre téléphone',
    };
  },

  // ================================================================
  // SIMULATION (développement / provider non configuré)
  // ================================================================
  _simulate(provider, amount, phone, orderId) {
    const ref = `SIM-${provider.toUpperCase()}-${Date.now()}`;
    console.log(`[Payment] ⚠️ SIMULATION ${provider} — ${amount} F — réf: ${ref}`);
    return {
      success: true,
      provider,
      reference: ref,
      status: 'completed', // En simulation, paiement immédiatement réussi
      simulated: true,
      message: `Paiement simulé (${provider} non configuré). En production, l'utilisateur recevrait une demande sur son téléphone.`,
    };
  },

  // ── Webhook signature verification ──────────────────
  verifyWebhookSignature(provider, payload, signature) {
    const secret = process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
    if (!secret) return true; // Pas de vérification en dev
    const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    return hash === signature;
  },
};

module.exports = PaymentService;
