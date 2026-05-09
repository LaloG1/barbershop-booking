document.addEventListener('DOMContentLoaded', () => {
  // 🎯 Elementos del DOM
  const readerElement = document.getElementById('reader');
  const resultPanel = document.getElementById('scan-result');
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultContent = document.getElementById('result-content');
  const resultActions = document.getElementById('result-actions');
  const btnConfirm = document.getElementById('btn-confirm');
  const btnCancel = document.getElementById('btn-cancel');
  const btnRescan = document.getElementById('btn-rescan');
  const toast = document.getElementById('toast');
  const soundSuccess = document.getElementById('sound-success');
  const toggleCameraBtn = document.getElementById('toggle-camera');
  const manualForm = document.getElementById('manual-form');

  // 📦 Estado
  let html5QrCode = null;
  let currentAppointmentId = null;
  let cameraFacingMode = 'environment'; // 'environment' = trasera, 'user' = frontal

  // 🔊 Reproducir sonido de éxito
  function playSuccessSound() {
    try {
      soundSuccess.currentTime = 0;
      soundSuccess.play().catch(() => {}); // Ignorar errores de autoplay
    } catch (e) {}
  }

  // 🔔 Mostrar notificación toast
  function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 4000);
  }

  // 🔄 Inicializar scanner QR
  async function initScanner() {
    // Limpiar scanner anterior si existe
    if (html5QrCode) {
      await html5QrCode.stop().catch(() => {});
      html5QrCode.clear();
    }

    // Crear nueva instancia
    html5QrCode = new Html5Qrcode('reader');
    
    const config = {
      fps: 10,
      qrbox: { width: 200, height: 200 },
      disableFlip: false,
      rememberLastUsedCamera: true
    };

    try {
      await html5QrCode.start(
        { facingMode: cameraFacingMode },
        config,
        onScanSuccess,
        onScanFailure
      );
      console.log('📷 Scanner iniciado con cámara:', cameraFacingMode);
    } catch (err) {
      console.error('❌ Error iniciando scanner:', err);
      showToast('No se pudo acceder a la cámara. Verifica los permisos.', 'error');
      
      // Mostrar formulario manual como fallback
      document.querySelector('.manual-entry').open = true;
    }
  }

  // ✅ Callback: QR escaneado exitosamente
  async function onScanSuccess(decodedText, decodedResult) {
    console.log('🎯 QR escaneado:', decodedText);
    
    // Pausar scanner temporalmente para procesar
    await html5QrCode.pause();
    
    // Extraer ID de la cita del contenido del QR
    // Formato esperado: "CITA BARBERÍA\n👤 Nombre\n📅 Fecha ⏰ Hora\n✂️ Corte\n🆔 UUID"
    const appointmentId = extractAppointmentId(decodedText);
    
    if (!appointmentId) {
      showToast('❌ QR no válido para citas', 'error');
      await resumeScanner();
      return;
    }

    // Mostrar resultado del escaneo
    showScanResult('loading', 'Verificando cita...', decodedText);
    
    try {
      // Verificar la cita en el backend
      const response = await fetch(`/api/appointments/${appointmentId}`);
      const {  appointment, error } = await response.json();
      
      if (error || !appointment) {
        throw new Error('Cita no encontrada');
      }

      // Mostrar detalles de la cita
      showAppointmentDetails(appointment);
      
    } catch (err) {
      console.error('Error verificando cita:', err);
      showScanResult('error', 'Cita no encontrada', `ID: ${appointmentId}`);
    }
  }

  // ❌ Callback: Error al escanear (ignoramos errores menores)
  function onScanFailure(errorMessage) {
    // No hacer nada: los errores de "no QR detectado" son normales
    // console.debug('🔍 Escaneando...', errorMessage);
  }

  // 🔍 Extraer UUID del contenido del QR
  function extractAppointmentId(qrContent) {
    // Buscar patrón de UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = qrContent.match(uuidPattern);
    return match ? match[0] : null;
  }

  // 📋 Mostrar detalles de la cita escaneada
  function showAppointmentDetails(appointment) {
    currentAppointmentId = appointment.id;
    
    const formatDate = (dateStr) => {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    };

    const statusBadges = {
      'confirmed': '🟡 Confirmada',
      'completed': '🟢 Realizada',
      'cancelled': '🔴 Cancelada',
      'no-show': '⚪ No se presentó'
    };

    const content = `
      <p><strong>👤 Cliente:</strong> ${appointment.name}</p>
      <p><strong>📅 Fecha:</strong> ${formatDate(appointment.appointment_date)}</p>
      <p><strong>⏰ Hora:</strong> ${appointment.appointment_time}</p>
      <p><strong>✂️ Corte:</strong> ${appointment.haircut_type}</p>
      <p><strong>📱 Teléfono:</strong> ${appointment.phone}</p>
      <p><strong>🎫 Estado:</strong> ${statusBadges[appointment.status] || appointment.status}</p>
    `;

    if (appointment.status === 'completed') {
      showScanResult('success', '✅ Cita ya realizada', content);
      resultActions.classList.add('hidden');
    } else if (appointment.status === 'cancelled') {
      showScanResult('error', '❌ Cita cancelada', content);
      resultActions.classList.add('hidden');
    } else {
      showScanResult('info', '📋 Cita encontrada', content);
      resultActions.classList.remove('hidden');
      btnConfirm.disabled = false;
      btnConfirm.textContent = '✅ Marcar como Realizada';
    }
  }

  // 🎨 Mostrar panel de resultado con estado
  function showScanResult(status, title, contentHtml) {
    // Iconos por estado
    const icons = {
      loading: '⏳',
      success: '✅',
      error: '❌',
      info: '📋'
    };

    resultIcon.textContent = icons[status] || '❓';
    resultTitle.textContent = title;
    resultContent.innerHTML = contentHtml;
    resultPanel.classList.remove('hidden');
    
    // Scroll suave al resultado
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 🔄 Reanudar scanner
  async function resumeScanner() {
    try {
      await html5QrCode.resume();
    } catch (e) {
      console.warn('No se pudo reanudar scanner, reiniciando...');
      await initScanner();
    }
  }

  // 🎯 Confirmar cita como realizada
  async function confirmAppointment() {
    if (!currentAppointmentId) return;
    
    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Procesando...';
    
    try {
      const response = await fetch(`/api/appointments/${currentAppointmentId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: 'barber-1', // 👈 Cambiar por sistema de auth real
          notes: 'Escaneado desde página de scanner'
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Error al actualizar');
      }

      // ✅ Éxito
      playSuccessSound();
      showToast('✅ Cita marcada como realizada', 'success');
      
      showScanResult('success', '✅ ¡Listo!', `
        <p><strong>${result.appointment.name}</strong></p>
        <p>Cita completada a las ${new Date(result.appointment.completed_at).toLocaleTimeString('es-MX')}</p>
      `);
      
      resultActions.classList.add('hidden');
      
      // Auto-limpiar después de 3 segundos
      setTimeout(() => {
        resetScanner();
      }, 3000);

    } catch (err) {
      console.error('Error confirmando cita:', err);
      showToast(`❌ ${err.message}`, 'error');
      btnConfirm.disabled = false;
      btnConfirm.textContent = '✅ Confirmar Cita';
    }
  }

  // 🔄 Resetear scanner para nueva lectura
  function resetScanner() {
    currentAppointmentId = null;
    resultPanel.classList.add('hidden');
    resultActions.classList.add('hidden');
    resumeScanner();
  }

  // 📝 Manejar entrada manual de ID
  manualForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('manual-id').value.trim();
    
    if (!id) return;
    
    showScanResult('loading', 'Buscando...', `ID: ${id}`);
    
    try {
      const response = await fetch(`/api/appointments/${id}`);
      const {  appointment, error } = await response.json();
      
      if (error || !appointment) {
        throw new Error('Cita no encontrada');
      }
      
      showAppointmentDetails(appointment);
      document.getElementById('manual-id').value = '';
      
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
      showScanResult('error', 'No encontrada', `ID: ${id}`);
    }
  });

  // 🔄 Cambiar entre cámaras frontal/trasera
  toggleCameraBtn.addEventListener('click', async () => {
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    showToast(`🔄 Cambiando a cámara ${cameraFacingMode === 'environment' ? 'trasera' : 'frontal'}...`);
    await initScanner();
  });

  // 🎯 Event listeners de botones
  btnConfirm.addEventListener('click', confirmAppointment);
  btnCancel.addEventListener('click', resetScanner);
  btnRescan.addEventListener('click', resetScanner);

  // 🚀 Iniciar scanner al cargar
  initScanner();

  // 🧹 Limpieza al salir de la página
  window.addEventListener('beforeunload', async () => {
    if (html5QrCode) {
      await html5QrCode.stop().catch(() => {});
    }
  });
});