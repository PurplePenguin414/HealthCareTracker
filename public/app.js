// ---- State ----
let currentType = 'therapy';
let currentView = 'upcoming';
let pendingAttachments = []; // files staged before appointment is saved
let editingApptId = null;

// ---- Type-specific field definitions ----
const TYPE_FIELDS = {
  therapy: [
    { key: 'topics_covered', label: 'Topics Covered', type: 'textarea' },
    { key: 'homework_assigned', label: 'Homework Assigned', type: 'textarea' },
    { key: 'target_memory', label: 'Target Memory', type: 'text' }
  ],
  dietitian: [
    { key: 'meal_plan_changes', label: 'Meal Plan Changes', type: 'textarea' },
    { key: 'goals_discussed', label: 'Goals Discussed', type: 'textarea' },
    { key: 'measurements', label: 'Measurements (optional)', type: 'text' }
  ],
  doctor: [
    { key: 'reason_for_visit', label: 'Reason for Visit', type: 'text' },
    { key: 'diagnosis_findings', label: 'Diagnosis / Findings', type: 'textarea' },
    { key: 'prescriptions_referrals', label: 'Prescriptions / Referrals', type: 'textarea' },
    { key: 'follow_up_needed', label: 'Follow-up Needed', type: 'text' }
  ],
  other: [] // rendered as dynamic custom fields instead
};

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
  initTheme();
  bindTopbar();
  bindTabs();
  bindViewToggle();
  bindApptModal();
  bindQuestionsModal();
  loadAppointments();
});

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.authenticated) window.location.href = '/login.html';
}

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('darkModeToggle').textContent = saved === 'dark' ? '☀️' : '🌙';
}

function bindTopbar() {
  document.getElementById('darkModeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    document.getElementById('darkModeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

// ---- Tabs ----
function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;

      const isTherapy = currentType === 'therapy';
      document.querySelectorAll('.therapy-only').forEach(el => {
        el.style.display = isTherapy ? '' : 'none';
      });
      if (!isTherapy && currentView === 'prep') switchView('upcoming');

      loadAppointments();
    });
  });
  // hide therapy-only elements by default state handled by tab click above
  document.querySelectorAll('.tab-btn')[0].click();
}

// ---- View toggle (Upcoming / History / Prep) ----
function bindViewToggle() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('upcomingView').hidden = view !== 'upcoming';
  document.getElementById('historyView').hidden = view !== 'history';
  document.getElementById('prepView').hidden = view !== 'prep';

  if (view === 'upcoming') loadAppointments();
  if (view === 'history') loadHistory();
  if (view === 'prep') loadPrepView();
}

// ---- Load & render appointment list ----
async function loadAppointments() {
  const res = await fetch(`/api/appointments?type=${currentType}&status=upcoming`);
  const appts = await res.json();
  renderApptList(appts, document.getElementById('appointmentList'));
}

async function loadHistory() {
  const res = await fetch(`/api/appointments/history/${currentType}?limit=10`);
  const appts = await res.json();
  renderApptList(appts, document.getElementById('historyList'));
}

