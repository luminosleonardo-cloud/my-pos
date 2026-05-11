/* ============================================================
   sales.js — sales history page logic
   ============================================================ */

let currentPeriod = 'today';

/* ---- Period filter ---- */
function getPeriodRange(period) {
  const now  = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAY  = 86400000;
  switch (period) {
    case 'today':
      return { from: today, to: new Date(today.getTime() + DAY) };
    case 'yesterday': {
      const y = new Date(today.getTime() - DAY);
      return { from: y, to: today };
    }
    case '7days':
      return { from: new Date(today.getTime() - 6 * DAY), to: new Date(today.getTime() + DAY) };
    case '30days':
      return { from: new Date(today.getTime() - 29 * DAY), to: new Date(today.getTime() + DAY) };
    default:
      return null;
  }
}

function getFilteredSales() {
  const all   = DB.getSales().slice().reverse();
  const range = getPeriodRange(currentPeriod);
  if (!range) return all;
  return all.filter(s => {
    const d = new Date(s.createdAt);
    return d >= range.from && d < range.to;
  });
}

/* ---- Stats ---- */
function renderStats() {
  const sales    = getFilteredSales();
  const revenue  = sales.reduce((s, x) => s + x.total, 0);
  const itemsQty = sales.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0);
  const avg      = sales.length > 0 ? revenue / sales.length : null;

  document.getElementById('sales-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue">🧾</div>
      <div class="stat-content">
        <div class="stat-value">${sales.length}</div>
        <div class="stat-label">จำนวนบิล</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">💰</div>
      <div class="stat-content">
        <div class="stat-value">฿${fmt(revenue)}</div>
        <div class="stat-label">ยอดขายรวม</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon yellow">📦</div>
      <div class="stat-content">
        <div class="stat-value">${itemsQty}</div>
        <div class="stat-label">สินค้าที่ขายได้ (ชิ้น)</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">📈</div>
      <div class="stat-content">
        <div class="stat-value">${avg !== null ? '฿' + fmt(avg) : '—'}</div>
        <div class="stat-label">เฉลี่ยต่อบิล</div>
      </div>
    </div>`;
}

/* ---- Sales list ---- */
function renderSalesList() {
  const sales     = getFilteredSales();
  const container = document.getElementById('sales-list');

  if (sales.length === 0) {
    container.innerHTML = `
      <div class="table-card">
        <div class="empty-state">
          <div class="es-icon">🧾</div>
          <h3>ยังไม่มีรายการขาย</h3>
          <p>เมื่อมีการขายสินค้า รายการจะแสดงที่นี่</p>
        </div>
      </div>`;
    return;
  }

  container.innerHTML = sales.map(sale => {
    const d        = new Date(sale.createdAt);
    const dateStr  = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr  = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    const preview  = sale.items.map(i => i.name).join(', ');
    const totalQty = sale.items.reduce((s, i) => s + i.qty, 0);
    const isQR     = sale.payMethod === 'qr';
    const hasDisc  = sale.discountAmt > 0;

    return `
      <div class="sale-card">
        <div class="sale-card-header" onclick="toggleDetail('${sale.id}')">
          <div class="sale-datetime">
            <div class="sale-date">${dateStr}</div>
            <div class="sale-time">${timeStr} น.</div>
            ${sale.receiptNo ? `<div class="sale-receipt-no">#${sale.receiptNo}</div>` : ''}
          </div>
          <div class="sale-summary">
            <div class="sale-items-preview">${preview}</div>
            <div class="sale-qty-label">
              ${totalQty} ชิ้น · ${sale.items.length} รายการ
              ${isQR ? '<span class="pay-badge qr">QR</span>' : ''}
              ${hasDisc ? `<span class="pay-badge disc">ลด</span>` : ''}
            </div>
          </div>
          <div class="sale-amount">
            <div class="sale-total">฿${fmt(sale.total)}</div>
          </div>
          <div class="sale-chevron" id="chevron-${sale.id}">›</div>
        </div>
        <div class="sale-detail" id="detail-${sale.id}" style="display:none">
          <table class="sale-detail-table">
            <thead>
              <tr>
                <th>สินค้า</th>
                <th style="text-align:right">ราคา/ชิ้น</th>
                <th style="text-align:center">จำนวน</th>
                <th style="text-align:right">รวม</th>
              </tr>
            </thead>
            <tbody>
              ${sale.items.map(item => `
                <tr>
                  <td>${item.name}</td>
                  <td style="text-align:right">฿${fmt(item.price)}</td>
                  <td style="text-align:center">${item.qty}</td>
                  <td style="text-align:right;font-weight:600;color:var(--primary)">฿${fmt(item.price * item.qty)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
          <div class="sale-detail-footer">
            ${hasDisc ? `
              <div class="sale-detail-row">
                <span>ราคาก่อนลด</span><span>฿${fmt(sale.subtotal)}</span>
              </div>
              <div class="sale-detail-row" style="color:var(--danger)">
                <span>${sale.discountLabel || 'ส่วนลด'}</span><span>-฿${fmt(sale.discountAmt)}</span>
              </div>` : ''}
            <div class="sale-detail-row">
              <span>ยอดชำระ</span>
              <span class="sdf-total">฿${fmt(sale.total)}</span>
            </div>
            <div class="sale-detail-row">
              <span>รับเงินมา</span>
              <span>฿${fmt(sale.cash)}</span>
            </div>
            <div class="sale-detail-row" style="color:var(--primary)">
              <span>เงินทอน</span>
              <span style="font-weight:700">฿${fmt(sale.change)}</span>
            </div>
            <div class="sale-detail-row">
              <span>วิธีชำระ</span>
              <span>${isQR ? '📱 QR PromptPay' : '💵 เงินสด'}</span>
            </div>
            ${sale.note ? `<div class="sale-detail-row"><span>หมายเหตุ</span><span style="color:var(--text-muted)">${sale.note}</span></div>` : ''}
          </div>
          <div class="sale-detail-actions">
            <button class="btn btn-sm btn-outline" onclick="reprintReceipt('${sale.id}')">🖨️ พิมพ์ซ้ำ</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteSale('${sale.id}')">🗑️ ลบรายการนี้</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ---- Export CSV ---- */
function exportCSV() {
  const sales = getFilteredSales();
  if (sales.length === 0) { showToast('ไม่มีข้อมูลในช่วงที่เลือก', 'warning'); return; }
  const BOM = '﻿';
  const headers = ['เลขที่', 'วันที่-เวลา', 'สินค้า', 'จำนวน', 'ราคา/ชิ้น', 'รวมรายการ', 'ราคาก่อนลด', 'ส่วนลด', 'ยอดชำระ', 'รับเงิน', 'เงินทอน', 'วิธีชำระ', 'หมายเหตุ'];
  const rows = sales.flatMap(s =>
    s.items.map((item, i) => [
      i === 0 ? (s.receiptNo || s.id)                : '',
      i === 0 ? new Date(s.createdAt).toLocaleString('th-TH') : '',
      item.name,
      item.qty,
      item.price.toFixed(2),
      (item.price * item.qty).toFixed(2),
      i === 0 ? ((s.subtotal ?? s.total)).toFixed(2)  : '',
      i === 0 ? ((s.discountAmt || 0)).toFixed(2)     : '',
      i === 0 ? s.total.toFixed(2)                    : '',
      i === 0 ? (s.cash || 0).toFixed(2)              : '',
      i === 0 ? (s.change || 0).toFixed(2)            : '',
      i === 0 ? (s.payMethod === 'qr' ? 'QR PromptPay' : 'เงินสด') : '',
      i === 0 ? (s.note || '')                        : '',
    ])
  );
  const csv = BOM + [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `sales_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`ส่งออก ${sales.length} บิล เรียบร้อย`);
}

/* ---- Toggle detail ---- */
function toggleDetail(id) {
  const detail  = document.getElementById(`detail-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  const isOpen  = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  chevron.classList.toggle('open', !isOpen);
}

/* ---- Set period ---- */
function setPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll('.sales-period-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  renderStats();
  renderSalesList();
}

/* ---- Delete sale ---- */
function deleteSale(id) {
  if (!confirm('ต้องการลบรายการขายนี้ใช่หรือไม่?')) return;
  DB.deleteSale(id);
  showToast('ลบรายการขายแล้ว');
  renderStats();
  renderSalesList();
}

/* ---- Reprint receipt ---- */
function reprintReceipt(saleId) {
  const sale = DB.getSales().find(s => s.id === saleId);
  if (!sale) return;
  const saleItems = sale.items.map(i => ({ product: { name: i.name, price: i.price, category: '' }, qty: i.qty }));
  const meta = {
    subtotal:      sale.subtotal ?? sale.total,
    discountAmt:   sale.discountAmt  || 0,
    discountLabel: sale.discountLabel || '',
    note:          sale.note || '',
    receiptNo:     sale.receiptNo,
    payMethod:     sale.payMethod || 'cash',
  };
  document.getElementById('reprint-content').innerHTML =
    buildReceiptHTML(saleItems, sale.total, sale.cash || sale.total, sale.change || 0,
      meta, { showSuccess: false, createdAt: sale.createdAt });
  openModal('modal-reprint');
}

function thermalReprintSale(saleId) {
  const sale = DB.getSales().find(s => s.id === saleId);
  if (!sale || typeof Printer === 'undefined' || !Printer.connected()) {
    showToast('ไม่ได้เชื่อมต่อเครื่องพิมพ์', 'warning');
    return;
  }
  const saleItems = sale.items.map(i => ({ product: { name: i.name, price: i.price, category: '' }, qty: i.qty }));
  const meta = {
    subtotal: sale.subtotal ?? sale.total,
    discountAmt: sale.discountAmt || 0,
    discountLabel: sale.discountLabel || '',
    note: sale.note || '',
    receiptNo: sale.receiptNo,
  };
  Printer.printReceipt(saleItems, sale.total, sale.cash || sale.total, sale.change || 0, meta)
    .catch(err => showToast('พิมพ์ไม่สำเร็จ: ' + err.message, 'error'));
}

/* ---- AI: Analyze sales (Agent 3) ---- */
async function analyzeWithAI() {
  const btn   = document.getElementById('btn-analyze');
  const panel = document.getElementById('ai-panel');
  const body  = document.getElementById('ai-panel-body');
  const title = document.getElementById('ai-panel-title');

  if (!Agents.getKey()) {
    showToast('กรุณาตั้งค่า Gemini API Key ในตั้งค่าร้านก่อน', 'warning');
    window.location.href = 'settings.html';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังวิเคราะห์…';
  panel.style.display = 'block';
  body.innerHTML  = '<div class="ai-loading">⏳ AI กำลังวิเคราะห์ข้อมูล…</div>';
  title.textContent = '🤖 วิเคราะห์โดย AI';

  try {
    const sales    = getFilteredSales();
    const products = DB.getProducts();
    const result   = await Agents.analyzeSales(currentPeriod, sales, products);
    const tabLabel = document.querySelector('.tab-btn.active')?.textContent?.trim() || '';
    title.textContent = `🤖 วิเคราะห์ยอดขาย — ${tabLabel}`;
    body.innerHTML = `<div class="ai-result">${result.replace(/\n/g, '<br>')}</div>`;
  } catch (err) {
    if (err.message === 'NO_DATA') {
      body.innerHTML = '<div class="ai-empty">ไม่มีข้อมูลยอดขายในช่วงที่เลือก</div>';
    } else if (err.message === 'NO_KEY') {
      body.innerHTML = '<div class="ai-empty">⚠️ ยังไม่ได้ตั้งค่า Gemini API Key — กดที่ <strong>ตั้งค่าร้าน</strong> ในเมนูซ้ายเพื่อใส่ Key</div>';
    } else {
      body.innerHTML = `<div class="ai-error">❌ เกิดข้อผิดพลาด: ${err.message}</div>`;
    }
  } finally {
    btn.disabled    = false;
    btn.textContent = '🤖 วิเคราะห์ AI';
  }
}

function closeAIPanel() {
  document.getElementById('ai-panel').style.display = 'none';
}

/* ---- AI: Daily summary (Agent 5) ---- */
async function summarizeToday() {
  if (!Agents.getKey()) {
    showToast('กรุณาตั้งค่า Gemini API Key ในตั้งค่าร้านก่อน', 'warning');
    window.location.href = 'settings.html';
    return;
  }

  const todaySales = DB.getTodaySales();
  if (!todaySales.length) {
    showToast('ยังไม่มียอดขายวันนี้', 'warning');
    return;
  }

  const textEl = document.getElementById('daily-summary-text');
  textEl.textContent = '⏳ กำลังสร้างสรุป…';
  openModal('modal-daily-summary');

  try {
    const settings = DB.getSettings();
    textEl.textContent = await Agents.summarizeDay(todaySales, settings);
  } catch (err) {
    textEl.textContent = `❌ เกิดข้อผิดพลาด: ${err.message}`;
  }
}

function copySummary() {
  const text = document.getElementById('daily-summary-text').textContent;
  navigator.clipboard.writeText(text)
    .then(() => showToast('คัดลอกแล้ว ✓'))
    .catch(() => showToast('คัดลอกไม่ได้ — ลองเลือกข้อความแล้วกด Ctrl+C', 'warning'));
}

/* ---- Modal helpers ---- */
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  renderStats();
  renderSalesList();
  document.addEventListener('click', e => {
    if (e.target.id === 'modal-daily-summary') closeModal('modal-daily-summary');
    if (e.target.id === 'modal-reprint')       closeModal('modal-reprint');
  });
});
