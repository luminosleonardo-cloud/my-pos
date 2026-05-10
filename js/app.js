/* ============================================================
   app.js — POS page logic
   ============================================================ */

/* ---- State ---- */
let cart              = [];   // [{ product, qty }]
let allProducts       = [];
let currentCategory   = 'ทั้งหมด';
let searchQuery       = '';
let currentPayMethod  = 'cash';
let discountType      = '฿';
let discountValue     = 0;

/* ---- Helpers ---- */
function fmt(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
}

function getSubtotal() {
  return cart.reduce((s, i) => s + i.product.price * i.qty, 0);
}
function getDiscountAmt() {
  if (!discountValue) return 0;
  const sub = getSubtotal();
  const amt  = discountType === '%' ? sub * discountValue / 100 : discountValue;
  return Math.min(Math.max(0, amt), sub);
}
function getTotal() {
  return Math.max(0, getSubtotal() - getDiscountAmt());
}
function getDiscountLabel() {
  if (!discountValue) return '';
  return discountType === '%' ? `ส่วนลด ${discountValue}%` : 'ส่วนลด';
}

function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  const icons = { success: '✅', error: '❌', warning: '⚠️' };
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '✅'}</span><span class="toast-msg">${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 280);
  }, 2800);
}

/* ---- Clock ---- */
window._clockStarted = true; /* prevent shared.js from starting a duplicate clock */
function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

/* ---- Products ---- */
function getFilteredProducts() {
  let list = allProducts;
  if (currentCategory !== 'ทั้งหมด') list = list.filter(p => p.category === currentCategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.barcode.includes(q)
    );
  }
  return list;
}

function renderCategories() {
  const cats = DB.getCategories();
  const container = document.getElementById('category-tabs');
  container.innerHTML = cats.map(cat => `
    <button class="tab-btn ${cat === currentCategory ? 'active' : ''}"
            onclick="selectCategory('${cat}')">${cat}</button>
  `).join('');
}

function renderProducts() {
  const list = getFilteredProducts();
  const grid = document.getElementById('product-grid');

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="es-icon">🔍</div>
        <h3>ไม่พบสินค้า</h3>
        <p>ลองค้นหาคำอื่น หรือเพิ่มสินค้าในหน้าคลัง</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const status = DB.getStockStatus(p);
    const badgeMap = { normal: '', low: '<span class="stock-badge low">เหลือน้อย</span>', out: '<span class="stock-badge out">หมด</span>' };
    const thumbInner = p.image
      ? `<img src="${p.image}" alt="${p.name}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
         <span class="thumb-emoji" style="display:none">${DB.getEmoji(p.category)}</span>`
      : `<span class="thumb-emoji">${DB.getEmoji(p.category)}</span>`;
    return `
      <div class="product-card ${status === 'out' ? 'out-of-stock' : ''}"
           onclick="addToCart('${p.id}')">
        ${badgeMap[status] || ''}
        <div class="product-thumb">${thumbInner}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">฿${fmt(p.price)}</div>
        <div class="product-stock-label">คงเหลือ ${p.quantity}</div>
      </div>`;
  }).join('');
}

function selectCategory(cat) {
  currentCategory = cat;
  renderCategories();
  renderProducts();
}

/* ---- Cart ---- */
function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product || product.quantity === 0) return;

  const existing = cart.find(i => i.product.id === productId);
  if (existing) {
    if (existing.qty >= product.quantity) {
      showToast(`สินค้าคงเหลือเพียง ${product.quantity} ชิ้น`, 'warning');
      return;
    }
    existing.qty++;
  } else {
    cart.push({ product, qty: 1 });
  }
  renderCart();
  showToast(`เพิ่ม ${product.name}`, 'success');
}

function changeQty(productId, delta) {
  const item = cart.find(i => i.product.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.product.id !== productId);
  } else if (item.qty > item.product.quantity) {
    item.qty = item.product.quantity;
    showToast(`สินค้าคงเหลือเพียง ${item.product.quantity} ชิ้น`, 'warning');
  }
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('ล้างรายการทั้งหมดใช่ไหม?')) return;
  cart = [];
  discountValue = 0;
  const dv = document.getElementById('disc-value');
  if (dv) dv.value = '';
  renderCart();
}

