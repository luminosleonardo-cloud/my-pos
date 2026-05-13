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

/* ---- Customer Display (BroadcastChannel) ---- */
let _displayChannel   = null;
let _displayWin       = null;

function _openDisplayChannel() {
  try {
    _displayChannel = new BroadcastChannel('pos_customer_display');
    _displayChannel.onmessage = e => {
      if (e.data?.type === 'request_state') _broadcastCart();
    };
  } catch { _displayChannel = null; }
}

function _sendDisplay(msg) {
  if (_displayChannel) _displayChannel.postMessage(msg);
  if (typeof Sync !== 'undefined' && Sync.isActive()) Sync.writeDisplay(msg);
}

function _broadcastCart() {
  const settings = DB.getSettings();
  _sendDisplay({
    type: 'cart_update',
    shopName: settings.shopName || 'ร้านขายของชำ',
    cart: cart.map(i => ({
      name: i.product.name,
      category: i.product.category,
      image: i.product.image || '',
      price: i.product.price,
      qty: i.qty,
      lineTotal: i.product.price * i.qty,
    })),
    subtotal: getSubtotal(),
    discountAmt: getDiscountAmt(),
    discountLabel: getDiscountLabel(),
    total: getTotal(),
  });
}

async function openCustomerDisplay() {
  if (!_displayChannel) _openDisplayChannel();

  /* If window already open, just focus and re-sync */
  if (_displayWin && !_displayWin.closed) {
    _displayWin.focus();
    _broadcastCart();
    return;
  }

  /* Try Window Management API (Chrome 100+) — place on second screen */
  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      const second  = details.screens.find(s => s !== details.currentScreen) || details.currentScreen;
      _displayWin   = window.open(
        'customer-display.html', 'customer_display',
        `left=${second.availLeft},top=${second.availTop},` +
        `width=${second.availWidth},height=${second.availHeight},` +
        'menubar=no,toolbar=no,location=no,status=no'
      );
      /* Ask the new window to go fullscreen after it loads */
      if (_displayWin) {
        _displayWin.addEventListener('load', () => {
          try { _displayWin.document.documentElement.requestFullscreen?.(); } catch {}
        }, { once: true });
      }
      return;
    } catch {
      /* Permission denied or API unavailable — fall through */
    }
  }

  /* Fallback: open to the right of the current screen (common dual-monitor setup) */
  _displayWin = window.open(
    'customer-display.html', 'customer_display',
    `left=${screen.width},top=0,width=${screen.width},height=${screen.height},` +
    'menubar=no,toolbar=no,location=no,status=no'
  );
}

/* ---- Helpers ---- */
function getSubtotal() {
  return Math.round(cart.reduce((s, i) => s + i.product.price * i.qty, 0) * 100) / 100;
}
function getDiscountAmt() {
  if (!discountValue) return 0;
  const sub = getSubtotal();
  const amt  = discountType === '%' ? Math.round(sub * discountValue) / 100 : discountValue;
  return Math.round(Math.min(Math.max(0, amt), sub) * 100) / 100;
}
function getTotal() {
  return Math.max(0, Math.round((getSubtotal() - getDiscountAmt()) * 100) / 100);
}
function getDiscountLabel() {
  if (!discountValue) return '';
  return discountType === '%' ? `ส่วนลด ${discountValue}%` : 'ส่วนลด';
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
    const thumbInner = p.image
      ? `<img src="${p.image}" alt="${p.name}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
         <span class="thumb-emoji" style="display:none">${DB.getEmoji(p.category)}</span>`
      : `<span class="thumb-emoji">${DB.getEmoji(p.category)}</span>`;
    const badgeMap = {
      normal: '',
      low: '<span class="stock-badge low">เหลือน้อย</span>',
      'shelf-low': '<span class="stock-badge shelf-low">ชั้นเหลือน้อย</span>',
      out: '<span class="stock-badge out">หมด</span>',
    };
    const hasShelf = p.shelfQty !== null && p.shelfQty !== undefined;
    const displayQty = hasShelf ? p.shelfQty : p.quantity;
    const qtyLabel   = hasShelf ? 'บนชั้น' : 'คงเหลือ';
    return `
      <div class="product-card ${status === 'out' ? 'out-of-stock' : ''}"
           onclick="addToCart('${p.id}')">
        ${badgeMap[status] || ''}
        <div class="product-thumb">${thumbInner}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">฿${fmt(p.price)}</div>
        <div class="product-stock-label">${qtyLabel} ${displayQty}</div>
      </div>`;
  }).join('');
}

