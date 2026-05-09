/* ============================================================
   inventory.js — inventory management page logic
   ============================================================ */

let editingId   = null;
let deleteId    = null;
let invSearch   = '';
let invCategory = 'ทั้งหมด';

/* ---- Helpers ---- */
function fmt(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2 });
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

/* ---- Stats ---- */
function renderStats() {
  const s = DB.getStats();
  document.getElementById('stat-total').textContent  = s.totalProducts;
  document.getElementById('stat-low').textContent    = s.lowStock;
  document.getElementById('stat-out').textContent    = s.outOfStock;
  document.getElementById('stat-value').textContent  = `฿${fmt(s.totalValue)}`;
}

/* ---- Filter bar ---- */
function renderFilterCategories() {
  const cats = DB.getCategories();
  const sel  = document.getElementById('inv-category-filter');
  sel.innerHTML = cats.map(c =>
    `<option value="${c}" ${c === invCategory ? 'selected' : ''}>${c}</option>`
  ).join('');
}

function getFilteredList() {
  let list = DB.getProducts();
  if (invCategory !== 'ทั้งหมด') list = list.filter(p => p.category === invCategory);
  if (invSearch) {
    const q = invSearch.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }
  return list;
}

/* ---- Table ---- */
function renderTable() {
  renderStats();
  const list  = getFilteredList();
  const tbody = document.getElementById('inv-tbody');

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="empty-state">
          <div class="es-icon">📦</div>
          <h3>ไม่พบสินค้า</h3>
          <p>ลองเปลี่ยนคำค้นหา หรือเพิ่มสินค้าใหม่</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const status = DB.getStockStatus(p);
    const badgeMap = {
      normal: `<span class="badge badge-success">ปกติ</span>`,
      low:    `<span class="badge badge-warning">⚠ เหลือน้อย</span>`,
      out:    `<span class="badge badge-danger">หมด</span>`,
    };
    const iconHtml = p.image
      ? `<img src="${p.image}" alt="${p.name}" class="prod-row-img"
             onerror="this.outerHTML='<div class=\\'prod-table-icon\\'>${DB.getEmoji(p.category)}</div>'">`
      : `<div class="prod-table-icon">${DB.getEmoji(p.category)}</div>`;

    return `
      <tr>
        <td>
          <div class="prod-name-cell">
            ${iconHtml}
            <div>
              <div class="prod-name-text">${p.name}</div>
              <div class="prod-cat-text">${p.category}</div>
            </div>
          </div>
        </td>
        <td><span class="barcode-text">${p.barcode || '—'}</span></td>
        <td style="font-weight:600">฿${fmt(p.price)}</td>
        <td>
          <span style="font-weight:700;font-size:1rem">${p.quantity}</span>
          <span style="font-size:0.78rem;color:var(--text-muted)"> ชิ้น</span>
        </td>
        <td>${badgeMap[status]}</td>
        <td style="color:var(--text-muted);font-size:0.82rem">${new Date(p.updatedAt).toLocaleDateString('th-TH')}</td>
        <td>
          <div class="action-cell">
            <button class="btn btn-sm btn-outline" onclick="openEdit('${p.id}')">✏️ แก้ไข</button>
            <button class="btn btn-sm btn-outline-danger" onclick="askDelete('${p.id}', '${p.name.replace(/'/g, '\\\'')}')" title="ลบ">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ---- Add/Edit Modal ---- */
function openAdd() {
  editingId = null;
  document.getElementById('modal-product-title').textContent = 'เพิ่มสินค้าใหม่';
  document.getElementById('product-form').reset();
  renderCategoryOptions();
  clearImage();
  hidePriceSuggestions();
  hideBarcodeHint();
  hideBarcodeProgress();
  hideImgStatus();
  clearImgPicker();
  openModal('modal-product');
}

function openEdit(id) {
  const p = DB.getProducts().find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('modal-product-title').textContent = 'แก้ไขสินค้า';
  renderCategoryOptions(p.category);
  document.getElementById('f-name').value       = p.name;
  document.getElementById('f-barcode').value    = p.barcode;
  document.getElementById('f-price').value      = p.price;
  document.getElementById('f-cost').value       = p.costPrice || '';
  document.getElementById('f-quantity').value   = p.quantity;
  document.getElementById('f-low-stock').value  = p.lowStockThreshold;
  document.getElementById('f-category').value   = p.category;
  if (p.image) updateImagePreview(p.image);
  else clearImage();
  if (p.costPrice) updatePriceSuggestions();
  else hidePriceSuggestions();
  hideBarcodeHint();
  hideBarcodeProgress();
  hideImgStatus();
  clearImgPicker();
  openModal('modal-product');
}

function renderCategoryOptions(selected = '') {
  const CATS = ['เครื่องปรุง','ข้าว','น้ำมัน','นม','ไข่','บะหมี่','เครื่องดื่ม','ผัก','ผลไม้','ขนม','ของใช้','อื่นๆ'];
  const sel  = document.getElementById('f-category');
  sel.innerHTML = CATS.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${DB.getEmoji(c)} ${c}</option>`
  ).join('');
}

