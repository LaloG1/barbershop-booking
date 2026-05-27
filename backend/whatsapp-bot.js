const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// ─── Configuración ─────────────────────────────────────────────────────────
const SESSION_NAME = process.env.WHATSAPP_SESSION_NAME || 'barbershop_bot';
const IS_WINDOWS = process.platform === 'win32';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 segundos entre reintentos

let client = null;
let isReady = false;
let initAttempts = 0;

// ─── Obtener ruta de Chrome (Windows-optimized) ────────────────────────────
function getChromePath() {
  // 1. Variable de entorno (prioridad máxima)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  
  // 2. Rutas comunes en Windows
  const windowsPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.ProgramFiles + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env.ProgramFiles + ' (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  
  // 3. Verificar cuál existe
  for (const chromePath of windowsPaths) {
    if (fs.existsSync?.(chromePath) || require('fs').existsSync(chromePath)) {
      console.log('🔍 Chrome encontrado en:', chromePath);
      return chromePath;
    }
  }
  
  // 4. Fallback: dejar que puppeteer busque automáticamente
  console.warn('⚠️ Chrome no encontrado en rutas comunes, usando detección automática');
  return undefined;
}

// ─── Crear cliente con configuración Windows-optimized ─────────────────────
function createClient() {
  const chromePath = getChromePath();
  
  // Args optimizados para Windows + WhatsApp Web
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',  // Evita errores de memoria compartida
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',  // Desactivar GPU para evitar crashes en algunas PCs
    '--no-first-run',
    '--no-zygote',
    '--disable-software-rasterizer',
    '--disable-features=IsolateOrigins,site-per-process',  // Evita problemas de aislamiento
    '--window-size=1280,800',  // Tamaño de ventana fijo para consistencia
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Flags de memoria para evitar crashes
    '--js-flags="--max-old-space-size=512"',
    '--memory-pressure-off',
  ];
  
  // Agregar flag específico para Windows si es necesario
  if (IS_WINDOWS) {
    puppeteerArgs.push('--disable-features=MediaRouter');
  }
  
  return new Client({
    authStrategy: new LocalAuth({ 
      clientId: SESSION_NAME,
      dataPath: path.join(process.cwd(), '.wwebjs_auth')
    }),
    puppeteer: {
      headless: true,  // Siempre headless en producción/servidor
      executablePath: chromePath,
      args: puppeteerArgs,
      timeout: 120000,  // 2 minutos para inicializar (Chrome puede tardar)
      ignoreHTTPSErrors: true,
      defaultViewport: { width: 1280, height: 800 }
    },
    // Configuración específica de whatsapp-web.js
    takeoverOnConflict: true,
    takeoverTimeout: 30000,
    webVersion: '2.2412.54',  // Versión específica de WhatsApp Web (actualizar según sea necesario)
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/' + '2.2412.54' + '.html',
    }
  });
}

