// DATABASE HELPER (IndexedDB)
const DB_NAME = 'KasirKitaDB';
const DB_VERSION = 1;
let db;

async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('products')) d.createObjectStore('products', {keyPath:'id'});
      if (!d.objectStoreNames.contains('transactions')) d.createObjectStore('transactions', {keyPath:'id'});
      if (!d.objectStoreNames.contains('users')) d.createObjectStore('users', {keyPath:'username'});
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', {keyPath:'key'});
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = reject;
  });
}

function getStore(name, mode='readonly') {
  return db.transaction(name, mode).objectStore(name);
}

async function putData(storeName, data) {
  return new Promise((res,rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(data);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

async function getAllData(storeName) {
  return new Promise((res,rej) => {
    const req = getStore(storeName).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = rej;
  });
}

async function getData(storeName, key) {
  return new Promise((res,rej) => {
    const req = getStore(storeName).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = rej;
  });
}

// STATE
let cart = [];
let products = [];

// INIT
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await loadSettings();
  await renderProducts();
  await renderUsers();
  setupTabs();
  setupPOS();
  setupInventory();
  setupReports();
  setupAdmin();
  setupSync();
  registerSW();
});

// TABS
function setupTabs() {
  document.querySelectorAll('nav button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById(btn.dataset.tab).classList.add('active');
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
}

// POS
function setupPOS() {
  const search = document.getElementById('searchProduct');
  const list = document.getElementById('productList');
  
  search.oninput = async () => {
    const q = search.value.toLowerCase();
    const all = await getAllData('products');
    const filtered = all.filter(p => p.name.toLowerCase().includes(q));
    list.innerHTML = filtered.map(p => `<li onclick="addToCart('${p.id}')">${p.name} | Stok:${p.stock} | ${p.sell}</li>`).join('');
  };
  search.dispatchEvent(new Event('input'));

  document.getElementById('payBtn').onclick = processPayment;
  document.getElementById('taxRate').oninput = updateTotal;
}

async function addToCart(id) {
  const prod = await getData('products', id);
  if (!prod || prod.stock <= 0) return alert('Stok habis');
  const existing = cart.find(c => c.id === id);
  if (existing) existing.qty++;
  else cart.push({...prod, qty:1});
  renderCart();
}

function renderCart() {
  const el = document.getElementById('cartList');
  el.innerHTML = cart.map((c,i) => `<li>${c.name} x${c.qty} <button onclick="removeFromCart(${i})">❌</button></li>`).join('');
  updateTotal();
}

function removeFromCart(i) {
  cart.splice(i,1);
  renderCart();
}

async function processPayment() {
  if (cart.length === 0) return alert('Keranjang kosong');
  const taxRate = parseFloat(document.getElementById('taxRate').value) || 0;
  let subtotal = 0, profit = 0;
  
  const txItems = cart.map(c => {
    subtotal += c.sell * c.qty;
    profit += (c.sell - c.buy) * c.qty;
    return { productId: c.id, name: c.name, qty: c.qty, sell: c.sell, buy: c.buy };
  });

  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;
  const id = Date.now().toString();
  
  // Simpan transaksi & update stok
  const tx = { id, date: new Date().toISOString(), items: txItems, subtotal, tax, taxRate, profit, total };
  await putData('transactions', tx);
  
  for (const c of cart) {
    const p = await getData('products', c.id);
    p.stock -= c.qty;
    await putData('products', p);
  }

  printReceipt(tx);
  cart = [];
  renderCart();
  renderProducts();
  alert('Transaksi berhasil!');
}

function updateTotal() {
  const taxRate = parseFloat(document.getElementById('taxRate').value) || 0;
  const subtotal = cart.reduce((s,c) => s + c.sell * c.qty, 0);
  const tax = subtotal * (taxRate/100);
  document.getElementById('subtotal').textContent = formatRupiah(subtotal);
  document.getElementById('tax').textContent = formatRupiah(tax);
  document.getElementById('total').textContent = formatRupiah(subtotal + tax);
}

function printReceipt(tx) {
  const rc = document.getElementById('receiptContent');
  let html = `<div style="text-align:center"><h3>${getStoreSettings('storeName') || 'Toko'}</h3><p>${getStoreSettings('owner') || 'Pemilik'}</p></div>
  <div class="line"></div>`;
  tx.items.forEach(i => html += `<div class="row"><span>${i.name} x${i.qty}</span><span>${formatRupiah(i.sell*i.qty)}</span></div>`);
  html += `<div class="line"></div>
  <div class="row"><span>Subtotal</span><span>${formatRupiah(tx.subtotal)}</span></div>
  <div class="row"><span>Pajak (${tx.taxRate}%)</span><span>${formatRupiah(tx.tax)}</span></div>
  <div class="row"><strong>Total</strong><strong>${formatRupiah(tx.total)}</strong></div>
  <div class="line"></div><p style="text-align:center">Terima Kasih</p>`;
  rc.innerHTML = html;
  window.print();
}

// INVENTORY
function setupInventory() {
  document.getElementById('productForm').onsubmit = async e => {
    e.preventDefault();
    const id = Date.now().toString();
    const prod = {
      id,
      name: document.getElementById('prodName').value,
      category: document.getElementById('prodCategory').value,
      buy: parseFloat(document.getElementById('prodBuy').value),
      sell: parseFloat(document.getElementById('prodSell').value),
      stock: parseInt(document.getElementById('prodStock').value)
    };
    await putData('products', prod);
    e.target.reset();
    renderProducts();
  };

  document.getElementById('stockForm').onsubmit = async e => {
    e.preventDefault();
    const id = document.getElementById('stockProd').value;
    const type = document.getElementById('stockType').value;
    const qty = parseInt(document.getElementById('stockQty').value);
    const p = await getData('products', id);
    if (type === 'in') p.stock += qty;
    else p.stock -= qty;
    await putData('products', p);
    e.target.reset();
    renderProducts();
  };
}

async function renderProducts() {
  products = await getAllData('products');
  const tbody = document.querySelector('#inventoryTable tbody');
  tbody.innerHTML = products.map(p => `<tr><td>${p.name}</td><td>${p.category}</td><td>${p.buy}</td><td>${p.sell}</td><td>${p.stock}</td></tr>`).join('');
  
  const catList = [...new Set(products.map(p => p.category))];
  document.getElementById('catList').innerHTML = catList.map(c => `<option value="${c}">`).join('');
  
  const sel = document.getElementById('stockProd');
  sel.innerHTML = products.map(p => `<option value="${p.id}">${p.name} (${p.stock})</option>`).join('');
}

// REPORTS
function setupReports() {
  document.getElementById('genReport').onclick = generateReport;
  document.getElementById('exportExcel').onclick = exportToExcel;
}

async function generateReport() {
  const start = new Date(document.getElementById('repStart').value);
  const end = new Date(document.getElementById('repEnd').value);
  end.setHours(23,59,59);
  if (isNaN(start) || isNaN(end)) return alert('Pilih rentang tanggal');
  
  const all = await getAllData('transactions');
  const filtered = all.filter(t => { const d = new Date(t.date); return d >= start && d <= end; });
  
  const gross = filtered.reduce((s,t) => s + t.subtotal, 0);
  const net = filtered.reduce((s,t) => s + t.profit, 0);
  
  document.getElementById('repCount').textContent = filtered.length;
  document.getElementById('repGross').textContent = formatRupiah(gross);
  document.getElementById('repNet').textContent = formatRupiah(net);
}

function exportToExcel() {
  const ws = XLSX.utils.json_to_sheet([
    { Header: 'Tanggal', Nama: 'Harga Jual', Qty: 'Total', Profit: 'Keuntungan' },
    ...JSON.parse(localStorage.getItem('tempExport') || '[]')
  ]);
  // Simplified: export filtered report or all transactions
  XLSX.writeFile({ Sheets: { Data: ws }, SheetNames: ['Data'] }, 'Laporan_Kasir.xlsx');
}

// ADMIN & SETTINGS
async function loadSettings() {
  const name = await getData('settings', 'storeName');
  const owner = await getData('settings', 'owner');
  document.getElementById('storeName').textContent = name?.value || 'KasirKita';
  document.getElementById('adminStoreName').value = name?.value || '';
  document.getElementById('adminOwner').value = owner?.value || '';
}

function getStoreSettings(key) {
  // Synchronous fallback for print (since print sync)
  const s = JSON.parse(localStorage.getItem('ks_settings') || '{}');
  return s[key];
}

function setupAdmin() {
  document.getElementById('storeForm').onsubmit = async e => {
    e.preventDefault();
    await putData('settings', { key:'storeName', value: document.getElementById('adminStoreName').value });
    await putData('settings', { key:'owner', value: document.getElementById('adminOwner').value });
    localStorage.setItem('ks_settings', JSON.stringify({ storeName: document.getElementById('adminStoreName').value, owner: document.getElementById('adminOwner').value }));
    loadSettings();
  };

  document.getElementById('userForm').onsubmit = async e => {
    e.preventDefault();
    await putData('users', { username: document.getElementById('userName').value, password: document.getElementById('userPass').value, role: document.getElementById('userRole').value });
    renderUsers();
  };
}

async function renderUsers() {
  const users = await getAllData('users');
  document.getElementById('userList').innerHTML = users.map(u => `<li>${u.username} [${u.role}]</li>`).join('');
}

// SYNC (JSON)
function setupSync() {
  document.getElementById('exportJson').onclick = async () => {
    const data = {
      products: await getAllData('products'),
      transactions: await getAllData('transactions'),
      users: await getAllData('users'),
      settings: await getAllData('settings'),
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kasir_backup_${Date.now()}.json`;
    a.click();
  };

  document.getElementById('importJson').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target.result);
        for (const p of (data.products || [])) await putData('products', p);
        for (const t of (data.transactions || [])) await putData('transactions', t);
        for (const u of (data.users || [])) await putData('users', u);
        for (const s of (data.settings || [])) await putData('settings', s);
        alert('Restore berhasil! Refresh halaman.');
        location.reload();
      } catch(err) { alert('File JSON tidak valid'); }
    };
    reader.readAsText(file);
  };
}

// UTILS
function formatRupiah(n) { return new Intl.NumberFormat('id-ID', {style:'currency', currency:'IDR'}).format(n); }

let deferredPrompt;
const installBtn = document.getElementById('installBtn');

// Deteksi ketersediaan instalasi
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
  installBtn.textContent = ' INSTAL APLIKASI KASIR (1-KLIK)';
});

// Trigger instalasi saat tombol diklik
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  installBtn.hidden = true;
  
  // Munculkan prompt native browser
  deferredPrompt.prompt();
  
  // Tangkap respons user
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User installation choice: ${outcome}`);
  deferredPrompt = null;
});
