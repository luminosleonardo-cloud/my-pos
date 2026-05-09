/* ============================================================
   printer.js — ESC/POS thermal printer + cash drawer
   Supports: Web Serial API (USB/Serial) + Web Bluetooth BLE
   Chrome / Edge only
   ============================================================ */

const Printer = (() => {
  const ESC = 0x1B, GS = 0x1D;

  const CMD = {
    INIT:         [ESC, 0x40],
    CUT:          [GS,  0x56, 0x42, 0x00],
    DRAWER_P2:    [ESC, 0x70, 0x00, 0x19, 0xFA],
    DRAWER_P5:    [ESC, 0x70, 0x01, 0x19, 0xFA],
    ALIGN_LEFT:   [ESC, 0x61, 0x00],
    ALIGN_CENTER: [ESC, 0x61, 0x01],
    BOLD_ON:      [ESC, 0x45, 0x01],
    BOLD_OFF:     [ESC, 0x45, 0x00],
    SIZE_NORMAL:  [ESC, 0x21, 0x00],
    SIZE_TALL:    [ESC, 0x21, 0x10],
  };

  /* Serial state */
  let port = null, writer = null;
  /* Bluetooth state */
  let btDevice = null, btCharacteristic = null;

  const enc = new TextEncoder();

  /* ---- Settings ---- */
  function cfg() {
    return {
      baud:       Number(localStorage.getItem('hw_baud')       || 9600),
      paper:      Number(localStorage.getItem('hw_paper')      || 58),
      drawerMode: localStorage.getItem('hw_drawer')            || 'auto',
      drawerPin:  localStorage.getItem('hw_drawer_pin')        || '0',
    };
  }
  function saveCfg(obj) {
    Object.entries(obj).forEach(([k, v]) => localStorage.setItem('hw_' + k, v));
  }
  const cols = () => cfg().paper === 80 ? 48 : 32;

  /* ---- Low-level write (routes to Serial or BLE) ---- */
  async function _writeBT(data) {
    if (!btCharacteristic) return;
    const arr  = data instanceof Uint8Array ? data : new Uint8Array(data);
    const CHUNK = 512;
    for (let i = 0; i < arr.length; i += CHUNK) {
      const slice = arr.slice(i, i + CHUNK);
      if (btCharacteristic.properties.writeWithoutResponse) {
        await btCharacteristic.writeValueWithoutResponse(slice);
      } else {
        await btCharacteristic.writeValue(slice);
      }
      if (arr.length > CHUNK) await new Promise(r => setTimeout(r, 20));
    }
  }

  async function _bytes(arr) {
    if (writer)           await writer.write(new Uint8Array(arr));
    else if (btCharacteristic) await _writeBT(new Uint8Array(arr));
  }
  async function _text(str) {
    if (writer)           await writer.write(enc.encode(str));
    else if (btCharacteristic) await _writeBT(enc.encode(str));
  }

  /* ---- Connection state ---- */
  const available     = 'serial' in navigator;
  const availableBT   = 'bluetooth' in navigator;
  const connected     = () => port !== null || btDevice !== null;
  const connectedType = () => port ? 'serial' : btDevice ? 'bluetooth' : null;

  /* ---- Serial connect / disconnect ---- */
  async function connect() {
    if (!available) throw new Error('ต้องใช้ Chrome หรือ Edge (Web Serial API)');
    const p = await navigator.serial.requestPort();
    await p.open({ baudRate: cfg().baud });
    port = p;
    writer = p.writable.getWriter();
    refreshUI();
  }

  async function disconnect() {
    try { writer?.releaseLock(); } catch {}
    try { await port?.close();   } catch {}
    port = null; writer = null;
    refreshUI();
  }

  /* ---- Bluetooth connect / disconnect ---- */
  const BLE_SERVICES = [
    '0000ffe0-0000-1000-8000-00805f9b34fb',   /* generic BLE serial (most common) */
    '000018f0-0000-1000-8000-00805f9b34fb',   /* Xprinter BLE */
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',   /* Star Micronics */
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',   /* Handheld */
    '0000ff00-0000-1000-8000-00805f9b34fb',   /* some HOIN/RPP printers */
  ];

  async function connectBluetooth() {
    if (!availableBT) throw new Error('เบราว์เซอร์ไม่รองรับ Web Bluetooth');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES,
    });
    const server = await device.gatt.connect();

    /* Try known service UUIDs first */
    let char = null;
    for (const uuid of BLE_SERVICES) {
      try {
        const svc   = await server.getPrimaryService(uuid);
        const chars = await svc.getCharacteristics();
        char = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        if (char) break;
      } catch {}
    }

    /* Fallback: enumerate all services */
    if (!char) {
      try {
        const svcs = await server.getPrimaryServices();
        for (const svc of svcs) {
          try {
            const chars = await svc.getCharacteristics();
            char = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
            if (char) break;
          } catch {}
        }
      } catch {}
    }

    if (!char) throw new Error('ไม่พบ characteristic สำหรับพิมพ์งาน');

    btDevice = device;
    btCharacteristic = char;
    device.addEventListener('gattserverdisconnected', () => {
      btDevice = null; btCharacteristic = null;
      refreshUI();
      _toast('บลูทูธตัดการเชื่อมต่อ', 'warning');
    });
    refreshUI();
  }

  async function disconnectBluetooth() {
    try { btDevice?.gatt?.disconnect(); } catch {}
    btDevice = null; btCharacteristic = null;
    refreshUI();
  }

  /* ---- Cash drawer ---- */
  async function openDrawer() {
    if (!connected()) { _toast('เครื่องพิมพ์ไม่ได้เชื่อมต่อ', 'warning'); return; }
    await _bytes(cfg().drawerPin === '1' ? CMD.DRAWER_P5 : CMD.DRAWER_P2);
  }

  /* ---- Receipt printing ---- */
  function _pad(left, right, width) {
    const space = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, space)) + right;
  }

  function _shopSettings() {
    return typeof DB !== 'undefined' ? DB.getSettings()
      : { shopName: 'ร้านขายของชำ', address: '', phone: '', footer: 'ขอบคุณที่ใช้บริการ' };
  }

  async function printReceipt(saleItems, total, cash, change, meta = {}) {
    if (!connected()) return false;
    const w    = cols();
    const line = '-'.repeat(w);
    const s    = _shopSettings();
    const { subtotal, discountAmt, discountLabel, note, receiptNo } = meta;

    await _bytes(CMD.INIT);
    await _bytes(CMD.ALIGN_CENTER);
    await _bytes(CMD.BOLD_ON);
    await _bytes(CMD.SIZE_TALL);
    await _text((s.shopName || 'ร้านขายของชำ') + '\n');
    await _bytes(CMD.SIZE_NORMAL);
    await _bytes(CMD.BOLD_OFF);
    if (s.address) await _text(s.address + '\n');
    if (s.phone)   await _text('โทร: ' + s.phone + '\n');
    await _text(new Date().toLocaleString('th-TH') + '\n');
    if (receiptNo) await _text('เลขที่: ' + receiptNo + '\n');
    await _text(line + '\n');

    await _bytes(CMD.ALIGN_LEFT);
    for (const { product: p, qty } of saleItems) {
      const name  = p.name.slice(0, w - 12);
      const price = '฿' + (p.price * qty).toFixed(2);
      await _text(_pad(`${name} x${qty}`, price, w) + '\n');
    }

    await _text(line + '\n');
    if (discountAmt > 0) {
      await _text(_pad('ราคารวม', '฿' + subtotal.toFixed(2), w) + '\n');
      await _text(_pad(discountLabel || 'ส่วนลด', '-฿' + discountAmt.toFixed(2), w) + '\n');
    }
    await _bytes(CMD.BOLD_ON);
    await _text(_pad('ยอดชำระ', '฿' + total.toFixed(2), w) + '\n');
    await _bytes(CMD.BOLD_OFF);
    await _text(_pad('รับเงิน', '฿' + cash.toFixed(2), w) + '\n');
    await _text(_pad('เงินทอน', '฿' + (cash - total).toFixed(2), w) + '\n');
    if (note) await _text('หมายเหตุ: ' + note + '\n');
    await _bytes(CMD.ALIGN_CENTER);
    await _text(line + '\n');
    await _text((s.footer || 'ขอบคุณที่ใช้บริการ') + '\n\n\n');
    await _bytes(CMD.CUT);

    if (cfg().drawerMode === 'auto') await _bytes(
      cfg().drawerPin === '1' ? CMD.DRAWER_P5 : CMD.DRAWER_P2
    );
    return true;
  }

  async function printShiftReport(shift) {
    if (!connected()) return false;
    const w    = cols();
    const line = '-'.repeat(w);
    const s    = _shopSettings();
    const { startCash, openedAt, closedAt, actualCash, summary } = shift;
    const { totalSales, txCount, expectedCash, discrepancy } = summary;

    await _bytes(CMD.INIT);
    await _bytes(CMD.ALIGN_CENTER);
    await _bytes(CMD.BOLD_ON);
    await _bytes(CMD.SIZE_TALL);
    await _text((s.shopName || 'ร้านขายของชำ') + '\n');
    await _bytes(CMD.SIZE_NORMAL);
    await _bytes(CMD.BOLD_OFF);
    await _text('รายงานปิดกะ\n');
    await _text(new Date().toLocaleString('th-TH') + '\n');
    await _text(line + '\n');

    await _bytes(CMD.ALIGN_LEFT);
    await _text(_pad('เปิดกะ', new Date(openedAt).toLocaleTimeString('th-TH'), w) + '\n');
    await _text(_pad('ปิดกะ',  new Date(closedAt).toLocaleTimeString('th-TH'), w) + '\n');
    await _text(line + '\n');
    await _text(_pad('เงินเปิดกะ', '฿' + startCash.toFixed(2), w) + '\n');
    await _text(_pad(`ยอดขาย (${txCount} บิล)`, '฿' + totalSales.toFixed(2), w) + '\n');
    await _bytes(CMD.BOLD_ON);
    await _text(_pad('เงินที่ควรมี', '฿' + expectedCash.toFixed(2), w) + '\n');
    await _bytes(CMD.BOLD_OFF);
    await _text(_pad('เงินที่นับได้', '฿' + actualCash.toFixed(2), w) + '\n');
    const diffStr = (discrepancy >= 0 ? '+' : '') + '฿' + Math.abs(discrepancy).toFixed(2);
    await _bytes(CMD.BOLD_ON);
    await _text(_pad('ส่วนต่าง', diffStr, w) + '\n');
    await _bytes(CMD.BOLD_OFF);
    await _bytes(CMD.ALIGN_CENTER);
    await _text(line + '\n\n\n');
    await _bytes(CMD.CUT);
    return true;
  }

  async function testPrint() {
    if (!connected()) { _toast('เชื่อมต่อเครื่องพิมพ์ก่อน', 'warning'); return; }
    const w = cols();
    await _bytes(CMD.INIT);
    await _bytes(CMD.ALIGN_CENTER);
    await _bytes(CMD.BOLD_ON);
    await _text('-- ทดสอบการพิมพ์ --\n');
    await _bytes(CMD.BOLD_OFF);
    await _text(`กระดาษ ${cfg().paper} มม. (${w} ตัวอักษร)\n`);
    await _text(`เชื่อมต่อ: ${connectedType() === 'bluetooth' ? 'บลูทูธ' : 'Serial'}\n`);
    await _text(new Date().toLocaleString('th-TH') + '\n');
    await _text('-'.repeat(w) + '\n');
    await _text('ร้านขายของชำ\n\n\n');
    await _bytes(CMD.CUT);
    _toast('พิมพ์ทดสอบแล้ว', 'success');
  }

  /* ---- UI sync ---- */
  function refreshUI() {
    const on   = connected();
    const type = connectedType();

    const statusEl    = document.getElementById('hw-status');
    const connectBtn  = document.getElementById('btn-hw-connect');
    const disconnBtn  = document.getElementById('btn-hw-disconnect');
    const connectBtBtn= document.getElementById('btn-hw-connect-bt');
    const disconnBtBtn= document.getElementById('btn-hw-disconnect-bt');
    const drawerBtn   = document.getElementById('btn-open-drawer');
    const thermalBtn  = document.getElementById('btn-thermal-print');

    if (statusEl) {
      if (!on) {
        statusEl.textContent = '🔴 ยังไม่เชื่อมต่อ';
        statusEl.className   = 'hw-status';
      } else if (type === 'serial') {
        statusEl.textContent = '🟢 เชื่อมต่อ (Serial)';
        statusEl.className   = 'hw-status connected';
      } else {
        statusEl.textContent = '🔵 เชื่อมต่อ (บลูทูธ)';
        statusEl.className   = 'hw-status connected';
      }
    }
    if (connectBtn)   connectBtn.style.display   = !on ? 'inline-flex' : 'none';
    if (disconnBtn)   disconnBtn.style.display   = (type === 'serial')    ? 'inline-flex' : 'none';
    if (connectBtBtn) connectBtBtn.style.display = !on ? 'inline-flex' : 'none';
    if (disconnBtBtn) disconnBtBtn.style.display = (type === 'bluetooth') ? 'inline-flex' : 'none';
    if (drawerBtn)    drawerBtn.style.display     = (on && cfg().drawerMode === 'manual') ? 'flex' : 'none';
    if (thermalBtn)   thermalBtn.style.display    = on ? 'inline-flex' : 'none';

    const ind = document.getElementById('hw-indicator');
    if (ind) ind.style.background = on ? 'var(--primary)' : 'transparent';
  }

  function loadSettingsUI() {
    const c = cfg();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('hw-paper',      c.paper);
    set('hw-baud',       c.baud);
    set('hw-drawer',     c.drawerMode);
    set('hw-drawer-pin', c.drawerPin);
    refreshUI();
  }

  function saveSettingsUI() {
    const get = id => { const el = document.getElementById(id); return el ? el.value : null; };
    saveCfg({
      paper:       get('hw-paper'),
      baud:        get('hw-baud'),
      drawer:      get('hw-drawer'),
      drawer_pin:  get('hw-drawer-pin'),
    });
    refreshUI();
    _toast('บันทึกการตั้งค่าแล้ว', 'success');
  }

  function _toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
  }

  return {
    available, availableBT, connected, connectedType, cfg,
    connect, disconnect,
    connectBluetooth, disconnectBluetooth,
    openDrawer, printReceipt, printShiftReport, testPrint,
    refreshUI, loadSettingsUI, saveSettingsUI,
  };
})();