/* ---- Discount controls ---- */
function toggleDiscountType() {
  discountType = discountType === '฿' ? '%' : '฿';
  document.getElementById('disc-type-btn').textContent = discountType;
  applyDiscount();
}
function applyDiscount() {
  discountValue = parseFloat(document.getElementById('disc-value')?.value) || 0;
  renderCartFooter();
}
function renderCartFooter() {
  const sub  = getSubtotal();
  const disc = getDiscountAmt();
  const total = getTotal();
  const totalEl    = document.getElementById('cart-total');
  const subEl      = document.getElementById('cart-subtotal');
  const discEl     = document.getElementById('cart-discount-amt');
  const rowSub     = document.getElementById('row-subtotal');
  const rowDisc    = document.getElementById('row-discount');
  const discLabel  = document.getElementById('disc-row-label');
  const checkBtn   = document.getElementById('btn-checkout');

  if (totalEl)  totalEl.textContent  = `฿${fmt(total)}`;
  if (checkBtn) checkBtn.disabled = cart.length === 0;

  /* mobile cart bar */
  const mbar = document.getElementById('mobile-cart-bar');
  if (mbar) {
    const qty = cart.reduce((s, i) => s + i.qty, 0);
    if (qty > 0) {
      mbar.classList.remove('hidden');
      const mcbCount = document.getElementById('mcb-count');
      const mcbTotal = document.getElementById('mcb-total');
      if (mcbCount) mcbCount.textContent = qty;
      if (mcbTotal) mcbTotal.textContent = `฿${fmt(total)}`;
    } else {
      mbar.classList.add('hidden');
    }
  }

  if (disc > 0) {
    if (subEl)    subEl.textContent    = `฿${fmt(sub)}`;
    if (discEl)   discEl.textContent   = `-฿${fmt(disc)}`;
    if (discLabel) discLabel.textContent = getDiscountLabel();
    if (rowSub)   rowSub.style.display  = '';
    if (rowDisc)  rowDisc.style.display = '';
  } else {
    if (rowSub)  rowSub.style.display  = 'none';
    if (rowDisc) rowDisc.style.display = 'none';
  }
}

