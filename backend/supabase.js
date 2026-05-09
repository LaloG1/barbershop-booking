const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws')
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('❌ Faltan variables de entorno de Supabase');
}

module.exports = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: WebSocket
  }
})