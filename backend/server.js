// backend/server.js (CON AUTH COMPLETO)
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const supabase = require("./supabase");
const { generateAppointmentQR } = require("./qr-generator");
const { sendConfirmationMessage, initializeWhatsApp, isReady } = require("./whatsapp-bot");
const { hashPassword, verifyPassword, generateToken, verifyToken } = require("./utils/auth");
const requireAuth = require("./middleware/requireAuth");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── AUTH: Login ────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son requeridos" });
    }

    // Buscar usuario activo con ese email
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, branch_id, specialty, password_hash, is_active")
      .eq("email", email)
      .eq("is_active", true)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Verificar contraseña
    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Actualizar last_login
    await supabase.from("users").update({ last_login: new Date().toISOString() }).eq("id", user.id);

    // Generar token y responder (sin password_hash)
    const { password_hash, ...safeUser } = user;
    const token = generateToken(safeUser);

    res.json({
      success: true,
      message: "Login exitoso",
      token,
      user: safeUser
    });

  } catch (err) {
    console.error("🔥 Error en login:", err.message);
    res.status(500).json({ error: "Error interno de autenticación" });
  }
});

// ─── AUTH: Verificar sesión (para validar token en frontend) ───────────────
app.get("/api/auth/me", requireAuth(), async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, branch_id, specialty, is_active, last_login")
      .eq("id", req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "Error verificando sesión" });
  }
});

// ─── AUTH: Logout (invalidar token en frontend) ────────────────────────────
app.post("/api/auth/logout", (req, res) => {
  // En JWT, el logout es del lado del cliente (eliminar token)
  // Aquí solo confirmamos la acción
  res.json({ success: true, message: "Sesión cerrada" });
});

// ─── ADMIN: CRUD Usuarios (solo admin) ─────────────────────────────────────
app.get("/api/admin/users", requireAuth(["admin"]), async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("id, name, email, role, specialty, branch_id, is_active, created_at, last_login")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: "Error cargando usuarios" });
  }
});

app.post("/api/admin/users", requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, email, password, role, specialty, branch_id } = req.body;
    
    if (!name || !email || !password || !["admin", "barber"].includes(role)) {
      return res.status(400).json({ error: "Campos requeridos inválidos" });
    }

    // Verificar email único
    const { data: existing } = await supabase.from("users").select("id").eq("email", email).single();
    if (existing) {
      return res.status(400).json({ error: "El email ya está registrado" });
    }

    const password_hash = await hashPassword(password);

    const { data: user, error } = await supabase
      .from("users")
      .insert([{
        name, email, password_hash, role,
        specialty: role === "barber" ? specialty || null : null,
        branch_id: role === "barber" ? branch_id || null : null,
        is_active: true
      }])
      .select("id, name, email, role, specialty, branch_id")
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, user });
  } catch (err) {
    console.error("❌ Error creando usuario:", err.message);
    res.status(500).json({ error: "Error creando usuario" });
  }
});

app.patch("/api/admin/users/:id", requireAuth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, specialty, branch_id, is_active, password } = req.body;
    
    const updateData = { name, email, role, specialty, branch_id, is_active };
    if (password) updateData.password_hash = await hashPassword(password);
    if (role === "admin") { updateData.specialty = null; updateData.branch_id = null; }

    const { data: user, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", id)
      .select("id, name, email, role, specialty, branch_id, is_active")
      .single();

    if (error) throw error;
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "Error actualizando usuario" });
  }
});

// ─── BARBER: Obtener sus citas de hoy ──────────────────────────────────────
app.get("/api/barber/appointments/today", requireAuth(["barber"]), async (req, res) => {
  try {
    const barberId = req.user.id;
    const branchId = req.user.branch_id;
    const today = new Date().toISOString().split("T")[0];

    let query = supabase
      .from("appointments")
      .select(`id, name, phone, appointment_date, appointment_time, status, branch_id, barber_id,
               branches!inner(name), services!inner(name, price)`)
      .eq("barber_id", barberId)
      .eq("appointment_date", today)
      .order("appointment_time", { ascending: true });

    if (branchId) query = query.eq("branch_id", branchId);

    const { data: appointments, error } = await query;
    if (error) throw error;

    res.json({ success: true, appointments });
  } catch (err) {
    res.status(500).json({ error: "Error cargando citas" });
  }
});