function saveProduct() {
  const name      = document.getElementById('f-name').value.trim();
  const barcode   = document.getElementById('f-barcode').value.trim();
  const price     = document.getElementById('f-price').value;
  const costPrice = document.getElementById('f-cost').value;
  const quantity  = document.getElementById('f-quantity').value;
  const lowStock  = document.getElementById('f-low-stock').value;
  const category  = document.getElementById('f-category').value;
  const image     = document.getElementById('f-image').value;

  if (!name) { showToast('กรุณาระบุชื่อสินค้า', 'error'); return; }
  if (!price || parseFloat(price) < 0) { showToast('กรุณาระบุราคาที่ถูกต้อง', 'error'); return; }

  if (barcode) {
    const existing = DB.findByBarcode(barcode);
    if (existing && existing.id !== editingId) {
      showToast(`บาร์โค้ดนี้มีสินค้าอยู่แล้ว: ${existing.name}`, 'error');
      return;
    }
  }

  const data = { name, barcode, price, costPrice, quantity, category, lowStockThreshold: lowStock, image };
  if (editingId) {
    DB.updateProduct(editingId, data);
    showToast('แก้ไขสินค้าสำเร็จ');
  } else {
    DB.addProduct(data);
    showToast('เพิ่มสินค้าสำเร็จ');
  }

  closeModal('modal-product');
  renderFilterCategories();
  renderTable();
}