function renderCart() {
  const itemsEl   = document.getElementById('cart-items');
  const countEl   = document.getElementById('cart-count');

  const totalQty  = cart.reduce((s, i) => s + i.qty, 0);
  countEl.textContent = totalQty;
  renderCartFooter();

  if (cart.length === 0) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <div class="empty-icon">🛒</div>
        <p>ยังไม่มีสินค้าในตะกร้า</p>
        <p style="font-size:0.78rem;opacity:0.7">คลิกสินค้าหรือสแกนบาร์โค้ดเพื่อเพิ่ม</p>
      </div>`;
    return;
  }

  itemsEl.innerHTML = cart.map(({ product: p, qty }) => `
    <div class="cart-item">
      ${p.image
        ? `<img src="${p.image}" alt="${p.name}" class="cart-item-img"
               onerror="this.outerHTML='<span class=\\'cart-item-emoji\\'>${DB.getEmoji(p.category)}</span>'">`
        : `<span class="cart-item-emoji">${DB.getEmoji(p.category)}</span>`
      }
      <div class="cart-item-info">
        <div class="cart-item-name">${p.name}</div>
        <div class="cart-item-unit">฿${fmt(p.price)} / ชิ้น</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn minus" onclick="changeQty('${p.id}', -1)">−</button>
        <span class="qty-num">${qty}</span>
        <button class="qty-btn plus"  onclick="changeQty('${p.id}',  1)">+</button>
      </div>
      <span class="cart-item-total">฿${fmt(p.price * qty)}</span>
    </div>`).join('');
}

/* ---- Payment Modal ---- */
function openPayment() {
  const total = getTotal();
  const sub   = getSubtotal();
  const disc  = getDiscountAmt();
  document.getElementById('pay-total-amt').textContent = fmt(total);
  document.getElementById('pay-cash').value = '';
  document.getElementById('bill-note').value = '';

  /* show discount breakdown in modal header */
  const discInfo = document.getElementById('pay-discount-info');
  if (discInfo) {
    if (disc > 0) {
      document.getElementById('pay-subtotal-show').textContent = fmt(sub);
      document.getElementById('pay-disc-show').textContent     = `-฿${fmt(disc)} (${getDiscountLabel()})`;
      discInfo.style.display = '';
    } else {
      discInfo.style.display = 'none';
    }
  }

  currentPayMethod = 'cash';
  document.getElementById('tab-cash').classList.add('active');
  document.getElementById('tab-qr').classList.remove('active');
  document.getElementById('pay-cash-section').style.display = '';
  document.getElementById('pay-qr-section').style.display   = 'none';
  updateChange();
  openModal('modal-payment');
}

function switchPayMethod(method) {
  currentPayMethod = method;
  document.getElementById('tab-cash').classList.toggle('active', method === 'cash');
  document.getElementById('tab-qr').classList.toggle('active',   method === 'qr');
  document.getElementById('pay-cash-section').style.display = method === 'cash' ? '' : 'none';
  document.getElementById('pay-qr-section').style.display   = method === 'qr'   ? '' : 'none';
  if (method === 'qr') {
    const total = getTotal();
    const s = DB.getSettings();
    PromptPay.render(document.getElementById('qr-canvas-wrap'), s.promptpay, total);
    document.getElementById('qr-promptpay-no').textContent = s.promptpay || '—';
    document.getElementById('btn-confirm-pay').disabled = !s.promptpay;
  } else {
    updateChange();
  }
}

function updateChange() {
  if (currentPayMethod === 'qr') return;
  const total = getTotal();
  const cash  = parseFloat(document.getElementById('pay-cash').value) || 0;
  const changeBox = document.getElementById('change-box');
  const changeAmt = document.getElementById('change-amount');

  if (cash === 0) {
    changeBox.className = 'change-box';
    changeAmt.textContent = '—';
    document.getElementById('btn-confirm-pay').disabled = true;
    return;
  }

  const change = cash - total;
  if (change < 0) {
    changeBox.className = 'change-box insufficient';
    changeAmt.textContent = `−฿${fmt(Math.abs(change))}`;
    document.getElementById('btn-confirm-pay').disabled = true;
  } else {
    changeBox.className = 'change-box ok';
    changeAmt.textContent = `฿${fmt(change)}`;
    document.getElementById('btn-confirm-pay').disabled = false;
  }
}

let _lastReceiptData = null;

function confirmPayment() {
  const subtotal = getSubtotal();
  const discAmt  = getDiscountAmt();
  const total    = getTotal();
  const note     = document.getElementById('bill-note')?.value.trim() || '';
  let cash, change;
  if (currentPayMethod === 'qr') {
    cash = total; change = 0;
  } else {
    cash   = parseFloat(document.getElementById('pay-cash').value) || 0;
    change = cash - total;
  }

  const activeShift = DB.getActiveShift();
  cart.forEach(({ product, qty }) => DB.decreaseStock(product.id, qty));
  const savedSale = DB.addSale({
    items: cart.map(({ product: p, qty }) => ({ productId: p.id, name: p.name, price: p.price, qty })),
    subtotal, discountAmt: discAmt, discountLabel: getDiscountLabel(),
    total, cash, change, note,
    payMethod: currentPayMethod,
    shiftId: activeShift ? activeShift.id : null,
  });

  const saleItems = [...cart];
  cart = [];
  discountValue = 0;
  const dv = document.getElementById('disc-value');
  if (dv) dv.value = '';

  const meta = { subtotal, discountAmt: discAmt, discountLabel: getDiscountLabel(), note, receiptNo: savedSale.receiptNo };
  _lastReceiptData = { saleItems, total, cash, change, meta };

  if (Printer.connected()) {
    Printer.printReceipt(saleItems, total, cash, change, meta).catch(() => {});
  } else if (Printer.cfg().drawerMode === 'auto' && currentPayMethod === 'cash') {
    Printer.openDrawer().catch(() => {});
  }

  showReceipt(saleItems, total, cash, change, meta);
  allProducts = DB.getProducts();
  renderCart();
  renderProducts();
  if (typeof updateInventoryBadge === 'function') updateInventoryBadge();
  closeModal('modal-payment');
}

function thermalPrintLastReceipt() {
  if (!_lastReceiptData) return;
  const { saleItems, total, cash, change, meta } = _lastReceiptData;
  Printer.printReceipt(saleItems, total, cash, change, meta || {}).catch(err => showToast('พิมพ์ไม่สำเร็จ: ' + err.message, 'error'));
}

function showReceipt(saleItems, total, cash, change, meta = {}) {
  const s   = DB.getSettings();
  const now = new Date().toLocaleString('th-TH');
  const { subtotal, discountAmt, discountLabel, note, receiptNo } = meta;
  document.getElementById('receipt-content').innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <div class="receipt-success-icon">✅</div>
        <h2>${s.shopName || 'ร้านขายของชำ'}</h2>
        ${s.address ? `<p style="font-size:0.8rem;color:var(--text-muted)">${s.address}</p>` : ''}
        ${s.phone   ? `<p style="font-size:0.8rem;color:var(--text-muted)">โทร: ${s.phone}</p>` : ''}
        <p style="font-size:0.8rem;color:var(--text-muted)">${now}</p>
        ${receiptNo ? `<p style="font-size:0.78rem;color:var(--text-light)">เลขที่ ${receiptNo}</p>` : ''}
      </div>
      <hr class="receipt-divider">
      ${saleItems.map(({ product: p, qty }) => `
        <div class="receipt-row">
          <span>${p.name} × ${qty}</span>
          <span>฿${fmt(p.price * qty)}</span>
        </div>`).join('')}
      <hr class="receipt-divider">
      ${discountAmt > 0 ? `
        <div class="receipt-row"><span>ราคารวม</span><span>฿${fmt(subtotal)}</span></div>
        <div class="receipt-row" style="color:var(--danger)"><span>${discountLabel || 'ส่วนลด'}</span><span>-฿${fmt(discountAmt)}</span></div>` : ''}
      <div class="receipt-row receipt-total"><span>ยอดชำระ</span><span>฿${fmt(total)}</span></div>
      <div class="receipt-row"><span>รับเงิน</span><span>฿${fmt(cash)}</span></div>
      <div class="receipt-row" style="color:var(--primary);font-weight:700"><span>เงินทอน</span><span>฿${fmt(change)}</span></div>
      ${note ? `<p class="receipt-footer-msg" style="color:var(--text-muted)">หมายเหตุ: ${note}</p>` : ''}
      ${s.footer ? `<p class="receipt-footer-msg">${s.footer}</p>` : ''}
    </div>`;
  openModal('modal-receipt');
}

