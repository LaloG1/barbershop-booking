document.addEventListener('DOMContentLoaded', function() {
  // Elementos del DOM
  var readerElement = document.getElementById('reader');
  var resultPanel = document.getElementById('scan-result');
  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultContent = document.getElementById('result-content');
  var resultActions = document.getElementById('result-actions');
  var toast = document.getElementById('toast');
  var manualForm = document.getElementById('manual-form');

  // Estado global
  var html5QrCode = null;
  var currentAppointmentId = null;
  var currentAppointment = null;
  var isProcessing = false;
  var scannerStopped = false;

  // 🔔 Mostrar notificación
  function showToast(message, type) {
    if (!type) type = 'success';
    toast.textContent = message;
    toast.className = 'toast ' + (type === 'error' ? 'error' : '');
    toast.classList.remove('hidden');
    setTimeout(function() { toast.classList.add('hidden'); }, 4000);
  }

  // 🎨 Mostrar panel de resultado
  function showScanResult(status, title, html) {
    var icons = { loading: '⏳', success: '✅', error: '❌', info: '📋' };
    resultIcon.textContent = icons[status] || '❓';
    resultTitle.textContent = title;
    resultContent.innerHTML = html;
    resultPanel.classList.remove('hidden');
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // 📋 Mostrar detalles de la cita
  function showAppointmentDetails(app) {
    var statusText = { confirmed: '🟡 Confirmada', completed: '✅ Realizada', cancelled: '🔴 Cancelada' };
    var dateParts = app.appointment_date.split('-');
    var formattedDate = dateParts[2] + '/' + dateParts[1] + '/' + dateParts[0];

    var html = '';
    html += '<p><strong>👤 Cliente:</strong> ' + app.name + '</p>';
    html += '<p><strong>📅 Fecha:</strong> ' + formattedDate + '</p>';
    html += '<p><strong>⏰ Hora:</strong> ' + app.appointment_time + '</p>';
    html += '<p><strong>✂️ Corte:</strong> ' + app.haircut_type + '</p>';
    html += '<p><strong>🎫 Estado:</strong> ' + (statusText[app.status] || app.status) + '</p>';

    if (app.status === 'completed') {
      showScanResult('success', '✅ YA REALIZADA', html);
      resultActions.innerHTML = '<button id="btn-next" class="btn-secondary" style="width:100%">🔄 Nueva Cita</button>';
      resultActions.classList.remove('hidden');
      document.getElementById('btn-next').onclick = resetScanner;
    } else if (app.status === 'cancelled') {
      showScanResult('error', '❌ CANCELADA', html);
      resultActions.innerHTML = '<button id="btn-next" class="btn-secondary" style="width:100%">🔄 Nueva Cita</button>';
      resultActions.classList.remove('hidden');
      document.getElementById('btn-next').onclick = resetScanner;
    } else {
      // 🟡 Confirmada: mostrar botón para completar
      showScanResult('info', '📋 Cita Encontrada', html);
      resultActions.innerHTML = '<button id="btn-complete" class="btn-success" style="width:100%">✅ Marcar como Realizada</button>';
      resultActions.classList.remove('hidden');
      document.getElementById('btn-complete').onclick = completeAppointment;
    }
  }

  // ✅ Escanear QR exitosamente
  async function onScanSuccess(decodedText) {
    if (isProcessing || scannerStopped) return;
    
    console.log('🎯 QR escaneado:', decodedText.substring(0, 100));
    
    // 🔑 DETENER SCANNER y ocultar cámara
    await stopScanner();
    
    // Extraer UUID del contenido del QR
    var uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    var match = decodedText.match(uuidPattern);
    
    if (!match) {
      showToast('❌ QR no contiene un ID válido', 'error');
      await resumeScanner(); // Reanudar si falló la extracción
      return;
    }
    
    currentAppointmentId = match[0].toLowerCase().trim();
    console.log('🔑 ID extraído:', currentAppointmentId);
    
    // Mostrar estado de carga
    showScanResult('loading', 'Buscando cita...', '⏳ Conectando con base de datos...');
    
    try {
      // Consultar al backend
      var response = await fetch('/api/appointments/' + currentAppointmentId);
      var responseData = await response.json();
      
      console.log('📦 Respuesta del servidor:', responseData);
      
      if (!response.ok || responseData.error || !responseData.appointment) {
        throw new Error(responseData.error || 'Cita no encontrada en la base de datos');
      }
      
      // Guardar y mostrar detalles
      currentAppointment = responseData.appointment;
      showAppointmentDetails(currentAppointment);
      
    } catch (error) {
      console.error('❌ Error al buscar cita:', error.message);
      showScanResult('error', '❌ Error', 
        '<p><strong>Mensaje:</strong> ' + error.message + '</p>' +
        '<p><strong>ID buscado:</strong> <code>' + currentAppointmentId + '</code></p>' +
        '<p style="margin-top:1rem"><small>Verifica que:</small></p>' +
        '<ul style="text-align:left;font-size:0.9rem"><li>La cita exista en Supabase</li><li>El servidor esté corriendo</li><li>RLS esté desactivado</li></ul>' +
        '<button id="btn-retry" class="btn-primary" style="margin-top:1rem;width:100%">🔄 Reintentar</button>'
      );
      resultActions.classList.remove('hidden');
      document.getElementById('btn-retry').onclick = resetScanner;
    }
  }

  // ❌ Error al escanear (ignorar silenciosamente)
  function onScanFailure(errorMessage) {
    // No hacer nada: los errores de "no QR detectado" son normales
  }

  // 🛑 DETENER scanner y ocultar cámara (NUEVO)
  async function stopScanner() {
    if (scannerStopped) return;
    
    try {
      if (html5QrCode && html5QrCode.stop) {
        await html5QrCode.stop();
        console.log('📷 Scanner detenido');
      }
      if (html5QrCode && html5QrCode.clear) {
        html5QrCode.clear();
        console.log('🧹 Scanner limpiado');
      }
      
      // Ocultar elemento de cámara
      if (readerElement) {
        readerElement.style.display = 'none';
        console.log('👁️ Cámara oculta');
      }
      
      // Ocultar guía de escaneo si existe
      var guide = document.querySelector('.scanner-guide');
      if (guide) guide.style.display = 'none';
      
      scannerStopped = true;
      
    } catch (err) {
      console.warn('⚠️ Error al detener scanner:', err.message);
    }
  }

  // 🔄 Reanudar scanner (para nueva lectura)
  async function resumeScanner() {
    if (!scannerStopped) return;
    
    try {
      // Mostrar cámara de nuevo
      if (readerElement) {
        readerElement.style.display = 'block';
      }
      var guide = document.querySelector('.scanner-guide');
      if (guide) guide.style.display = 'block';
      
      // Resetear estado
      scannerStopped = false;
      currentAppointmentId = null;
      currentAppointment = null;
      resultPanel.classList.add('hidden');
      resultActions.classList.add('hidden');
      
      // Reiniciar scanner
      await initScanner();
      console.log('📷 Scanner reanudado');
      
    } catch (err) {
      console.error('❌ Error al reanudar:', err.message);
      showToast('Error al reiniciar cámara', 'error');
    }
  }

  // ✅ Completar cita (cambiar estado a "completed")
  async function completeAppointment() {
    if (!currentAppointmentId || isProcessing) return;
    
    isProcessing = true;
    var btn = document.getElementById('btn-complete');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Procesando...';
    }

    try {
      console.log('🔄 Actualizando cita:', currentAppointmentId);
      
      var response = await fetch('/api/appointments/' + currentAppointmentId + '/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          barberId: 'web-scanner', 
          notes: 'Completada desde página web del barbero'
        })
      });
      
      var result = await response.json();
      console.log('📦 Respuesta de completar:', result);
      
      if (!response.ok) {
        throw new Error(result.error || 'Error al actualizar el estado');
      }

      // 🎉 Éxito: mostrar pantalla de confirmación PERMANENTE
      showToast('✅ Cita marcada como realizada', 'success');
      
      var dateParts = currentAppointment.appointment_date.split('-');
      var formattedDate = dateParts[2] + '/' + dateParts[1] + '/' + dateParts[0];
      
      var successHtml = '';
      successHtml += '<div style="text-align:center;padding:1.5rem">';
      successHtml += '<p style="font-size:4rem;margin:0;line-height:1">✅</p>';
      successHtml += '<p style="font-size:1.3rem;font-weight:bold;margin:0.8rem 0">' + currentAppointment.name + '</p>';
      successHtml += '<p><strong>📅</strong> ' + formattedDate + ' | <strong>⏰</strong> ' + currentAppointment.appointment_time + '</p>';
      successHtml += '<p><strong>✂️</strong> ' + currentAppointment.haircut_type + '</p>';
      successHtml += '<p style="color:#22c55e;font-size:1.5rem;font-weight:bold;margin:1.5rem 0;text-transform:uppercase">✅ Completada</p>';
      successHtml += '<p style="font-size:0.9rem;color:#888">' + new Date(result.appointment.completed_at).toLocaleString('es-MX') + '</p>';
      successHtml += '</div>';
      
      resultIcon.textContent = '✅';
      resultTitle.textContent = '¡CITA REALIZADA!';
      resultTitle.style.color = '#22c55e';
      resultContent.innerHTML = successHtml;
      
      resultActions.innerHTML = '<button id="btn-next" class="btn-success" style="width:100%;padding:1rem;font-size:1.1rem">🔄 Escanear Siguiente</button>';
      resultActions.classList.remove('hidden');
      document.getElementById('btn-next').onclick = resetScanner;

    } catch (error) {
      console.error('❌ Error al completar:', error);
      showToast('❌ ' + error.message, 'error');
      
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✅ Marcar como Realizada';
      }
      isProcessing = false;
    }
  }

  // 🔄 Resetear para nueva lectura
  function resetScanner() {
    console.log('🔄 Resetear scanner llamado');
    resumeScanner();
  }

  // 🔄 Inicializar scanner QR
  async function initScanner() {
    // Si ya hay uno, limpiar
    if (html5QrCode) {
      try {
        if (html5QrCode.stop) await html5QrCode.stop();
        if (html5QrCode.clear) html5QrCode.clear();
      } catch(e) {}
    }

    // Crear nueva instancia
    html5QrCode = new Html5Qrcode('reader');
    
    var config = {
      fps: 10,
      qrbox: { width: 200, height: 200 },
      rememberLastUsedCamera: true
    };

    try {
      await html5QrCode.start(
        { facingMode: 'environment' },
        config,
        onScanSuccess,
        onScanFailure
      );
      console.log('📷 Scanner iniciado');
    } catch (err) {
      console.error('❌ Error al iniciar scanner:', err);
      showToast('❌ No se pudo acceder a la cámara. Usa el formulario manual.', 'error');
      document.querySelector('.manual-entry').open = true;
    }
  }

  // 📝 Manejar formulario manual
  manualForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    var idInput = document.getElementById('manual-id');
    var id = idInput.value.trim().toLowerCase();
    
    if (!id) {
      showToast('Ingresa un ID válido', 'error');
      return;
    }
    
    // Validar formato UUID
    var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      showToast('Formato inválido. Ej: a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'error');
      return;
    }
    
    currentAppointmentId = id;
    showScanResult('loading', 'Buscando...', '🔍 ID: ' + id);
    
    try {
      var res = await fetch('/api/appointments/' + id);
      var data = await res.json();
      
      if (!res.ok || data.error || !data.appointment) {
        throw new Error(data.error || 'Cita no encontrada');
      }
      
      currentAppointment = data.appointment;
      showAppointmentDetails(currentAppointment);
      idInput.value = '';
      
    } catch (err) {
      console.error('Error manual search:', err);
      showToast('❌ ' + err.message, 'error');
      showScanResult('error', 'No encontrada', '<code>' + id + '</code>');
    }
  });

  // 🚀 Iniciar al cargar
  console.log('🚀 Iniciando página del barbero...');
  initScanner();

  // 🧹 Limpiar al salir
  window.addEventListener('beforeunload', function() {
    if (html5QrCode && html5QrCode.stop) {
      html5QrCode.stop().catch(function(){});
    }
  });
});