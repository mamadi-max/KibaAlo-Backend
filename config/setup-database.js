// config/setup-database.js — KibaAlo v2
require('dotenv').config();
const { supabaseAdmin } = require('./supabase');

async function check() {
  console.log('\n🛵 KibaAlo v2 — Vérification base de données\n');
  const tables = [
    'users','shops','products','orders','digital_purchases','invoices',
    'payments','wallets','transactions','livreurs','parcels',
    'promo_codes','reviews','notifications','services','rentals',
    'order_tracking','saved_addresses','wishlists','search_history','admin_logs',
  ];
  let ok = true;
  for (const t of tables) {
    try {
      const { error, count } = await supabaseAdmin.from(t).select('id', { count:'exact', head:true });
      if (error) { console.log(`  ❌ ${t}: ${error.message}`); ok = false; }
      else console.log(`  ✅ ${t} (${count ?? 0} entrées)`);
    } catch(e) { console.log(`  ❌ ${t}: ${e.message}`); ok = false; }
  }
  console.log(ok ? '\n✅ Base de données prête !\n' : '\n⚠️  Exécutez config/schema.sql dans Supabase SQL Editor\n');
  process.exit(ok ? 0 : 1);
}
check();
