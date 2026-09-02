const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const TOYYIB_SECRET = process.env.TOYYIB_SECRET || '';
const TOYYIB_CAT = process.env.TOYYIB_CAT || '';
const SERVER_URL = (process.env.SERVER_URL || '').replace(/\/$/, '');

// PENGURUSAN DATA TEMPATAN (FAIL JSON - TANPA SUPABASE)
const DB_FILE = path.join(__dirname, 'store_data.json');

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      products: [
        { id: 1, name: 'Capcut Pro 1 Month', price: 11.00, tnc: '1. Akaun private 30 hari.\n2. Dilarang tukar password akaun.\n3. Hubungi admin jika ada masalah log masuk.' }
      ],
      inventory: [
        { id: 1, product_id: 1, credentials: 'capcutuser@gmail.com | Pass1234', is_sold: false, sold_to: null }
      ],
      orders: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    const content = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return { products: [], inventory: [], orders: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function buildStoreKeyboard(products) {
  const keyboard = [
    [{ text: '🏷️ List Produk' }, { text: '🎟️ Voucher' }, { text: '📁 Laporan Stok' }]
  ];
  let row = [];
  for (let i = 1; i <= products.length; i++) {
    row.push({ text: `${i}` });
    if (row.length === 5) {
      keyboard.push(row);
      row = [];
    }
  }
  if (row.length > 0) keyboard.push(row);
  return keyboard;
}

function sendProductList(chatId) {
  const store = loadData();
  let listText = '🛒 *LIST PRODUCT*\n\n';

  if (store.products.length === 0) {
    listText += 'Tiada produk tersenarai lagi.\n';
  } else {
    store.products.forEach((p, index) => {
      const stockCount = store.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
      listText += `[${index + 1}]. ${p.name.toUpperCase()} ( ${stockCount} )\n`;
    });
  }

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  listText += `\n📄 Halaman 1 / 1\n📅 ${now}`;

  bot.sendMessage(chatId, listText, {
    parse_mode: 'Markdown',
    reply_markup: { keyboard: buildStoreKeyboard(store.products), resize_keyboard: true }
  });
}

bot.onText(/\/start/, (msg) => {
  sendProductList(msg.chat.id);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (text === '/start') return;
  if (text === '🏷️ List Produk') return sendProductList(chatId);
  if (text === '🎟️ Voucher') return bot.sendMessage(chatId, '🎟️ Tiada baucar aktif buat masa ini.');
  if (text === '📁 Laporan Stok') {
    const store = loadData();
    let report = '📁 *LAPORAN STOK SEMASA:*\n\n';
    store.products.forEach((p, index) => {
      const stockCount = store.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
      report += `${index + 1}. ${p.name}: *${stockCount} unit*\n`;
    });
    return bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  const selectedIndex = parseInt(text) - 1;
  if (!isNaN(selectedIndex)) {
    const store = loadData();
    if (store.products[selectedIndex]) {
      const product = store.products[selectedIndex];
      const availableStock = store.inventory.filter(i => i.product_id === product.id && !i.is_sold);

      if (availableStock.length === 0) {
        return bot.sendMessage(chatId, `❌ Maaf, stok untuk *${product.name}* telah habis (0).`, { parse_mode: 'Markdown' });
      }

      const orderId = `ORD-${Date.now()}`;
      const amountCents = Math.round(product.price * 100);

      if (TOYYIB_SECRET && TOYYIB_CAT) {
        try {
          const response = await axios.post('https://toyyibpay.com/index.php/api/createBill', new URLSearchParams({
            userSecretKey: TOYYIB_SECRET,
            categoryCode: TOYYIB_CAT,
            billName: product.name,
            billDescription: `Pesanan ${orderId}`,
            billPriceSetting: 1,
            billPayorInfo: 0,
            billAmount: amountCents,
            billReturnUrl: `${SERVER_URL}/payment-return`,
            billCallbackUrl: `${SERVER_URL}/payment-callback`,
            billExternalReferenceNo: orderId,
            billTo: `Pelanggan-${chatId}`,
            billEmail: 'customer@tgstore.com',
            billPhone: '0123456789'
          }));

          const billCode = response.data[0]?.BillCode;
          if (billCode) {
            const paymentUrl = `https://toyyibpay.com/${billCode}`;

            store.orders.push({
              orderId,
              productId: product.id,
              productName: product.name,
              chatId: String(chatId),
              amount: product.price,
              status: 'pending',
              date: new Date().toLocaleString('ms-MY')
            });
            saveData(store);

            return bot.sendMessage(chatId, 
              `🛒 *Pesanan #${selectedIndex + 1}: ${product.name}*\n` +
              `💰 *Jumlah:* RM${Number(product.price).toFixed(2)}\n\n` +
              `Tekan butang di bawah untuk membuat pembayaran:\n\n` +
              `⚡ *Maklumat akaun akan dihantar serta-merta selepas bayaran disahkan.*`, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [[{ text: '💳 Bayar Sekarang (FPX / DuitNow)', url: paymentUrl }]]
              }
            });
          }
        } catch (e) {
          console.error('ToyyibPay Error:', e.message);
        }
      }
      return bot.sendMessage(chatId, `🛒 *Pesanan: ${product.name}*\n⚠️ Gateway pembayaran sedang diselenggara.`);
    }
  }
});

