document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('portal_user'));
  const token = localStorage.getItem('portal_token');
  if (!user || !token || user.role !== 'admin') { window.location.href = '../index.html'; return; }
  
  document.getElementById('admin-name').textContent = `👋 ${user.name}`;
  await loadUsers(token);
  await loadBranchesForSelect(token);
  
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('new-user-btn').addEventListener('click', () => showUserForm());
  document.getElementById('cancel-form').addEventListener('click', hideUserForm);
  document.getElementById('form-role').addEventListener('change', toggleBarberFields);
  document.getElementById('user-form').addEventListener('submit', (e) => handleUserSubmit(e, token));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab)));
});

async function loadUsers(token) {
  try {
    const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` }});
    const { data: users } = await res.json();
    const tbody = document.getElementById('users-table-body');
    if (!users?.length) { tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay usuarios</td></tr>'; return; }
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.name}</strong></td><td>${u.email}</td>
        <td><span class="badge badge-${u.role}">${u.role==='admin'?'👨‍💼 Admin':'✂️ Barbero'}</span></td>
        <td>${u.branch_name||'—'}</td>
        <td><span class="badge badge-${u.is_active?'success':'danger'}">${u.is_active?'✅ Activo':'❌ Inactivo'}</span></td>
        <td>
          <button class="btn-sm btn-edit" onclick="editUser('${u.id}')">✏️</button>
          <button class="btn-sm btn-${u.is_active?'danger':'success'}" onclick="toggleUserStatus('${u.id}',${!u.is_active})">${u.is_active?'🔒 Desactivar':'🔓 Activar'}</button>
        </td>
      </tr>
    `).join('');
  } catch (err) { document.getElementById('users-table-body').innerHTML = '<tr><td colspan="6" class="error">Error cargando usuarios</td></tr>'; }
}

async function loadBranchesForSelect(token) {
  try {
    const res = await fetch('/api/branches', { headers: { 'Authorization': `Bearer ${token}` }});
    const { data: branches } = await res.json();
    const select = document.getElementById('form-branch');
    select.innerHTML = '<option value="">Sin asignar</option>' + branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  } catch (e) { console.warn('⚠️ No se cargaron sucursales'); }
}

function showUserForm(userData = null) {
  const modal = document.getElementById('user-form-modal');
  const form = document.getElementById('user-form');
  const title = document.getElementById('form-title');
  if (userData) {
    title.textContent = '✏️ Editar Usuario';
    document.getElementById('edit-user-id').value = userData.id;
    document.getElementById('form-name').value = userData.name;
    document.getElementById('form-email').value = userData.email;
    document.getElementById('form-password').value = '';
    document.getElementById('form-role').value = userData.role;
    document.getElementById('form-specialty').value = userData.specialty || '';
    document.getElementById('form-branch').value = userData.branch_id || '';
  } else {
    title.textContent = '➕ Nuevo Usuario';
    form.reset();
    document.getElementById('edit-user-id').value = '';
  }
  toggleBarberFields();
  modal.style.display = 'flex';
}
function hideUserForm() { document.getElementById('user-form-modal').style.display = 'none'; }
function toggleBarberFields() {
  const role = document.getElementById('form-role').value;
  document.getElementById('barber-fields').style.display = role === 'barber' ? 'flex' : 'none';
}

async function handleUserSubmit(e, token) {
  e.preventDefault();
  const isEdit = !!document.getElementById('edit-user-id').value;
  const url = isEdit ? `/api/admin/users/${document.getElementById('edit-user-id').value}` : '/api/admin/users';
  const method = isEdit ? 'PATCH' : 'POST';
  const payload = {
    name: document.getElementById('form-name').value.trim(),
    email: document.getElementById('form-email').value.trim(),
    role: document.getElementById('form-role').value,
    specialty: document.getElementById('form-specialty').value.trim() || null,
    branch_id: document.getElementById('form-branch').value || null
  };
  const password = document.getElementById('form-password').value;
  if (password) payload.password = password;
  
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Error guardando');
    alert(`✅ Usuario ${isEdit?'actualizado':'creado'}`);
    hideUserForm();
    await loadUsers(token);
  } catch (err) { alert(`❌ ${err.message}`); }
}

// Funciones globales para onclick
window.editUser = async (userId) => {
  const token = localStorage.getItem('portal_token');
  const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` }});
  const { data: users } = await res.json();
  const user = users.find(u => u.id === userId);
  if (user) showUserForm(user);
};
window.toggleUserStatus = async (userId, newStatus) => {
  if (!confirm(`¿${newStatus?'Activar':'Desactivar'} este usuario?`)) return;
  const token = localStorage.getItem('portal_token');
  try {
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ is_active: newStatus }) });
    if (!res.ok) throw new Error('Error actualizando');
    await loadUsers(token);
    alert(`✅ Usuario ${newStatus?'activado':'desactivado'}`);
  } catch (err) { alert(`❌ ${err.message}`); }
};
function logout() { localStorage.removeItem('portal_token'); localStorage.removeItem('portal_user'); window.location.href = '../index.html'; }
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');
}