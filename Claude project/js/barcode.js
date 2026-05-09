/* ============================================================
   barcode.js — USB keyboard-wedge + camera barcode scanner
   ============================================================ */
const BarcodeScanner = (() => {
  /* ---- USB / Bluetooth scanner (keyboard-wedge mode) ----
     Scanners type characters very fast (< 60ms between keystrokes)
     and finish with Enter. We detect this pattern globally.      */
  let buffer    = '';
  let lastTime  = 0;
  let scanCb    = null;
  const GAP_MS  = 60;   // max ms between chars for a scanner keystroke
  const MIN_LEN = 3;    // min barcode length

  document.addEventListener('keydown', e => {
    const now = Date.now();

    if (now - lastTime > GAP_MS) buffer = '';
    lastTime = now;

    if (e.key === 'Enter') {
      const code = buffer.trim();
      buffer = '';
      if (code.length >= MIN_LEN && scanCb) {
        e.preventDefault();
        scanCb(code, 'usb');
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      buffer += e.key;
    }
  });

  function onScan(callback) {
    scanCb = callback;
  }

  /* ---- Camera scanner (html5-qrcode library) ---- */
  let scanner    = null;
  let camRunning = false;

  async function startCamera(elementId, callback) {
    if (typeof Html5Qrcode === 'undefined') {
      showToast('ไลบรารีสแกนกล้องโหลดไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต', 'error');
      return false;
    }

    if (camRunning) await stopCamera();

    scanner = new Html5Qrcode(elementId, { verbose: false });

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 120 },
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
    };

    try {
      await scanner.start({ facingMode: 'environment' }, config, decodedText => {
        if (camRunning) callback(decodedText, 'camera');
      });
      camRunning = true;
      return true;
    } catch (err) {
      console.error('Camera start failed:', err);
      showToast('ไม่สามารถเปิดกล้องได้: ' + (err.message || err), 'error');
      return false;
    }
  }

  async function stopCamera() {
    if (scanner && camRunning) {
      try { await scanner.stop(); } catch {}
      camRunning = false;
    }
  }

  function isRunning() { return camRunning; }

  return { onScan, startCamera, stopCamera, isRunning };
})();
