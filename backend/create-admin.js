// backend/create-admin.js
require('dotenv').config();
const { hashPassword } = require('./utils/auth');
const supabase = require('./supabase');

async function createInitialAdmin() {
  const email = 'admin@barbershop.local';
  const password = 'Admin123!';
  
  console.log('🔐 Creando admin inicial...');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);
  
  const password_hash = await hashPassword(password);
  
  const { data, error } = await supabase
    .from('users')
    .upsert([{
      name: 'Administrador Principal',
      email,
      password_hash,
      role: 'admin',
      is_active: true,
      created_at: new Date().toISOString()
    }], { onConflict: 'email' })
    .select('id, email, role')
    .single();
  
  if (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
  
  console.log('✅ Admin creado/actualizado:', data);
  console.log('\n🌐 Ahora puedes login en: http://localhost:3000/portal/');
}

createInitialAdmin().catch(console.error);