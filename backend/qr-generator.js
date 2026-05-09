const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Asegurar que existe la carpeta
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Genera un QR y lo guarda como archivo PNG
 * @param {string} text - Contenido del QR
 * @returns {Promise<{filePath: string, base64: string}>}
 */
async function generateAppointmentQR(text) {
  const filename = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const filePath = path.join(UPLOADS_DIR, filename);
  
  await QRCode.toFile(filePath, text, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'M'
  });

  // También devolvemos base64 por si se necesita para otras integraciones
  const base64 = await QRCode.toDataURL(text, { width: 400, margin: 2 });
  
  return { filePath, base64, filename };
}

/**
 * Limpia QRs antiguos (opcional: ejecutar con cron)
 */
function cleanupOldQRs(hours = 24) {
  const files = fs.readdirSync(UPLOADS_DIR);
  const now = Date.now();
  const maxAge = hours * 60 * 60 * 1000;
  
  files.forEach(file => {
    if (!file.startsWith('qr_')) return;
    const filePath = path.join(UPLOADS_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > maxAge) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ QR eliminado: ${file}`);
    }
  });
}

module.exports = { generateAppointmentQR, cleanupOldQRs, UPLOADS_DIR };