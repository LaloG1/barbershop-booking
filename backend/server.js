const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const supabase = require('./supabase');
const { generateAppointmentQR } = require('./qr-generator');
const { sendConfirmationMessage, initializeWhatsApp, isReady } = require('./whatsapp-bot');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Asegurar que existe la carpeta uploads
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── Endpoint: Agendar cita (Cliente) ───────────────────────────────────────
app.post('/api/appointments', async (req, res) => {
  console.log('\n📥 [API] Nueva solicitud de cita:', JSON.stringify(req.body, null, 2));
  
  try {
    const { name, phone, haircut, date, time } = req.body;

    // 🔐 Validaciones básicas
    if (!name || !phone || !haircut || !date || !time) {
      console.warn('⚠️ Validación: campos incompletos');
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const validHaircuts = ['Pelon', 'normal', 'militar'];
    if (!validHaircuts.includes(haircut)) {
      return res.status(400).json({ error: 'Tipo de corte no válido' });
    }

    // Validar horario 10:00 - 18:00
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    if (totalMinutes < 600 || totalMinutes > 1080) {
      return res.status(400).json({ error: 'Horario válido: 10:00 AM a 6:00 PM' });
    }

    // Validar fecha no pasada
    const appointmentDateTime = new Date(`${date}T${time}`);
    if (appointmentDateTime < new Date()) {
      return res.status(400).json({ error: 'No se pueden agendar citas en el pasado' });
    }

    // 🗄️ Guardar en Supabase (🔑 CORREGIDO: usar 'data:' en destructuración)
    console.log('🗄️ Guardando cita en Supabase...');
    const { data: appointment, error: dbError } = await supabase
      .from('appointments')
      .insert([{
        name: name.trim(),
        phone: phone.trim(),
        haircut_type: haircut,
        appointment_date: date,
        appointment_time: time
      }])
      .select()
      .single();

    if (dbError) {
      console.error('❌ Error en Supabase:', dbError);
      return res.status(500).json({ 
        error: 'Error guardando la cita', 
        details: process.env.NODE_ENV === 'development' ? dbError : undefined 
      });
    }

    console.log('✅ Cita guardada en Supabase ID:', appointment.id);

    // 🖼️ Generar QR
    console.log('🖼️ Generando QR...');
    const qrContent = `CITA BARBERÍA
👤 ${name.trim()}
📅 ${date} ⏰ ${time}
✂️ ${haircut}
🆔 ${appointment.id}
📍 Barbería Premium`;

    const { filePath: qrPath, filename: qrFilename } = await generateAppointmentQR(qrContent);
    console.log('✅ QR generado:', qrPath);

    // 💾 Guardar ruta del QR en Supabase
    const qrPublicUrl = `/uploads/${qrFilename}`;
    const { error: updateError } = await supabase
      .from('appointments')
      .update({ qr_code_url: qrPublicUrl })
      .eq('id', appointment.id);

    if (updateError) {
      console.warn('⚠️ No se pudo actualizar qr_code_url:', updateError.message);
    } else {
      console.log('✅ qr_code_url actualizado en Supabase:', qrPublicUrl);
    }

    // 📱 Preparar mensaje de WhatsApp
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const dayName = dayNames[new Date(date).getDay()];
    
    const whatsappMessage = `✅ *¡Cita Confirmada!* 💈

👤 *Nombre:* ${name.trim()}
📅 *Fecha:* ${date} (${dayName})
⏰ *Hora:* ${time} hrs
✂️ *Corte:* ${haircut}

🎫 *Tu código:* \`${appointment.id.slice(0, 8)}\`

📌 Presenta el QR adjunto al llegar.
¡Te esperamos! ✂️✨`;

    // 🚀 Enviar WhatsApp (en background para no bloquear la respuesta)
    console.log('📱 Enviando WhatsApp...');
    sendConfirmationMessage(phone, whatsappMessage, qrPath)
      .then(() => console.log(`✅ WhatsApp enviado a ${phone}`))
      .catch(err => console.error(`❌ Error enviando WhatsApp: ${err.message}`));

    // ✅ Responder al frontend inmediatamente
    console.log('✅ Respondiendo al frontend...');
    res.json({
      success: true,
      message: 'Cita agendada correctamente',
      appointment: {
        id: appointment.id,
        name: appointment.name,
        date: appointment.appointment_date,
        time: appointment.appointment_time,
        haircut: appointment.haircut_type,
        qr_url: qrPublicUrl
      }
    });

  } catch (error) {
    console.error('🔥 ERROR GLOBAL en /api/appointments:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      body: req.body
    });
    
    res.status(500).json({
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ─── Endpoint: Verificar cita por ID ────────────────────────────────────────
app.get('/api/appointments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 [GET] Buscando cita: ${id}`);
    
    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !appointment) {
      console.warn('⚠️ Cita no encontrada:', error?.message || 'null data');
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    console.log('✅ Cita encontrada:', appointment.name);
    res.json({ success: true, appointment });
    
  } catch (err) {
    console.error('❌ Error en GET /api/appointments/:id:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// ─── Endpoint: Completar cita (cambiar estado a "completed") ────────────────
app.post('/api/appointments/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { barberId, notes } = req.body;
    
    console.log(`🔄 [POST] Completando cita: ${id}`);

    // 1. Verificar que la cita existe y está confirmada
    const { data: existing, error: fetchError } = await supabase
      .from('appointments')
      .select('id, status, name')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    if (existing.status === 'completed') {
      return res.status(400).json({ error: 'Esta cita ya está marcada como realizada' });
    }

    // 2. Actualizar estado
    const { data: updated, error: updateError } = await supabase
      .from('appointments')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: barberId || 'web-scanner',
        completion_notes: notes || null
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Error actualizando:', updateError);
      return res.status(500).json({ error: 'Error al actualizar la cita' });
    }

    console.log('✅ Cita completada:', updated.name);
    res.json({
      success: true,
      message: 'Cita marcada como realizada',
      appointment: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        completed_at: updated.completed_at
      }
    });

  } catch (err) {
    console.error('❌ Error en POST /complete:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── Endpoint: Verificar estado de WhatsApp ─────────────────────────────────
app.get('/api/whatsapp/status', (req, res) => {
  res.json({ connected: isReady() });
});

// ─── Servir archivos estáticos de uploads (para ver QRs en navegador) ───────
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Servir frontend para rutas no-API ──────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Iniciar servidor ───────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📁 Frontend: ${path.join(__dirname, '..', 'frontend')}`);
  console.log(`📁 Uploads: ${UPLOADS_DIR}`);
  
  // Inicializar WhatsApp después de 2 segundos
  setTimeout(() => {
    console.log('🔄 Inicializando WhatsApp...');
    initializeWhatsApp();
  }, 2000);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Recibida señal ${signal}. Cerrando...`);
  
  server.close(async () => {
    console.log('✅ Servidor HTTP cerrado');
    
    try {
      const { client } = require('./whatsapp-bot');
      await client.destroy();
      console.log('✅ Cliente WhatsApp cerrado');
    } catch (e) {
      console.warn('⚠️ Error cerrando WhatsApp:', e.message);
    }
    
    process.exit(0);
  });
  
  // Forzar cierre después de 10s
  setTimeout(() => {
    console.error('❌ Timeout en shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));