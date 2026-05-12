/* ============================================================
   shared.js — functions shared across all pages
   (settings modal, shift management, clock, modal helpers)
   ============================================================ */

/* ---- Theme engine ---- */
const THEMES = {
  green:  { label: 'เขียว',  color: '#16a34a' },
  blue:   { label: 'น้ำเงิน', color: '#0284c7' },
  purple: { label: 'ม่วง',   color: '#7c3aed' },
  orange: { label: 'ส้ม',    color: '#ea580c' },
  rose:   { label: 'ชมพู',   color: '#e11d48' },
  teal:   { label: 'ฟ้า',    color: '#0d9488' },
};

function applyTheme(name) {
  const theme = THEMES[name] ? name : 'green';
  if (theme === 'green') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('pos_theme', theme);
}

/* Apply immediately on script load (before DOMContentLoaded) to avoid flash */
applyTheme(localStorage.getItem('pos_theme') || 'green');

/* ---- Global helpers (available on every page) ---- */
function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  const icons = { success: '✅', error: '❌', warning: '⚠️' };
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '✅'}</span><span class="toast-msg">${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('hiding'); setTimeout(() => el.remove(), 280); }, 2800);
}

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

/* ---- Low stock badge on inventory sidebar link (warehouse qty) ---- */
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
  if (outCount > 0) parts.push(`🔴 หมดคลัง ${outCount} รายการ`);
  if (lowCount > 0) parts.push(`🟡 คลังเหลือน้อย ${lowCount} รายการ`);
  badge.setAttribute('data-tooltip', parts.join('\n'));
}