// FUNGSI SERAHAN AKAUN
function deliverProduct(orderId) {
  const store = loadData();
  const order = store.orders.find(o => o.orderId === orderId && o.status === 'pending');
  if (!order) return false;

  const item = store.inventory.find(i => i.product_id === order.productId && !i.is_sold);
  const product = store.products.find(p => p.id === order.productId);

  if (item) {
    item.is_sold = true;
    item.sold_to = order.chatId;
    order.status = 'paid';
    order.completedAt = new Date().toLocaleString('ms-MY');
    saveData(store);

    const tncText = product?.tnc ? `\n\n📌 *Terma & Syarat (T&C):*\n${product.tnc}` : '';
    const deliveryMessage = 
      `🎉 *Pembayaran Berjaya Disahkan!*\n\n` +
      `Produk: *${order.productName}*\n\n` +
      `🔐 *Maklumat Akaun Anda:*\n` +
      `\`\`\`\n${item.credentials}\n\`\`\`` +
      `${tncText}\n\n` +
      `_Terima kasih atas sokongan anda! Sila simpan butiran ini._`;

    bot.sendMessage(order.chatId, deliveryMessage, { parse_mode: 'Markdown' });
    return true;
  }
  return false;
}

app.all('/payment-callback', (req, res) => {
  const data = { ...req.query, ...req.body };
  const status = String(data.status_id || data.status || '');
  const orderId = data.order_id || data.refno;
  if (status === '1' && orderId) deliverProduct(orderId);
  res.send('OK');
});

app.get('/payment-return', async (req, res) => {
  const { status_id, order_id, billcode } = req.query;
  if (String(status_id) === '1' && order_id) {
    deliverProduct(order_id);
  } else if (billcode) {
    try {
      const checkRes = await axios.post('https://toyyibpay.com/index.php/api/getBillTransactions', new URLSearchParams({ billCode: billcode }));
      if (checkRes.data && checkRes.data[0] && checkRes.data[0].billpaymentStatus === '1') {
        deliverProduct(checkRes.data[0].billExternalReferenceNo);
      }
    } catch (e) {}
  }
  res.send(`<html><body style="font-family:sans-serif; text-align:center; padding:50px; background:#0b0f19; color:#fff;"><h1 style="color:#10b981;">🎉 Pembayaran Berjaya!</h1><p>Sila buka aplikasi Telegram anda.</p></body></html>`);
});

