document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("booking-form");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const statusMsg = document.getElementById("status-message");
  const loading = document.getElementById("loading");
  const submitBtn = document.getElementById("submit-btn");

  const phoneInput = document.getElementById("phone");
  const phonePrefix = document.getElementById("phone-prefix");
  const countryRadios = document.querySelectorAll('input[name="country"]');

  const branchSelect = document.getElementById("branch");

  // 🔽 Cargar sucursales desde API
  // 🔽 Cargar sucursales desde API y poblar el select
  async function loadBranches() {
    const branchSelect = document.getElementById("branch");
    const branchError = document.getElementById("branch-error");

    try {
      console.log("🌐 Cargando sucursales desde /api/branches...");

      const res = await fetch("/api/branches");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      console.log("📦 Respuesta branches:", json);

      if (!json.success || !json.branches?.length) {
        throw new Error("No se encontraron sucursales disponibles");
      }

      // Limpiar y habilitar select
      branchSelect.innerHTML =
        '<option value="">Selecciona una sucursal</option>';
      branchSelect.disabled = false;

      // Poblar opciones con datos reales de Supabase
      json.branches.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.id; // 👈 UUID real de Supabase
        opt.textContent = `🏢 ${b.name}${b.address ? " - " + b.address : ""}`;
        branchSelect.appendChild(opt);
      });

      console.log(`✅ Sucursales cargadas: ${json.branches.length}`);
    } catch (err) {
      console.error("❌ Error cargando sucursales:", err.message);

      // Mostrar error al usuario
      branchSelect.innerHTML = '<option value="">Error al cargar</option>';
      branchSelect.disabled = true;

      if (branchError) {
        branchError.textContent =
          "⚠️ No se pudieron cargar las sucursales. Recarga la página.";
        branchError.style.display = "block";
      }
    }
  }

  loadBranches(); // Cargar al iniciar

  // 🌍 Cambiar prefijo según país
  countryRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.value === "mx") {
        phonePrefix.textContent = "+521";
        phoneInput.placeholder = "5512345678";
        phoneInput.maxLength = 10;
      } else {
        phonePrefix.textContent = "+1";
        phoneInput.placeholder = "2135551234";
        phoneInput.maxLength = 10;
      }
      phoneInput.focus();
    });
  });

  // 🔒 Solo permitir números en el teléfono
  phoneInput.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "");
  });

  // 📅 Configurar fecha mínima (hoy)
  const today = new Date().toISOString().split("T")[0];
  dateInput.min = today;
  dateInput.value = today;

  timeInput.addEventListener("change", validateTime);
  timeInput.addEventListener("input", validateTime);

  function validateTime() {
    const value = timeInput.value;
    if (!value) return;
    const [h, m] = value.split(":").map(Number);
    const totalMin = h * 60 + m;
    if (totalMin < 600 || totalMin > 1080) {
      timeInput.setCustomValidity("Horario válido: 10:00 AM - 6:00 PM");
      timeInput.reportValidity();
    } else {
      timeInput.setCustomValidity("");
    }
  }

  // 📤 Enviar formulario
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setLoading(true);
    clearMessage();

    // 🔑 Concatenar prefijo + número limpio
    const fullPhone = phonePrefix.textContent + phoneInput.value.trim();
    const branchSelect = document.getElementById("branch");

    // 🔑 Validar que se seleccionó una sucursal válida
    if (!branchSelect.value || branchSelect.disabled) {
      showMessage("❌ Por favor selecciona una sucursal válida", "error");
      if (branchSelect.disabled) {
        branchSelect.focus();
      }
      return; // ⚠️ Detener envío
    }

    const formData = {
      name: document.getElementById("name").value.trim(),
      phone: fullPhone,
      date: document.getElementById("date").value,
      time: document.getElementById("time").value,
      branch_id: branchSelect.value, // 👈 Incluir branch_id
    };

    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error desconocido");

      showMessage(
        "✅ ¡Cita agendada! Revisa tu WhatsApp para la confirmación con QR.",
        "success",
      );
      form.reset();
      branchSelect.value = ""; // 👈 Resetear selector de sucursal
      dateInput.value = today;
      // Restaurar prefijo MX por defecto
      phonePrefix.textContent = "+521";
      phoneInput.placeholder = "5512345678";
      document.querySelector('input[name="country"][value="mx"]').checked =
        true;
    } catch (error) {
      console.error("❌ Error:", error);
      showMessage(`❌ ${error.message}. Intenta de nuevo.`, "error");
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    loading.classList.toggle("hidden", !isLoading);
    form.classList.toggle("hidden", isLoading);
  }

  function showMessage(text, type) {
    statusMsg.textContent = text;
    statusMsg.className = `message show ${type}`;
    if (type === "success")
      setTimeout(() => statusMsg.classList.remove("show"), 8000);
  }

  function clearMessage() {
    statusMsg.textContent = "";
    statusMsg.className = "message";
  }
});
