/* ============================================================
   settings.js — Settings page logic
   ============================================================ */

/* ---- Load saved values into form ---- */
function loadSettings() {
  const s = DB.getSettings();
  document.getElementById('set-shop-name').value = s.shopName  || '';
  document.getElementById('set-address').value   = s.address   || '';
  document.getElementById('set-phone').value     = s.phone     || '';
  document.getElementById('set-taxid').value     = s.taxId     || '';
  document.getElementById('set-promptpay').value = s.promptpay || '';
  document.getElementById('set-footer').value    = s.footer    || '';
  document.getElementById('set-gemini-key').value = localStorage.getItem('gemini_api_key') || '';
  const shopId = (typeof Sync !== 'undefined') ? Sync.getShopId() : (localStorage.getItem('shop_id') || '');
  document.getElementById('set-shop-id').value = shopId;
  document.getElementById('set-firebase-config').value = localStorage.getItem('firebase_config') || '';

  const v = document.getElementById('about-version');
  if (v && typeof APP_VERSION !== 'undefined') v.textContent = APP_VERSION;
}

/* ---- Save all settings ---- */
function saveAllSettings() {
  const shopName = document.getElementById('set-shop-name').value.trim();
  if (!shopName) { showToast('กรุณาระบุชื่อร้าน', 'warning'); return; }

  DB.saveSettings({
    shopName,
    address:   document.getElementById('set-address').value.trim(),
    phone:     document.getElementById('set-phone').value.trim(),
    taxId:     document.getElementById('set-taxid').value.trim(),
    promptpay: document.getElementById('set-promptpay').value.trim(),
    footer:    document.getElementById('set-footer').value.trim(),
  });

  /* Gemini key */
  const geminiKey = document.getElementById('set-gemini-key').value.trim();
  localStorage.setItem('gemini_api_key', geminiKey);
  sessionStorage.removeItem('gemini_model');

  /* Shop ID */
  const shopId = document.getElementById('set-shop-id').value.trim();
  if (shopId) {
    if (typeof Sync !== 'undefined') Sync.setShopId(shopId);
    else localStorage.setItem('shop_id', shopId.toUpperCase());
  }

  /* Firebase config */
  const fbRaw = document.getElementById('set-firebase-config').value.trim();
  if (fbRaw) {
    try {
      JSON.parse(fbRaw);
      localStorage.setItem('firebase_config', fbRaw);
      if (typeof Sync !== 'undefined') Sync.init().then(() => updateSyncStatus());
    } catch {
      showToast('Firebase Config ไม่ใช่ JSON ที่ถูกต้อง', 'error');
      return;
    }
  }

  const bn = document.getElementById('brand-name');
  if (bn) bn.textContent = shopName;

  showToast('บันทึกการตั้งค่าเรียบร้อย ✓');
}

/* ---- Toggle password visibility ---- */
function toggleKeyVisibility(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    if (btn) btn.textContent = '🙈 ซ่อน';
  } else {
    inp.type = 'password';
    if (btn) btn.textContent = '👁️ แสดง';
  }
}

function toggleFbConfig() {
  const ta  = document.getElementById('set-firebase-config');
  const btn = document.getElementById('btn-eye-fb');
  if (!ta) return;
  const masked = ta.dataset.masked === '1';
  if (!masked) {
    ta.dataset.plaintext = ta.value;
    ta.value = ta.value ? '••••••••••••••••••••••••••' : '';
    ta.dataset.masked = '1';
    if (btn) btn.textContent = '👁️ แสดง';
  } else {
    ta.value = ta.dataset.plaintext || '';
    ta.dataset.masked = '0';
    if (btn) btn.textContent = '🙈 ซ่อน';
  }
}

/* ---- Test Gemini API key ---- */
async function testGeminiConnection() {
  const key    = document.getElementById('set-gemini-key').value.trim();
  const status = document.getElementById('gemini-test-status');
  if (!key) { showToast('ใส่ Gemini API Key ก่อน', 'warning'); return; }

  status.textContent = '⏳ กำลังทดสอบ…';
  status.style.color = 'var(--text-muted)';
  try {
    const res  = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    const models  = (data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent'));
    const bestName = (models.find(m => m.name.includes('flash')) || models[0])?.name?.replace('models/', '') || '?';
    status.textContent = `✅ พร้อมใช้งาน — model: ${bestName}`;
    status.style.color = 'var(--primary)';
  } catch (err) {
    status.textContent = `❌ ${err.message}`;
    status.style.color = 'var(--danger)';
  }
}

/* ---- Copy Shop ID ---- */
function copyShopId() {
  const el = document.getElementById('set-shop-id');
  const id = el ? el.value.trim() : '';
  if (!id) { showToast('ยังไม่มี Shop ID', 'warning'); return; }
  navigator.clipboard.writeText(id).then(() => showToast('คัดลอก Shop ID แล้ว'));
}

/* ---- Sync status indicator ---- */
function updateSyncStatus() {
  const dot  = document.getElementById('sync-dot-pg');
  const text = document.getElementById('sync-status-text');
  if (!dot || !text) return;

  if (typeof Sync !== 'undefined' && Sync.isActive()) {
    dot.setAttribute('data-s', 'synced');
    text.textContent = '✅ เชื่อมต่อ Firebase แล้ว — ซิงค์อัตโนมัติทุกการแก้ไข';
    text.style.color = 'var(--primary)';
  } else {
    dot.removeAttribute('data-s');
    const hasConfig = !!localStorage.getItem('firebase_config');
    text.textContent = hasConfig
      ? '⚠️ มี Config แล้วแต่ยังไม่ได้เชื่อมต่อ — เปิดจาก localhost หรือ Config ผิด'
      : 'ยังไม่ได้ตั้งค่า — ใส่ Firebase Config แล้วบันทึก';
    text.style.color = 'var(--text-muted)';
  }
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  const bn = document.getElementById('brand-name');
  if (bn) bn.textContent = DB.getSettings().shopName || 'ร้านขายของชำ';
  updateSyncStatus();
});
