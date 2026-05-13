/* ============================================================
   printer.js — ESC/POS thermal printer + cash drawer  v2
   • Web Serial (USB) + Web Bluetooth BLE
   • Heartbeat + auto-reconnect (Serial & BLE)
   • Thai: TIS-620 text mode OR canvas image fallback
   • Pending-receipt queue — auto-prints on reconnect
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
    SIZE_DOUBLE_H:[ESC, 0x21, 0x10],
    CHARSET_THAI: [ESC, 0x52, 0x0E],   // ESC R 14 = Thai charset
  };

  /* ── State ─────────────────────────────────────────────── */
  let port = null, writer = null;
  let btDevice = null, btChar = null;
  let _heartbeatTimer = null;
  let _lastWriteAt    = 0;
  let _pendingJob     = null;   // { saleItems, total, cash, change, meta }

  /* ── Settings ───────────────────────────────────────────── */
  function cfg() {
    return {
      baud:       Number(localStorage.getItem('hw_baud')       || 9600),
      paper:      Number(localStorage.getItem('hw_paper')      || 58),
      drawerMode: localStorage.getItem('hw_drawer')            || 'auto',
      drawerPin:  localStorage.getItem('hw_drawer_pin')        || '0',
      printMode:  localStorage.getItem('hw_print_mode')        || 'text',  // 'text' | 'image'
      codePage:   Number(localStorage.getItem('hw_codepage')   || 21),     // 21=CP874 (1B 74 15), 20=TIS-620
    };
  }
  function saveCfg(obj) {
    Object.entries(obj).forEach(([k, v]) => localStorage.setItem('hw_' + k, v));
  }
  const cols = () => cfg().paper === 80 ? 48 : 32;

  /* ── Thai TIS-620 encoding ─────────────────────────────── */
  /* Thai Unicode U+0E01–U+0E7F maps to TIS-620 0xA1–0xFF    */
  function _encodeThai(str) {
    const out = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x0E01 && cp <= 0x0E7F) {
        const b = cp - 0x0E00 + 0xA0;
        out.push(b <= 0xFF ? b : 0x3F);
      } else if (cp < 0x80) {
        out.push(cp);
      } else if (cp === 0x2019 || cp === 0x2018) {
        out.push(0x27);         // curly quotes → straight
      } else {
        out.push(0x3F);         // '?' fallback
      }
    }
    return new Uint8Array(out);
  }

  /* ── Low-level write ────────────────────────────────────── */
  async function _writeBT(data) {
    if (!btChar) return;
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
    const CHUNK = 512;
    for (let i = 0; i < arr.length; i += CHUNK) {
      const sl = arr.slice(i, i + CHUNK);
      if (btChar.properties.writeWithoutResponse) await btChar.writeValueWithoutResponse(sl);
      else await btChar.writeValue(sl);
      if (arr.length > CHUNK) await new Promise(r => setTimeout(r, 20));
    }
  }

  async function _bytes(arr) {
    _lastWriteAt = Date.now();
    if (writer) await writer.write(new Uint8Array(arr));
    else if (btChar) await _writeBT(new Uint8Array(arr));
  }

  /* Write Thai text as TIS-620 (skipped in image mode) */
  async function _text(str) {
    _lastWriteAt = Date.now();
    const encoded = _encodeThai(str);
    if (writer) await writer.write(encoded);
    else if (btChar) await _writeBT(encoded);
  }

  /* ── Connection state ───────────────────────────────────── */
  const available   = 'serial' in navigator;
  const availableBT = 'bluetooth' in navigator;
  const connected   = () => port !== null || btDevice !== null;
  const connectedType = () => port ? 'serial' : btDevice ? 'bluetooth' : null;

  /* ── Heartbeat ──────────────────────────────────────────── */
  function _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = setInterval(async () => {
      if (!connected()) { _stopHeartbeat(); return; }
      if (Date.now() - _lastWriteAt < 4500) return;   // skip if recently wrote
      try {
        if (writer) await writer.write(new Uint8Array([0x00])); // null byte no-op
        _lastWriteAt = Date.now();
      } catch {
        _onSerialDisconnect();
      }
    }, 5000);
  }

  function _stopHeartbeat() {
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
  }

  async function _onSerialDisconnect() {
    _stopHeartbeat();
    try { writer?.releaseLock(); } catch {}
    try { await port?.close();   } catch {}
    port = null; writer = null;
    refreshUI();
    _toast('เครื่องพิมพ์ตัดการเชื่อมต่อ', 'warning');
    setTimeout(_tryAutoConnect, 3000);
  }

  /* ── Serial auto-reconnect ──────────────────────────────── */
  async function _tryAutoConnect() {
    if (!available || connected()) return;
    try {
      const ports = await navigator.serial.getPorts();
      if (!ports.length) return;

      /* Prefer the previously-used port by vendorId/productId */
      let target = ports[0];
      try {
        const saved = JSON.parse(localStorage.getItem('hw_serial_port') || 'null');
        if (saved && ports.length > 1) {
          const match = ports.find(p => {
            const info = p.getInfo();
            return info.usbVendorId === saved.usbVendorId &&
                   info.usbProductId === saved.usbProductId;
          });
          if (match) target = match;
        }
      } catch {}

      await target.open({ baudRate: cfg().baud });
      port   = target;
      writer = target.writable.getWriter();
      await _initPrinter();
      refreshUI();
      _startHeartbeat();
      _drainPending();
      _toast('เชื่อมต่อเครื่องพิมพ์อัตโนมัติ ✓', 'success');
    } catch {
      /* Silently fail — port might be busy or not a printer */
    }
  }

  /* ── Pending receipt queue ──────────────────────────────── */
  function setPending(saleItems, total, cash, change, meta) {
    _pendingJob = { saleItems, total, cash, change, meta };
  }

  function _drainPending() {
    if (!_pendingJob || !connected()) return;
    const job = _pendingJob;
    _pendingJob = null;
    printReceipt(job.saleItems, job.total, job.cash, job.change, job.meta).catch(() => {});
  }

  /* ── Init printer (code page + charset) ─────────────────── */
  async function _initPrinter() {
    await _bytes(CMD.INIT);
    if (cfg().printMode !== 'image') {
      await _bytes([ESC, 0x74, cfg().codePage]); // set Thai code page
      await _bytes(CMD.CHARSET_THAI);
    }
  }

  /* ── Serial connect ─────────────────────────────────────── */
  async function connect() {
    if (!available) throw new Error('ต้องใช้ Chrome หรือ Edge (Web Serial API)');
    const p = await navigator.serial.requestPort();
    await p.open({ baudRate: cfg().baud });
    port   = p;
    writer = p.writable.getWriter();
    try { localStorage.setItem('hw_serial_port', JSON.stringify(p.getInfo())); } catch {}
    await _initPrinter();
    _startHeartbeat();
    refreshUI();
    _drainPending();
  }

  async function disconnect() {
    _stopHeartbeat();
    try { writer?.releaseLock(); } catch {}
    try { await port?.close();   } catch {}
    port = null; writer = null;
    refreshUI();
  }

  /* ── Bluetooth connect ──────────────────────────────────── */
  const BLE_SERVICES = [
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
  ];

  async function _getBLEChar(server) {
    for (const uuid of BLE_SERVICES) {
      try {
        const svc   = await server.getPrimaryService(uuid);
        const chars = await svc.getCharacteristics();
        const ch    = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
        if (ch) return ch;
      } catch {}
    }
    try {
      for (const svc of await server.getPrimaryServices()) {
        try {
          const chars = await svc.getCharacteristics();
          const ch    = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (ch) return ch;
        } catch {}
      }
    } catch {}
    return null;
  }

  async function _reconnectBLE(device) {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      try {
        const server = await device.gatt.connect();
        const ch     = await _getBLEChar(server);
        if (!ch) continue;
        btChar = ch;
        refreshUI();
        _startHeartbeat();
        _drainPending();
        _toast('เชื่อมต่อบลูทูธอีกครั้ง ✓', 'success');
        return;
      } catch {}
    }
    btDevice = null; btChar = null;
    refreshUI();
    _toast('บลูทูธตัดการเชื่อมต่อ', 'error');
  }

  async function connectBluetooth() {
    if (!availableBT) throw new Error('เบราว์เซอร์ไม่รองรับ Web Bluetooth');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true, optionalServices: BLE_SERVICES,
    });
    const server = await device.gatt.connect();
    const ch     = await _getBLEChar(server);
    if (!ch) throw new Error('ไม่พบ characteristic สำหรับพิมพ์งาน');

    btDevice = device;
    btChar   = ch;

    device.addEventListener('gattserverdisconnected', () => {
      btChar = null;
      _stopHeartbeat();
      refreshUI();
      _toast('บลูทูธตัดการเชื่อมต่อ กำลังเชื่อมต่อใหม่…', 'warning');
      _reconnectBLE(device);
    });

    await _initPrinter();
    _startHeartbeat();
    refreshUI();
    _drainPending();
  }

  async function disconnectBluetooth() {
    _stopHeartbeat();
    try { btDevice?.gatt?.disconnect(); } catch {}
    btDevice = null; btChar = null;
    refreshUI();
  }

  /* ── Cash drawer ────────────────────────────────────────── */
  async function openDrawer() {
    if (!connected()) { _toast('เครื่องพิมพ์ไม่ได้เชื่อมต่อ', 'warning'); return; }
    await _bytes(cfg().drawerPin === '1' ? CMD.DRAWER_P5 : CMD.DRAWER_P2);
  }

  /* ══════════════════════════════════════════════════════════
     Receipt building — shared structured line format
     ══════════════════════════════════════════════════════════
     Each line: { text, rightText?, sub?, align?, bold?, big?,
                  small?, separator? }
  */
  function _shopSettings() {
    return typeof DB !== 'undefined' ? DB.getSettings()
      : { shopName: 'ร้านขายของชำ', footer: 'ขอบคุณที่ใช้บริการ' };
  }

  function _buildLines(saleItems, total, cash, change, meta, s) {
    const { subtotal, discountAmt, discountLabel, note, receiptNo, payMethod } = meta || {};
    const lines = [];
    const add = (text, o = {}) => lines.push({ text, ...o });
    const sep = ()              => lines.push({ separator: true });

    add(s.shopName || 'ร้านขายของชำ', { align: 'center', bold: true, big: true });
    if (s.address) add(s.address,              { align: 'center' });
    if (s.phone)   add('โทร: ' + s.phone,      { align: 'center' });
    if (s.taxId)   add('เลขผู้เสียภาษี: ' + s.taxId, { align: 'center' });
    add(new Date().toLocaleString('th-TH'),     { align: 'center' });
    if (receiptNo) add('#' + receiptNo,         { align: 'center' });
    add('ชำระ: ' + (payMethod === 'qr' ? 'QR PromptPay' : 'เงินสด'), { align: 'center' });
    sep();

    for (const { product: p, qty } of saleItems) {
      add(p.name, {
        rightText: '฿' + (p.price * qty).toFixed(2),
        sub: `  ${qty} × ฿${p.price.toFixed(2)}`,
      });
    }
    sep();

    if ((discountAmt || 0) > 0) {
      add('ราคารวม',                { rightText: '฿' + subtotal.toFixed(2) });
      add(discountLabel || 'ส่วนลด', { rightText: '-฿' + discountAmt.toFixed(2) });
    }
    add('ยอดชำระ',  { rightText: '฿' + total.toFixed(2), bold: true });
    add('รับเงิน',   { rightText: '฿' + cash.toFixed(2) });
    add('เงินทอน',   { rightText: '฿' + (cash - total).toFixed(2) });
    if (note) { sep(); add('หมายเหตุ: ' + note); }
    sep();
    add(s.footer || 'ขอบคุณที่ใช้บริการ', { align: 'center' });
    return lines;
  }

  function _buildShiftLines(shift, s) {
    const { startCash, openedAt, closedAt, actualCash, summary } = shift;
    const { totalSales, txCount, expectedCash, discrepancy } = summary;
    const lines = [];
    const add = (text, o = {}) => lines.push({ text, ...o });
    const sep = ()              => lines.push({ separator: true });

    add(s.shopName || 'ร้านขายของชำ', { align: 'center', bold: true, big: true });
    add('รายงานปิดกะ', { align: 'center' });
    add(new Date().toLocaleString('th-TH'), { align: 'center' });
    sep();
    add('เปิดกะ',  { rightText: new Date(openedAt).toLocaleTimeString('th-TH') });
    add('ปิดกะ',   { rightText: new Date(closedAt).toLocaleTimeString('th-TH') });
    sep();
    add('เงินเปิดกะ',               { rightText: '฿' + startCash.toFixed(2) });
    add(`ยอดขาย (${txCount} บิล)`,  { rightText: '฿' + totalSales.toFixed(2) });
    add('เงินที่ควรมี',              { rightText: '฿' + expectedCash.toFixed(2), bold: true });
    add('เงินที่นับได้',              { rightText: '฿' + actualCash.toFixed(2) });
    const diff = (discrepancy >= 0 ? '+' : '') + '฿' + Math.abs(discrepancy).toFixed(2);
    add('ส่วนต่าง', { rightText: diff, bold: true });
    sep();
    return lines;
  }

  /* ══════════════════════════════════════════════════════════
     Text-mode renderer (TIS-620)
  */
  function _pad(left, right, w) {
    const sp = w - left.length - right.length;
    return left + ' '.repeat(Math.max(1, sp)) + right;
  }

  async function _printTextLines(lines) {
    const w    = cols();
    const rule = '-'.repeat(w);

    for (const ln of lines) {
      if (ln.separator) { await _text(rule + '\n'); continue; }

      if (ln.align === 'center') {
        await _bytes(CMD.ALIGN_CENTER);
        if (ln.big)        { await _bytes(CMD.BOLD_ON); await _bytes(CMD.SIZE_DOUBLE_H); }
        else if (ln.bold)    await _bytes(CMD.BOLD_ON);
        await _text(ln.text + '\n');
        if (ln.big || ln.bold) await _bytes(CMD.BOLD_OFF);
        if (ln.big)            await _bytes(CMD.SIZE_NORMAL);
        await _bytes(CMD.ALIGN_LEFT);
      } else if (ln.rightText) {
        /* Truncate name if too long to fit with the right-side amount */
        const maxName = w - ln.rightText.length - 2;
        const name    = ln.text.length > maxName ? ln.text.slice(0, maxName - 1) + '.' : ln.text;
        if (ln.bold) await _bytes(CMD.BOLD_ON);
        await _text(_pad(name, ln.rightText, w) + '\n');
        if (ln.bold) await _bytes(CMD.BOLD_OFF);
        if (ln.sub)  await _text(ln.sub + '\n');
      } else {
        await _bytes(CMD.ALIGN_LEFT);
        await _text(ln.text + '\n');
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
     Image-mode renderer (canvas → ESC/POS raster GS v 0)
  */
  async function _printImageLines(lines) {
    const paper = cfg().paper;
    const dotsW = paper === 80 ? 576 : 384;
    const SC    = 2;              // render at 2× then downscale
    const W     = dotsW * SC;
    const PX    = 12 * SC;       // horizontal padding

    const FS = { normal: 22 * SC, bold: 26 * SC, big: 34 * SC, small: 18 * SC };
    const LH = { normal: 30 * SC, big: 42 * SC, small: 24 * SC };

    /* Pass 1: measure height */
    let H = 16 * SC;
    for (const ln of lines) {
      if (ln.separator) { H += 14 * SC; continue; }
      H += ln.big ? LH.big : LH.normal;
      if (ln.sub) H += LH.small;
    }
    H += 32 * SC;

    /* Pass 2: draw */
    const cv  = document.createElement('canvas');
    cv.width  = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    let y = 12 * SC;
    for (const ln of lines) {
      if (ln.separator) {
        ctx.fillStyle = '#000';
        ctx.fillRect(PX, y + 4 * SC, W - PX * 2, SC);
        y += 14 * SC;
        continue;
      }
      const fs = ln.big ? FS.big : (ln.bold ? FS.bold : (ln.small ? FS.small : FS.normal));
      const fw = (ln.big || ln.bold) ? '700' : '400';
      const lh = ln.big ? LH.big : LH.normal;
      ctx.font      = `${fw} ${fs}px Sarabun, Tahoma, sans-serif`;
      ctx.fillStyle = '#000';

      if (ln.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(ln.text, W / 2, y + fs);
      } else if (ln.rightText) {
        ctx.textAlign = 'left';
        ctx.fillText(ln.text, PX, y + fs);
        ctx.textAlign = 'right';
        ctx.fillText(ln.rightText, W - PX, y + fs);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(ln.text, PX, y + fs);
      }
      y += lh;

      if (ln.sub) {
        ctx.font      = `400 ${FS.small}px Sarabun, Tahoma, sans-serif`;
        ctx.fillStyle = '#444';
        ctx.textAlign = 'left';
        ctx.fillText(ln.sub, PX, y + FS.small * 0.85);
        ctx.fillStyle = '#000';
        y += LH.small;
      }
    }

    /* Downscale to printer resolution */
    const finalH = Math.ceil(H / SC);
    const out    = document.createElement('canvas');
    out.width  = dotsW;
    out.height = finalH;
    out.getContext('2d').drawImage(cv, 0, 0, dotsW, finalH);

    await _sendRaster(out);
  }

  async function _sendRaster(canvas) {
    const W   = canvas.width, H = canvas.height;
    const pix = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const bpr = Math.ceil(W / 8);
    const bmp = new Uint8Array(bpr * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        /* Weighted luminance (rec. 601) */
        const lum = (pix[i] * 299 + pix[i + 1] * 587 + pix[i + 2] * 114) / 1000;
        if (lum < 128) bmp[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }

    /* GS v 0 — raster bit image */
    const xL = bpr & 0xFF, xH = bpr >> 8;
    const yL = H   & 0xFF, yH = H   >> 8;
    await _bytes([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);

    /* Send bitmap in chunks for BLE compatibility */
    const CHUNK = 2048;
    for (let i = 0; i < bmp.length; i += CHUNK) {
      await _bytes(bmp.slice(i, i + CHUNK));
    }
    await _bytes([0x0A, 0x0A, 0x0A]);   // 3 line feeds after image
  }

  /* ══════════════════════════════════════════════════════════
     Screenshot-based image renderer
     Renders the actual HTML receipt into a hidden off-screen
     div at paper width, captures via html2canvas at 2x, then
     downscales to printer dot resolution before raster send.
  */
  async function _printHTMLScreenshot(htmlStr) {
    const dotsW = cfg().paper === 80 ? 576 : 384;
    const SC    = 2;

    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      `position:fixed;left:-9999px;top:0;width:${dotsW}px;background:#fff;overflow:hidden`;

    /* Inject receipt HTML + scoped overrides:
       - Force receipt to fill full paper width
       - Hide tear-edge decoration (CSS gradient doesn't raster usefully) */
    wrapper.innerHTML =
      `<style>
        .receipt-v2{max-width:none!important;width:${dotsW}px!important;margin:0!important;padding:8px 6px!important}
        .rcpt-tear{display:none!important}
      </style>` + htmlStr;

    document.body.appendChild(wrapper);
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    try {
      const raw = await html2canvas(wrapper, {
        width:           dotsW,
        scale:           SC,
        backgroundColor: '#ffffff',
        logging:         false,
        useCORS:         false,
      });
      /* Downscale 2x capture to printer dot width */
      const out = document.createElement('canvas');
      out.width  = dotsW;
      out.height = Math.ceil(raw.height / SC);
      out.getContext('2d').drawImage(raw, 0, 0, dotsW, out.height);
      await _sendRaster(out);
    } finally {
      document.body.removeChild(wrapper);
    }
  }

  /* ══════════════════════════════════════════════════════════
     Public print functions
  */
  async function printReceipt(saleItems, total, cash, change, meta = {}) {
    if (!connected()) return false;
    const s    = _shopSettings();
    const mode = cfg().printMode;

    await _bytes(CMD.INIT);
    if (mode === 'image') {
      /* Screenshot the rendered HTML receipt; fall back to canvas drawing if
         html2canvas or buildReceiptHTML is not available on this page */
      if (typeof html2canvas !== 'undefined' && typeof buildReceiptHTML === 'function') {
        await _printHTMLScreenshot(
          buildReceiptHTML(saleItems, total, cash, change, meta, { showSuccess: false })
        );
      } else {
        await _printImageLines(_buildLines(saleItems, total, cash, change, meta, s));
      }
    } else {
      await _bytes([ESC, 0x74, cfg().codePage]);
      await _bytes(CMD.CHARSET_THAI);
      await _printTextLines(_buildLines(saleItems, total, cash, change, meta, s));
      await _text('\n\n\n');
    }
    await _bytes(CMD.CUT);

    if (cfg().drawerMode === 'auto') {
      await _bytes(cfg().drawerPin === '1' ? CMD.DRAWER_P5 : CMD.DRAWER_P2);
    }
    return true;
  }

  async function printShiftReport(shift) {
    if (!connected()) return false;
    const s     = _shopSettings();
    const lines = _buildShiftLines(shift, s);
    const mode  = cfg().printMode;

    await _bytes(CMD.INIT);
    if (mode === 'image') {
      await _printImageLines(lines);
    } else {
      await _bytes([ESC, 0x74, cfg().codePage]);
      await _bytes(CMD.CHARSET_THAI);
      await _printTextLines(lines);
      await _text('\n\n\n');
    }
    await _bytes(CMD.CUT);
    return true;
  }

  async function testPrint() {
    if (!connected()) { _toast('เชื่อมต่อเครื่องพิมพ์ก่อน', 'warning'); return; }
    const s     = _shopSettings();
    const mode  = cfg().printMode;
    const lines = [
      { text: '-- ทดสอบการพิมพ์ --', align: 'center', bold: true, big: true },
      { separator: true },
      { text: `กระดาษ ${cfg().paper} มม. (${cols()} คอลัมน์)`, align: 'center' },
      { text: `โหมด: ${mode === 'image' ? 'รูปภาพ Canvas' : 'TIS-620 Text'}`, align: 'center' },
      { text: `เชื่อมต่อ: ${connectedType() === 'bluetooth' ? 'บลูทูธ BLE' : 'Serial USB'}`, align: 'center' },
      { text: new Date().toLocaleString('th-TH'), align: 'center' },
      { separator: true },
      { text: 'ภาษาไทย:', align: 'center' },
      { text: 'ก ข ค ง จ ช ซ ฌ ญ ฎ ฏ ฐ', align: 'center' },
      { text: 'สวัสดีครับ / ยินดีต้อนรับ', align: 'center' },
      { separator: true },
      { text: 'สินค้าทดสอบ', rightText: '฿99.00', sub: '  3 × ฿33.00' },
      { text: 'รายการที่สอง', rightText: '฿45.50' },
      { separator: true },
      { text: 'ยอดชำระ', rightText: '฿144.50', bold: true },
      { separator: true },
      { text: s.shopName || 'ร้านขายของชำ', align: 'center' },
    ];

    await _bytes(CMD.INIT);
    if (mode === 'image') {
      await _printImageLines(lines);
    } else {
      await _bytes([ESC, 0x74, cfg().codePage]);
      await _bytes(CMD.CHARSET_THAI);
      await _printTextLines(lines);
      await _text('\n\n\n');
    }
    await _bytes(CMD.CUT);
    _toast('พิมพ์ทดสอบแล้ว ✓', 'success');
  }

  /* ── UI sync ────────────────────────────────────────────── */
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
      if      (!on)              { statusEl.textContent = '🔴 ยังไม่เชื่อมต่อ';      statusEl.className = 'hw-status'; }
      else if (type === 'serial'){ statusEl.textContent = '🟢 เชื่อมต่อ (Serial)';   statusEl.className = 'hw-status connected'; }
      else                       { statusEl.textContent = '🔵 เชื่อมต่อ (บลูทูธ)';  statusEl.className = 'hw-status connected'; }
    }
    if (connectBtn)   connectBtn.style.display   = !on                   ? 'inline-flex' : 'none';
    if (disconnBtn)   disconnBtn.style.display   = type === 'serial'     ? 'inline-flex' : 'none';
    if (connectBtBtn) connectBtBtn.style.display = !on                   ? 'inline-flex' : 'none';
    if (disconnBtBtn) disconnBtBtn.style.display = type === 'bluetooth'  ? 'inline-flex' : 'none';
    if (drawerBtn)    drawerBtn.style.display     = on && cfg().drawerMode === 'manual' ? 'flex' : 'none';
    if (thermalBtn)   thermalBtn.style.display    = on ? 'inline-flex' : 'none';

    const ind = document.getElementById('hw-indicator');
    if (ind) ind.style.background = on ? 'var(--primary)' : 'transparent';

    /* Show/hide code page selector based on print mode */
    const cpRow = document.getElementById('hw-codepage-row');
    if (cpRow) cpRow.style.display = cfg().printMode === 'text' ? '' : 'none';
  }

  function loadSettingsUI() {
    const c   = cfg();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('hw-paper',      c.paper);
    set('hw-baud',       c.baud);
    set('hw-drawer',     c.drawerMode);
    set('hw-drawer-pin', c.drawerPin);
    set('hw-print-mode', c.printMode);
    set('hw-codepage',   c.codePage);
    refreshUI();
  }

  function saveSettingsUI() {
    const get = id => { const el = document.getElementById(id); return el ? el.value : null; };
    saveCfg({
      paper:      get('hw-paper'),
      baud:       get('hw-baud'),
      drawer:     get('hw-drawer'),
      drawer_pin: get('hw-drawer-pin'),
      print_mode: get('hw-print-mode'),
      codepage:   get('hw-codepage'),
    });
    refreshUI();
    _toast('บันทึกการตั้งค่าแล้ว ✓', 'success');
  }

  function _toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
  }

  /* Auto-connect on every page load */
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_tryAutoConnect, 600));
  }

  return {
    available, availableBT, connected, connectedType, cfg,
    connect, disconnect,
    connectBluetooth, disconnectBluetooth,
    openDrawer,
    printReceipt, printShiftReport, testPrint,
    setPending,
    refreshUI, loadSettingsUI, saveSettingsUI,
  };
})();
