// portal/admin/script.js - Versión AdminLTE

document.addEventListener('DOMContentLoaded', async () => {
  // 🔐 Verificar sesión de admin
  const user = JSON.parse(localStorage.getItem('portal_user'));
  const token = localStorage.getItem('portal_token');
  
  if (!user || !token || user.role !== 'admin') {
    window.location.href = '../index.html';
    return;
  }
  
  // Mostrar info del admin
  document.getElementById('admin-name').textContent = user.name;
  document.getElementById('admin-email').textContent = user.email;
  
  // Inicializar datos
  await loadDashboardStats(token);
  await loadUsers(token);
  await loadBranchesForSelect(token);
  
  // Event Listeners
  setupEventListeners(token);
  
  // Inicializar AdminLTE plugins (si es necesario)
  if ($().tooltip) {
    $('[data-toggle="tooltip"]').tooltip();
  }
});

// 📊 Cargar estadísticas del dashboard
async function loadDashboardStats(token) {
  try {
    // Cargar usuarios totales
    const usersRes = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { data: users } = await usersRes.json();
    document.getElementById('stat-users').textContent = users?.length || 0;
    
    // Cargar sucursales activas
    const branchesRes = await fetch('/api/branches');
    const { data: branches } = await branchesRes.json();
    document.getElementById('stat-branches').textContent = branches?.filter(b => b.is_active).length || 0;
    
    // Cargar citas de hoy (simplificado)
    const today = new Date().toISOString().split('T')[0];
    const appointmentsRes = await fetch(`/api/appointments?date=${today}`);
    const { data: appointments } = await appointmentsRes.json();
    document.getElementById('stat-appointments').textContent = appointments?.length || 0;
    
    // Calcular ingresos estimados (simplificado)
    const totalRevenue = (appointments?.length || 0) * 250; // Precio promedio estimado
    document.getElementById('stat-revenue').textContent = `$${totalRevenue.toLocaleString()}`;
    
  } catch (err) {
    console.warn('⚠️ No se pudieron cargar estadísticas:', err.message);
  }
}

// 👥 Cargar lista de usuarios en tabla
async function loadUsers(token) {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { data: users } = await res.json();
    
    const tbody = document.getElementById('users-table-body');
    
    if (!users?.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No hay usuarios registrados</td></tr>';
      return;
    }
    
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>
          <div class="d-flex align-items-center">
            <div class="avatar-sm bg-secondary rounded-circle d-flex align-items-center justify-content-center mr-2" style="width:32px;height:32px;">
              <small class="text-white font-weight-bold">${u.name.charAt(0).toUpperCase()}</small>
            </div>
            <strong>${u.name}</strong>
          </div>
        </td>
        <td><small class="text-muted">${u.email}</small></td>
        <td>
          <span class="badge badge-${u.role === 'admin' ? 'admin' : 'barber'}">
            ${u.role === 'admin' ? '👨‍💼 Admin' : '✂️ Barbero'}
          </span>
        </td>
        <td>${u.branch_name || '<span class="text-muted">—</span>'}</td>
        <td>
          <span class="badge badge-${u.is_active ? 'success' : 'danger'}">
            ${u.is_active ? '✅ Activo' : '❌ Inactivo'}
          </span>
        </td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary btn-edit" data-id="${u.id}" title="Editar">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-outline-${u.is_active ? 'danger' : 'success'} btn-toggle-status" 
                    data-id="${u.id}" 
                    data-active="${u.is_active}" 
                    title="${u.is_active ? 'Desactivar' : 'Activar'}">
              <i class="fas fa-${u.is_active ? 'lock' : 'unlock'}"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
    
    // Agregar event listeners a botones dinámicos
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => editUser(e.target.closest('button').dataset.id, token));
    });
    
    document.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        toggleUserStatus(b.dataset.id, b.dataset.active === 'true', token);
      });
    });
    
  } catch (err) {
    console.error('❌ Error cargando usuarios:', err.message);
    document.getElementById('users-table-body').innerHTML = 
      '<tr><td colspan="6" class="text-center text-danger py-4">Error cargando usuarios</td></tr>';
  }
}

// 📍 Cargar sucursales para el select del formulario
async function loadBranchesForSelect(token) {
  try {
    const res = await fetch('/api/branches', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { data: branches } = await res.json();
    
    const select = document.getElementById('form-branch');
    select.innerHTML = '<option value="">Sin asignar</option>' + 
      branches.map(b => `<option value="${b.id}">${b.name}${b.address ? ' - ' + b.address : ''}</option>`).join('');
      
  } catch (e) {
    console.warn('⚠️ No se pudieron cargar sucursales para el formulario');
  }
}

// 🎛️ Configurar todos los event listeners
function setupEventListeners(token) {
  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);
  
  // Sidebar navigation - cambiar tabs
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.dataset.tab);
      
      // Actualizar estado activo en sidebar
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
  
  // Stats cards que navegan a tabs
  document.querySelectorAll('.small-box-footer[data-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.dataset.tab);
      
      // Actualizar sidebar
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      document.querySelector(`.nav-link[data-tab="${link.dataset.tab}"]`)?.classList.add('active');
    });
  });
  
  // Modal: Nuevo usuario
  document.getElementById('new-user-btn').addEventListener('click', () => showUserForm(null, token));
  
  // Modal: Cancelar
  document.getElementById('cancel-form').addEventListener('click', () => {
    $('#userModal').modal('hide');
  });
  
  // Mostrar/ocultar campos de barbero según rol
  document.getElementById('form-role').addEventListener('change', toggleBarberFields);
  
  // Formulario de usuario: submit
  document.getElementById('user-form').addEventListener('submit', (e) => handleUserSubmit(e, token));
  
  // Cerrar modal al hacer submit exitoso (AdminLTE)
  $('#userModal').on('hidden.bs.modal', function () {
    document.getElementById('user-form').reset();
    document.getElementById('edit-user-id').value = '';
    toggleBarberFields();
  });
}