/* ---- Low shelf badge on warehouse sidebar link (shelf qty) ---- */
function updateWarehouseBadge() {
  const badge = document.getElementById('wh-badge');
  if (!badge) return;
  const products = DB.getProducts();
  const tracked = products.filter(p => p.shelfQty !== null && p.shelfQty !== undefined);
  const shelfOut = tracked.filter(p => p.shelfQty === 0).length;
  const shelfLow = tracked.filter(p => p.shelfQty > 0 && p.shelfQty <= (p.minShelfQty || 3)).length;
  const total = shelfOut + shelfLow;
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
  const parts = [];
  if (shelfOut > 0) parts.push(`🟠 ชั้นหมด ${shelfOut} รายการ`);
  if (shelfLow > 0) parts.push(`🔵 ชั้นเหลือน้อย ${shelfLow} รายการ`);
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

/* ---- Receipt HTML builder (screen display) ---- */
function buildReceiptHTML(saleItems, total, cash, change, meta = {}, opts = {}) {
  const { subtotal, discountAmt, discountLabel, note, receiptNo, payMethod } = meta;
  const { showSuccess = false, createdAt = null } = opts;
  const s       = DB.getSettings();
  const hasDisc = (discountAmt || 0) > 0;
  const isQR    = payMethod === 'qr';
  const _f = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  const dt       = new Date(createdAt || Date.now());
  const dateStr  = dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr  = dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const totalQty = saleItems.reduce((sum, i) => sum + i.qty, 0);

  /* Paper-width-aware sizing: 58mm ≈ 220px / 80mm ≈ 302px at 96dpi */
  const hwPaper  = parseInt(localStorage.getItem('hw_paper') || '58');
  const rcptMaxW = hwPaper === 80 ? '302px' : '220px';
  const rcptFont = hwPaper === 80 ? '0.875rem' : '0.8rem';

  return `
  <div class="receipt-v2" style="max-width:${rcptMaxW};font-size:${rcptFont}"
       data-paper="${hwPaper}">
    ${showSuccess ? `<div class="rcpt-success"><span>✓</span></div>` : ''}

    <div class="rcpt-header">
      <div class="rcpt-shopname">${s.shopName || 'ร้านขายของชำ'}</div>
      ${s.address ? `<div class="rcpt-shopinfo">${s.address}</div>` : ''}
      ${s.phone   ? `<div class="rcpt-shopinfo">📞 ${s.phone}</div>` : ''}
      ${s.taxId   ? `<div class="rcpt-shopinfo">เลขผู้เสียภาษี: ${s.taxId}</div>` : ''}
    </div>

    <div class="rcpt-line"></div>

    <div class="rcpt-meta">
      <div class="rcpt-meta-row"><span>วันที่</span><span>${dateStr}</span></div>
      <div class="rcpt-meta-row"><span>เวลา</span><span>${timeStr} น.</span></div>
      ${receiptNo ? `<div class="rcpt-meta-row"><span>เลขที่บิล</span><span class="rcpt-billno">#${receiptNo}</span></div>` : ''}
      <div class="rcpt-meta-row"><span>วิธีชำระ</span><span>${isQR ? '📱 QR PromptPay' : '💵 เงินสด'}</span></div>
    </div>

    <div class="rcpt-line"></div>

    <div class="rcpt-items">
      ${saleItems.map(({ product: p, qty }) => `
        <div class="rcpt-item">
          <div class="rcpt-iname">${p.name}</div>
          <div class="rcpt-idetail">
            <span class="rcpt-iunit">${qty} × ฿${_f(p.price)}</span>
            <span class="rcpt-iamt">฿${_f(p.price * qty)}</span>
          </div>
        </div>`).join('')}
    </div>
    <div class="rcpt-count">${totalQty} ชิ้น · ${saleItems.length} รายการ</div>

    <div class="rcpt-line"></div>

    <div class="rcpt-sum">
      ${hasDisc ? `
        <div class="rcpt-sum-row">
          <span>ราคาก่อนลด</span><span>฿${_f(subtotal)}</span>
        </div>
        <div class="rcpt-sum-row rcpt-disc">
          <span>${discountLabel || 'ส่วนลด'}</span><span>−฿${_f(discountAmt)}</span>
        </div>` : ''}
      <div class="rcpt-sum-total">
        <span>ยอดชำระ</span><span>฿${_f(total)}</span>
      </div>
      <div class="rcpt-sum-row">
        <span>รับเงิน</span><span>฿${_f(cash)}</span>
      </div>
      <div class="rcpt-sum-row rcpt-sum-change">
        <span>เงินทอน</span><span>฿${_f(change)}</span>
      </div>
    </div>

    ${note ? `
      <div class="rcpt-line"></div>
      <div class="rcpt-note">📝 ${note}</div>` : ''}

    <div class="rcpt-line"></div>

    <div class="rcpt-footer">
      <div class="rcpt-footer-txt">${s.footer || 'ขอบคุณที่ใช้บริการ'}</div>
      ${isQR && s.promptpay ? `<div class="rcpt-shopinfo" style="margin-top:4px">PromptPay: ${s.promptpay}</div>` : ''}
    </div>

    <div class="rcpt-tear"></div>
  </div>`;
}

/* ---- Shop settings — redirect to dedicated settings page ---- */
function openSettingsModal() {
  window.location.href = 'settings.html';
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
  showToast('เปิดกะแล้ว — เงินเปิดกะ ฿' + fmt(cash));
}

let _shiftCloseSales = null;

function openCloseShiftModal() {
  const shift = DB.getActiveShift();
  if (!shift) return;
  const openedAt   = new Date(shift.openedAt);
  _shiftCloseSales = DB.getSales().filter(s => new Date(s.createdAt) >= openedAt);
  const totalSales = _shiftCloseSales.reduce((sum, s) => sum + s.total, 0);
  const txCount    = _shiftCloseSales.length;
  const expected   = shift.startCash + totalSales;

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
  if (!shift || !_shiftCloseSales) return;
  const totalSales = _shiftCloseSales.reduce((sum, s) => sum + s.total, 0);
  const expected   = shift.startCash + totalSales;
  const actual     = parseFloat(document.getElementById('shift-close-actual').value) || 0;
  const diff       = actual - expected;
  const el         = document.getElementById('shift-close-discrepancy');
  el.textContent   = (diff >= 0 ? '+' : '') + '฿' + fmt(Math.abs(diff));
  el.style.color   = diff === 0 ? 'var(--primary)' : diff > 0 ? 'var(--warning)' : 'var(--danger)';
}

function confirmCloseShift() {
  const actual = parseFloat(document.getElementById('shift-close-actual').value);
  if (isNaN(actual)) { showToast('กรุณาระบุยอดเงินที่นับได้', 'warning'); return; }
  const closed = DB.closeShift(actual);
  _shiftCloseSales = null;
  closeModal('modal-shift-close');
  updateShiftUI();
  if (typeof Printer !== 'undefined' && Printer.connected() && closed) {
    Printer.printShiftReport(closed).catch(() => {});
  }
  showShiftSummary(closed);
}

function showShiftSummary(shift) {
  if (!shift) return;
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

/* ---- Inject shared modals (shift modals only — settings moved to settings.html) ---- */
function _injectSharedModals() {
  if (document.getElementById('modal-shift-open')) return; /* already in HTML */

  const wrap = document.createElement('div');
  wrap.innerHTML = `
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

const APP_VERSION = 'v2026.05.11';

function copyShopId() {
  const id = document.getElementById('set-shop-id')?.value || localStorage.getItem('shop_id') || '';
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    if (typeof showToast === 'function') showToast('คัดลอก Shop ID แล้ว');
  });
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  _injectSharedModals();
  updateShiftUI();
  updateInventoryBadge();
  updateWarehouseBadge();

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
