// routes/admin.js — KibaAlo v2
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');
const EmailService = require('../services/email');

router.use(authenticate);
router.use(requireRole('admin'));

router.get('/stats', async (req, res) => {
  try {
    const [
      { count:totalUsers },
      { count:totalShops },
      { count:totalOrders },
      { count:pendingKyc },
      { count:activeDeliveries },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('id', { count:'exact', head:true }),
      supabaseAdmin.from('shops').select('id', { count:'exact', head:true }).eq('is_active', true),
      supabaseAdmin.from('orders').select('id', { count:'exact', head:true }),
      supabaseAdmin.from('users').select('id', { count:'exact', head:true }).eq('kyc_status', 'submitted'),
      supabaseAdmin.from('orders').select('id', { count:'exact', head:true }).in('status', ['in_route','picked_up']),
    ]);
    const { data:rev } = await supabaseAdmin.from('transactions').select('amount').eq('type', 'debit');
    const totalRevenue = (rev||[]).reduce((s,t) => s + t.amount, 0);
    res.json({ success:true, data:{ totalUsers, totalShops, totalOrders, pendingKyc, activeDeliveries, totalRevenue } });
  } catch (err) { res.status(500).json({ success:false, message:'Erreur stats' }); }
});

router.get('/users', async (req, res) => {
  try {
    const { role, kyc_status, page=1, limit=30 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = supabaseAdmin.from('users')
      .select('id,email,phone,first_name,last_name,role,country,city,kyc_status,is_active,is_suspended,is_email_verified,created_at,last_login', { count:'exact' })
      .order('created_at', { ascending:false }).range(offset, offset+parseInt(limit)-1);
    if (role)       q = q.eq('role', role);
    if (kyc_status) q = q.eq('kyc_status', kyc_status);
    const { data, count } = await q;
    res.json({ success:true, data, total:count });
  } catch (err) { res.status(500).json({ success:false, message:'Erreur' }); }
});

router.patch('/users/:id/kyc', async (req, res) => {
  try {
    const { action, reason } = req.body;
    const updates = action === 'verify'
      ? { kyc_status:'verified', kyc_verified_at:new Date().toISOString() }
      : { kyc_status:'rejected', kyc_reject_reason:reason||'Documents non conformes' };
    await supabaseAdmin.from('users').update(updates).eq('id', req.params.id);
    const { data:u } = await supabaseAdmin.from('users').select('email,first_name').eq('id', req.params.id).single();
    if (u && action === 'verify') await EmailService.sendKycVerified(u.email, u.first_name);
    await supabaseAdmin.from('notifications').insert({
      user_id:req.params.id, type:`kyc_${action}`,
      title: action==='verify'?'✅ Identité vérifiée !':'❌ Vérification refusée',
      body:  action==='verify'?'Votre identité est vérifiée.':`Raison: ${reason||'Non conforme'}`,
    });
    res.json({ success:true, message:`KYC ${action==='verify'?'validé ✅':'refusé ❌'}` });
  } catch (err) { res.status(500).json({ success:false, message:'Erreur KYC' }); }
});

router.patch('/users/:id/suspend', async (req, res) => {
  try {
    const { reason, suspend } = req.body;
    await supabaseAdmin.from('users').update({ is_suspended:!!suspend, suspend_reason:suspend?reason:null }).eq('id', req.params.id);
    res.json({ success:true, message:suspend?'Utilisateur suspendu':'Suspension levée' });
  } catch (err) { res.status(500).json({ success:false, message:'Erreur' }); }
});

router.patch('/shops/:id/verify', async (req, res) => {
  try {
    await supabaseAdmin.from('shops').update({ is_verified:true, is_featured:req.body.featured||false }).eq('id', req.params.id);
    res.json({ success:true, message:'Boutique vérifiée ✅' });
  } catch (err) { res.status(500).json({ success:false, message:'Erreur' }); }
});

router.get('/orders', async (req, res) => {
  try {
    const { status, page=1, limit=30 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let q = supabaseAdmin.from('orders')
      .select('id,order_number,status,total,payment_status,created_at,shops!shop_id(name),users!client_id(first_name,last_name)', { count:'exact' })
      .order('created_at', { ascending:false }).range(offset, offset+parseInt(limit)-1);
    if (status) q = q.eq('status', status);
    const { data, count } = await q;
    res.json({ success:true, data, total:count });
  } catch (err) { res.status(500).json({ success:false, message:'Erreur' }); }
});

module.exports = router;
