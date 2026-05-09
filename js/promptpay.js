/* ============================================================
   promptpay.js — Thai PromptPay QR (EMVCo + CRC16/CCITT)
   ============================================================ */

const PromptPay = (() => {

  /* CRC16/CCITT — poly 0x1021, init 0xFFFF */
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /* EMVCo TLV encoder */
  function tlv(tag, value) {
    return tag + String(value.length).padStart(2, '0') + value;
  }

  /* Normalize Thai phone → 0066XXXXXXXXX (13 chars) */
  function normalizePhone(raw) {
    const d = raw.replace(/\D/g, '');
    if (d.length === 10 && d.startsWith('0')) return '0066' + d.slice(1);
    if (d.length === 11 && d.startsWith('66'))  return '00' + d;
    return '0066' + d.slice(-9);
  }

  /* Build PromptPay payload string */
  function build(target, amount) {
    const digits = target.replace(/\D/g, '');
    const isNatId = digits.length === 13;
    const proxy   = isNatId ? tlv('02', digits) : tlv('01', normalizePhone(target));
    const acct    = tlv('00', 'A000000677010111') + proxy;

    let payload =
      tlv('00', '01') +
      tlv('01', '12') +          /* dynamic QR */
      tlv('29', acct) +
      tlv('53', '764') +         /* THB */
      (amount > 0 ? tlv('54', amount.toFixed(2)) : '') +
      tlv('58', 'TH') +
      tlv('59', 'Merchant') +    /* ASCII merchant name (tag 59 spec: max 25 ASCII) */
      tlv('60', 'Bangkok') +
      '6304';

    return payload + crc16(payload);
  }

  /* Render QR into a container div using QRCode.js library */
  function render(containerEl, target, amount) {
    containerEl.innerHTML = '';
    if (!target) {
      containerEl.innerHTML =
        '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center">กรุณาตั้งค่าเบอร์ PromptPay<br>ในหน้าตั้งค่าร้านก่อน</p>';
      return;
    }
    const text = build(target, amount);
    try {
      new QRCode(containerEl, {
        text,
        width: 220,
        height: 220,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (e) {
      containerEl.innerHTML = '<p style="color:var(--danger);font-size:0.8rem">QR Error: ' + e.message + '</p>';
    }
  }

  return { build, render };
})();
