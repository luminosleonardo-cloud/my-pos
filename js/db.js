/* ============================================================
   db.js — localStorage data layer
   ============================================================ */
const DB = (() => {
  const PRODUCTS_KEY  = 'grocery_products';
  const SALES_KEY     = 'grocery_sales';
  const SETTINGS_KEY  = 'grocery_settings';
  const SHIFTS_KEY    = 'grocery_shifts';
  const RECEIPT_KEY   = 'grocery_receipt_no';

  const CATEGORY_EMOJI = {
    'เครื่องปรุง': '🧂',
    'ข้าว':        '🍚',
    'น้ำมัน':      '🫙',
    'นม':          '🥛',
    'ไข่':         '🥚',
    'บะหมี่':      '🍜',
    'เครื่องดื่ม': '🥤',
    'ผัก':         '🥦',
    'ผลไม้':       '🍎',
    'ขนม':         '🍬',
    'ของใช้':      '🧴',
    'อื่นๆ':       '📦',
  };

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- Products ---------- */

  function getProducts() {
    try {
      return JSON.parse(localStorage.getItem(PRODUCTS_KEY) || '[]');
    } catch { return []; }
  }

  function saveProducts(products) {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  }

  function addProduct(data) {
    const products = getProducts();
    const now = new Date().toISOString();
    const product = {
      id: generateId(),
      name: data.name || '',
      barcode: data.barcode || '',
      price: parseFloat(data.price) || 0,
      quantity: parseInt(data.quantity) || 0,
      category: data.category || 'อื่นๆ',
      lowStockThreshold: parseInt(data.lowStockThreshold) || 5,
      costPrice: parseFloat(data.costPrice) || 0,
      image: data.image || '',
      createdAt: now,
      updatedAt: now,
    };
    products.push(product);
    saveProducts(products);
    return product;
  }

  function updateProduct(id, data) {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return null;
    products[idx] = {
      ...products[idx],
      name: data.name ?? products[idx].name,
      barcode: data.barcode ?? products[idx].barcode,
      price: data.price !== undefined ? parseFloat(data.price) : products[idx].price,
      quantity: data.quantity !== undefined ? parseInt(data.quantity) : products[idx].quantity,
      category: data.category ?? products[idx].category,
      lowStockThreshold: data.lowStockThreshold !== undefined
        ? parseInt(data.lowStockThreshold) : products[idx].lowStockThreshold,
      costPrice: data.costPrice !== undefined ? parseFloat(data.costPrice) || 0 : products[idx].costPrice,
      image: data.image !== undefined ? data.image : products[idx].image,
      updatedAt: new Date().toISOString(),
    };
    saveProducts(products);
    return products[idx];
  }

  function deleteProduct(id) {
    saveProducts(getProducts().filter(p => p.id !== id));
  }

  function findByBarcode(barcode) {
    return getProducts().find(p => p.barcode === barcode) || null;
  }

  function searchProducts(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return getProducts();
    return getProducts().filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }

  function filterByCategory(category) {
    if (!category || category === 'ทั้งหมด') return getProducts();
    return getProducts().filter(p => p.category === category);
  }

  function getCategories() {
    const cats = [...new Set(getProducts().map(p => p.category))].sort();
    return ['ทั้งหมด', ...cats];
  }

  function decreaseStock(id, qty) {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return;
    products[idx].quantity = Math.max(0, products[idx].quantity - qty);
    products[idx].updatedAt = new Date().toISOString();
    saveProducts(products);
  }

  function getStockStatus(product) {
    if (product.quantity === 0) return 'out';
    if (product.quantity <= product.lowStockThreshold) return 'low';
    return 'normal';
  }

  function getEmoji(category) {
    return CATEGORY_EMOJI[category] || '📦';
  }

  /* ---------- Sales ---------- */

  function getSales() {
    try {
      return JSON.parse(localStorage.getItem(SALES_KEY) || '[]');
    } catch { return []; }
  }

  function getNextReceiptNo() {
    const n = parseInt(localStorage.getItem(RECEIPT_KEY) || '0') + 1;
    localStorage.setItem(RECEIPT_KEY, String(n));
    return n;
  }

  function addSale(sale) {
    const sales = getSales();
    const newSale = {
      id: generateId(),
      receiptNo: getNextReceiptNo(),
      ...sale,
      createdAt: new Date().toISOString(),
    };
    sales.push(newSale);
    localStorage.setItem(SALES_KEY, JSON.stringify(sales));
    return newSale;
  }

  function deleteSale(id) {
    localStorage.setItem(SALES_KEY, JSON.stringify(getSales().filter(s => s.id !== id)));
  }

  function getTodaySales() {
    const today = new Date().toDateString();
    return getSales().filter(s => new Date(s.createdAt).toDateString() === today);
  }

  /* ---------- Stats ---------- */

  function getStats() {
    const products = getProducts();
    const todaySales = getTodaySales();
    return {
      totalProducts: products.length,
      lowStock: products.filter(p => p.quantity > 0 && p.quantity <= p.lowStockThreshold).length,
      outOfStock: products.filter(p => p.quantity === 0).length,
      totalValue: products.reduce((sum, p) => sum + p.price * p.quantity, 0),
      todayRevenue: todaySales.reduce((sum, s) => sum + s.total, 0),
    };
  }

  /* ---------- Settings ---------- */

  function getSettings() {
    try {
      return {
        shopName: 'ร้านขายของชำ', address: '', phone: '',
        taxId: '', promptpay: '', footer: 'ขอบคุณที่ใช้บริการ',
        ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
      };
    } catch {
      return { shopName: 'ร้านขายของชำ', address: '', phone: '', taxId: '', promptpay: '', footer: 'ขอบคุณที่ใช้บริการ' };
    }
  }

  function saveSettings(data) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  }

  /* ---------- Shifts ---------- */

  function getShifts() {
    try { return JSON.parse(localStorage.getItem(SHIFTS_KEY) || '[]'); }
    catch { return []; }
  }

  function getActiveShift() {
    return getShifts().find(s => !s.closedAt) || null;
  }

  function openShift(startCash) {
    const shifts = getShifts();
    const shift = {
      id: generateId(),
      startCash: parseFloat(startCash) || 0,
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    shifts.push(shift);
    localStorage.setItem(SHIFTS_KEY, JSON.stringify(shifts));
    return shift;
  }

  function closeShift(actualCash) {
    const shifts = getShifts();
    const idx = shifts.findIndex(s => !s.closedAt);
    if (idx === -1) return null;
    const shift = shifts[idx];
    const openedAt = new Date(shift.openedAt);
    const shiftSales = getSales().filter(s => new Date(s.createdAt) >= openedAt);
    const totalSales = shiftSales.reduce((sum, s) => sum + s.total, 0);
    const txCount = shiftSales.length;
    const expectedCash = shift.startCash + totalSales;
    const actual = parseFloat(actualCash) || 0;
    shifts[idx] = {
      ...shift,
      closedAt: new Date().toISOString(),
      actualCash: actual,
      summary: { totalSales, txCount, expectedCash, discrepancy: actual - expectedCash },
    };
    localStorage.setItem(SHIFTS_KEY, JSON.stringify(shifts));
    return shifts[idx];
  }

  /* ---------- Sample data ---------- */

  function initSampleData() {
    if (getProducts().length > 0) return;
    const samples = [
      { name: 'น้ำตาลทราย 1 กก.',       barcode: '8850926100022', price: 25,  quantity: 50, category: 'เครื่องปรุง', lowStockThreshold: 10 },
      { name: 'ข้าวหอมมะลิ 5 กก.',       barcode: '8851234567890', price: 185, quantity: 30, category: 'ข้าว',        lowStockThreshold: 5  },
      { name: 'น้ำมันพืช 1 ล.',          barcode: '8852345678901', price: 65,  quantity: 24, category: 'น้ำมัน',     lowStockThreshold: 8  },
      { name: 'นมสดรสจืด 1 ล.',          barcode: '8853456789012', price: 45,  quantity: 4,  category: 'นม',          lowStockThreshold: 6  },
      { name: 'ไข่ไก่ แผง 30 ฟอง',      barcode: '8854567890123', price: 120, quantity: 20, category: 'ไข่',         lowStockThreshold: 5  },
      { name: 'บะหมี่กึ่งสำเร็จรูป',    barcode: '8855678901234', price: 7,   quantity: 100,category: 'บะหมี่',     lowStockThreshold: 20 },
      { name: 'ซอสปรุงรส 200 มล.',       barcode: '8856789012345', price: 18,  quantity: 35, category: 'เครื่องปรุง', lowStockThreshold: 10 },
      { name: 'น้ำดื่ม 1.5 ล.',          barcode: '8857890123456', price: 10,  quantity: 48, category: 'เครื่องดื่ม', lowStockThreshold: 12 },
      { name: 'น้ำอัดลม 325 มล.',        barcode: '8858901234567', price: 15,  quantity: 60, category: 'เครื่องดื่ม', lowStockThreshold: 12 },
      { name: 'ผักคะน้า (มัด)',           barcode: '8859012345678', price: 20,  quantity: 15, category: 'ผัก',         lowStockThreshold: 5  },
      { name: 'กล้วยหอม (หวี)',           barcode: '8850123456789', price: 30,  quantity: 10, category: 'ผลไม้',      lowStockThreshold: 3  },
      { name: 'ขนมปังแผ่น',              barcode: '8851122334455', price: 25,  quantity: 0,  category: 'ขนม',         lowStockThreshold: 5  },
      { name: 'สบู่ก้อน',                barcode: '8852233445566', price: 18,  quantity: 28, category: 'ของใช้',     lowStockThreshold: 8  },
      { name: 'ยาสีฟัน 100 ก.',          barcode: '8853344556677', price: 45,  quantity: 16, category: 'ของใช้',     lowStockThreshold: 5  },
    ];
    samples.forEach(s => addProduct(s));
  }

  initSampleData();

  return {
    getProducts, addProduct, updateProduct, deleteProduct,
    findByBarcode, searchProducts, filterByCategory, getCategories,
    decreaseStock, getStockStatus, getEmoji,
    getSales, addSale, deleteSale, getTodaySales, getStats, getNextReceiptNo,
    getSettings, saveSettings,
    getShifts, getActiveShift, openShift, closeShift,
  };
})();
