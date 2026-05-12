/* ============================================================
   warehouse.js — shelf & warehouse management page
   ============================================================ */

let whFilter  = 'all';
let whSearch  = '';
let _rsId     = null;   /* product id for restock-shelf modal */
let _rvId     = null;   /* product id for receive-stock modal */

/* ---- Stats ---- */
function renderWhStats() {
  const s = DB.getWarehouseStats();
  document.getElementById('wh-stat-tracked').textContent    = s.trackedProducts;
  document.getElementById('wh-stat-shelf-alert').textContent = s.shelfOut + s.shelfLow;
  document.getElementById('wh-stat-wh-alert').textContent   = s.warehouseLow;
  document.getElementById('wh-stat-wh-out').textContent     = s.warehouseOut;
}

/* ---- Filter ---- */
function setWhFilter(filter, btn) {
  whFilter = filter;
  document.querySelectorAll('.wh-filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderWhTable();
}

/* ---- Table ---- */
function getWhFilteredList() {
  let list = DB.getProducts();
  const q = whSearch.toLowerCase().trim();
  if (q) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      (p.shelfLocation || '').toLowerCase().includes(q)
    );
  }
  if (whFilter === 'tracked') {
    return list.filter(p => p.shelfQty !== null && p.shelfQty !== undefined);
  }
  if (whFilter === 'shelf-alert') {
    return list.filter(p => {
      if (p.shelfQty === null || p.shelfQty === undefined) return false;
      return p.shelfQty === 0 || p.shelfQty <= (p.minShelfQty || 3);
    });
  }
  if (whFilter === 'wh-alert') {
    return list.filter(p =>
      p.quantity === 0 || p.quantity <= p.lowStockThreshold
    );
  }
  return list;
}

function renderWhTable() {
  renderWhStats();
  const list  = getWhFilteredList();
  const tbody = document.getElementById('wh-tbody');

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state"><div class="es-icon">🔍</div><h3>ไม่พบสินค้า</h3></div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const hasShelf = p.shelfQty !== null && p.shelfQty !== undefined;
    const whStatus = DB.getWarehouseStatus(p);
    const shStatus = hasShelf ? DB.getStockStatus(p) : null;

    const whBadge = {
      normal: '',
      low:    `<span class="badge badge-warning">⚠ คลังน้อย</span>`,
      out:    `<span class="badge badge-danger">คลังหมด</span>`,
    }[whStatus];

    const shBadge = !hasShelf ? '' : {
      normal:      `<span class="badge badge-success">ชั้นปกติ</span>`,
      'shelf-low': `<span class="badge badge-info">📦 ชั้นน้อย</span>`,
      out:         `<span class="badge badge-danger">ชั้นหมด</span>`,
    }[shStatus] || '';

    const icon = p.image
      ? `<img src="${p.image}" alt="${p.name}" class="prod-row-img"
             onerror="this.outerHTML='<div class=\\'prod-table-icon\\'>${DB.getEmoji(p.category)}</div>'">`
      : `<div class="prod-table-icon">${DB.getEmoji(p.category)}</div>`;

    const shelfCell = hasShelf
      ? `<span class="wh-qty-shelf">${p.shelfQty}</span>
         <span style="font-size:0.75rem;color:var(--text-muted)"> / ${p.minShelfQty || 3} ขั้นต่ำ</span>`
      : `<span class="wh-untracked">—</span>`;

    const shelfLocCell = p.shelfLocation
      ? `<span class="wh-location-tag">${p.shelfLocation}</span>`
      : `<span style="color:var(--text-muted)">—</span>`;

    return `<tr>
      <td>
        <div class="prod-name-cell">
          ${icon}
          <div>
            <div class="prod-name-text">${p.name}</div>
            <div class="prod-cat-text">${p.category}</div>
          </div>
        </div>
      </td>
      <td>${shelfLocCell}</td>
      <td>${shelfCell}</td>
      <td>
        <span style="font-weight:700">${p.quantity}</span>
        <span style="font-size:0.75rem;color:var(--text-muted)"> ชิ้น</span>
      </td>
      <td>${shBadge}${whBadge ? `<div style="margin-top:2px">${whBadge}</div>` : ''}</td>
      <td>
        <div class="action-cell">
          ${hasShelf ? `<button class="btn btn-sm btn-primary" onclick="openRestock('${p.id}')" title="เติมของขึ้นชั้น">📋 เติมชั้น</button>` : ''}
          <button class="btn btn-sm btn-outline" onclick="openReceive('${p.id}')" title="รับสินค้าเข้าคลัง">📦 รับสินค้า</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ---- Restock Shelf modal ---- */
function openRestock(id) {
  const p = DB.getProducts().find(x => x.id === id);
  if (!p) return;
  _rsId = id;
  document.getElementById('rs-product-name').textContent = p.name;
  document.getElementById('rs-shelf-qty').textContent    = (p.shelfQty || 0) + ' ชิ้น';
  document.getElementById('rs-wh-qty').textContent       = p.quantity + ' ชิ้น';
  document.getElementById('rs-qty').value = '';
  document.getElementById('rs-note').value = '';
  const ps = p.packSize || 12;
  document.getElementById('rs-btn-half').textContent = `+ครึ่งแพ็ค (+${Math.ceil(ps / 2)})`;
  document.getElementById('rs-btn-full').textContent = `+1 แพ็ค (+${ps})`;
  openModal('modal-restock');
  document.getElementById('rs-qty').focus();
}

function rsQuick(qty) {
  const el = document.getElementById('rs-qty');
  el.value = Math.max(1, (parseInt(el.value) || 0) + qty);
}

function rsPackQuick(multiplier) {
  if (!_rsId) return;
  const p = DB.getProducts().find(x => x.id === _rsId);
  if (!p) return;
  rsQuick(Math.ceil((p.packSize || 12) * multiplier));
}

function confirmRestock() {
  if (!_rsId) return;
  const qty  = parseInt(document.getElementById('rs-qty').value);
  const note = document.getElementById('rs-note').value.trim();
  if (!qty || qty < 1) { showToast('ระบุจำนวนที่จะเติม', 'warning'); return; }
  const result = DB.restockShelf(_rsId, qty, note);
  if (!result) { showToast('โอนได้สูงสุดเท่าที่มีในคลัง', 'warning'); return; }
  _rsId = null;
  closeModal('modal-restock');
  renderWhTable();
  renderWhLog();
  if (typeof updateWarehouseBadge === 'function') updateWarehouseBadge();
  showToast('เติมของขึ้นชั้นสำเร็จ');
}

/* ---- Receive Stock modal ---- */
function openReceive(id) {
  const p = DB.getProducts().find(x => x.id === id);
  if (!p) return;
  _rvId = id;
  document.getElementById('rv-product-name').textContent = p.name;
  document.getElementById('rv-wh-qty').textContent       = p.quantity + ' ชิ้น';
  document.getElementById('rv-qty').value  = '';
  document.getElementById('rv-note').value = '';
  const ps = p.packSize || 12;
  document.getElementById('rv-btn-half').textContent   = `+ครึ่งแพ็ค (+${Math.ceil(ps / 2)})`;
  document.getElementById('rv-btn-full').textContent   = `+1 แพ็ค (+${ps})`;
  document.getElementById('rv-btn-double').textContent = `+2 แพ็ค (+${ps * 2})`;
  openModal('modal-receive');
  document.getElementById('rv-qty').focus();
}

function rvPackQuick(multiplier) {
  if (!_rvId) return;
  const p = DB.getProducts().find(x => x.id === _rvId);
  if (!p) return;
  const el = document.getElementById('rv-qty');
  el.value = Math.max(1, (parseInt(el.value) || 0) + Math.ceil((p.packSize || 12) * multiplier));
}

function confirmReceive() {
  if (!_rvId) return;
  const qty  = parseInt(document.getElementById('rv-qty').value);
  const note = document.getElementById('rv-note').value.trim();
  if (!qty || qty < 1) { showToast('ระบุจำนวนที่รับเข้า', 'warning'); return; }
  DB.receiveStock(_rvId, qty, note);
  _rvId = null;
  closeModal('modal-receive');
  renderWhTable();
  renderWhLog();
  if (typeof updateInventoryBadge === 'function') updateInventoryBadge();
  showToast('รับสินค้าเข้าคลังสำเร็จ');
}

/* ---- Activity Log ---- */
function renderWhLog() {
  const el = document.getElementById('wh-log-list');
  if (!el) return;
  const log = DB.getWarehouseLog().slice().reverse().slice(0, 30);
  if (!log.length) {
    el.innerHTML = '<p class="wh-log-empty">ยังไม่มีประวัติ</p>';
    return;
  }
  el.innerHTML = log.map(e => {
    const icon = e.type === 'restock_shelf' ? '📋' : '📦';
    const label = e.type === 'restock_shelf' ? 'เติมชั้น' : 'รับสินค้า';
    const dt = new Date(e.createdAt);
    const timeStr = dt.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="wh-log-item">
      <span class="wh-log-icon">${icon}</span>
      <div class="wh-log-info">
        <div class="wh-log-name">${e.productName}</div>
        <div class="wh-log-sub">${label} +${e.qty} ชิ้น${e.note ? ` · ${e.note}` : ''}</div>
      </div>
      <span class="wh-log-time">${timeStr}</span>
    </div>`;
  }).join('');
}

