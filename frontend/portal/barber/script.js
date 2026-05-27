document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('portal_user'));
  const token = localStorage.getItem('portal_token');
  
  if (!user || !token || user.role !== 'barber') { window.location.href = '../index.html'; return; }
  
  document.getElementById('user-name').textContent = user.name;
  
  // Cargar sucursal si tiene branch_id
  if (user.branch_id) {
    try {
      const res = await fetch('/api/branches', { headers: { 'Authorization': `Bearer ${token}` }});
      const { data: branches } = await res.json();
      const branch = branches?.find(b => b.id === user.branch_id);
      if (branch) document.getElementById('user-branch').textContent = `📍 ${branch.name}`;
    } catch (e) { console.warn('⚠️ No se pudo cargar sucursal'); }
  }
  
  loadShiftStats(user.id, user.branch_id, token);
  initQRScanner(onQrScan);
  
  document.getElementById('search-btn').addEventListener('click', searchAppointmentManual);
  document.getElementById('complete-btn').addEventListener('click', () => completeAppointment(token));
  document.getElementById('cancel-scan-btn').addEventListener('click', resetScan);
  document.getElementById('logout-btn').addEventListener('click', logout);
  loadRecentAppointments(user.id, token);
});

async function loadShiftStats(barberId, branchId, token) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`/api/barber/appointments/today?barber_id=${barberId}&branch_id=${branchId||''}`, { headers: { 'Authorization': `Bearer ${token}` }});
    const { data: appointments } = await res.json();
    document.getElementById('today-count').textContent = appointments?.length || 0;
    // Calcular total (simplificado)
    const total = appointments?.reduce((sum, a) => sum + (a.services?.[0]?.price || 0), 0) || 0;
    document.getElementById('today-total').textContent = `$${total.toFixed(2)}`;
  } catch (e) { console.warn('⚠️ No se pudieron cargar estadísticas'); }
}

function initQRScanner(onScan) {
  const html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 }},
    (decodedText) => { html5QrCode.stop().then(() => onScan(decodedText)).catch(() => onScan(decodedText)); },
    () => {}
  ).catch(err => {
    console.error('❌ Error scanner:', err);
    document.getElementById('qr-reader').innerHTML = '<p class="error">⚠️ No se pudo acceder a la cámara. Usa el código manual.</p>';
  });
}

async function onQrScan(decodedText) {
  const aptId = extractAppointmentId(decodedText);
  if (!aptId) { alert('❌ Código QR no válido'); resetScan(); return; }
  await fetchAppointmentDetails(aptId);
}

function extractAppointmentId(content) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(content)) return content;
  const urlMatch = content.match(/[?&]id=([0-9a-f-]+)/i);
  if (urlMatch) return urlMatch[1];
  const codeMatch = content.match(/Código:\s*`?([0-9a-f]{8})/i);
  if (codeMatch) return `%${codeMatch[1]}%`;
  return null;
}

async function searchAppointmentManual() {
  const code = document.getElementById('manual-code').value.trim();
  if (!code) { alert('Ingresa un código de cita'); return; }
  const aptId = code.length === 8 ? `%${code}%` : code;
  await fetchAppointmentDetails(aptId, true);
}

async function fetchAppointmentDetails(aptId, isPartial = false) {
  const token = localStorage.getItem('portal_token');
  try {
    const url = isPartial ? `/api/appointments?search=${encodeURIComponent(aptId)}&limit=1` : `/api/appointments/${aptId}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }});
    const data = await res.json();
    if (!res.ok || !data.appointment) throw new Error('Cita no encontrada');
    const apt = data.appointment;
    if (apt.status === 'completed') { alert('⚠️ Esta cita ya está completada'); resetScan(); return; }
    
    document.getElementById('apt-name').textContent = apt.name;
    document.getElementById('apt-date').textContent = apt.appointment_date;
    document.getElementById('apt-time').textContent = apt.appointment_time;
    document.getElementById('apt-branch').textContent = apt.branches?.name || 'Sin asignar';
    document.getElementById('complete-btn').dataset.aptId = apt.id;
    document.getElementById('scan-result').style.display = 'block';
    document.getElementById('scan-result').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error('❌ Error:', err.message);
    alert(`❌ ${err.message}`);
    resetScan();
  }
}

async function completeAppointment(token) {
  const aptId = document.getElementById('complete-btn').dataset.aptId;
  if (!aptId) { alert('❌ No hay cita seleccionada'); return; }
  try {
    const response = await fetch(`/api/appointments/${aptId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ notes: 'Completada desde portal' })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Error al completar');
    alert('✅ Cita marcada como realizada');
    loadShiftStats(JSON.parse(localStorage.getItem('portal_user')).id, null, token);
    loadRecentAppointments(JSON.parse(localStorage.getItem('portal_user')).id, token);
    resetScan();
  } catch (err) {
    console.error('❌ Error:', err.message);
    alert(`❌ ${err.message}`);
  }
}

function resetScan() {
  document.getElementById('scan-result').style.display = 'none';
  document.getElementById('manual-code').value = '';
  document.getElementById('qr-reader').innerHTML = '';
  setTimeout(() => initQRScanner(onQrScan), 500);
}

async function loadRecentAppointments(barberId, token) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(`/api/appointments?barber_id=${barberId}&date=${today}&status=completed`, { headers: { 'Authorization': `Bearer ${token}` }});
    const { data: appointments } = await res.json();
    const list = document.getElementById('recent-list');
    if (!appointments?.length) { list.innerHTML = '<p class="text-muted">Sin citas completadas hoy</p>'; return; }
    list.innerHTML = appointments.map(apt => `<div class="recent-item"><strong>${apt.name}</strong><small>${apt.appointment_time} • ${apt.services?.[0]?.name || 'Servicio'}</small></div>`).join('');
  } catch (e) { console.warn('⚠️ No se pudo cargar historial'); }
}

function logout() {
  localStorage.removeItem('portal_token');
  localStorage.removeItem('portal_user');
  window.location.href = '../index.html';
}