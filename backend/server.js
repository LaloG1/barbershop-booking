const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const supabase = require("./supabase");
const { generateAppointmentQR } = require("./qr-generator");
const {
  sendConfirmationMessage,
  initializeWhatsApp,
  isReady,
} = require("./whatsapp-bot");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Asegurar que existe la carpeta uploads
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── Endpoint: Agendar cita (Cliente) ───────────────────────────────────────
app.post("/api/appointments", async (req, res) => {
  console.log("\n📥 [API] Request:", JSON.stringify(req.body, null, 2));

  try {
    const { name, phone, date, time } = req.body;

    // Validaciones
    if (!name || !phone || !date || !time) {
      return res.status(400).json({ error: "Campos obligatorios" });
    }
    if (!/^\+\d{10,14}$/.test(phone)) {
      return res.status(400).json({ error: "Teléfono inválido" });
    }
    const [h, m] = time.split(":").map(Number);
    if (h * 60 + m < 600 || h * 60 + m > 1080) {
      return res.status(400).json({ error: "Horario: 10AM-6PM" });
    }

    // 🗄️ INSERTAR EN SUPABASE
    console.log("🗄️ Ejecutando insert en Supabase...");

    const rawResult = await supabase
      .from("appointments")
      .insert([
        {
          name: name.trim(),
          phone: phone.trim(),
          appointment_date: date,
          appointment_time: time,
        },
      ])
      .select()
      .single();

    console.log("📦 Respuesta CRUDA:", JSON.stringify(rawResult, null, 2));

    // 🔑 EXTRACCIÓN SEGURA DE DATOS
    // Intentamos extraer 'data' de la respuesta estándar
    let appointment = rawResult.data;
    let dbError = rawResult.error;

    // Fallback: Si 'data' no existe pero el resultado tiene 'id', usamos el resultado directo
    if (!appointment && rawResult && rawResult.id) {
      appointment = rawResult;
      console.log("⚠️ Usando fallback: rawResult directo");
    }

    // Validar error
    if (dbError) {
      console.error("❌ Error de BD:", dbError);
      return res
        .status(500)
        .json({ error: "Error BD", debug: dbError.message });
    }

    // Validar que tenemos la cita
    if (!appointment) {
      console.error("❌ CRÍTICO: No se encontró data ni id en la respuesta");
      console.log("Keys disponibles:", Object.keys(rawResult));
      return res.status(500).json({ error: "La BD no devolvió el registro" });
    }

    console.log("✅ Cita guardada ID:", appointment.id);

    // 🖼️ Generar QR
    const qrContent = `CITA BARBERÍA\n👤 ${name.trim()}\n📅 ${date} ⏰ ${time}\n🆔 ${appointment.id}`;
    const { filePath: qrPath, filename: qrFilename } =
      await generateAppointmentQR(qrContent);
    const qrPublicUrl = `/uploads/${qrFilename}`;

    // 💾 Actualizar qr_code_url (opcional)
    await supabase
      .from("appointments")
      .update({ qr_code_url: qrPublicUrl })
      .eq("id", appointment.id);

    // 📱 Preparar mensaje de WhatsApp
    const days = [
      "Domingo",
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
    ];
    const dayName = days[new Date(date).getDay()];

    const msg =
      `✅ *¡Cita Confirmada!* 💈\n\n` +
      `👤 *Nombre:* ${name.trim()}\n` +
      `📅 *Fecha:* ${date} (${dayName})\n` +
      `⏰ *Hora:* ${time}\n` +
      `🎫 *Tu código:* \`${appointment.id.slice(0, 8)}\`\n\n` +
      `📌 *Presenta el QR adjunto al llegar.*\n` +
      `¡Te esperamos! ✂️✨`;

    // 🚀 Enviar WhatsApp
    sendConfirmationMessage(phone, msg, qrPath)
      .then(() => console.log(`✅ WhatsApp enviado a ${phone}`))
      .catch((err) => console.error(`❌ WhatsApp error: ${err.message}`));
    sendConfirmationMessage(phone, msg, qrPath).catch((err) =>
      console.error("❌ WhatsApp:", err.message),
    );

    // ✅ Responder
    res.json({
      success: true,
      message: "Cita agendada",
      appointment: { id: appointment.id, name: appointment.name, date, time },
    });
  } catch (error) {
    console.error("🔥 CATCH GLOBAL:", {
      message: error.message,
      stack: error.stack?.split("\n")[0],
      name: error.name,
    });
    res.status(500).json({ error: "Error interno", debug: error.message });
  }
});

// ─── Endpoint: Verificar cita por ID ────────────────────────────────────────
app.get("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 [GET] Buscando cita: ${id}`);

    const { data: appointment, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !appointment) {
      console.warn("⚠️ Cita no encontrada:", error?.message || "null data");
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    console.log("✅ Cita encontrada:", appointment.name);
    res.json({ success: true, appointment });
  } catch (err) {
    console.error("❌ Error en GET /api/appointments/:id:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ─── Endpoint: Completar cita (cambiar estado a "completed") ────────────────
app.post("/api/appointments/:id/complete", async (req, res) => {
  try {
    const { id } = req.params;
    const { barberId, notes } = req.body;

    console.log(`🔄 [POST] Completando cita: ${id}`);

    // 1. Verificar que la cita existe y está confirmada
    const { data: existing, error: fetchError } = await supabase
      .from("appointments")
      .select("id, status, name")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    if (existing.status === "completed") {
      return res
        .status(400)
        .json({ error: "Esta cita ya está marcada como realizada" });
    }

    // 2. Actualizar estado
    const { data: updated, error: updateError } = await supabase
      .from("appointments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: barberId || "web-scanner",
        completion_notes: notes || null,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("❌ Error actualizando:", updateError);
      return res.status(500).json({ error: "Error al actualizar la cita" });
    }

    console.log("✅ Cita completada:", updated.name);
    res.json({
      success: true,
      message: "Cita marcada como realizada",
      appointment: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        completed_at: updated.completed_at,
      },
    });
  } catch (err) {
    console.error("❌ Error en POST /complete:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ─── Endpoint: Verificar estado de WhatsApp ─────────────────────────────────
app.get("/api/whatsapp/status", (req, res) => {
  res.json({ connected: isReady() });
});

// ─── Servir archivos estáticos de uploads (para ver QRs en navegador) ───────
app.use("/uploads", express.static(UPLOADS_DIR));

// ─── Servir frontend para rutas no-API ──────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// ─── Iniciar servidor ───────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📁 Frontend: ${path.join(__dirname, "..", "frontend")}`);
  console.log(`📁 Uploads: ${UPLOADS_DIR}`);

  // Inicializar WhatsApp después de 2 segundos
  setTimeout(() => {
    console.log("🔄 Inicializando WhatsApp...");
    initializeWhatsApp();
  }, 2000);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Recibida señal ${signal}. Cerrando...`);

  server.close(async () => {
    console.log("✅ Servidor HTTP cerrado");

    try {
      const { client } = require("./whatsapp-bot");
      await client.destroy();
      console.log("✅ Cliente WhatsApp cerrado");
    } catch (e) {
      console.warn("⚠️ Error cerrando WhatsApp:", e.message);
    }

    process.exit(0);
  });

  // Forzar cierre después de 10s
  setTimeout(() => {
    console.error("❌ Timeout en shutdown");
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