// DASHBOARD WEB ADMIN (DARK THEME)
app.get('/', (req, res) => {
  const store = loadData();
  const totalProducts = store.products.length;
  const readyStock = store.inventory.filter(i => !i.is_sold).length;
  const successfulOrders = store.orders.filter(o => o.status === 'paid');
  const pendingOrders = store.orders.filter(o => o.status === 'pending');
  const totalSales = successfulOrders.reduce((sum, o) => sum + Number(o.amount), 0);

  res.send(`
  <!DOCTYPE html>
  <html lang="ms">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Store Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { background-color: #0b0f19; color: #f1f5f9; }
      .dark-card { background-color: #151d30; border: 1px solid #1e293b; }
      .dark-input { background-color: #0b0f19; border: 1px solid #334155; color: white; }
    </style>
  </head>
  <body class="p-4 max-w-xl mx-auto font-sans pb-16">
    <div class="dark-card p-4 rounded-2xl shadow mb-4 flex justify-between items-center">
      <div>
        <h1 class="text-lg font-bold">🏪 Store Admin</h1>
        <p class="text-xs text-emerald-400 font-semibold">● Sistem Stabil (Simpanan Terus)</p>
      </div>
      <span class="text-xs bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-full font-bold">Direct Save</span>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="dark-card p-4 rounded-2xl">
        <p class="text-xs text-slate-400">Total Produk</p>
        <p class="text-2xl font-black text-blue-400 mt-1">${totalProducts}</p>
      </div>
      <div class="dark-card p-4 rounded-2xl">
        <p class="text-xs text-slate-400">Total Stok Siap</p>
        <p class="text-2xl font-black text-emerald-400 mt-1">${readyStock}</p>
      </div>
      <div class="dark-card p-4 rounded-2xl col-span-2">
        <p class="text-xs text-slate-400">Total Jualan Terkumpul</p>
        <p class="text-2xl font-black text-amber-400 mt-1">RM ${totalSales.toFixed(2)}</p>
      </div>
    </div>

    ${pendingOrders.length > 0 ? `
    <div class="dark-card p-4 rounded-2xl mb-4 border border-amber-500/40">
      <h2 class="font-bold text-sm text-amber-400 mb-2">⏳ Pesanan Menunggu:</h2>
      <div class="divide-y divide-slate-800 text-xs">
        ${pendingOrders.map(o => `
          <div class="py-2 flex justify-between items-center">
            <div>
              <p class="font-bold text-white">${o.productName} (RM${Number(o.amount).toFixed(2)})</p>
              <p class="text-[10px] text-slate-400">${o.orderId}</p>
            </div>
            <a href="/admin/manual-confirm/${o.orderId}" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold">Lepaskan</a>
          </div>
        `).join('')}
      </div>
    </div>` : ''}

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">➕ Tambah Produk Baru</h2>
      <form action="/admin/add-product" method="POST" class="space-y-3">
        <input type="text" name="name" placeholder="Nama Produk" required class="w-full text-xs p-3 rounded-xl dark-input">
        <input type="number" step="0.01" name="price" placeholder="Harga (RM)" required class="w-full text-xs p-3 rounded-xl dark-input">
        <textarea name="tnc" placeholder="Terma & Syarat" rows="2" class="w-full text-xs p-3 rounded-xl dark-input"></textarea>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-3 rounded-xl font-bold">Simpan Produk</button>
      </form>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">📦 Masukkan Stok Akaun</h2>
      <form action="/admin/add-stock" method="POST" class="space-y-3">
        <select name="product_id" class="w-full text-xs p-3 rounded-xl dark-input">
          ${store.products.map((p, idx) => `<option value="${p.id}">[${idx + 1}] ${p.name}</option>`).join('')}
        </select>
        <textarea name="credentials" placeholder="email@gmail.com | pass123" required rows="3" class="w-full text-xs p-3 rounded-xl dark-input"></textarea>
        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-3 rounded-xl font-bold">Tambah ke Inventori</button>
      </form>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">🛠️ Senarai & Edit Produk</h2>
      <div class="space-y-3">
        ${store.products.map((p, idx) => {
          const sCount = store.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
          return `
          <div class="bg-slate-900 border border-slate-800 p-3 rounded-xl">
            <form action="/admin/update-product" method="POST" class="space-y-2 text-xs">
              <input type="hidden" name="id" value="${p.id}">
              <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-blue-400">Slot [${idx + 1}]</span>
                <span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">Stok: ${sCount}</span>
              </div>
              <input type="text" name="name" value="${p.name}" class="w-full p-2 rounded-lg dark-input">
              <input type="number" step="0.01" name="price" value="${p.price}" class="w-full p-2 rounded-lg dark-input">
              <textarea name="tnc" rows="2" class="w-full p-2 rounded-lg dark-input">${p.tnc || ''}</textarea>
              <div class="flex gap-2 pt-1">
                <button type="submit" class="flex-1 bg-blue-600 text-white py-2 rounded-lg font-semibold">Simpan</button>
                <a href="/admin/delete-product/${p.id}" onclick="return confirm('Padam produk ini?')" class="px-3 bg-rose-900/30 text-rose-400 border border-rose-800 flex items-center justify-center rounded-lg">Padam</a>
              </div>
            </form>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="dark-card p-4 rounded-2xl">
      <h2 class="font-bold text-sm mb-3">📜 Sejarah Pembelian Berjaya</h2>
      ${successfulOrders.length === 0 ? 
        `<p class="text-xs text-slate-500 py-3 text-center">Tiada rekod lagi.</p>` :
        `<div class="divide-y divide-slate-800 text-xs">
          ${successfulOrders.slice().reverse().map(o => `
            <div class="py-2.5 flex justify-between items-center">
              <div>
                <p class="font-bold text-white">${o.productName}</p>
                <p class="text-[10px] text-slate-400">${o.completedAt || o.date}</p>
              </div>
              <span class="text-emerald-400 font-bold">+RM ${Number(o.amount).toFixed(2)}</span>
            </div>
          `).join('')}
        </div>`
      }
    </div>
  </body>
  </html>
  `);
});

app.post('/admin/add-product', (req, res) => {
  const { name, price, tnc } = req.body;
  const store = loadData();
  store.products.push({ id: Date.now(), name, price: parseFloat(price), tnc: tnc || '' });
  saveData(store);
  res.redirect('/');
});

app.post('/admin/update-product', (req, res) => {
  const { id, name, price, tnc } = req.body;
  const store = loadData();
  const product = store.products.find(p => p.id === parseInt(id));
  if (product) {
    product.name = name;
    product.price = parseFloat(price);
    product.tnc = tnc;
    saveData(store);
  }
  res.redirect('/');
});

app.get('/admin/delete-product/:id', (req, res) => {
  const store = loadData();
  const prodId = parseInt(req.params.id);
  store.products = store.products.filter(p => p.id !== prodId);
  store.inventory = store.inventory.filter(i => i.product_id !== prodId);
  saveData(store);
  res.redirect('/');
});

app.post('/admin/add-stock', (req, res) => {
  const { product_id, credentials } = req.body;
  const store = loadData();
  const lines = credentials.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  lines.forEach(line => {
    store.inventory.push({ id: Date.now() + Math.random(), product_id: parseInt(product_id), credentials: line, is_sold: false, sold_to: null });
  });
  saveData(store);
  res.redirect('/');
});

app.get('/admin/manual-confirm/:orderId', (req, res) => {
  deliverProduct(req.params.orderId);
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif pada port ${PORT}`));
