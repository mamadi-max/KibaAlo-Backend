// routes/wallet.js
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

// ─── GET /api/wallet ────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { data: wallet, error } = await supabaseAdmin
      .from('wallets').select('*').eq('user_id', req.user.id).single();

    if (error || !wallet) {
      return res.status(404).json({ success: false, message: 'Portefeuille introuvable' });
    }

    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    res.json({
      success: true,
      data: {
        balance: wallet.balance,
        currency: wallet.currency,
        transactions: transactions || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur portefeuille' });
  }
});

// ─── POST /api/wallet/recharge ──────────────────────────────
// Simulation de recharge (intégrer avec Orange Money / Moov en production)
router.post('/recharge', authenticate, async (req, res) => {
  try {
    const { amount, provider } = req.body; // provider: orange_money, moov_money, card
    if (!amount || amount < 500) {
      return res.status(400).json({ success: false, message: 'Montant minimum: 500 F CFA' });
    }

    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id,balance').eq('user_id', req.user.id).single();

    const newBalance = wallet.balance + parseInt(amount);
    await supabaseAdmin.from('wallets')
      .update({ balance: newBalance }).eq('id', wallet.id);

    await supabaseAdmin.from('transactions').insert({
      wallet_id: wallet.id,
      user_id: req.user.id,
      type: 'credit',
      amount: parseInt(amount),
      balance_before: wallet.balance,
      balance_after: newBalance,
      description: `Recharge via ${provider || 'Mobile Money'}`,
      payment_provider: provider || 'mobile_money',
      status: 'completed'
    });

    await supabaseAdmin.from('notifications').insert({
      user_id: req.user.id,
      type: 'wallet_credit',
      title: '💳 Portefeuille rechargé',
      body: `+${parseInt(amount).toLocaleString('fr-FR')} F CFA ajoutés à votre solde`
    });

    res.json({
      success: true,
      message: `Solde rechargé: +${parseInt(amount).toLocaleString()} F CFA`,
      newBalance
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur recharge' });
  }
});

// ─── POST /api/wallet/withdraw ──────────────────────────────
router.post('/withdraw', authenticate, async (req, res) => {
  try {
    const { amount, phone, provider } = req.body;
    if (!amount || amount < 1000) {
      return res.status(400).json({ success: false, message: 'Retrait minimum: 1 000 F CFA' });
    }

    const { data: wallet } = await supabaseAdmin
      .from('wallets').select('id,balance').eq('user_id', req.user.id).single();

    if (wallet.balance < amount) {
      return res.status(400).json({ success: false, message: 'Solde insuffisant' });
    }

    const newBalance = wallet.balance - parseInt(amount);
    await supabaseAdmin.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);

    await supabaseAdmin.from('transactions').insert({
      wallet_id: wallet.id,
      user_id: req.user.id,
      type: 'withdrawal',
      amount: parseInt(amount),
      balance_before: wallet.balance,
      balance_after: newBalance,
      description: `Retrait vers ${phone} via ${provider}`,
      payment_provider: provider,
      status: 'completed'
    });

    res.json({
      success: true,
      message: `Retrait de ${parseInt(amount).toLocaleString()} F CFA en cours`,
      newBalance
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur retrait' });
  }
});

module.exports = router;
