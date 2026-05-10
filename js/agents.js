/* ============================================================
   agents.js — AI agents powered by Gemini API
   Agent 1: Stock Monitor | Agent 3: Sales Analyst | Agent 5: Receipt
   ============================================================ */
const Agents = (() => {

  function getKey() {
    return localStorage.getItem('gemini_api_key') || '';
  }

  async function getModel(key) {
    const cached = sessionStorage.getItem('gemini_model');
    if (cached) return cached;
    try {
      const res  = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
      const data = await res.json();
      const available = (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));
      const priority = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-001', 'gemini-pro'];
      const model = priority.find(p => available.includes(p)) || available[0] || 'gemini-1.5-flash';
      sessionStorage.setItem('gemini_model', model);
      return model;
    } catch {
      return 'gemini-1.5-flash';
    }
  }

  async function call(systemPrompt, userMsg, maxTokens = 800) {
    const key = getKey();
    if (!key) throw new Error('NO_KEY');

    const model = await getModel(key);
    const fullPrompt = `${systemPrompt}\n\n${userMsg}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  /* ------ Agent 3: Sales Analyst ------ */
  async function analyzeSales(period, sales, products) {
    if (!sales.length) throw new Error('NO_DATA');

    const periodLabel = {
      today: 'วันนี้', yesterday: 'เมื่อวาน',
      '7days': '7 วันล่าสุด', '30days': '30 วันล่าสุด', all: 'ทั้งหมด'
    }[period] || period;

    const totalRevenue = sales.reduce((s, x) => s + x.total, 0);
    const avgBill      = totalRevenue / sales.length;

    const freq    = {};
    const hourMap = {};
    const dayMap  = {};
    sales.forEach(s => {
      const d   = new Date(s.createdAt);
      const h   = d.getHours();
      const day = d.toLocaleDateString('th-TH', { weekday: 'long' });
      hourMap[h]  = (hourMap[h]  || 0) + 1;
      dayMap[day] = (dayMap[day] || 0) + s.total;
      s.items.forEach(item => {
        if (!freq[item.name]) freq[item.name] = { qty: 0, rev: 0 };
        freq[item.name].qty += item.qty;
        freq[item.name].rev += item.price * item.qty;
      });
    });

    const topItems  = Object.entries(freq).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5)
      .map(([n, d]) => `${n} (${d.qty} ชิ้น ฿${d.rev.toFixed(0)})`);
    const soldNames = new Set(Object.keys(freq));
    const slowItems = products.filter(p => !soldNames.has(p.name)).slice(0, 5).map(p => p.name);
    const topHours  = Object.entries(hourMap).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([h, c]) => `${h}:00 น. (${c} บิล)`);
    const weakDay   = Object.entries(dayMap).sort((a, b) => a[1] - b[1])[0]?.[0] || '';

    const system = `คุณเป็นนักวิเคราะห์ยอดขายร้านขายของชำ ตอบเป็นภาษาไทย กระชับ ชัดเจน ใช้ emoji นำหน้าหัวข้อ ไม่เกิน 20 บรรทัด ห้ามใช้ markdown header (#) หรือ bold (**)`;
    const userMsg = `วิเคราะห์ยอดขาย${periodLabel}:
- ${sales.length} บิล รายได้รวม ฿${totalRevenue.toFixed(2)} เฉลี่ย ฿${avgBill.toFixed(2)}/บิล
- สินค้าขายดี: ${topItems.join(' | ')}
- สินค้าไม่มียอดขาย: ${slowItems.length ? slowItems.join(', ') : 'ไม่มี'}
- ชั่วโมงขายดี: ${topHours.join(', ')}
- วันที่ขายน้อยที่สุด: ${weakDay || 'ไม่พบ'}`;

    return call(system, userMsg, 800);
  }

  /* ------ Agent 5: Daily Summary / Receipt ------ */
  async function summarizeDay(todaySales, settings) {
    if (!todaySales.length) throw new Error('NO_DATA');

    const total = todaySales.reduce((s, x) => s + x.total, 0);
    const cash  = todaySales.filter(s => s.payMethod !== 'qr').reduce((s, x) => s + x.total, 0);
    const qr    = todaySales.filter(s => s.payMethod === 'qr').reduce((s, x) => s + x.total, 0);

    const freq = {};
    todaySales.forEach(s => s.items.forEach(item => {
      freq[item.name] = (freq[item.name] || 0) + item.qty;
    }));
    const topItems = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([n, q]) => `${n} x${q}`);

    const shopName = settings?.shopName || 'ร้านขายของชำ';
    const dateStr  = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

    const system  = `สร้างข้อความสรุปยอดขายประจำวัน สำหรับส่ง LINE กลุ่มร้าน ตอบเป็น plain text เท่านั้น ห้ามใช้ markdown`;
    const userMsg = `ร้าน: ${shopName} วันที่: ${dateStr}
จำนวนบิล: ${todaySales.length} | ยอดรวม: ฿${total.toFixed(2)} | เงินสด: ฿${cash.toFixed(2)} | QR: ฿${qr.toFixed(2)}
สินค้าขายดี: ${topItems.join(', ')}
รูปแบบ: ขึ้นต้นด้วย 📋 สรุปยอดขาย [ชื่อร้าน] [วันที่] แล้วใส่รายละเอียดโดยมี ──────────── คั่นส่วน ท้ายใส่ขอบคุณสั้นๆ`;

    return call(system, userMsg, 400);
  }

  /* ------ Agent 1: Stock Monitor ------ */
  async function analyzeStock(products, allSales) {
    const out = products.filter(p => p.quantity === 0);
    const low = products.filter(p => p.quantity > 0 && p.quantity <= p.lowStockThreshold);

    if (!out.length && !low.length) {
      return '✅ สต็อกสินค้าอยู่ในระดับที่ดี ไม่มีสินค้าที่ต้องสั่งเพิ่มในขณะนี้';
    }

    const cutoff  = new Date(Date.now() - 30 * 86400000);
    const sales30 = allSales.filter(s => new Date(s.createdAt) >= cutoff);
    const qty30   = {};
    sales30.forEach(s => s.items.forEach(i => {
      qty30[i.name] = (qty30[i.name] || 0) + i.qty;
    }));
    const dayCount = Math.max(1, new Set(sales30.map(s => new Date(s.createdAt).toDateString())).size);

    const fmt = p => {
      const avg = ((qty30[p.name] || 0) / dayCount).toFixed(1);
      return `${p.name} (สต็อก ${p.quantity}, ขาย ${avg}/วัน)`;
    };

    const system  = `คุณเป็นผู้ช่วยจัดการสต็อกร้านขายของชำ แนะนำการสั่งของด้วยภาษาไทย กระชับ ใช้ emoji นำหน้าหัวข้อ ไม่เกิน 15 บรรทัด`;
    const userMsg = `วิเคราะห์สต็อกสินค้า:
🔴 หมดสต็อก (${out.length} รายการ): ${out.slice(0, 8).map(fmt).join(' | ') || 'ไม่มี'}
🟡 เหลือน้อย (${low.length} รายการ): ${low.slice(0, 8).map(fmt).join(' | ') || 'ไม่มี'}
แนะนำว่าควรสั่งอะไรก่อน และควรสั่งเมื่อไร`;

    return call(system, userMsg, 700);
  }

  return { getKey, analyzeSales, summarizeDay, analyzeStock };
})();
