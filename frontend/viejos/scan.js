document.addEventListener("DOMContentLoaded", function () {
  // 🎯 Elementos del DOM
  var readerElement = document.getElementById("reader");
  var scannerContainer = document.getElementById("scanner-container");
  var manualContainer = document.getElementById("manual-container");
  var manualForm = document.getElementById("manual-form");
  var manualIdInput = document.getElementById("manual-id");
  var btnManualSearch = document.getElementById("btn-manual-search");
  var resultPanel = document.getElementById("scan-result");
  var resultIcon = document.getElementById("result-icon");
  var resultTitle = document.getElementById("result-title");
  var resultContent = document.getElementById("result-content");
  var resultActions = document.getElementById("result-actions");
  var toast = document.getElementById("toast");
  var soundSuccess = document.getElementById("sound-success");
  var toggleCameraBtn = document.getElementById("toggle-camera");
  var headerSubtitle = document.getElementById("header-subtitle");

  // Toggle de modo
  var btnModeScan = document.getElementById("btn-mode-scan");
  var btnModeManual = document.getElementById("btn-mode-manual");

  // 📦 Estado global
  var html5QrCode = null;
  var currentAppointmentId = null;
  var currentAppointment = null;
  var isProcessing = false;
  var scannerStopped = false;
  var currentMode = "scan"; // 'scan' o 'manual'
  var cameraFacingMode = "environment";

  // 🔊 Sonido de éxito
  function playSuccessSound() {
    try {
      soundSuccess.currentTime = 0;
      soundSuccess.play().catch(function () {});
    } catch (e) {}
  }

  // 🔔 Toast notification
  function showToast(message, type) {
    if (!type) type = "success";
    toast.textContent = message;
    toast.className = "toast " + (type === "error" ? "error" : "");
    toast.classList.remove("hidden");
    setTimeout(function () {
      toast.classList.add("hidden");
    }, 4000);
  }

  // 🎨 Mostrar panel de resultado
  function showScanResult(status, title, html) {
    var icons = { loading: "⏳", success: "✅", error: "❌", info: "📋" };
    resultIcon.textContent = icons[status] || "❓";
    resultTitle.textContent = title;
    resultContent.innerHTML = html;
    resultPanel.classList.remove("hidden");
    resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // 📋 Mostrar detalles de la cita
  function showAppointmentDetails(app) {
    var statusText = {
      confirmed: "🟡 Confirmada",
      completed: "✅ Realizada",
      cancelled: "🔴 Cancelada",
      "no-show": "⚪ No se presentó",
    };
    var dateParts = app.appointment_date.split("-");
    var formattedDate = dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];

    var html = "";
    html += "<p><strong>👤 Cliente:</strong> " + app.name + "</p>";
    html += "<p><strong>📅 Fecha:</strong> " + formattedDate + "</p>";
    html += "<p><strong>⏰ Hora:</strong> " + app.appointment_time + "</p>";
    html += "<p><strong>📱 Teléfono:</strong> " + app.phone + "</p>";
    html +=
      "<p><strong>🎫 Estado:</strong> " +
      (statusText[app.status] || app.status) +
      "</p>";

    if (app.status === "completed") {
      showScanResult("success", "✅ YA REALIZADA", html);
      resultActions.innerHTML =
        '<button id="btn-next" class="btn-secondary" style="width:100%">🔄 Nueva Cita</button>';
      resultActions.classList.remove("hidden");
      document.getElementById("btn-next").onclick = resetAll;
    } else if (app.status === "cancelled") {
      showScanResult("error", "❌ CANCELADA", html);
      resultActions.innerHTML =
        '<button id="btn-next" class="btn-secondary" style="width:100%">🔄 Nueva Cita</button>';
      resultActions.classList.remove("hidden");
      document.getElementById("btn-next").onclick = resetAll;
    } else {
      showScanResult("info", "📋 Cita Encontrada", html);
      resultActions.innerHTML =
        '<button id="btn-complete" class="btn-success" style="width:100%">✅ Marcar como Realizada</button>';
      resultActions.classList.remove("hidden");
      document.getElementById("btn-complete").onclick = completeAppointment;
    }
  }

  // ✅ Escanear QR exitosamente (solo en modo scan)
  async function onScanSuccess(decodedText) {
    if (isProcessing || scannerStopped || currentMode !== "scan") return;

    console.log("🎯 QR escaneado:", decodedText.substring(0, 100));

    // 🔑 DETENER SCANNER y ocultar cámara
    await stopScanner();

    // Extraer UUID del contenido del QR
    var uuidPattern =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    var match = decodedText.match(uuidPattern);

    if (!match) {
      showToast("❌ QR no contiene un ID válido", "error");
      await resumeScanner();
      return;
    }

    currentAppointmentId = match[0].toLowerCase().trim();
    console.log("🔑 ID extraído:", currentAppointmentId);

    // Mostrar estado de carga
    showScanResult(
      "loading",
      "Buscando cita...",
      "⏳ Conectando con base de datos...",
    );

    try {
      var response = await fetch("/api/appointments/" + currentAppointmentId);
      var responseData = await response.json();

      console.log("📦 Respuesta del servidor:", responseData);

      if (!response.ok || responseData.error || !responseData.appointment) {
        throw new Error(responseData.error || "Cita no encontrada");
      }

      currentAppointment = responseData.appointment;
      showAppointmentDetails(currentAppointment);
    } catch (error) {
      console.error("❌ Error al buscar cita:", error.message);
      showScanResult(
        "error",
        "❌ Error",
        "<p><strong>Mensaje:</strong> " +
          error.message +
          "</p>" +
          "<p><strong>ID:</strong> <code>" +
          currentAppointmentId +
          "</code></p>" +
          '<button id="btn-retry" class="btn-primary" style="margin-top:1rem;width:100%">🔄 Reintentar</button>',
      );
      resultActions.classList.remove("hidden");
      document.getElementById("btn-retry").onclick = resetAll;
    }
  }

  // ❌ Error al escanear (ignorar)
  function onScanFailure() {}

  // 🛑 Detener scanner y ocultar cámara
  async function stopScanner() {
    if (scannerStopped) return;

    try {
      if (html5QrCode && html5QrCode.stop) {
        await html5QrCode.stop();
        console.log("📷 Scanner detenido");
      }
      if (html5QrCode && html5QrCode.clear) {
        html5QrCode.clear();
        console.log("🧹 Scanner limpiado");
      }

      if (scannerContainer) {
        scannerContainer.style.display = "none";
        console.log("👁️ Cámara oculta");
      }

      scannerStopped = true;
    } catch (err) {
      console.warn("⚠️ Error al detener scanner:", err.message);
    }
  }

  // 🔄 Inicializar scanner QR
  async function initScanner() {
    if (scannerStopped) return;

    // Limpiar anterior
    if (html5QrCode) {
      try {
        if (html5QrCode.stop) await html5QrCode.stop();
        if (html5QrCode.clear) html5QrCode.clear();
      } catch (e) {}
    }

    html5QrCode = new Html5Qrcode("reader");

    var config = {
      fps: 10,
      qrbox: { width: 200, height: 200 },
      rememberLastUsedCamera: true,
    };

    try {
      await html5QrCode.start(
        { facingMode: cameraFacingMode },
        config,
        onScanSuccess,
        onScanFailure,
      );
      console.log("📷 Scanner iniciado");
    } catch (err) {
      console.error("❌ Error scanner:", err);
      showToast("❌ No se pudo acceder a la cámara", "error");
    }
  }

  // 🔄 Reanudar scanner (para nueva lectura)
  async function resumeScanner() {
    if (!scannerStopped) return;

    try {
      if (scannerContainer) scannerContainer.style.display = "block";
      scannerStopped = false;
      currentAppointmentId = null;
      currentAppointment = null;
      resultPanel.classList.add("hidden");
      resultActions.classList.add("hidden");

      await initScanner();
      console.log("📷 Scanner reanudado");
    } catch (err) {
      console.error("❌ Error al reanudar:", err.message);
      showToast("Error al reiniciar cámara", "error");
    }
  }

  // 🔤 Manejar búsqueda manual (SIN validación estricta)
  manualForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (isProcessing) return;

    var id = manualIdInput.value.trim().toLowerCase();

    if (!id) {
      showToast("Ingresa el ID de la cita", "error");
      return;
    }

    // ✅ Validación FLEXIBLE: solo verificar que tenga guiones y caracteres hex
    // No bloquear al usuario con mensajes de formato estricto
    var basicPattern = /^[0-9a-f\-]{36}$/i;
    if (!basicPattern.test(id)) {
      // En lugar de error, mostrar hint amigable y permitir intento
      console.log("⚠️ ID con formato inusual, intentando de todos modos:", id);
      // showToast('Formato inusual, pero intentando...', 'warning');
    }

    // Limpiar cualquier espacio o caracter extra
    id = id.replace(/\s+/g, "");
    currentAppointmentId = id;

    // UI: estado de carga
    btnManualSearch.disabled = true;
    btnManualSearch.textContent = "🔍 Buscando...";
    showScanResult(
      "loading",
      "Buscando cita...",
      "⏳ Conectando con base de datos...",
    );

    try {
      var res = await fetch("/api/appointments/" + id);
      var data = await res.json();

      console.log("📦 Respuesta manual:", data);

      if (!res.ok || data.error || !data.appointment) {
        throw new Error(data.error || "Cita no encontrada. Verifica el ID.");
      }

      currentAppointment = data.appointment;
      showAppointmentDetails(currentAppointment);
      manualIdInput.value = ""; // Limpiar input
    } catch (err) {
      console.error("❌ Error búsqueda manual:", err.message);
      showToast("❌ " + err.message, "error");
      showScanResult(
        "error",
        "No encontrada",
        "<p><strong>ID buscado:</strong></p><p><code>" +
          id +
          "</code></p>" +
          '<p style="margin-top:0.8rem;font-size:0.9rem">💡 Verifica:</p>' +
          '<ul style="text-align:left;font-size:0.85rem"><li>El ID es correcto</li><li>La cita existe en Supabase</li><li>El servidor está corriendo</li></ul>',
      );
      resultActions.innerHTML =
        '<button id="btn-retry" class="btn-primary" style="width:100%">🔄 Intentar de Nuevo</button>';
      resultActions.classList.remove("hidden");
      document.getElementById("btn-retry").onclick = function () {
        resultPanel.classList.add("hidden");
        resultActions.classList.add("hidden");
        manualIdInput.focus();
      };
    } finally {
      btnManualSearch.disabled = false;
      btnManualSearch.textContent = "🔍 Buscar Cita";
    }
  });

  // ✅ Completar cita (cambiar estado a "completed")
  async function completeAppointment() {
    if (!currentAppointmentId || isProcessing) return;

    isProcessing = true;
    var btn = document.getElementById("btn-complete");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Procesando...";
    }

    try {
      console.log("🔄 Actualizando cita:", currentAppointmentId);

      var response = await fetch(
        "/api/appointments/" + currentAppointmentId + "/complete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            barberId: "web-scanner",
            notes: "Completada desde página web del barbero",
          }),
        },
      );

      var result = await response.json();
      console.log("📦 Respuesta completar:", result);

      if (!response.ok) {
        throw new Error(result.error || "Error al actualizar");
      }

      // 🎉 Éxito
      playSuccessSound();
      showToast("✅ Cita marcada como realizada", "success");

      var dateParts = currentAppointment.appointment_date.split("-");
      var formattedDate =
        dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];

      var successHtml = "";
      successHtml += '<div style="text-align:center;padding:1.5rem">';
      successHtml += '<p style="font-size:4rem;margin:0;line-height:1">✅</p>';
      successHtml +=
        '<p style="font-size:1.3rem;font-weight:bold;margin:0.8rem 0">' +
        currentAppointment.name +
        "</p>";
      successHtml +=
        "<p><strong>📅</strong> " +
        formattedDate +
        " | <strong>⏰</strong> " +
        currentAppointment.appointment_time +
        "</p>";
      successHtml +=
        "<p><strong>✂️</strong> " + currentAppointment.haircut_type + "</p>";
      successHtml +=
        '<p style="color:#22c55e;font-size:1.5rem;font-weight:bold;margin:1.5rem 0;text-transform:uppercase">✅ Completada</p>';
      successHtml +=
        '<p style="font-size:0.9rem;color:#888">' +
        new Date(result.appointment.completed_at).toLocaleString("es-MX") +
        "</p>";
      successHtml += "</div>";

      resultIcon.textContent = "✅";
      resultTitle.textContent = "¡CITA REALIZADA!";
      resultTitle.style.color = "#22c55e";
      resultContent.innerHTML = successHtml;

      resultActions.innerHTML =
        '<button id="btn-next" class="btn-success" style="width:100%;padding:1rem;font-size:1.1rem">🔄 Escanear Siguiente</button>';
      resultActions.classList.remove("hidden");
      document.getElementById("btn-next").onclick = resetAll;
    } catch (error) {
      console.error("❌ Error completar:", error);
      showToast("❌ " + error.message, "error");

      if (btn) {
        btn.disabled = false;
        btn.textContent = "✅ Marcar como Realizada";
      }
      isProcessing = false;
    }
  }

  // 🔄 Resetear TODO para nueva lectura
  function resetAll() {
    console.log("🔄 Reset completo");

    // Limpiar estado
    currentAppointmentId = null;
    currentAppointment = null;
    isProcessing = false;
    resultPanel.classList.add("hidden");
    resultActions.classList.add("hidden");

    // Si estamos en modo manual, limpiar input y enfocar
    if (currentMode === "manual") {
      manualIdInput.value = "";
      manualIdInput.focus();
      return;
    }

    // Si estamos en modo scan, reanudar cámara
    if (scannerStopped) {
      resumeScanner();
    }
  }

  // 🔄 Cambiar entre cámaras
  toggleCameraBtn.addEventListener("click", async function () {
    cameraFacingMode =
      cameraFacingMode === "environment" ? "user" : "environment";
    showToast(
      "🔄 Cámara: " +
        (cameraFacingMode === "environment" ? "Trasera" : "Frontal"),
    );

    if (currentMode === "scan" && !scannerStopped) {
      await initScanner();
    }
  });

  // 🔘 Toggle de modo: Escanear ↔ Manual
  function setMode(mode) {
    if (currentMode === mode) return;

    console.log("🔄 Cambiando a modo:", mode);
    currentMode = mode;

    // Actualizar botones de modo
    if (mode === "scan") {
      btnModeScan.classList.add("active");
      btnModeManual.classList.remove("active");
      headerSubtitle.textContent = "Apunta la cámara al QR del cliente";

      // Mostrar scanner, ocultar manual
      if (scannerContainer) scannerContainer.style.display = "block";
      if (manualContainer) manualContainer.classList.add("hidden");
      if (toggleCameraBtn) toggleCameraBtn.style.display = "flex";

      // Resetear y iniciar scanner
      scannerStopped = false;
      resultPanel.classList.add("hidden");
      resultActions.classList.add("hidden");
      initScanner();
    } else {
      btnModeScan.classList.remove("active");
      btnModeManual.classList.add("active");
      headerSubtitle.textContent = "Ingresa el código de la cita manualmente";

      // Ocultar scanner, mostrar manual
      if (scannerContainer) scannerContainer.style.display = "none";
      if (manualContainer) manualContainer.classList.remove("hidden");
      if (toggleCameraBtn) toggleCameraBtn.style.display = "none";

      // Detener scanner si está activo
      if (html5QrCode && html5QrCode.stop) {
        html5QrCode.stop().catch(function () {});
      }
      scannerStopped = true;

      // Resetear UI de resultados
      resultPanel.classList.add("hidden");
      resultActions.classList.add("hidden");

      // Enfocar input manual
      setTimeout(function () {
        manualIdInput.focus();
      }, 100);
    }
  }

  // Event listeners para toggle de modo
  btnModeScan.addEventListener("click", function () {
    setMode("scan");
  });
  btnModeManual.addEventListener("click", function () {
    setMode("manual");
  });

  // 🚀 Iniciar al cargar
  console.log("🚀 Iniciando página del barbero...");
  setMode("scan"); // Empezar en modo escanear por defecto

  // 🧹 Limpieza al salir
  window.addEventListener("beforeunload", function () {
    if (html5QrCode && html5QrCode.stop) {
      html5QrCode.stop().catch(function () {});
    }
  });
});