function renderApptList(appts, container) {
  if (!appts.length) {
    container.innerHTML = '<div class="empty-state">No appointments yet.</div>';
    return;
  }
  container.innerHTML = appts.map(a => `
    <div class="appt-card" data-id="${a.id}">
      <div class="appt-card-top">
        <span class="appt-card-date">${formatDate(a.appointment_date)}${a.appointment_time ? ' · ' + formatTime(a.appointment_time) : ''}</span>
        <span class="appt-status status-${a.status}">${a.status}</span>
      </div>
      <div class="appt-card-provider">${escapeHtml(a.provider_name || 'No provider listed')}${a.location ? ' — ' + escapeHtml(a.location) : ''}</div>
    </div>
  `).join('');

  container.querySelectorAll('.appt-card').forEach(card => {
    card.addEventListener('click', () => openApptModal(card.dataset.id));
  });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(timeStr) {
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Appointment Modal ----
function bindApptModal() {
  document.getElementById('addApptBtn').addEventListener('click', () => openApptModal(null));
  document.getElementById('closeModalBtn').addEventListener('click', closeApptModal);
  document.getElementById('apptModal').addEventListener('click', (e) => {
    if (e.target.id === 'apptModal') closeApptModal();
  });
  document.getElementById('apptForm').addEventListener('submit', saveAppointment);
  document.getElementById('deleteApptBtn').addEventListener('click', deleteAppointment);
  document.getElementById('fileUpload').addEventListener('change', handleFileStaged);
}

async function openApptModal(id) {
  document.getElementById('questionsModal').hidden = true;

  editingApptId = id;
  pendingAttachments = [];
  const form = document.getElementById('apptForm');
  form.reset();
  document.getElementById('apptType').value = currentType;
  document.getElementById('deleteApptBtn').hidden = !id;
  document.getElementById('attachmentList').innerHTML = '';

  renderTypeFields(currentType, {});

  if (id) {
    const res = await fetch(`/api/appointments/${id}`);
    const appt = await res.json();
    document.getElementById('modalTitle').textContent = 'Edit Appointment';
    document.getElementById('apptId').value = appt.id;
    document.getElementById('providerName').value = appt.provider_name || '';
    document.getElementById('apptStatus').value = appt.status;
    document.getElementById('apptDate').value = appt.appointment_date;
    document.getElementById('apptTime').value = appt.appointment_time || '';
    document.getElementById('apptLocation').value = appt.location || '';
    document.getElementById('apptNotes').value = appt.notes || '';
    document.getElementById('reminderEnabled').checked = !!appt.reminder_enabled;

    renderTypeFields(appt.type, appt.details, appt.customFields);
    renderExistingAttachments(appt.attachments);
  } else {
    document.getElementById('modalTitle').textContent = 'New Appointment';
    document.getElementById('apptId').value = '';
    document.getElementById('reminderEnabled').checked = true;
  }

  document.getElementById('apptModal').hidden = false;
}

function closeApptModal() {
  document.getElementById('apptModal').hidden = true;
}

function renderTypeFields(type, details = {}, customFields = []) {
  const container = document.getElementById('typeSpecificFields');
  if (type === 'other') {
    container.innerHTML = `
      <label style="display:block;font-size:0.85rem;color:var(--text-muted);margin-bottom:0.4rem;">Custom Fields</label>
      <div id="customFieldsContainer"></div>
      <button type="button" class="add-field-btn" id="addCustomFieldBtn">+ Add Field</button>
    `;
    const cfContainer = document.getElementById('customFieldsContainer');
    const fields = customFields && customFields.length ? customFields : [];
    fields.forEach(f => addCustomFieldRow(cfContainer, f.field_label, f.field_value));
    document.getElementById('addCustomFieldBtn').addEventListener('click', () => addCustomFieldRow(cfContainer, '', ''));
    return;
  }

  const fields = TYPE_FIELDS[type] || [];
  container.innerHTML = fields.map(f => `
    <div class="form-group">
      <label for="field_${f.key}">${f.label}</label>
      ${f.type === 'textarea'
        ? `<textarea id="field_${f.key}" rows="2">${escapeHtml(details[f.key] || '')}</textarea>`
        : `<input type="text" id="field_${f.key}" value="${escapeHtml(details[f.key] || '')}">`}
    </div>
  `).join('');
}

function addCustomFieldRow(container, label, value) {
  const row = document.createElement('div');
  row.className = 'custom-field-row';
  row.innerHTML = `
    <input type="text" placeholder="Field name" class="cf-label" value="${escapeHtml(label || '')}">
    <input type="text" placeholder="Value" class="cf-value" value="${escapeHtml(value || '')}">
    <button type="button" class="remove-field-btn">&times;</button>
  `;
  row.querySelector('.remove-field-btn').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function renderExistingAttachments(attachments) {
  const list = document.getElementById('attachmentList');
  list.innerHTML = (attachments || []).map(a => `
    <div class="attachment-item" data-id="${a.id}">
      <a href="/api/attachments/file/${a.id}" target="_blank">${escapeHtml(a.original_name)}</a>
      <button type="button" class="attachment-remove" data-id="${a.id}">Remove</button>
    </div>
  `).join('');
  list.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/attachments/${btn.dataset.id}`, { method: 'DELETE' });
      btn.closest('.attachment-item').remove();
    });
  });
}

function handleFileStaged(e) {
  const file = e.target.files[0];
  if (file) pendingAttachments.push(file);
}

async function saveAppointment(e) {
  e.preventDefault();
  const type = document.getElementById('apptType').value;
  const id = document.getElementById('apptId').value;

  const payload = {
    type,
    provider_name: document.getElementById('providerName').value,
    status: document.getElementById('apptStatus').value,
    appointment_date: document.getElementById('apptDate').value,
    appointment_time: document.getElementById('apptTime').value,
    location: document.getElementById('apptLocation').value,
    notes: document.getElementById('apptNotes').value,
    reminder_enabled: document.getElementById('reminderEnabled').checked
  };

  if (type === 'other') {
    const rows = document.querySelectorAll('#customFieldsContainer .custom-field-row');
    payload.customFields = Array.from(rows).map(row => ({
      field_label: row.querySelector('.cf-label').value,
      field_value: row.querySelector('.cf-value').value
    })).filter(f => f.field_label.trim());
  } else {
    const fields = TYPE_FIELDS[type] || [];
    payload.details = {};
    fields.forEach(f => {
      const el = document.getElementById(`field_${f.key}`);
      if (el) payload.details[f.key] = el.value;
    });
  }

  let apptId = id;
  if (id) {
    await fetch(`/api/appointments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const created = await res.json();
    apptId = created.id;
  }

  // Upload any staged attachments
  for (const file of pendingAttachments) {
    const formData = new FormData();
    formData.append('file', file);
    await fetch(`/api/attachments/${apptId}`, { method: 'POST', body: formData });
  }
  pendingAttachments = [];

  closeApptModal();
  if (currentView === 'upcoming') loadAppointments();
  else if (currentView === 'history') loadHistory();
}

async function deleteAppointment() {
  const id = document.getElementById('apptId').value;
  if (!id) return;
  if (!confirm('Delete this appointment? This cannot be undone.')) return;
  await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
  closeApptModal();
  if (currentView === 'upcoming') loadAppointments();
  else if (currentView === 'history') loadHistory();
}

// ---- Prep Checklist (Therapy only) ----
async function loadPrepView() {
  const res = await fetch('/api/appointments?type=therapy&status=upcoming');
  const appts = await res.json();
  const select = document.getElementById('prepApptSelect');

  if (!appts.length) {
    select.innerHTML = '<option value="">No upcoming therapy appointments</option>';
    document.getElementById('prepChecklist').innerHTML = '';
    return;
  }

  select.innerHTML = appts.map(a =>
    `<option value="${a.id}">${formatDate(a.appointment_date)}${a.provider_name ? ' — ' + escapeHtml(a.provider_name) : ''}</option>`
  ).join('');

  select.onchange = () => renderPrepChecklist(select.value);
  renderPrepChecklist(select.value);
}

async function renderPrepChecklist(apptId) {
  const container = document.getElementById('prepChecklist');
  if (!apptId) { container.innerHTML = ''; return; }

  const res = await fetch(`/api/appointments/${apptId}`);
  const appt = await res.json();

  if (!appt.questionChecks.length) {
    container.innerHTML = '<div class="empty-state">No questions in your bank yet. Add some via "Manage Questions".</div>';
    return;
  }

  container.innerHTML = appt.questionChecks.map(q => `
    <label class="prep-item">
      <input type="checkbox" data-question-id="${q.question_id}" ${q.checked ? 'checked' : ''}>
      <span>${escapeHtml(q.question_text)}</span>
    </label>
  `).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const checks = {};
      checks[cb.dataset.questionId] = cb.checked;
      await fetch(`/api/appointments/${apptId}/question-checks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checks)
      });
    });
  });
}

// ---- Manage Questions Modal ----
function bindQuestionsModal() {
  document.getElementById('manageQuestionsBtn').addEventListener('click', openQuestionsModal);
  document.getElementById('closeQuestionsModalBtn').addEventListener('click', () => {
    document.getElementById('questionsModal').hidden = true;
    loadPrepView(); // refresh in case questions changed
  });
  document.getElementById('questionsModal').addEventListener('click', (e) => {
    if (e.target.id === 'questionsModal') {
      document.getElementById('questionsModal').hidden = true;
      loadPrepView();
    }
  });
  document.getElementById('addQuestionForm').addEventListener('submit', addQuestion);
}

async function openQuestionsModal() {
  document.getElementById('apptModal').hidden = true;

  document.getElementById('questionsModal').hidden = false;
  await renderQuestionBank();
}

async function renderQuestionBank() {
  const res = await fetch('/api/questions');
  const questions = await res.json();
  const list = document.getElementById('questionBankList');

  if (!questions.length) {
    list.innerHTML = '<div class="empty-state">No questions yet — add your first one above.</div>';
    return;
  }

  list.innerHTML = questions.map(q => `
    <div class="question-bank-item" data-id="${q.id}">
      <span>${escapeHtml(q.question_text)}</span>
      <button type="button" class="attachment-remove" data-id="${q.id}">Remove</button>
    </div>
  `).join('');

  list.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/questions/${btn.dataset.id}`, { method: 'DELETE' });
      renderQuestionBank();
    });
  });
}

async function addQuestion(e) {
  e.preventDefault();
  const input = document.getElementById('newQuestionText');
  if (!input.value.trim()) return;
  await fetch('/api/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_text: input.value.trim() })
  });
  input.value = '';
  renderQuestionBank();
}
