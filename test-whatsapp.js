// test-whatsapp.js
require('dotenv').config();
const { sendConfirmationMessage, initializeWhatsApp } = require('./backend/whatsapp-bot');
const { generateAppointmentQR } = require('./backend/qr-generator');
const path = require('path');

async function test() {
  console.log('🚀 Iniciando test de WhatsApp...\n');
  
  // Inicializar cliente
  initializeWhatsApp();
  
  // Esperar a que esté listo
  await new Promise(resolve => {
    const check = setInterval(() => {
      const { isReady } = require('./backend/whatsapp-bot');
      if (isReady()) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
    // Timeout 15s
    setTimeout(() => {
      clearInterval(check);
      console.error('❌ Timeout esperando WhatsApp');
      process.exit(1);
    }, 15000);
  });
  
  console.log('✅ WhatsApp listo\n');
  
  // Datos de prueba
  const testPhone = '+5216564128331'; // 👈 CAMBIA POR TU NÚMERO REAL
  const testMessage = `✅ *¡Cita de Prueba!* 💈\n\n👤 *Nombre:* Test User\n📅 *Fecha:* 2024-12-31\n⏰ *Hora:* 14:00 hrs\n✂️ *Corte:* normal\n\n🎫 *Código:* \`test-123\`\n\n📌 Presenta este QR al llegar.`;
  
  // Generar QR de prueba
  const qrContent = `CITA DE PRUEBA\n👤 Test User\n📅 2024-12-31 ⏰ 14:00\n✂️ normal\n🆔 test-123`;
  const { filePath: qrPath } = await generateAppointmentQR(qrContent);
  console.log('🖼️ QR generado:', qrPath);
  
  // Enviar
  try {
    await sendConfirmationMessage(testPhone, testMessage, qrPath);
    console.log('\n🎉 ¡Test completado! Revisa tu WhatsApp.');
  } catch (err) {
    console.error('\n❌ Test fallido:', err.message);
  }
  
  // Salir
  setTimeout(() => {
    const { client } = require('./backend/whatsapp-bot');
    client.destroy().then(() => process.exit(0));
  }, 3000);
}

test().catch(console.error);