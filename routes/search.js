// routes/search.js — KibaAlo v2
const express = require('express');
const router  = express.Router();
const { supabaseAdmin } = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    const { q, type='all', country, city, category, isDigital, minPrice, maxPrice, page=1, limit=20 } = req.query;
    if (!q || q.trim().length < 2) return res.json({ success:true, data:{ shops:[], products:[] }, query:q });
    const term = q.trim();
    const results = {};

    if (type === 'all' || type === 'shops') {
      let sq = supabaseAdmin.from('shops')
        .select('id,name,slug,category,logo_url,emoji,city,country,rating,delivery_fee,is_open,estimated_time,is_verified,is_featured')
        .eq('is_active', true).or(`name.ilike.%${term}%,description.ilike.%${term}%`).limit(parseInt(limit));
      if (country)  sq = sq.eq('country', country.toUpperCase());
      if (city)     sq = sq.ilike('city', `%${city}%`);
      if (category) sq = sq.eq('category', category);
      sq = sq.order('rating', { ascending:false });
      const { data } = await sq;
      results.shops = data || [];
    }

    if (type === 'all' || type === 'products') {
      let pq = supabaseAdmin.from('products')
        .select('id,name,price,compare_price,emoji,image_url,is_digital,is_promo,promo_percent,category,rating,shops!shop_id(id,name,city,country,is_open,delivery_fee)')
        .eq('is_available', true).or(`name.ilike.%${term}%,description.ilike.%${term}%`).limit(parseInt(limit));
      if (category) pq = pq.eq('category', category);
      if (isDigital === 'true')  pq = pq.eq('is_digital', true);
      if (isDigital === 'false') pq = pq.eq('is_digital', false);
      if (minPrice) pq = pq.gte('price', parseInt(minPrice));
      if (maxPrice) pq = pq.lte('price', parseInt(maxPrice));
      pq = pq.order('order_count', { ascending:false });
      const { data } = await pq;
      results.products = (data||[]).filter(p => !country || p.shops?.country === country.toUpperCase());
    }

    res.json({ success:true, data:results, query:term });
  } catch (err) {
    res.status(500).json({ success:false, message:'Erreur recherche' });
  }
});

router.get('/suggestions', async (req, res) => {
  try {
    const { q, country } = req.query;
    if (!q || q.length < 2) return res.json({ success:true, data:[] });
    const [{ data:shops }, { data:products }] = await Promise.all([
      supabaseAdmin.from('shops').select('name').eq('is_active', true).ilike('name', `%${q}%`).limit(4),
      supabaseAdmin.from('products').select('name').eq('is_available', true).ilike('name', `%${q}%`).limit(4),
    ]);
    const suggestions = [
      ...(shops||[]).map(s => ({ type:'shop',    text:s.name, icon:'🏪' })),
      ...(products||[]).map(p => ({ type:'product', text:p.name, icon:'📦' })),
    ].slice(0,8);
    res.json({ success:true, data:suggestions });
  } catch (err) {
    res.status(500).json({ success:false, message:'Erreur suggestions' });
  }
});

router.get('/popular', async (req, res) => {
  try {
    const { country } = req.query;
    let shopsQ = supabaseAdmin.from('shops')
      .select('id,name,emoji,rating,category,city,country,delivery_fee,is_open')
      .eq('is_active', true).eq('is_featured', true).limit(6);
    if (country) shopsQ = shopsQ.eq('country', country.toUpperCase());
    const [{ data:shops }, { data:products }, { data:digital }] = await Promise.all([
      shopsQ,
      supabaseAdmin.from('products').select('id,name,emoji,price,order_count,shops!shop_id(name)').eq('is_available', true).eq('is_digital', false).order('order_count', { ascending:false }).limit(8),
      supabaseAdmin.from('products').select('id,name,emoji,price,order_count,digital_file_type,shops!shop_id(name)').eq('is_available', true).eq('is_digital', true).order('order_count', { ascending:false }).limit(6),
    ]);
    res.json({ success:true, data:{ featuredShops:shops||[], popularProducts:products||[], digitalProducts:digital||[] } });
  } catch (err) {
    res.status(500).json({ success:false, message:'Erreur popular' });
  }
});

module.exports = router;