function selectCategory(cat) {
  currentCategory = cat;
  renderCategories();
  renderProducts();
}

/* ---- Cart persistence ---- */
function saveCart() {
  localStorage.setItem('pos_cart', JSON.stringify(
    cart.map(i => ({ id: i.product.id, qty: i.qty }))
  ));
  localStorage.setItem('pos_cart_disc', JSON.stringify(
    { type: discountType, value: discountValue }
  ));
}

function loadCart() {
  try {
    const raw  = JSON.parse(localStorage.getItem('pos_cart') || '[]');
    cart = raw
      .map(entry => {
        const product = allProducts.find(p => p.id === entry.id);
        if (!product) return null;
        return { product, qty: Math.min(entry.qty, _availQty(product) || 0) };
      })
      .filter(Boolean)
      .filter(i => i.qty > 0);

    const disc = JSON.parse(localStorage.getItem('pos_cart_disc') || 'null');
    if (disc) {
      discountType  = disc.type  || '฿';
      discountValue = disc.value || 0;
      const dv    = document.getElementById('disc-value');
      const dtBtn = document.getElementById('disc-type-btn');
      if (dv)    dv.value        = discountValue || '';
      if (dtBtn) dtBtn.textContent = discountType;
    }
  } catch { cart = []; }
}

function clearSavedCart() {
  localStorage.removeItem('pos_cart');
  localStorage.removeItem('pos_cart_disc');
}

/* ---- Cart item HTML (shared between renderCart and renderCartSheet) ---- */
function cartItemHTML(p, qty) {
  const img = p.image
    ? `<img src="${p.image}" alt="${p.name}" class="cart-item-img"
           onerror="this.outerHTML='<span class=\\'cart-item-emoji\\'>${DB.getEmoji(p.category)}</span>'">`
    : `<span class="cart-item-emoji">${DB.getEmoji(p.category)}</span>`;
  return `
    <div class="cart-item">
      ${img}
      <div class="cart-item-info">
        <div class="cart-item-name">${p.name}</div>
        <div class="cart-item-unit">฿${fmt(p.price)} / ชิ้น</div>
      </div>
      <div class="qty-controls">
        <button class="qty-btn minus" onclick="changeQty('${p.id}',-1)">−</button>
        <span class="qty-num">${qty}</span>
        <button class="qty-btn plus"  onclick="changeQty('${p.id}', 1)">+</button>
      </div>
      <span class="cart-item-total">฿${fmt(p.price * qty)}</span>
    </div>`;
}

/* ---- Cart ---- */
function _availQty(product) {
  return (product.shelfQty !== null && product.shelfQty !== undefined)
    ? product.shelfQty : product.quantity;
}

function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  const avail = product ? _availQty(product) : 0;
  if (!product || avail === 0) return;

  const existing = cart.find(i => i.product.id === productId);
  if (existing) {
    if (existing.qty >= avail) {
      showToast(`สินค้าคงเหลือเพียง ${avail} ชิ้น`, 'warning');
      return;
    }
    existing.qty++;
  } else {
    cart.push({ product, qty: 1 });
  }
  saveCart();
  renderCart();
}

function changeQty(productId, delta) {
  const item = cart.find(i => i.product.id === productId);
  if (!item) return;
  const avail = _availQty(item.product);
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.product.id !== productId);
  } else if (item.qty > avail) {
    item.qty = avail;
    showToast(`สินค้าคงเหลือเพียง ${avail} ชิ้น`, 'warning');
  }
  if (cart.length > 0) saveCart();
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('ล้างรายการทั้งหมดใช่ไหม?')) return;
  cart = [];
  discountValue = 0;
  const dv = document.getElementById('disc-value');
  if (dv) dv.value = '';
  clearSavedCart();
  renderCart();
}