/* ---- Image upload ---- */
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    const img = new Image();
    img.onload = () => {
      const MAX = 300;
      let { width: w, height: h } = img;
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else       { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      updateImagePreview(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
}

function updateImagePreview(url) {
  document.getElementById('f-image').value                 = url;
  document.getElementById('img-preview').src               = url;
  document.getElementById('img-preview').style.display     = 'block';
  document.getElementById('img-placeholder').style.display = 'none';
  document.getElementById('btn-clear-img').style.display   = 'inline-flex';
}

function clearImage() {
  document.getElementById('f-image').value                 = '';
  document.getElementById('img-preview').src               = '';
  document.getElementById('img-preview').style.display     = 'none';
  document.getElementById('img-placeholder').style.display = 'flex';
  document.getElementById('btn-clear-img').style.display   = 'none';
}

/* ---- Price suggestions ---- */
function updatePriceSuggestions() {
  const cost = parseFloat(document.getElementById('f-cost').value);
  const box  = document.getElementById('price-suggestions');
  if (!cost || cost <= 0) { hidePriceSuggestions(); return; }

  const levels = [
    { label: 'กำไร 20%', pct: 0.20 },
    { label: 'กำไร 30%', pct: 0.30 },
    { label: 'กำไร 40%', pct: 0.40 },
    { label: 'กำไร 50%', pct: 0.50 },
  ];
  const current = parseFloat(document.getElementById('f-price').value) || 0;

  box.style.display = 'block';
  box.innerHTML = `
    <div class="price-sug-label">ราคาขายแนะนำ (คลิกเพื่อใช้)</div>
    <div class="price-sug-row">
      ${levels.map(({ label, pct }) => {
        const price = Math.ceil(cost / (1 - pct));
        const active = current === price ? ' active' : '';
        return `<button type="button" class="price-chip${active}" onclick="applyPrice(${price}, this)">
          ${label}
          <span class="chip-price">฿${price}</span>
        </button>`;
      }).join('')}
    </div>`;
}

function applyPrice(price, chipEl) {
  document.getElementById('f-price').value = price;
  document.querySelectorAll('.price-chip').forEach(el => el.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');
  const input = document.getElementById('f-price');
  input.style.borderColor = 'var(--primary)';
  input.style.boxShadow   = '0 0 0 3px rgba(22,163,74,0.15)';
  setTimeout(() => { input.style.borderColor = ''; input.style.boxShadow = ''; }, 700);
}

function hidePriceSuggestions() {
  const box = document.getElementById('price-suggestions');
  box.style.display = 'none';
  box.innerHTML     = '';
}

/* ---- Delete ---- */
function askDelete(id, name) {
  deleteId = id;
  document.getElementById('delete-name').textContent = name;
  openModal('modal-delete');
}

function confirmDelete() {
  if (!deleteId) return;
  DB.deleteProduct(deleteId);
  deleteId = null;
  showToast('ลบสินค้าสำเร็จ');
  closeModal('modal-delete');
  renderFilterCategories();
  renderTable();
}

/* ---- Gemini API Settings ---- */
function loadGeminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

function saveGeminiKey() {
  const key = document.getElementById('gemini-key').value.trim();
  localStorage.setItem('gemini_api_key', key);
  sessionStorage.removeItem('gemini_model'); // re-detect model on next call
  updateGapiStatus();
  showToast('บันทึก Gemini Key แล้ว');
}

async function testGeminiKey() {
  const key = loadGeminiKey();
  if (!key) { showToast('ใส่ API Key ก่อน', 'warning'); return; }
  const statusEl = document.getElementById('gapi-status');
  statusEl.textContent = '⏳ กำลังทดสอบ…';
  statusEl.className   = 'gapi-status';
  try {
    const result = await lookupWithGemini('8850926100022');
    const name = result?.name_th || result?.name_en || '';
    if (name) {
      statusEl.textContent = '✅ พร้อมใช้งาน';
      statusEl.className   = 'gapi-status ready';
      showToast(`✅ Gemini ใช้งานได้ — ทดสอบ: ${name}`, 'success');
    } else {
      statusEl.textContent = '✅ พร้อมใช้งาน';
      statusEl.className   = 'gapi-status ready';
      showToast('✅ Gemini API ใช้งานได้', 'success');
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    statusEl.className   = 'gapi-status notset';
    showToast(`❌ ${err.message}`, 'error');
  }
}

function updateGapiStatus() {
  const key = loadGeminiKey();
  const statusEl = document.getElementById('gapi-status');
  if (!statusEl) return;
  if (key) {
    statusEl.textContent = '✅ พร้อมใช้งาน';
    statusEl.className   = 'gapi-status ready';
  } else {
    statusEl.textContent = '⚠️ ยังไม่ได้ตั้งค่า';
    statusEl.className   = 'gapi-status notset';
  }
  const keyEl = document.getElementById('gemini-key');
  if (keyEl && key) keyEl.value = key;
}

/* ---- Gemini: auto-detect best available model ---- */
async function getGeminiModel(apiKey) {
  const cached = sessionStorage.getItem('gemini_model');
  if (cached) return cached;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
  );
  const data = await res.json();
  const available = (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));

  const priority = [
    'gemini-1.5-flash', 'gemini-1.5-flash-001', 'gemini-1.5-flash-002',
    'gemini-1.5-pro',   'gemini-1.5-pro-001',
    'gemini-pro',       'gemini-1.0-pro',
  ];
  const model = priority.find(p => available.includes(p)) || available[0] || 'gemini-pro';
  sessionStorage.setItem('gemini_model', model);
  return model;
}

/* ---- Keyword-based category guesser (fallback when Gemini not configured) ---- */
const CATS = ['เครื่องปรุง','ข้าว','น้ำมัน','นม','ไข่','บะหมี่','เครื่องดื่ม','ผัก','ผลไม้','ขนม','ของใช้','อื่นๆ'];

function guessCategory(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  const rules = [
    [/ข้าว|rice|jasmine|หอมมะลิ/,                                              'ข้าว'],
    [/น้ำมัน|oil|ปาล์ม|รำข้าว|มะพร้าว/,                                       'น้ำมัน'],
    [/นม|milk|dairy|โยเกิร์ต|yogurt|ครีม|cheese|เนย/,                         'นม'],
    [/ไข่|egg/,                                                                 'ไข่'],
    [/บะหมี่|มาม่า|noodle|instant|โจ๊ก|วุ้นเส้น|เส้น|ราเมน|ก๋วยเตี๋ยว/,     'บะหมี่'],
    [/น้ำอัดลม|โค้ก|เป๊ปซี่|สไปรท์|น้ำผลไม้|juice|drink|cola|เบียร์|beer|ชา|tea|กาแฟ|coffee|เอส|กระทิงแดง|ชาเขียว|น้ำเก๊กฮวย|เครื่องดื่ม/, 'เครื่องดื่ม'],
    [/น้ำดื่ม|น้ำเปล่า|water/,                                                 'เครื่องดื่ม'],
    [/ผัก|กะหล่ำ|มะเขือ|ฟักทอง|ผักบุ้ง|คะน้า|vegetable|lettuce/,            'ผัก'],
    [/ผลไม้|fruit|กล้วย|แอปเปิ้ล|ส้ม|มะม่วง|องุ่น|สตรอว์เบอร์รี่/,         'ผลไม้'],
    [/ขนม|บิสกิต|cookie|chip|snack|ช็อก|คุก|โอริโอ|potato|ป๊อปคอร์น|วาฟเฟิล|เวเฟอร์|ทอฟฟี่|ลูกอม|candy/, 'ขนม'],
    [/ซอส|น้ำปลา|ซีอิ๊ว|กะปิ|พริก|เกลือ|น้ำตาล|ผงชูรส|ปรุงรส|seasoning|sauce|vinegar|น้ำส้มสายชู|มายองเนส/, 'เครื่องปรุง'],
    [/แชมพู|สบู่|ยาสีฟัน|ครีมนวด|โลชั่น|shampoo|soap|toothpaste|detergent|ผ้าอนามัย|ทิชชู่|tissue|ยา|deodorant|ผงซักฟอก|น้ำยา/, 'ของใช้'],
  ];
  for (const [pattern, cat] of rules) {
    if (pattern.test(n)) return cat;
  }
  return null;
}

/* ---- Gemini lookup ---- */
async function lookupWithGemini(barcode) {
  const apiKey = loadGeminiKey();
  if (!apiKey) return null;

  const model = await getGeminiModel(apiKey);
  const prompt =
    `ค้นหาชื่อสินค้าจากบาร์โค้ด EAN/UPC: ${barcode}\n` +
    `ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:\n` +
    `{"name_th":"ชื่อสินค้าภาษาไทย","name_en":"product name","brand":"brand","category":"หมวดหมู่"}\n` +
    `โดย category ต้องเป็นหนึ่งในนี้เท่านั้น: ${CATS.join(', ')}\n` +
    `ถ้าไม่พบให้ใส่ค่าว่าง ""`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 256 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

/* ---- Barcode Lookup ---- */
let barcodeTimer = null;

function onBarcodeInput(e) {
  clearTimeout(barcodeTimer);
  const barcode = e.target.value.trim();
  hideBarcodeHint();
  hideBarcodeProgress();
  if (barcode.length < 4) return;
  barcodeTimer = setTimeout(() => lookupBarcodeInfo(barcode), 900);
}

function showBarcodeProgress() {
  const el = document.getElementById('barcode-progress');
  if (el) el.style.display = 'block';
}
function hideBarcodeProgress() {
  const el = document.getElementById('barcode-progress');
  if (el) el.style.display = 'none';
}

async function lookupBarcodeInfo(barcode) {
  showBarcodeProgress();
  hideBarcodeHint();
  clearImgPicker();
  showImgStatus('🔍 กำลังค้นหาข้อมูลสินค้า…', 'loading');

  /* run OpenFoodFacts + Gemini in parallel */
  const [offResult, geminiResult] = await Promise.all([
    fetchFromOFF(barcode),
    loadGeminiKey() ? lookupWithGemini(barcode).catch(() => null) : Promise.resolve(null),
  ]);

  hideBarcodeProgress();

  /* Priority: OFF Thai > Gemini Thai > Gemini English > OFF English */
  const nameField = document.getElementById('f-name');
  let suggested = '';
  if (offResult?.th)               suggested = offResult.th;
  else if (geminiResult?.name_th)  suggested = geminiResult.name_th;
  else if (geminiResult?.name_en)  suggested = geminiResult.name_en;
  else if (offResult?.en)          suggested = offResult.en;

  /* Auto-detect category */
  let detectedCategory = null;
  if (geminiResult?.category && CATS.includes(geminiResult.category)) {
    detectedCategory = geminiResult.category;
  } else if (suggested) {
    detectedCategory = guessCategory(suggested);
  }
  if (detectedCategory) {
    const catSel = document.getElementById('f-category');
    catSel.value = detectedCategory;
    catSel.style.borderColor = 'var(--primary)';
    catSel.style.boxShadow   = '0 0 0 3px rgba(22,163,74,0.15)';
    setTimeout(() => { catSel.style.borderColor = ''; catSel.style.boxShadow = ''; }, 1200);
  }

  if (suggested) {
    if (!nameField.value.trim()) nameField.value = suggested;
    const src = offResult?.th ? 'OFF' : geminiResult ? 'Gemini' : 'OFF';
    const catTag = detectedCategory ? ` · ${detectedCategory}` : '';
    showBarcodeHint(`✅ พบ: ${suggested} (${src})${catTag}`, 'found');
  } else {
    showBarcodeHint('ไม่พบข้อมูลสินค้า', 'not-found');
  }

  /* Images from OpenFoodFacts */
  if (offResult?.image) {
    hideImgStatus();
    renderImagePicker([{ thumb: offResult.image, title: suggested || barcode, source: 'off' }]);
  } else {
    showImgStatus('ไม่พบรูปภาพ (อัปโหลดเองได้)', 'not-found');
  }
}

async function fetchFromOFF(barcode) {
  try {
    const res  = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name_th,product_name,image_front_thumb_url,image_thumb_url`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1) return null;
    const p = data.product;
    const image = p.image_front_thumb_url || p.image_thumb_url || '';
    return { th: p.product_name_th || '', en: p.product_name || '', image };
  } catch { return null; }
}


function showBarcodeHint(msg, type) {
  const el = document.getElementById('barcode-hint');
  if (!el) return;
  el.style.display = 'flex';
  el.className     = `barcode-hint ${type}`;
  el.innerHTML     = `<span>${msg}</span>`;
}

function hideBarcodeHint() {
  const el = document.getElementById('barcode-hint');
  if (el) el.style.display = 'none';
}

async function triggerImageSearch() {
  const barcode = document.getElementById('f-barcode').value.trim();
  const name    = document.getElementById('f-name').value.trim();
  if (!barcode && !name) {
    showToast('ระบุชื่อสินค้าหรือบาร์โค้ดก่อน', 'warning');
    return;
  }
  if (barcode) {
    await lookupBarcodeInfo(barcode);
  } else {
    await searchImagesByName(name);
  }
}

async function searchImagesByName(name) {
  showImgStatus('🔍 กำลังค้นหารูปภาพ…', 'loading');
  clearImgPicker();
  const images = await fetchOFFByName(name);
  if (images.length) {
    hideImgStatus();
    renderImagePicker(images);
  } else {
    showImgStatus('ไม่พบรูปภาพ ลองเปลี่ยนคำค้นหา', 'not-found');
  }
}

async function fetchOFFByName(name) {
  try {
    const q   = encodeURIComponent(name);
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1` +
      `&fields=product_name,product_name_th,image_front_thumb_url&page_size=8`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.products || [])
      .filter(p => p.image_front_thumb_url)
      .map(p => ({
        thumb: p.image_front_thumb_url,
        title: p.product_name_th || p.product_name || name,
        source: 'off',
      }));
  } catch { return []; }
}

function showImgStatus(msg, type) {
  const el = document.getElementById('auto-img-status');
  if (!el) return;
  el.style.display = 'block';
  el.textContent   = msg;
  el.className     = `auto-img-status ${type}`;
}
function hideImgStatus() {
  const el = document.getElementById('auto-img-status');
  if (el) el.style.display = 'none';
}

function renderImagePicker(images) {
  const grid = document.getElementById('img-picker-grid');
  if (!grid) return;
  grid.style.display = 'grid';
  grid.innerHTML = images.map(img => {
    const badge = img.source === 'off'
      ? `<span class="img-source-badge">OFF</span>` : '';
    return `
    <div class="img-picker-item" data-url="${img.thumb}"
         onclick="selectPickedImage(this)" title="${img.title}">
      <img src="${img.thumb}" alt="${img.title}" loading="lazy"
           onerror="this.parentElement.style.display='none'">
      ${badge}
    </div>`;
  }).join('');
}

function selectPickedImage(el) {
  document.querySelectorAll('.img-picker-item').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  updateImagePreview(el.dataset.url);
}

function clearImgPicker() {
  const grid = document.getElementById('img-picker-grid');
  if (!grid) return;
  grid.style.display = 'none';
  grid.innerHTML     = '';
}

/* ---- Camera scanner for barcode field ---- */
async function scanForBarcode() {
  openModal('modal-cam-inv');
  await BarcodeScanner.startCamera('reader-inv', code => {
    document.getElementById('f-barcode').value = code;
    stopInvCamera();
    showToast(`สแกนบาร์โค้ด: ${code}`);
    lookupBarcodeInfo(code);
  });
}

async function stopInvCamera() {
  await BarcodeScanner.stopCamera();
  closeModal('modal-cam-inv');
}

/* ---- Modal helpers ---- */
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  updateGapiStatus();
  renderFilterCategories();
  renderTable();

  document.getElementById('f-cost').addEventListener('input', updatePriceSuggestions);
  document.getElementById('f-barcode').addEventListener('input', onBarcodeInput);

  let invSearchTimer = null;
  document.getElementById('inv-search-input').addEventListener('input', e => {
    clearTimeout(invSearchTimer);
    invSearchTimer = setTimeout(() => {
      invSearch = e.target.value;
      renderTable();
    }, 160);
  });

  document.getElementById('inv-category-filter').addEventListener('change', e => {
    invCategory = e.target.value;
    renderTable();
  });

  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', async e => {
      if (e.target === el) {
        if (el.id === 'modal-cam-inv') await stopInvCamera();
        else closeModal(el.id);
      }
    });
  });
});
