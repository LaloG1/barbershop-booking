const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// ─── Configuración del cliente WhatsApp ─────────────────────────────────────
const SESSION_NAME = process.env.WHATSAPP_SESSION_NAME || "barbershop_bot";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: SESSION_NAME }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
    executablePath: process.env.CHROME_PATH || undefined,
  },
});

let isReady = false;

client.on("qr", (qr) => {
  console.log("\n📱 [WhatsApp] Escanea el código QR para conectar el bot:");
  qrcode.generate(qr, { small: true });
  // Opcional: emitir evento para frontend si usas WebSockets
});

client.on("ready", () => {
  console.log("✅ [WhatsApp] Bot conectado y listo para enviar mensajes!");
  isReady = true;
});

client.on("disconnected", (reason) => {
  console.log("⚠️ [WhatsApp] Desconectado:", reason);
  isReady = false;
  // Reintentar conexión después de 5 segundos
  setTimeout(() => client.initialize().catch(console.error), 5000);
});

client.on("auth_failure", (msg) => {
  console.error("❌ [WhatsApp] Fallo de autenticación:", msg);
});

// ─── Función para enviar mensaje de confirmación con QR ─────────────────────
/**
 * Envía un mensaje de WhatsApp con texto + imagen QR
 * @param {string} phone - Número con código de país (ej: "5215512345678")
 * @param {string} message - Texto del mensaje
 * @param {string} qrFilePath - Ruta del archivo QR a adjuntar
 * @returns {Promise<boolean>}
 */

/* async function sendConfirmationMessage(phone, message, qrFilePath) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!isReady) {
        console.warn('⚠️ WhatsApp no está listo, reintentando en 2s...');
        await new Promise(r => setTimeout(r, 2000));
        if (!isReady) throw new Error('WhatsApp client not ready');
      }

      // Normalizar número: eliminar +, espacios, guiones
      const normalizedPhone = phone.replace(/[^0-9]/g, '');
      const chatId = `${normalizedPhone}@c.us`;

      console.log(`📤 Enviando WhatsApp a ${normalizedPhone}...`);

      // Adjuntar QR como imagen
      const media = MessageMedia.fromFilePath(qrFilePath);
      
      // Enviar mensaje con imagen y texto como caption
      await client.sendMessage(chatId, media, {
        caption: message,
        sendAudioAsVoice: false
      });

      console.log(`✅ Mensaje enviado a ${normalizedPhone}`);
      resolve(true);
    } catch (error) {
      console.error('❌ Error enviando WhatsApp:', error.message);
      // Fallback: enviar solo texto si falla la imagen
      try {
        const chatId = `${phone.replace(/[^0-9]/g, '')}@c.us`;
        await client.sendMessage(chatId, message + '\n\n⚠️ No se pudo adjuntar el QR. Por favor contacta a la barbería.');
        console.log('✅ Fallback: mensaje de texto enviado');
        resolve(true);
      } catch (fallbackErr) {
        console.error('❌ Fallback también falló:', fallbackErr.message);
        reject(fallbackErr);
      }
    }
  });
} */

/**
 * Envía un mensaje de WhatsApp con texto + imagen QR
 * @param {string} phone - Número con código de país (ej: "+5216564128331")
 * @param {string} message - Texto del mensaje
 * @param {string} qrFilePath - Ruta del archivo QR a adjuntar
 * @returns {Promise<boolean>}
 */