/* ---- Discount controls ---- */
function toggleDiscountType() {
  discountType = discountType === '฿' ? '%' : '฿';
  document.getElementById('disc-type-btn').textContent = discountType;
  applyDiscount();
}
let _saveCartTimer = null;
function applyDiscount() {
  discountValue = parseFloat(document.getElementById('disc-value')?.value) || 0;
  renderCartFooter();
  clearTimeout(_saveCartTimer);
  _saveCartTimer = setTimeout(saveCart, 400);
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
  const itemsEl = document.getElementById('cart-items');
  const countEl = document.getElementById('cart-count');

  countEl.textContent = cart.reduce((s, i) => s + i.qty, 0);
  renderCartFooter();

  _broadcastCart();

  if (cart.length === 0) {
    closeCartSheet();
    clearSavedCart();
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <div class="empty-icon">🛒</div>
        <p>ยังไม่มีสินค้าในตะกร้า</p>
        <p style="font-size:0.78rem;opacity:0.7">คลิกสินค้าหรือสแกนบาร์โค้ดเพื่อเพิ่ม</p>
      </div>`;
    return;
  }

  if (document.getElementById('cart-sheet')?.classList.contains('open')) {
    renderCartSheet();
  }

  itemsEl.innerHTML = cart.map(({ product: p, qty }) => cartItemHTML(p, qty)).join('');
}

/* ---- Cart bottom sheet (mobile) ---- */
function openCartSheet() {
  renderCartSheet();
  document.getElementById('cart-sheet').classList.add('open');
  document.getElementById('cart-sheet-backdrop').classList.add('open');
}

function closeCartSheet() {
  document.getElementById('cart-sheet').classList.remove('open');
  document.getElementById('cart-sheet-backdrop').classList.remove('open');
}

function renderCartSheet() {
  const bodyEl = document.getElementById('sheet-cart-items');
  if (!bodyEl) return;

  document.getElementById('sheet-item-count').textContent = cart.length;

  if (cart.length === 0) {
    bodyEl.innerHTML = `<div class="cart-empty"><div class="empty-icon">🛒</div><p>ยังไม่มีสินค้าในตะกร้า</p></div>`;
  } else {
    bodyEl.innerHTML = cart.map(({ product: p, qty }) => cartItemHTML(p, qty)).join('');
  }

  /* footer totals */
  const sub   = getSubtotal();
  const disc  = getDiscountAmt();
  const total = getTotal();
  document.getElementById('sheet-total').textContent = `฿${fmt(total)}`;
  const rowSub  = document.getElementById('sheet-row-sub');
  const rowDisc = document.getElementById('sheet-row-disc');
  if (disc > 0) {
    document.getElementById('sheet-subtotal').textContent  = `฿${fmt(sub)}`;
    document.getElementById('sheet-disc-amt').textContent  = `-฿${fmt(disc)}`;
    document.getElementById('sheet-disc-label').textContent = getDiscountLabel();
    rowSub.style.display  = '';
    rowDisc.style.display = '';
  } else {
    rowSub.style.display  = 'none';
    rowDisc.style.display = 'none';
  }
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
    _sendDisplay({
      type: 'qr_show',
      shopName: s.shopName || 'ร้านขายของชำ',
      promptpay: s.promptpay,
      total,
    });
  } else {
    updateChange();
    _broadcastCart();
  }
}

function closePaymentModal() {
  closeModal('modal-payment');
  _broadcastCart();
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
    items: cart.map(({ product: p, qty }) => ({ productId: p.id, name: p.name, price: p.price, costPrice: p.costPrice || 0, qty })),
    subtotal, discountAmt: discAmt, discountLabel: getDiscountLabel(),
    total, cash, change, note,
    payMethod: currentPayMethod,
    shiftId: activeShift ? activeShift.id : null,
  });

  const saleItems = [...cart];
  cart = [];
  discountValue = 0;
  clearSavedCart();
  const dv = document.getElementById('disc-value');
  if (dv) dv.value = '';

  const meta = { subtotal, discountAmt: discAmt, discountLabel: getDiscountLabel(), note, receiptNo: savedSale.receiptNo, payMethod: currentPayMethod };
  _lastReceiptData = { saleItems, total, cash, change, meta };

  if (Printer.connected()) {
    Printer.printReceipt(saleItems, total, cash, change, meta).catch(() => {});
  } else {
    Printer.setPending(saleItems, total, cash, change, meta);
    if (Printer.cfg().drawerMode === 'auto' && currentPayMethod === 'cash') {
      Printer.openDrawer().catch(() => {});
    }
  }

  /* broadcast payment-done to customer display */
  {
    const settings = DB.getSettings();
    _sendDisplay({
      type: 'payment_done',
      shopName: settings.shopName || 'ร้านขายของชำ',
      total,
      change: currentPayMethod === 'cash' ? change : 0,
      footer: settings.footer || 'ขอบคุณที่ใช้บริการ',
    });
  }

  showReceipt(saleItems, total, cash, change, meta);
  allProducts = DB.getProducts();
  renderCart();
  renderProducts();
  renderDashboard();
  if (typeof updateInventoryBadge === 'function') updateInventoryBadge();
  closeModal('modal-payment');
}

function thermalPrintLastReceipt() {
  if (!_lastReceiptData) return;
  const { saleItems, total, cash, change, meta } = _lastReceiptData;
  Printer.printReceipt(saleItems, total, cash, change, meta || {}).catch(err => showToast('พิมพ์ไม่สำเร็จ: ' + err.message, 'error'));
}

function showReceipt(saleItems, total, cash, change, meta = {}) {
  document.getElementById('receipt-content').innerHTML =
    buildReceiptHTML(saleItems, total, cash, change, meta, { showSuccess: true });
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
  if (_availQty(product) === 0) {
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

/* ---- Dashboard ---- */
let _salesChart = null;

function renderDashboard() {
  const sales = DB.getSales();
  renderSalesChart(sales);
  renderTopProducts(sales);
}

function renderSalesChart(sales) {
  const canvas = document.getElementById('chart-sales-7d');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = [];
  const values = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toDateString();
    labels.push(d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
    values.push(sales.filter(s => new Date(s.createdAt).toDateString() === ds)
      .reduce((sum, s) => sum + s.total, 0));
  }

  if (_salesChart) {
    _salesChart.data.labels = labels;
    _salesChart.data.datasets[0].data = values;
    _salesChart.update('none');
    return;
  }

  _salesChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: 'rgba(22,163,74,0.25)',
        borderColor: '#16a34a',
        borderWidth: 2,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback: v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v,
          },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function renderTopProducts(sales) {
  const el = document.getElementById('top5-list');
  if (!el) return;

  const DAY30 = Date.now() - 30 * 86400000;
  sales = sales.filter(s => new Date(s.createdAt).getTime() >= DAY30);

  const counts = {};
  sales.forEach(s => s.items.forEach(i => {
    counts[i.name] = (counts[i.name] || 0) + i.qty;
  }));

  const top5 = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!top5.length) {
    el.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">ยังไม่มีข้อมูลการขาย</p>';
    return;
  }

  const max = top5[0][1];
  el.innerHTML = top5.map(([name, qty], i) => `
    <div class="top5-item">
      <span class="top5-rank">${i + 1}</span>
      <div class="top5-bar-wrap">
        <div class="top5-name">${name}</div>
        <div class="top5-bar" style="width:${Math.round(qty / max * 100)}%"></div>
      </div>
      <span class="top5-qty">${qty} ชิ้น</span>
    </div>`).join('');
}

/* ---- Customer display menu ---- */
function openCustomerDisplayMenu() {
  const hasFb = typeof Sync !== 'undefined' && Sync.isActive();
  const el = document.getElementById('cd-pair-firebase-section');
  if (el) el.style.display = hasFb ? '' : 'none';
  if (hasFb) _renderPairQR();
  openModal('modal-cd-menu');
}

function openCustomerDisplayLocal() {
  closeModal('modal-cd-menu');
  openCustomerDisplay();
}

function _renderPairQR() {
  const shopId = Sync.getShopId();
  const cfg    = Sync.getConfig();
  if (!shopId || !cfg) return;
  const hash    = `${shopId}|${btoa(JSON.stringify(cfg))}`;
  const baseUrl = location.href.replace(/[^/]*$/, '');
  const url     = `${baseUrl}customer-display.html#${hash}`;
  document.getElementById('cd-pair-url').textContent = url;
  const wrap = document.getElementById('cd-pair-qr');
  wrap.innerHTML = '';
  try {
    new QRCode(wrap, { text: url, width: 200, height: 200,
      colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
  } catch {}
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  allProducts = DB.getProducts();
  loadCart();
  renderCategories();
  renderProducts();
  renderCart();
  renderDashboard();
  Printer.refreshUI();
  updateShiftUI();
  _openDisplayChannel();
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