// ─── BARBER: Completar cita (atribuir al usuario logueado) ─────────────────
app.post("/api/appointments/:id/complete", requireAuth(["barber", "admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const completedBy = req.user.id; // 👈 Usuario logueado completa la cita

    // Verificar que la cita existe y está confirmada
    const { data: existing, error: fetchError } = await supabase
      .from("appointments")
      .select("id, status, name")
      .eq("id", id)
      .single();

    if (fetchError || !existing) return res.status(404).json({ error: "Cita no encontrada" });
    if (existing.status === "completed") {
      return res.status(400).json({ error: "Esta cita ya está marcada como realizada" });
    }

    // Actualizar estado
    const { data: updated, error: updateError } = await supabase
      .from("appointments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: completedBy,
        completion_notes: notes || null
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;
    res.json({ success: true, message: "Cita marcada como realizada", appointment: updated });
  } catch (err) {
    console.error("❌ Error completando cita:", err.message);
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── PÚBLICO: Sucursales y Barberos ────────────────────────────────────────
app.get("/api/branches", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("branches")
      .select("id, name, address")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    res.json({ success: true, branches: data || [] });
  } catch (err) { res.status(500).json({ error: "Error cargando sucursales" }); }
});

app.get("/api/barbers", async (req, res) => {
  try {
    const { branch_id } = req.query;
    let query = supabase.from("users")
      .select("id, name, specialty, branch_id")
      .eq("role", "barber")
      .eq("is_active", true)
      .order("name");
    if (branch_id) query = query.eq("branch_id", branch_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, barbers: data || [] });
  } catch (err) { res.status(500).json({ error: "Error cargando barberos" }); }
});

// ─── PÚBLICO: Agendar cita ─────────────────────────────────────────────────
app.post("/api/appointments", async (req, res) => {
  try {
    const { name, phone, date, time, branch_id, barber_id, service_id } = req.body;
    if (!name || !phone || !date || !time) return res.status(400).json({ error: "Campos obligatorios" });

    const { data: appointment, error: dbError } = await supabase
      .from("appointments")
      .insert([{ name: name.trim(), phone: phone.trim(), appointment_date: date, appointment_time: time, branch_id: branch_id || null, barber_id: barber_id || null, service_id: service_id || null }])
      .select()
      .single();

    if (dbError) throw dbError;

    // Generar QR en background
    const qrContent = `CITA BARBERÍA\n👤 ${name.trim()}\n📅 ${date} ⏰ ${time}\n🆔 ${appointment.id}`;
    const { filePath: qrPath, filename: qrFilename } = await generateAppointmentQR(qrContent);
    const qrPublicUrl = `/uploads/${qrFilename}`;

    // Actualizar URL del QR (sin bloquear respuesta)
    supabase.from("appointments").update({ qr_code_url: qrPublicUrl }).eq("id", appointment.id)
      .then(({ error }) => { if (error) console.warn("⚠️ QR no actualizado:", error.message); });

    // Responder inmediatamente al cliente
    res.json({ success: true, message: "Cita agendada", appointment: { id: appointment.id, name: appointment.name, date: appointment.appointment_date, time: appointment.appointment_time, qr_code_url: qrPublicUrl } });

    // WhatsApp en background (si está habilitado)
    if (process.env.WHATSAPP_ENABLED !== "false") {
      const days = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
      const dayName = days[new Date(date).getDay()];
      const msg = `✅ *¡Cita Confirmada!* 💈\n\n👤 ${name}\n📅 ${date} (${dayName})\n⏰ ${time}\n🎫 Código: \`${appointment.id.slice(0,8)}\``;
      sendConfirmationMessage(phone, msg, qrPath).catch(err => console.error("❌ WhatsApp falló:", err.message));
    }
  } catch (error) {
    console.error("🔥 Error agendando cita:", error.message);
    if (!res.headersSent) res.status(500).json({ error: "Error interno al agendar" });
  }
});

app.get("/api/appointments/:id", async (req, res) => {
  try {
    const { data: appointment, error } = await supabase.from("appointments").select("*").eq("id", req.params.id).single();
    if (error || !appointment) return res.status(404).json({ error: "Cita no encontrada" });
    res.json({ success: true, appointment });
  } catch (err) { res.status(500).json({ error: "Error interno" }); }
});

// ─── Archivos estáticos y rutas ────────────────────────────────────────────
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/portal", express.static(path.join(__dirname, "..", "portal"))); // Portal antes del wildcard

app.get("*", (req, res) => {
  if (!req.path.startsWith("/portal")) {
    res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
  }
});

// ─── Iniciar servidor ──────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  if (process.env.WHATSAPP_ENABLED !== "false") {
    console.log("🔄 Inicializando WhatsApp...");
    initializeWhatsApp().catch(err => console.warn("⚠️ WhatsApp error:", err.message));
  } else {
    console.log("📵 WhatsApp desactivado");
  }
});

// ─── Manejo de errores globales ────────────────────────────────────────────
process.on("unhandledRejection", reason => console.error("❌ Unhandled Rejection:", reason));
process.on("uncaughtException", error => {
  console.error("❌ Uncaught Exception:", error.message);
  if (error.message?.includes("whatsapp") || error.message?.includes("puppeteer")) {
    console.warn("⚠️ Error de WhatsApp ignorado");
    return;
  }
  process.exit(1);
});