/* ---- Best sellers from shelf sales ---- */
function renderWhTopProducts() {
  const el = document.getElementById('wh-top-list');
  if (!el) return;
  const DAY30 = Date.now() - 30 * 86400000;
  const sales = DB.getSales().filter(s => new Date(s.createdAt).getTime() >= DAY30);
  const counts = {};
  sales.forEach(s => s.items.forEach(i => {
    counts[i.name] = (counts[i.name] || 0) + i.qty;
  }));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!top.length) {
    el.innerHTML = '<p class="wh-log-empty">ยังไม่มีข้อมูลการขาย</p>';
    return;
  }
  const max = top[0][1];
  el.innerHTML = top.map(([name, qty], i) => `
    <div class="top5-item">
      <span class="top5-rank">${i + 1}</span>
      <div class="top5-bar-wrap">
        <div class="top5-name">${name}</div>
        <div class="top5-bar" style="width:${Math.round(qty / max * 100)}%"></div>
      </div>
      <span class="top5-qty">${qty} ชิ้น</span>
    </div>`).join('');
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  renderWhTable();
  renderWhLog();
  renderWhTopProducts();

  let searchTimer = null;
  document.getElementById('wh-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      whSearch = e.target.value;
      renderWhTable();
    }, 160);
  });

  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
  });

  /* Wire quick-pack buttons */
  document.getElementById('rs-btn-half').onclick   = () => rsPackQuick(0.5);
  document.getElementById('rs-btn-full').onclick   = () => rsPackQuick(1);
  document.getElementById('rv-btn-half').onclick   = () => rvPackQuick(0.5);
  document.getElementById('rv-btn-full').onclick   = () => rvPackQuick(1);
  document.getElementById('rv-btn-double').onclick = () => rvPackQuick(2);
});