// 🔄 Cambiar entre tabs de contenido
function switchTab(tabName) {
  // Ocultar todos los tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.style.display = 'none';
  });
  
  // Mostrar el tab seleccionado
  const selectedTab = document.getElementById(`tab-${tabName}`);
  if (selectedTab) {
    selectedTab.style.display = 'block';
  }
  
  // Actualizar título y breadcrumb
  const titles = {
    'dashboard': '📊 Dashboard',
    'users': '👥 Gestionar Usuarios',
    'branches': '📍 Sucursales',
    'services': '✂️ Servicios',
    'reports': '📊 Reportes'
  };
  
  document.getElementById('page-title').textContent = titles[tabName] || 'Dashboard';
  document.getElementById('breadcrumb-active').textContent = titles[tabName]?.replace(/^[^\s]+\s/, '') || 'Dashboard';
  
  // Cargar datos específicos si es necesario
  if (tabName === 'users') {
    const token = localStorage.getItem('portal_token');
    loadUsers(token);
  }
}

// ➕ Mostrar formulario modal (crear o editar)
function showUserForm(userData, token) {
  const modal = $('#userModal');
  const form = document.getElementById('user-form');
  const title = document.getElementById('form-title');
  
  if (userData) {
    // Modo edición
    title.textContent = '✏️ Editar Usuario';
    document.getElementById('edit-user-id').value = userData.id;
    document.getElementById('form-name').value = userData.name;
    document.getElementById('form-email').value = userData.email;
    document.getElementById('form-password').value = '';
    document.getElementById('form-role').value = userData.role;
    document.getElementById('form-specialty').value = userData.specialty || '';
    document.getElementById('form-branch').value = userData.branch_id || '';
  } else {
    // Modo creación
    title.textContent = '➕ Nuevo Usuario';
    form.reset();
    document.getElementById('edit-user-id').value = '';
  }
  
  toggleBarberFields();
  modal.modal('show');
}

// 🎭 Mostrar/ocultar campos específicos para barberos
function toggleBarberFields() {
  const role = document.getElementById('form-role').value;
  const barberFields = document.getElementById('barber-fields');
  barberFields.style.display = role === 'barber' ? 'block' : 'none';
}

// 💾 Manejar envío del formulario de usuario
async function handleUserSubmit(e, token) {
  e.preventDefault();
  
  const isEdit = !!document.getElementById('edit-user-id').value;
  const url = isEdit 
    ? `/api/admin/users/${document.getElementById('edit-user-id').value}`
    : '/api/admin/users';
    
  const method = isEdit ? 'PATCH' : 'POST';
  
  const payload = {
    name: document.getElementById('form-name').value.trim(),
    email: document.getElementById('form-email').value.trim(),
    role: document.getElementById('form-role').value,
    specialty: document.getElementById('form-specialty').value.trim() || null,
    branch_id: document.getElementById('form-branch').value || null
  };
  
  const password = document.getElementById('form-password').value;
  if (password) {
    payload.password = password;
  }
  
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    
    const result = await res.json();
    
    if (!res.ok) {
      throw new Error(result.error || 'Error guardando usuario');
    }
    
    // Mostrar notificación estilo AdminLTE
    alert(`✅ Usuario ${isEdit ? 'actualizado' : 'creado'} correctamente`);
    
    // Cerrar modal y recargar datos
    $('#userModal').modal('hide');
    await loadUsers(token);
    await loadDashboardStats(token);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    alert(`❌ ${err.message}`);
  }
}

// ✏️ Editar usuario (función global para botones dinámicos)
async function editUser(userId, token) {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { data: users } = await res.json();
    const user = users.find(u => u.id === userId);
    
    if (user) {
      showUserForm(user, token);
    } else {
      alert('❌ No se encontró el usuario');
    }
  } catch (e) {
    alert('❌ Error cargando datos del usuario');
  }
}

// 🔓/🔒 Activar o desactivar usuario
async function toggleUserStatus(userId, newStatus, token) {
  const action = newStatus ? 'activar' : 'desactivar';
  
  if (!confirm(`¿Estás seguro de que quieres ${action} este usuario?`)) return;
  
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ is_active: newStatus })
    });
    
    if (!res.ok) throw new Error('Error actualizando estado');
    
    // Recargar datos
    await loadUsers(token);
    await loadDashboardStats(token);
    
    // Notificación visual
    alert(`✅ Usuario ${newStatus ? 'activado' : 'desactivado'} correctamente`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    alert(`❌ Error: ${err.message}`);
  }
}

// 🚪 Cerrar sesión
function logout() {
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
  window.location.href = '../index.html';
}