/* ---- Camera Scanner ---- */
async function openCameraScanner() {
  openModal('modal-camera');
  await BarcodeScanner.startCamera('reader', (code) => {
    handleBarcode(code);
    closeCameraScanner();
  });
}

async function closeCameraScanner() {
  await BarcodeScanner.stopCamera();
  closeModal('modal-camera');
}

/* ---- Barcode handler (shared for USB + camera) ---- */
function handleBarcode(code) {
  const product = DB.findByBarcode(code);
  if (!product) {
    showToast(`ไม่พบสินค้าบาร์โค้ด: ${code}`, 'warning');
    document.getElementById('search-input').value = code;
    searchQuery = code;
    renderProducts();
    return;
  }
  if (product.quantity === 0) {
    showToast(`${product.name} หมดสต็อก`, 'error');
    return;
  }
  addToCart(product.id);
}

/* ---- Modal helpers ---- */
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

/* ---- Hardware settings ---- */
function openHwSettings() {
  Printer.loadSettingsUI();
  openModal('modal-hw');
}
function connectPrinter() {
  Printer.connect().catch(err => showToast('❌ ' + err.message, 'error'));
}
function disconnectPrinter() {
  Printer.disconnect();
  showToast('ตัดการเชื่อมต่อแล้ว');
}
function connectBtPrinter() {
  Printer.connectBluetooth().catch(err => showToast('❌ ' + err.message, 'error'));
}
function disconnectBtPrinter() {
  Printer.disconnectBluetooth();
  showToast('ตัดการเชื่อมต่อบลูทูธแล้ว');
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
  showToast('บันทึกการตั้งค่าแล้ว');
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

function openCloseShiftModal() {
  const shift = DB.getActiveShift();
  if (!shift) return;
  const openedAt   = new Date(shift.openedAt);
  const sales      = DB.getSales().filter(s => new Date(s.createdAt) >= openedAt);
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const txCount    = sales.length;
  const expected   = shift.startCash + totalSales;

  document.getElementById('shift-close-opened').textContent   = openedAt.toLocaleString('th-TH');
  document.getElementById('shift-close-startcash').textContent = '฿' + fmt(shift.startCash);
  document.getElementById('shift-close-sales').textContent    = txCount + ' รายการ';
  document.getElementById('shift-close-total').textContent    = '฿' + fmt(totalSales);
  document.getElementById('shift-close-expected').textContent = '฿' + fmt(expected);
  document.getElementById('shift-close-actual').value         = '';
  document.getElementById('shift-close-discrepancy').textContent = '—';
  document.getElementById('shift-close-discrepancy').style.color = '';
  openModal('modal-shift-close');
}

function calcDiscrepancy() {
  const shift = DB.getActiveShift();
  if (!shift) return;
  const sales      = DB.getSales().filter(s => new Date(s.createdAt) >= new Date(shift.openedAt));
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const expected   = shift.startCash + totalSales;
  const actual     = parseFloat(document.getElementById('shift-close-actual').value) || 0;
  const diff       = actual - expected;
  const el         = document.getElementById('shift-close-discrepancy');
  el.textContent   = (diff >= 0 ? '+' : '') + '฿' + fmt(diff);
  el.style.color   = diff === 0 ? 'var(--primary)' : diff > 0 ? 'var(--warning)' : 'var(--danger)';
}

function confirmCloseShift() {
  const actual = parseFloat(document.getElementById('shift-close-actual').value);
  if (isNaN(actual)) { showToast('กรุณาระบุยอดเงินที่นับได้', 'warning'); return; }
  const closed = DB.closeShift(actual);
  closeModal('modal-shift-close');
  updateShiftUI();
  if (Printer.connected() && closed) Printer.printShiftReport(closed).catch(() => {});
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

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  allProducts = DB.getProducts();
  renderCategories();
  renderProducts();
  renderCart();
  Printer.refreshUI();
  updateShiftUI();
  /* update brand name from settings */
  const bn = document.getElementById('brand-name');
  if (bn) bn.textContent = DB.getSettings().shopName || 'ร้านขายของชำ';

  /* USB scanner */
  BarcodeScanner.onScan(code => handleBarcode(code));

  /* Search input — debounced so it doesn't re-render on every keystroke */
  const searchEl = document.getElementById('search-input');
  let searchTimer = null;
  searchEl.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value;
      renderProducts();
    }, 160);
  });

  /* Discount input */
  const discEl2 = document.getElementById('disc-value');
  if (discEl2) discEl2.addEventListener('input', applyDiscount);

  /* Payment cash input */
  const cashEl = document.getElementById('pay-cash');
  if (cashEl) cashEl.addEventListener('input', updateChange);

  /* Close modals on backdrop click */
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', async e => {
      if (e.target === el) {
        if (el.id === 'modal-camera') await closeCameraScanner();
        else closeModal(el.id);
      }
    });
  });

  /* ---- Keyboard shortcuts ---- */
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    switch (e.key) {
      case 'F2':
        e.preventDefault();
        if (cart.length > 0) openPayment();
        break;
      case 'F4':
        e.preventDefault();
        Printer.openDrawer();
        break;
      case 'F3':
      case '/':
        e.preventDefault();
        document.getElementById('search-input')?.focus();
        break;
      case 'Escape': {
        const open = [...document.querySelectorAll('.modal-backdrop.open')];
        if (open.length) {
          const last = open[open.length - 1];
          if (last.id === 'modal-camera') closeCameraScanner();
          else closeModal(last.id);
        }
        break;
      }
      case 'Enter': {
        const payModal = document.getElementById('modal-payment');
        if (payModal?.classList.contains('open')) {
          const btn = document.getElementById('btn-confirm-pay');
          if (btn && !btn.disabled) { e.preventDefault(); confirmPayment(); }
        }
        break;
      }
    }
  });
});