// ─── Esperar a que el cliente esté listo con reintentos ────────────────────
async function waitForReady(timeout = 60000) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (isReady && client) {
      // Verificar adicionalmente que la página no esté cerrada
      if (client.pupPage && !client.pupPage.isClosed?.()) {
        return true;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error(`WhatsApp no estuvo listo en ${timeout/1000} segundos`);
}

// ─── Inicializar con reintentos automáticos ────────────────────────────────
async function initializeWithRetry() {
  if (initAttempts >= MAX_RETRIES) {
    console.error(`❌ [WhatsApp] Máximo de intentos (${MAX_RETRIES}) alcanzado`);
    return false;
  }
  
  initAttempts++;
  console.log(`🔄 [WhatsApp] Intento ${initAttempts}/${MAX_RETRIES}...`);
  
  try {
    // Limpiar sesión anterior si existe
    if (client) {
      try {
        console.log('🧹 Limpiando cliente anterior...');
        await client.destroy();
        client = null;
      } catch (e) {
        console.warn('⚠️ Error limpiando cliente anterior:', e.message);
      }
    }
    
    // Crear nuevo cliente
    client = createClient();
    setupEvents(client);
    
    // Inicializar con timeout
    const initPromise = client.initialize();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout inicializando WhatsApp')), 120000)
    );
    
    await Promise.race([initPromise, timeoutPromise]);
    
    console.log('✅ [WhatsApp] Inicialización exitosa');
    initAttempts = 0;  // Resetear contador en éxito
    return true;
    
  } catch (error) {
    console.error(`❌ [WhatsApp] Error en intento ${initAttempts}:`, error.message);
    
    // Manejar errores específicos de Windows/Puppeteer
    if (error.message?.includes('Target closed') || 
        error.message?.includes('EBUSY') || 
        error.message?.includes('lockfile')) {
      
      console.warn('🔧 Error de sesión/Chrome, intentando limpiar...');
      
      try {
        // Intentar eliminar la carpeta de sesión bloqueada
        const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${SESSION_NAME}`);
        if (fs.rm) {
          await fs.rm(sessionPath, { recursive: true, force: true });
          console.log('🗑️ Sesión eliminada, reintentando...');
        }
      } catch (cleanupErr) {
        console.warn('⚠️ No se pudo limpiar la sesión:', cleanupErr.message);
      }
    }
    
    // Esperar antes del siguiente intento
    if (initAttempts < MAX_RETRIES) {
      const delay = RETRY_DELAY * initAttempts;
      console.log(`⏳ Esperando ${delay/1000}s antes del siguiente intento...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return initializeWithRetry();  // Reintentar recursivamente
    }
    
    return false;
  }
}

// ─── Configurar eventos del cliente ────────────────────────────────────────
function setupEvents(cli) {
  cli.on('qr', (qr) => {
    console.log('\n📱 [WhatsApp] QR generado - Escanea para conectar:');
    qrcode.generate(qr, { small: true });
    isReady = false;
  });

  cli.on('ready', () => {
    console.log('✅ [WhatsApp] Bot conectado y listo para enviar mensajes!');
    isReady = true;
    initAttempts = 0;  // Resetear en éxito
  });

  cli.on('disconnected', (reason) => {
    console.log('⚠️ [WhatsApp] Desconectado:', reason);
    isReady = false;
    
    // Reintentar conexión automáticamente después de un delay
    setTimeout(() => {
      if (!isReady && initAttempts < MAX_RETRIES) {
        console.log('🔄 [WhatsApp] Intentando reconexión automática...');
        initializeWithRetry().catch(err => console.error('❌ Reconexión fallida:', err.message));
      }
    }, 10000);  // 10 segundos antes de reconectar
  });

  cli.on('auth_failure', (msg) => {
    console.error('❌ [WhatsApp] Fallo de autenticación:', msg);
    isReady = false;
    // No reintentar automáticamente en auth_failure, requiere escaneo manual
  });

  cli.on('change_state', (state) => {
    console.log(`🔄 [WhatsApp] Estado: ${state}`);
    if (state === 'CONNECTED') isReady = true;
  });

  cli.on('change_battery', (batteryInfo) => {
    console.log(`🔋 [WhatsApp] Batería del dispositivo: ${batteryInfo.level}%`);
  });

  // Manejar errores de página de Puppeteer (crítico para Windows)
  if (cli.pupPage) {
    cli.pupPage.on('error', (err) => {
      console.warn('⚠️ [Puppeteer] Error de página:', err.message);
      if (err.message.includes('detached') || 
          err.message.includes('closed') || 
          err.message.includes('Target closed')) {
        isReady = false;
        // No lanzar error aquí, el listener 'disconnected' se encargará
      }
    });
    
    cli.pupPage.on('close', () => {
      console.log('🔒 [Puppeteer] Página cerrada');
      isReady = false;
    });
  }
}

// ─── Enviar mensaje con manejo robusto de errores ─────────────────────────
async function sendConfirmationMessage(phone, message, qrFilePath) {
  try {
    console.log(`\n📤 [WhatsApp] Preparando envío a: ${phone}`);
    
    // Verificar que WhatsApp está habilitado
    if (process.env.WHATSAPP_ENABLED === 'false') {
      console.log('📵 WhatsApp desactivado por configuración, omitiendo envío');
      return true;
    }
    
    // Esperar cliente listo
    if (!isReady || !client) {
      console.log('⏳ [WhatsApp] Esperando conexión (timeout: 30s)...');
      try {
        await waitForReady(30000);
      } catch (waitErr) {
        console.warn('⚠️ Timeout esperando WhatsApp, intentando enviar de todas formas...');
      }
    }
    
    // Verificar que el cliente y la página estén disponibles
    if (!client || !client.pupPage || client.pupPage.isClosed?.()) {
      throw new Error('Cliente de WhatsApp no disponible o página cerrada');
    }
    
    // Normalizar número de teléfono
    const normalizedPhone = phone.replace(/[^0-9]/g, '');
    console.log(`🔢 Número normalizado: ${normalizedPhone}`);
    
    // Resolver chat ID con getNumberId (más confiable que asumir formato)
    let chatId;
    try {
      const resolved = await client.getNumberId(`${normalizedPhone}@c.us`);
      chatId = resolved?._serialized || `${normalizedPhone}@c.us`;
      console.log(`🎯 Chat ID resuelto: ${chatId}`);
    } catch (resolveErr) {
      console.warn(`⚠️ No se pudo resolver número con getNumberId, usando formato directo`);
      chatId = `${normalizedPhone}@c.us`;
    }
    
    // Pequeña pausa para asegurar sincronización
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Preparar y enviar mensaje
    if (qrFilePath && (await fs.access(qrFilePath).then(() => true).catch(() => false))) {
      console.log('🖼️ Enviando mensaje con imagen QR...');
      const media = MessageMedia.fromFilePath(qrFilePath);
      const result = await client.sendMessage(chatId, media, { 
        caption: message,
        sendMediaAsSticker: false,
        sendMediaAsDocument: false
      });
      console.log('✅ Mensaje con QR enviado:', result?.id || 'OK');
    } else {
      console.log('📝 Enviando mensaje de texto...');
      const result = await client.sendMessage(chatId, message);
      console.log('✅ Mensaje de texto enviado:', result?.id || 'OK');
    }
    
    return true;
    
  } catch (error) {
    console.warn(`⚠️ Error enviando WhatsApp: ${error.message}`);
    
    // Fallback: intentar solo texto sin imagen
    try {
      console.log('🔄 Intentando fallback (solo texto, sin QR)...');
      
      if (!client || !isReady) {
        await waitForReady(15000).catch(() => {});
      }
      
      const normalizedPhone = phone.replace(/[^0-9]/g, '');
      const chatId = `${normalizedPhone}@c.us`;
      
      const fallbackMessage = message + '\n\n⚠️ *Nota:* No se pudo adjuntar el código QR. Por favor, muéstralo desde la página web o solicita que te lo reenvíen.';
      
      await client?.sendMessage(chatId, fallbackMessage);
      console.log('✅ Fallback de texto exitoso');
      return true;
      
    } catch (finalErr) {
      console.error('❌ Fallback también falló:', finalErr.message);
      // No propagar error: el agendado ya fue exitoso, WhatsApp es opcional
      return false;
    }
  }
}

// ─── Función pública para inicializar (con reintentos) ─────────────────────
async function initializeWhatsApp() {
  console.log('🔄 [WhatsApp] Iniciando proceso de conexión...');
  const success = await initializeWithRetry();
  
  if (!success) {
    console.error('❌ [WhatsApp] No se pudo inicializar después de múltiples intentos');
    console.log('💡 Sugerencias:');
    console.log('   1. Verifica que Chrome esté instalado en: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    console.log('   2. Ejecuta como Administrador si hay problemas de permisos');
    console.log('   3. Desactiva temporalmente el antivirus/firewall si bloquea Puppeteer');
    console.log('   4. Usa WHATSAPP_ENABLED=false en .env para desarrollo sin WhatsApp');
  }
  
  return success;
}

// ─── Exportar funciones públicas ───────────────────────────────────────────
module.exports = {
  sendConfirmationMessage,
  initializeWhatsApp,
  isReady: () => isReady,
  getClient: () => client,
  forceReconnect: async () => {
    console.log('🔄 [WhatsApp] Reconexión forzada solicitada');
    isReady = false;
    initAttempts = 0;
    return initializeWithRetry();
  }
};