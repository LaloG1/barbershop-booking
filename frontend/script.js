document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('booking-form');
  const dateInput = document.getElementById('date');
  const timeInput = document.getElementById('time');
  const statusMsg = document.getElementById('status-message');
  const loading = document.getElementById('loading');
  const submitBtn = document.getElementById('submit-btn');

  // 📅 Configurar fecha mínima (hoy)
  const today = new Date().toISOString().split('T')[0];
  dateInput.min = today;
  dateInput.value = today;

  // ⏰ Configurar validación de hora en tiempo real
  timeInput.addEventListener('change', validateTime);
  timeInput.addEventListener('input', validateTime);

  function validateTime() {
    const value = timeInput.value;
    if (!value) return;
    
    const [h, m] = value.split(':').map(Number);
    const totalMin = h * 60 + m;
    
    if (totalMin < 600 || totalMin > 1080) {
      timeInput.setCustomValidity('Horario válido: 10:00 AM - 6:00 PM');
      timeInput.reportValidity();
    } else {
      timeInput.setCustomValidity('');
    }
  }

  // 🎨 Efecto visual al seleccionar opción de corte
  document.getElementById('haircut').addEventListener('change', function() {
    this.style.borderColor = this.value ? 'var(--accent)' : 'var(--border)';
  });

  // 📤 Manejar envío del formulario
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Validación HTML5 + custom
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    // UI: estado de carga
    setLoading(true);
    clearMessage();

    // 📦 Preparar datos
    const formData = {
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      haircut: document.getElementById('haircut').value,
      date: document.getElementById('date').value,
      time: document.getElementById('time').value
    };

    try {
      // 🚀 Enviar al backend
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error desconocido al agendar');
      }

      // ✅ Éxito
      showMessage('✅ ¡Cita agendada! Revisa tu WhatsApp para la confirmación con QR.', 'success');
      form.reset();
      document.getElementById('haircut').style.borderColor = 'var(--border)';
      
      // Resetear fecha a hoy
      dateInput.value = today;

      // 🎉 Efecto visual adicional
      submitBtn.textContent = '✨ ¡Listo!';
      setTimeout(() => {
        submitBtn.textContent = '✨ Agendar Cita';
      }, 2000);

    } catch (error) {
      console.error('❌ Error:', error);
      showMessage(`❌ ${error.message}. Intenta de nuevo o contáctanos por WhatsApp.`, 'error');
    } finally {
      setLoading(false);
    }
  });

  // ─── Funciones auxiliares ────────────────────────────────────────────────
  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    loading.classList.toggle('hidden', !isLoading);
    form.classList.toggle('hidden', isLoading);
  }

  function showMessage(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `message show ${type}`;
    
    // Auto-ocultar mensajes de éxito después de 8 segundos
    if (type === 'success') {
      setTimeout(() => {
        statusMsg.classList.remove('show');
      }, 8000);
    }
  }

  function clearMessage() {
    statusMsg.textContent = '';
    statusMsg.className = 'message';
  }

  // 🔍 Verificar estado de WhatsApp al cargar (opcional)
  checkWhatsAppStatus();

  async function checkWhatsAppStatus() {
    try {
      const res = await fetch('/api/whatsapp/status');
      const { connected } = await res.json();
      if (!connected) {
        console.warn('⚠️ El bot de WhatsApp no está conectado. Los mensajes no se enviarán.');
        // Opcional: mostrar advertencia al usuario
      }
    } catch (e) {
      console.warn('⚠️ No se pudo verificar el estado de WhatsApp');
    }
  }
});