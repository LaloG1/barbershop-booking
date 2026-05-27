document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');

  // Verificar sesión existente al cargar
  checkExistingSession();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    if (!email || !password) { showError('Completa todos los campos'); return; }
    
    setLoading(true); clearError();
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Error de autenticación');
      
      // Guardar sesión
      localStorage.setItem('portal_token', data.token);
      localStorage.setItem('portal_user', JSON.stringify(data.user));
      
      // Redirigir por rol
      if (data.user.role === 'admin') {
        window.location.href = 'admin/dashboard.html';
      } else if (data.user.role === 'barber') {
        window.location.href = 'barber/scan.html';
      } else {
        throw new Error('Rol no reconocido: ' + data.user.role);
      }
    } catch (err) {
      console.error('❌ Login error:', err.message);
      showError(err.message);
    } finally {
      setLoading(false);
    }
  });

  function checkExistingSession() {
    const token = localStorage.getItem('portal_token');
    const userStr = localStorage.getItem('portal_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user.role === 'admin') window.location.href = 'admin/dashboard.html';
        else if (user.role === 'barber') window.location.href = 'barber/scan.html';
      } catch (e) {
        localStorage.removeItem('portal_token');
        localStorage.removeItem('portal_user');
      }
    }
  }

  function showError(msg) { errorMsg.textContent = `❌ ${msg}`; errorMsg.style.display = 'block'; }
  function clearError() { errorMsg.style.display = 'none'; errorMsg.textContent = ''; }
  function setLoading(loading) {
    loginBtn.disabled = loading;
    loginBtn.textContent = loading ? '⏳ Verificando...' : '🔐 Iniciar Sesión';
  }
});