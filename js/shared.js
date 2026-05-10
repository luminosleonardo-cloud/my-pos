/* ============================================================
   shared.js — functions shared across all pages
   (settings modal, shift management, clock, modal helpers)
   ============================================================ */

/* ---- Modal helpers (safe to redefine on every page) ---- */
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

/* ---- Clock ---- */
function _sharedUpdateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ---- Low stock badge on inventory sidebar link ---- */
function updateInventoryBadge() {
  const badge = document.getElementById('inv-badge');
  if (!badge) return;
  const products = DB.getProducts();
  const outCount = products.filter(p => p.quantity === 0).length;
  const lowCount = products.filter(p => p.quantity > 0 && p.quantity <= p.lowStockThreshold).length;
  const total = outCount + lowCount;
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
  const parts = [];
  if (outCount > 0) parts.push(`🔴 หมดสต็อก ${outCount} รายการ`);
  if (lowCount > 0) parts.push(`🟡 เหลือน้อย ${lowCount} รายการ`);
  badge.setAttribute('data-tooltip', parts.join('\n'));
}

/* ---- Shift UI indicator ---- */
function updateShiftUI() {
  const shift    = DB.getActiveShift();
  const indicator = document.getElementById('shift-indicator');
  const linkText  = document.getElementById('shift-link-text');
  if (shift) {
    const t = new Date(shift.openedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    if (indicator) indicator.style.background = 'var(--primary)';
    if (linkText)  linkText.textContent = `ปิดกะ (${t})`;
  } else {
    if (indicator) indicator.style.background = 'transparent';
    if (linkText)  linkText.textContent = 'เปิด/ปิดกะ';
  }
}

/* ---- Shop settings ---- */
function openSettingsModal() {
  const s = DB.getSettings();
  document.getElementById('set-shop-name').value = s.shopName  || '';
  document.getElementById('set-address').value   = s.address   || '';
  document.getElementById('set-phone').value     = s.phone     || '';
  document.getElementById('set-taxid').value     = s.taxId     || '';
  document.getElementById('set-promptpay').value = s.promptpay || '';
  document.getElementById('set-footer').value    = s.footer    || '';
  const geminiEl = document.getElementById('set-gemini-key');
  if (geminiEl) geminiEl.value = localStorage.getItem('gemini_api_key') || '';
  openModal('modal-settings');
}

function saveSettingsForm() {
  DB.saveSettings({
    shopName:  document.getElementById('set-shop-name').value.trim(),
    address:   document.getElementById('set-address').value.trim(),
    phone:     document.getElementById('set-phone').value.trim(),
    taxId:     document.getElementById('set-taxid').value.trim(),
    promptpay: document.getElementById('set-promptpay').value.trim(),
    footer:    document.getElementById('set-footer').value.trim(),
  });
  const geminiEl = document.getElementById('set-gemini-key');
  if (geminiEl) localStorage.setItem('gemini_api_key', geminiEl.value.trim());
  const bn = document.getElementById('brand-name');
  if (bn) bn.textContent = DB.getSettings().shopName || 'ร้านขายของชำ';
  closeModal('modal-settings');
  if (typeof showToast === 'function') showToast('บันทึกการตั้งค่าแล้ว');
}

/* ---- Shift management ---- */
function openShiftModal() {
  if (DB.getActiveShift()) {
    openCloseShiftModal();
  } else {
    document.getElementById('shift-start-cash').value = '';
    openModal('modal-shift-open');
  }
}

function confirmOpenShift() {
  const cash = parseFloat(document.getElementById('shift-start-cash').value) || 0;
  DB.openShift(cash);
  closeModal('modal-shift-open');
  updateShiftUI();
  if (typeof showToast === 'function') showToast('เปิดกะแล้ว — เงินเปิดกะ ฿' + Number(cash).toLocaleString('th-TH', { minimumFractionDigits: 2 }));
}

function openCloseShiftModal() {
  const shift = DB.getActiveShift();
  if (!shift) return;
  const openedAt   = new Date(shift.openedAt);
  const sales      = DB.getSales().filter(s => new Date(s.createdAt) >= openedAt);
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const txCount    = sales.length;
  const expected   = shift.startCash + totalSales;
  const fmt = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  document.getElementById('shift-close-opened').textContent    = openedAt.toLocaleString('th-TH');
  document.getElementById('shift-close-startcash').textContent = '฿' + fmt(shift.startCash);
  document.getElementById('shift-close-sales').textContent     = txCount + ' รายการ';
  document.getElementById('shift-close-total').textContent     = '฿' + fmt(totalSales);
  document.getElementById('shift-close-expected').textContent  = '฿' + fmt(expected);
  document.getElementById('shift-close-actual').value          = '';
  const discEl = document.getElementById('shift-close-discrepancy');
  discEl.textContent = '—';
  discEl.style.color = '';
  openModal('modal-shift-close');
}

function calcDiscrepancy() {
  const shift = DB.getActiveShift();
  if (!shift) return;
  const fmt = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  const sales      = DB.getSales().filter(s => new Date(s.createdAt) >= new Date(shift.openedAt));
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const expected   = shift.startCash + totalSales;
  const actual     = parseFloat(document.getElementById('shift-close-actual').value) || 0;
  const diff       = actual - expected;
  const el         = document.getElementById('shift-close-discrepancy');
  el.textContent   = (diff >= 0 ? '+' : '') + '฿' + fmt(Math.abs(diff));
  el.style.color   = diff === 0 ? 'var(--primary)' : diff > 0 ? 'var(--warning)' : 'var(--danger)';
}

function confirmCloseShift() {
  const actual = parseFloat(document.getElementById('shift-close-actual').value);
  if (isNaN(actual)) {
    if (typeof showToast === 'function') showToast('กรุณาระบุยอดเงินที่นับได้', 'warning');
    return;
  }
  const closed = DB.closeShift(actual);
  closeModal('modal-shift-close');
  updateShiftUI();
  if (typeof Printer !== 'undefined' && Printer.connected() && closed) {
    Printer.printShiftReport(closed).catch(() => {});
  }
  showShiftSummary(closed);
}

function showShiftSummary(shift) {
  if (!shift) return;
  const fmt = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
  const { startCash, openedAt, closedAt, actualCash, summary } = shift;
  const { totalSales, txCount, expectedCash, discrepancy } = summary;
  const diffColor = discrepancy === 0 ? 'var(--primary)' : discrepancy > 0 ? 'var(--warning)' : 'var(--danger)';
  document.getElementById('shift-summary-content').innerHTML = `
    <div class="shift-summary">
      <div class="ss-row"><span>เปิดกะ</span><span>${new Date(openedAt).toLocaleString('th-TH')}</span></div>
      <div class="ss-row"><span>ปิดกะ</span><span>${new Date(closedAt).toLocaleString('th-TH')}</span></div>
      <hr style="margin:8px 0;border-color:var(--border)">
      <div class="ss-row"><span>เงินเปิดกะ</span><span>฿${fmt(startCash)}</span></div>
      <div class="ss-row"><span>ยอดขาย (${txCount} รายการ)</span><span>฿${fmt(totalSales)}</span></div>
      <div class="ss-row ss-total"><span>เงินที่ควรมี</span><span>฿${fmt(expectedCash)}</span></div>
      <div class="ss-row"><span>เงินที่นับได้</span><span>฿${fmt(actualCash)}</span></div>
      <div class="ss-row" style="color:${diffColor};font-weight:700">
        <span>ส่วนต่าง</span>
        <span>${discrepancy >= 0 ? '+' : ''}฿${fmt(discrepancy)}</span>
      </div>
    </div>`;
  openModal('modal-shift-summary');
}

/* ---- Inject shared modals (skipped if already in the HTML) ---- */
function _injectSharedModals() {
  if (document.getElementById('modal-settings')) return; /* index.html already has them */

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <!-- ========== MODAL: Shop Settings ========== -->
  <div id="modal-settings" class="modal-backdrop">
    <div class="modal modal-wide">
      <div class="modal-header">
        <span class="modal-title">🏪 ตั้งค่าร้าน</span>
        <button class="modal-close" onclick="closeModal('modal-settings')">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">ชื่อร้าน *</label>
            <input id="set-shop-name" class="form-input" type="text" placeholder="เช่น ร้านขายของชำสมใจ">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">ที่อยู่</label>
          <input id="set-address" class="form-input" type="text" placeholder="เช่น 123 ถ.สุขุมวิท กรุงเทพ">
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">เบอร์โทรศัพท์</label>
            <input id="set-phone" class="form-input" type="tel" placeholder="0812345678">
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">เลขผู้เสียภาษี</label>
            <input id="set-taxid" class="form-input" type="text" placeholder="1234567890123">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">เบอร์ PromptPay</label>
          <input id="set-promptpay" class="form-input" type="tel" placeholder="0812345678 หรือเลขบัตร 13 หลัก">
          <p style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">ใช้แสดง QR สำหรับรับชำระเงิน</p>
        </div>
        <div class="form-group">
          <label class="form-label">ข้อความท้ายใบเสร็จ</label>
          <input id="set-footer" class="form-input" type="text" placeholder="ขอบคุณที่ใช้บริการ">
        </div>
        <hr style="margin:16px 0;border-color:var(--border)">
        <div class="form-group">
          <label class="form-label">🤖 Gemini API Key <span style="font-weight:400;color:var(--text-muted)">(สำหรับ AI วิเคราะห์ยอดขาย / สต็อก / บาร์โค้ด)</span></label>
          <input id="set-gemini-key" class="form-input" type="password" placeholder="AIza…" autocomplete="off">
          <p style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">รับ Key ฟรีได้ที่ <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--primary)">aistudio.google.com</a> — เก็บในเครื่องของคุณเท่านั้น</p>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between;align-items:center">
        <span style="font-size:0.72rem;color:var(--text-muted);opacity:0.6">${APP_VERSION}</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" onclick="closeModal('modal-settings')">ยกเลิก</button>
          <button class="btn btn-primary" onclick="saveSettingsForm()">💾 บันทึก</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ========== MODAL: Open Shift ========== -->
  <div id="modal-shift-open" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">⏰ เปิดกะ</span>
        <button class="modal-close" onclick="closeModal('modal-shift-open')">✕</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:16px">
          นับเงินในลิ้นชักก่อนเปิดกะ แล้วระบุจำนวนด้านล่าง
        </p>
        <div class="form-group">
          <label class="form-label">เงินเปิดกะ (บาท)</label>
          <div class="input-group">
            <span class="input-addon input-addon-left">฿</span>
            <input id="shift-start-cash" class="form-input" type="number"
                   min="0" step="0.01" placeholder="0.00">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('modal-shift-open')">ยกเลิก</button>
        <button class="btn btn-primary btn-lg" onclick="confirmOpenShift()">▶ เปิดกะ</button>
      </div>
    </div>
  </div>

  <!-- ========== MODAL: Close Shift ========== -->
  <div id="modal-shift-close" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">⏹ ปิดกะ</span>
        <button class="modal-close" onclick="closeModal('modal-shift-close')">✕</button>
      </div>
      <div class="modal-body">
        <div class="shift-summary">
          <div class="ss-row"><span>เปิดกะเมื่อ</span><span id="shift-close-opened">—</span></div>
          <div class="ss-row"><span>เงินเปิดกะ</span><span id="shift-close-startcash">—</span></div>
          <div class="ss-row"><span>จำนวนบิล</span><span id="shift-close-sales">—</span></div>
          <div class="ss-row"><span>ยอดขายรวม</span><span id="shift-close-total">—</span></div>
          <div class="ss-row ss-total"><span>เงินที่ควรมี</span><span id="shift-close-expected">—</span></div>
        </div>
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">เงินที่นับได้จริง (บาท)</label>
          <div class="input-group">
            <span class="input-addon input-addon-left">฿</span>
            <input id="shift-close-actual" class="form-input" type="number"
                   min="0" step="0.01" placeholder="0.00" oninput="calcDiscrepancy()">
          </div>
        </div>
        <div class="change-box" style="margin-top:8px">
          <span class="change-label">ส่วนต่าง</span>
          <span id="shift-close-discrepancy" class="change-amount">—</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('modal-shift-close')">ยกเลิก</button>
        <button class="btn btn-danger" onclick="confirmCloseShift()">⏹ ปิดกะ</button>
      </div>
    </div>
  </div>

  <!-- ========== MODAL: Shift Summary ========== -->
  <div id="modal-shift-summary" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">📊 สรุปกะ</span>
        <button class="modal-close" onclick="closeModal('modal-shift-summary')">✕</button>
      </div>
      <div id="shift-summary-content" class="modal-body"></div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="closeModal('modal-shift-summary')">ปิด</button>
      </div>
    </div>
  </div>`;

  /* Append modals and wire backdrop-click to close */
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    if (!el.dataset.backdropWired) {
      el.dataset.backdropWired = '1';
      el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
    }
  });
}

const APP_VERSION = 'v1.2.0';

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  _injectSharedModals();
  updateShiftUI();
  updateInventoryBadge();

  const bn = document.getElementById('brand-name');
  if (bn) bn.textContent = DB.getSettings().shopName || 'ร้านขายของชำ';

  /* Version badge */
  const footer = document.querySelector('.sidebar-footer');
  if (footer) {
    const v = document.createElement('span');
    v.className   = 'app-version';
    v.textContent = APP_VERSION;
    footer.appendChild(v);
  }

  /* Clock — only start if app.js hasn't started its own */
  if (!window._clockStarted) {
    window._clockStarted = true;
    setInterval(_sharedUpdateClock, 1000);
    _sharedUpdateClock();
  }
});