async function sendConfirmationMessage(phone, message, qrFilePath) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`\n📤 [WhatsApp] Iniciando envío a: ${phone}`);

      // 1️⃣ Validar que el cliente esté listo
      if (!isReady) {
        console.warn("⚠️ [WhatsApp] Cliente no está listo, esperando 3s...");
        await new Promise((r) => setTimeout(r, 3000));
        if (!isReady) throw new Error("WhatsApp client not ready");
      }

      // 2️⃣ Normalizar número
      const normalizedPhone = phone.replace(/[^0-9]/g, "");
      console.log(`🔢 [WhatsApp] Número normalizado: ${normalizedPhone}`);

      // 3️⃣ 🎯 Resolver número con getNumberId()
      console.log("🔍 [WhatsApp] Resolviendo número con getNumberId()...");
      const resolved = await client.getNumberId(`${normalizedPhone}@c.us`);
      console.log("✅ [WhatsApp] Número resuelto:", JSON.stringify(resolved));

      if (!resolved) {
        throw new Error(
          `El número ${normalizedPhone} no está registrado en WhatsApp`,
        );
      }

      // 🔑 CLAVE: Extraer chatId correctamente del objeto LID
      let chatId;
      if (resolved && typeof resolved === "object" && resolved._serialized) {
        chatId = resolved._serialized; // Ej: "95314014912540@lid"
      } else if (typeof resolved === "string") {
        chatId = resolved;
      } else {
        chatId = `${normalizedPhone}@c.us`;
      }

      // 🔍 DEBUG: Confirmar que chatId tiene valor ANTES de usarlo
      console.log("🎯 [WhatsApp] chatId FINAL:", chatId);
      if (!chatId || chatId === "undefined") {
        throw new Error(
          "chatId está undefined o vacío después de resolver el número",
        );
      }

      // 4️⃣ Validar que el archivo QR existe
      const fs = require("fs");
      if (!fs.existsSync(qrFilePath)) {
        throw new Error(`El archivo QR no existe: ${qrFilePath}`);
      }
      console.log(`🖼️ [WhatsApp] QR válido: ${qrFilePath}`);

      // 5️⃣ Esperar sincronización
      console.log(
        "⏳ [WhatsApp] Esperando sincronización del contacto (2s)...",
      );
      await new Promise((r) => setTimeout(r, 2000));

      // 6️⃣ Crear media y enviar
      const { MessageMedia } = require("whatsapp-web.js");
      console.log("📦 [WhatsApp] Creando MessageMedia...");
      const media = MessageMedia.fromFilePath(qrFilePath);

      console.log(`📤 [WhatsApp] Enviando mensaje con imagen a: ${chatId}`);
      const result = await client.sendMessage(chatId, media, {
        caption: message,
        sendAudioAsVoice: false,
      });

      console.log(
        "✅ [WhatsApp] Mensaje con QR enviado exitosamente:",
        result?.id || "OK",
      );
      resolve(true);
    } catch (error) {
      console.error("❌ [WhatsApp] ERROR al enviar con imagen:", {
        message: error.message,
        phone: phone,
        qrFilePath: qrFilePath,
      });

      // 🔄 Fallback: enviar solo texto
      try {
        console.log("🔄 [WhatsApp] Intentando fallback (solo texto)...");
        const normalizedPhone = phone.replace(/[^0-9]/g, "");

        // Re-resolver para fallback
        let fallbackChatId;
        try {
          const resolved = await client.getNumberId(`${normalizedPhone}@c.us`);
          fallbackChatId = resolved?._serialized || `${normalizedPhone}@c.us`;
        } catch {
          fallbackChatId = `${normalizedPhone}@c.us`;
        }

        console.log(
          `📤 [WhatsApp] Fallback enviando texto a: ${fallbackChatId}`,
        );
        await client.sendMessage(
          fallbackChatId,
          message +
            "\n\n⚠️ No se pudo adjuntar el QR automáticamente. Por favor contacta a la barbería si necesitas tu comprobante.",
        );
        console.log("✅ [WhatsApp] Fallback de texto exitoso");
        resolve(true);
      } catch (fallbackErr) {
        console.error(
          "❌ [WhatsApp] Fallback también falló:",
          fallbackErr.message,
        );
        reject(fallbackErr);
      }
    }
  });
}

// ─── Inicialización ─────────────────────────────────────────────────────────
function initializeWhatsApp() {
  console.log("🔄 Inicializando cliente de WhatsApp...");
  client.initialize().catch((err) => {
    console.error("❌ Error inicializando WhatsApp:", err.message);
  });
}

// ─── Exportar funciones ─────────────────────────────────────────────────────
module.exports = {
  client,
  sendConfirmationMessage,
  initializeWhatsApp,
  isReady: () => isReady,
};
