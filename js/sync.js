/* ============================================================
   sync.js — Firebase Firestore real-time sync
   Wraps DB write functions: localStorage (instant) + Firestore (cloud)
   Real-time listeners push remote changes to localStorage → re-render UI
   ============================================================ */
const Sync = (() => {
  let _db     = null;
  let _shopId = null;

  /* ---- Shop ID ---- */
  function getShopId() {
    let id = localStorage.getItem('shop_id');
    if (!id) {
      id = Math.random().toString(36).slice(2, 8).toUpperCase();
      localStorage.setItem('shop_id', id);
    }
    return id;
  }

  function setShopId(id) {
    localStorage.setItem('shop_id', id.trim().toUpperCase());
    _shopId = id.trim().toUpperCase();
  }

  /* ---- Firebase config ---- */
  function getConfig() {
    try { return JSON.parse(localStorage.getItem('firebase_config') || 'null'); }
    catch { return null; }
  }

  /* ---- Firestore shortcuts ---- */
  function col(name)  { return _db.collection(`shops/${_shopId}/${name}`); }
  function docRef(path) { return _db.doc(`shops/${_shopId}/${path}`); }

  /* ---- Init ---- */
  async function init() {
    const config = getConfig();
    if (!config?.projectId) return;

    _shopId = getShopId();

    try {
      let app;
      try { app = firebase.app(); } catch { app = firebase.initializeApp(config); }
      _db = firebase.firestore(app);

      /* Offline persistence (works even without network) */
      await _db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

      _setSyncDot('syncing');

      /* If Firestore shop is empty → upload local data (first device setup) */
      const probe = await col('products').limit(1).get();
      if (probe.empty) {
        await _uploadLocal();
      } else {
        await _downloadToLocal();
      }

      _setupListeners();
      _patchDB();
      _setSyncDot('synced');

    } catch (err) {
      console.error('[Sync]', err);
      _setSyncDot('error');
    }
  }

  /* ---- First-time: push localStorage → Firestore ---- */
  async function _uploadLocal() {
    const batch = _db.batch();
    DB.getProducts().forEach(p => batch.set(col('products').doc(p.id), p));
    DB.getSales().forEach(s => batch.set(col('sales').doc(s.id), s));
    const settings = DB.getSettings();
    if (settings) batch.set(docRef('settings/main'), settings);
    await batch.commit();
  }

  /* ---- Pull Firestore → localStorage ---- */
  async function _downloadToLocal() {
    const [pSnap, sSnap, sDoc] = await Promise.all([
      col('products').get(),
      col('sales').get(),
      docRef('settings/main').get(),
    ]);
    if (!pSnap.empty)
      localStorage.setItem('grocery_products', JSON.stringify(pSnap.docs.map(d => d.data())));
    if (!sSnap.empty)
      localStorage.setItem('grocery_sales',    JSON.stringify(sSnap.docs.map(d => d.data())));
    if (sDoc.exists)
      localStorage.setItem('grocery_settings', JSON.stringify(sDoc.data()));
    _refreshUI();
  }

  /* ---- Real-time listeners ---- */
  function _setupListeners() {
    /* Products */
    col('products').onSnapshot({ includeMetadataChanges: false }, snap => {
      localStorage.setItem('grocery_products', JSON.stringify(snap.docs.map(d => d.data())));
      if (typeof renderTable         === 'function') renderTable();
      if (typeof renderStats         === 'function') renderStats();
      if (typeof renderProducts      === 'function') renderProducts();
      if (typeof updateInventoryBadge === 'function') updateInventoryBadge();
      _setSyncDot('synced');
    });

    /* Sales */
    col('sales').onSnapshot({ includeMetadataChanges: false }, snap => {
      localStorage.setItem('grocery_sales', JSON.stringify(snap.docs.map(d => d.data())));
      if (typeof renderSalesList === 'function') renderSalesList();
      if (typeof renderStats     === 'function') renderStats();
      _setSyncDot('synced');
    });

    /* Settings */
    docRef('settings/main').onSnapshot({ includeMetadataChanges: false }, doc => {
      if (!doc.exists) return;
      localStorage.setItem('grocery_settings', JSON.stringify(doc.data()));
      const bn = document.getElementById('brand-name');
      if (bn) bn.textContent = doc.data().shopName || 'ร้านขายของชำ';
    });
  }

  /* ---- Patch DB write functions ---- */
  function _patchDB() {
    /* addProduct */
    const _add = DB.addProduct.bind(DB);
    DB.addProduct = d => {
      const p = _add(d);
      col('products').doc(p.id).set(p).catch(() => {});
      _setSyncDot('syncing');
      return p;
    };

    /* updateProduct */
    const _upd = DB.updateProduct.bind(DB);
    DB.updateProduct = (id, d) => {
      const p = _upd(id, d);
      if (p) col('products').doc(id).set(p).catch(() => {});
      return p;
    };

    /* deleteProduct */
    const _del = DB.deleteProduct.bind(DB);
    DB.deleteProduct = id => {
      _del(id);
      col('products').doc(id).delete().catch(() => {});
    };

    /* decreaseStock */
    const _dec = DB.decreaseStock.bind(DB);
    DB.decreaseStock = (id, qty) => {
      _dec(id, qty);
      const p = DB.getProducts().find(x => x.id === id);
      if (p) col('products').doc(id).set(p).catch(() => {});
    };

    /* addSale */
    const _addSale = DB.addSale.bind(DB);
    DB.addSale = sale => {
      const s = _addSale(sale);
      col('sales').doc(s.id).set(s).catch(() => {});
      _setSyncDot('syncing');
      return s;
    };

    /* deleteSale */
    const _delSale = DB.deleteSale.bind(DB);
    DB.deleteSale = id => {
      _delSale(id);
      col('sales').doc(id).delete().catch(() => {});
    };

    /* saveSettings */
    const _saveSets = DB.saveSettings.bind(DB);
    DB.saveSettings = data => {
      _saveSets(data);
      docRef('settings/main').set(data).catch(() => {});
    };

    /* openShift */
    const _openShift = DB.openShift.bind(DB);
    DB.openShift = cash => {
      const s = _openShift(cash);
      col('shifts').doc(s.id).set(s).catch(() => {});
      return s;
    };

    /* closeShift */
    const _closeShift = DB.closeShift.bind(DB);
    DB.closeShift = cash => {
      const s = _closeShift(cash);
      if (s) col('shifts').doc(s.id).set(s).catch(() => {});
      return s;
    };
  }

  /* ---- UI helpers ---- */
  function _refreshUI() {
    if (typeof renderTable          === 'function') renderTable();
    if (typeof renderStats          === 'function') renderStats();
    if (typeof renderSalesList      === 'function') renderSalesList();
    if (typeof renderProducts       === 'function') renderProducts();
    if (typeof updateInventoryBadge === 'function') updateInventoryBadge();
  }

  function _setSyncDot(status) {
    const el = document.getElementById('sync-dot');
    if (!el) return;
    el.dataset.s = status;
    if      (status === 'syncing') { el.title = 'กำลังซิงค์…'; }
    else if (status === 'synced')  { el.title = 'ซิงค์แล้ว'; }
    else if (status === 'error')   { el.title = '⚠️ ซิงค์ไม่ได้ — ตรวจสอบ Firebase Config'; }
  }

  function isActive() { return _db !== null; }

  return { init, getShopId, setShopId, getConfig, isActive };
})();
