const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ─── Configuración ─────────────────────────────────────────────────────────
const SESSION_NAME = process.env.WHATSAPP_SESSION_NAME || "barbershop_bot";
const IS_RENDER =
  process.env.RENDER === "true" || process.env.NODE_ENV === "production";

let client = null;
let isReady = false;
let initPromise = null;

// ─── Crear cliente ─────────────────────────────────────────────────────────
function createClient() {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: SESSION_NAME,
      dataPath: IS_RENDER ? "/opt/render/project/src/.wwebjs_auth" : undefined,
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
        '--js-flags="--max-old-space-size=256"',
      ],
      timeout: 60000,
    },
  });
}

// ─── Esperar a que el cliente esté listo ───────────────────────────────────
async function waitForClient(timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (isReady && client && !client.pupPage?.isClosed?.()) {
      return client;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("WhatsApp client no estuvo listo en el tiempo límite");
}

// ─── Enviar mensaje con reintentos ─────────────────────────────────────────
async function sendConfirmationMessage(phone, message, qrFilePath) {

  // Si WhatsApp está desactivado o no hay cliente, omitir sin error
  if (process.env.WHATSAPP_ENABLED === 'false' || !client || !isReady) {
    console.log('📵 WhatsApp no disponible, omitiendo envío a:', phone);
    return Promise.resolve(true);
  }

  try {
    console.log(`\n📤 [WhatsApp] Preparando envío a: ${phone}`);

    // Esperar cliente listo
    const cli = await waitForClient(20000);

    // Normalizar número
    const normalizedPhone = phone.replace(/[^0-9]/g, "");

    // Resolver chat ID
    let chatId;
    try {
      const resolved = await cli.getNumberId(`${normalizedPhone}@c.us`);
      chatId = resolved?._serialized || `${normalizedPhone}@c.us`;
    } catch {
      chatId = `${normalizedPhone}@c.us`;
    }
    console.log(`🎯 Chat ID: ${chatId}`);

    // Pequeña pausa para sincronización
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Enviar mensaje
    if (qrFilePath && fs.existsSync(qrFilePath)) {
      console.log("🖼️ Enviando con imagen...");
      const media = MessageMedia.fromFilePath(qrFilePath);
      const result = await cli.sendMessage(chatId, media, { caption: message });
      console.log("✅ Mensaje con QR enviado:", result?.id || "OK");
    } else {
      console.log("📝 Enviando solo texto...");
      const result = await cli.sendMessage(chatId, message);
      console.log("✅ Mensaje de texto enviado:", result?.id || "OK");
    }

    return true;
  } catch (error) {
    console.warn(`⚠️ Error enviando WhatsApp: ${error.message}`);

    // Fallback: intentar solo texto sin imagen
    try {
      const cli = await waitForClient(10000);
      const normalizedPhone = phone.replace(/[^0-9]/g, "");
      const chatId = `${normalizedPhone}@c.us`;

      await cli.sendMessage(
        chatId,
        message + "\n\n⚠️ No se pudo adjuntar el QR.",
      );
      console.log("✅ Fallback de texto exitoso");
      return true;
    } catch (finalErr) {
      console.error("❌ Fallback también falló:", finalErr.message);
      throw finalErr;
    }
  }
}

// ─── Inicializar WhatsApp ──────────────────────────────────────────────────
function initializeWhatsApp() {
  console.log("🔄 [WhatsApp] Inicializando...");

  return new Promise((resolve, reject) => {
    // Función interna para iniciar nuevo cliente
    async function startNew() {
      try {
        // Limpiar cliente anterior si existe
        if (client) {
          try {
            await client.destroy();
          } catch (e) {
            console.warn("⚠️ Error limpiando cliente anterior:", e.message);
          }
        }

        client = createClient();
        setupEvents(client);

        // Timeout para evitar bloqueos infinitos
        const initTimeout = setTimeout(() => {
          console.warn("⚠️ Timeout inicializando WhatsApp");
          isReady = false;
          resolve(null);
        }, 60000);

        await client.initialize();
        clearTimeout(initTimeout);

        console.log("✅ [WhatsApp] Inicialización completada");
        resolve(client);
      } catch (err) {
        console.error("❌ Error inicializando WhatsApp:", err.message);

        // 🎯 Manejar específicamente errores de archivo bloqueado (Windows)
        if (
          err.message?.includes("EBUSY") ||
          err.message?.includes("lockfile")
        ) {
          console.warn(
            "🔓 Archivo de sesión bloqueado. Intenta eliminar la carpeta .wwebjs_auth manualmente.",
          );
          console.warn("📁 Ruta: " + path.join(process.cwd(), ".wwebjs_auth"));
        }

        // No rechazar la promesa: permitir que el servidor continúe
        isReady = false;
        resolve(null); // 👈 Clave: resolver con null en lugar de rechazar
      }
    }

    startNew();
  });
}

// ─── Configurar eventos del cliente ────────────────────────────────────────
function setupEvents(cli) {
  cli.on("qr", (qr) => {
    console.log("\n📱 [WhatsApp] QR generado - Escanea para conectar:");
    qrcode.generate(qr, { small: true });
  });

  cli.on("ready", () => {
    console.log("✅ [WhatsApp] Bot conectado y listo!");
    isReady = true;
  });

  cli.on("disconnected", (reason) => {
    console.log("⚠️ [WhatsApp] Desconectado:", reason);
    isReady = false;
    // Reintentar conexión automáticamente
    setTimeout(() => {
      if (!isReady) {
        console.log("🔄 [WhatsApp] Reintentando conexión...");
        initializeWhatsApp();
      }
    }, 5000);
  });

  cli.on("auth_failure", (msg) => {
    console.error("❌ [WhatsApp] Fallo de autenticación:", msg);
    isReady = false;
  });

  cli.on("change_state", (state) => {
    console.log(`🔄 [WhatsApp] Estado: ${state}`);
    if (state === "CONNECTED") isReady = true;
  });

  // Manejar errores de página de Puppeteer
  if (cli.pupPage) {
    cli.pupPage.on("error", (err) => {
      console.warn("⚠️ [Puppeteer] Error de página:", err.message);
      if (err.message.includes("detached") || err.message.includes("closed")) {
        isReady = false;
      }
    });
  }
}

// ─── Exportar ──────────────────────────────────────────────────────────────
module.exports = {
  sendConfirmationMessage,
  initializeWhatsApp,
  isReady: () => isReady,
  getClient: () => client,
};
