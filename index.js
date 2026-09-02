const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const TOYYIB_SECRET = process.env.TOYYIB_SECRET || '';
const TOYYIB_CAT = process.env.TOYYIB_CAT || '';
const SERVER_URL = process.env.SERVER_URL || '';

let storeData = {
  // Pautan banner gambar kedai (boleh ditukar di kod atau dashboard)
  bannerUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop&q=80',
  products: [
    { id: 1, name: 'GEMINI AI 18 BULAN', price: 15.00, tnc: 'Akaun private. Warranty penuh.' },
    { id: 2, name: 'ALIGHT MOTION ANDROID 1Y', price: 12.00, tnc: 'Boleh login Android sahaja.' },
    { id: 3, name: 'ALIGHT MOTION IOS 1 YEAR', price: 14.00, tnc: 'Khusus pengguna iPhone/iPad.' },
    { id: 4, name: 'AMAZON PRIME VIDEO', price: 8.00, tnc: 'Private profile.' },
    { id: 5, name: 'APPLE MUSIC 1 BULAN', price: 7.00, tnc: 'Join family link.' },
    { id: 6, name: 'CANVA HEAD 1 BULAN', price: 5.00, tnc: 'Akaun jemputan Pro.' },
    { id: 7, name: 'CAPCUT 7DAY', price: 4.00, tnc: 'Akaun sharing jaminan 7 hari.' },
    { id: 8, name: 'CAPCUT PRO 1 BULAN PRIVATE', price: 10.00, tnc: 'Dilarang tukar password.' },
    { id: 9, name: 'CHATGPT+', price: 20.00, tnc: 'Private shared access.' },
    { id: 10, name: 'DISNEY', price: 9.00, tnc: 'Private profile 30 hari.' }
  ],
  inventory: [
    { id: 1, product_id: 2, credentials: 'am_android@gmail.com | pass123', is_sold: false },
    { id: 2, product_id: 3, credentials: 'am_ios@gmail.com | pass123', is_sold: false },
    { id: 3, product_id: 7, credentials: 'capcut7d@gmail.com | pass123', is_sold: false }
  ],
  orders: []
};

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Fungsi Menjana Keyboard Grid Nombor
function buildStoreKeyboard(products) {
  const keyboard = [
    [{ text: '🏷️ List Produk' }, { text: '🎟️ Voucher' }, { text: '📁 Laporan Stok' }]
  ];

  // Susun nombor 5 lajur sebaris (1-5, 6-10, ...)
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

// Fungsi Papar Menu Utama dengan Banner
async function sendProductList(chatId) {
  let listText = 'LIST PRODUCT\n\n';

  storeData.products.forEach((p, index) => {
    const stockCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
    listText += `[${index + 1}]. ${p.name.toUpperCase()} ( ${stockCount} )\n`;
  });

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  listText += `\n📄 Halaman 1 / 1\n📅 ${now}`;

  const keyboard = buildStoreKeyboard(storeData.products);

  try {
    await bot.sendPhoto(chatId, storeData.bannerUrl, {
      caption: listText,
      reply_markup: {
        keyboard: keyboard,
        resize_keyboard: true
      }
    });
  } catch (err) {
    bot.sendMessage(chatId, listText, {
      reply_markup: { keyboard: keyboard, resize_keyboard: true }
    });
  }
}

// 1. TELEGRAM BOT EVENT
bot.onText(/\/start/, (msg) => {
  sendProductList(msg.chat.id);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (text === '/start') return;

  if (text === '🏷️ List Produk') {
    return sendProductList(chatId);
  }

  if (text === '🎟️ Voucher') {
    return bot.sendMessage(chatId, '🎟️ Tiada baucar aktif buat masa ini.');
  }

  if (text === '📁 Laporan Stok') {
    let report = '📁 *LAPORAN STOK SEMASA:*\n\n';
    storeData.products.forEach((p, index) => {
      const stockCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
      report += `${index + 1}. ${p.name}: *${stockCount} unit*\n`;
    });
    return bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  // Jika Pengguna Tekan Nombor (Contoh: "1", "2", dsb.)
  const selectedIndex = parseInt(text) - 1;
  if (!isNaN(selectedIndex) && storeData.products[selectedIndex]) {
    const product = storeData.products[selectedIndex];
    const availableStock = storeData.inventory.filter(i => i.product_id === product.id && !i.is_sold);

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

          storeData.orders.push({
            orderId,
            productId: product.id,
            productName: product.name,
            chatId: String(chatId),
            amount: product.price,
            status: 'pending',
            date: new Date().toLocaleString('ms-MY')
          });

          return bot.sendMessage(chatId, 
            `🛒 *Pesanan #${selectedIndex + 1}: ${product.name}*\n` +
            `💰 *Harga:* RM${product.price.toFixed(2)}\n\n` +
            `Tekan pautan di bawah untuk pembayaran FPX / QR:\n👉 ${paymentUrl}`, 
            { parse_mode: 'Markdown' }
          );
        }
      } catch (e) {
        console.error('ToyyibPay Error:', e.message);
      }
    }

    return bot.sendMessage(chatId, `🛒 *Pesanan: ${product.name} (RM${product.price.toFixed(2)})*\n⚠️ Gerbang pembayaran belum diaktifkan.`, { parse_mode: 'Markdown' });
  }
});

// Callback Auto-Delivery Selepas Bayaran Berjaya
app.post('/payment-callback', (req, res) => {
  const { status_id, order_id } = req.body;
  if (status_id === '1') {
    const order = storeData.orders.find(o => o.orderId === order_id && o.status === 'pending');
    if (order) {
      const item = storeData.inventory.find(i => i.product_id === order.productId && !i.is_sold);
      const product = storeData.products.find(p => p.id === order.productId);

      if (item) {
        item.is_sold = true;
        item.sold_to = order.chatId;
        order.status = 'paid';
        order.completedAt = new Date().toLocaleString('ms-MY');

        const tncText = product?.tnc ? `\n\n📌 *Terma & Syarat (T&C):*\n${product.tnc}` : '';

        const deliveryMessage = 
          `🎉 *Pembayaran Berjaya!*\n\n` +
          `Produk: *${order.productName}*\n\n` +
          `🔐 *Maklumat Akaun Anda:*\n` +
          `\`\`\`\n${item.credentials}\n\`\`\`` +
          `${tncText}\n\n` +
          `_Terima kasih atas sokongan anda! Sila simpan butiran ini._`;

        bot.sendMessage(order.chatId, deliveryMessage, { parse_mode: 'Markdown' });
      }
    }
  }
  res.send('OK');
});

// 2. DASHBOARD WEB (DARK THEME)
app.get('/', (req, res) => {
  const totalProducts = storeData.products.length;
  const readyStock = storeData.inventory.filter(i => !i.is_sold).length;
  const successfulOrders = storeData.orders.filter(o => o.status === 'paid');
  const totalSales = successfulOrders.reduce((sum, o) => sum + o.amount, 0);

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
        <p class="text-xs text-emerald-400 font-semibold">● Bot Layout Mode: Grid Pad</p>
      </div>
      <span class="text-xs bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-full font-bold">RM Edition</span>
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
        <p class="text-xs text-slate-400">Total Jualan Berjaya</p>
        <p class="text-2xl font-black text-amber-400 mt-1">RM ${totalSales.toFixed(2)}</p>
      </div>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">🖼️ Kemas Kini Pautan Banner</h2>
      <form action="/admin/update-banner" method="POST" class="space-y-2">
        <input type="url" name="bannerUrl" value="${storeData.bannerUrl}" required class="w-full text-xs p-3 rounded-xl dark-input">
        <button type="submit" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2.5 rounded-xl font-bold">Kemas Kini Banner</button>
      </form>
    </div>

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
          ${storeData.products.map((p, idx) => `<option value="${p.id}">[${idx + 1}] ${p.name}</option>`).join('')}
        </select>
        <textarea name="credentials" placeholder="email@gmail.com | pass123" required rows="3" class="w-full text-xs p-3 rounded-xl dark-input"></textarea>
        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-3 rounded-xl font-bold">Tambah ke Inventori</button>
      </form>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">🛠️ Senarai & Edit Produk</h2>
      <div class="space-y-3">
        ${storeData.products.map((p, idx) => {
          const sCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
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
              <span class="text-emerald-400 font-bold">+RM ${o.amount.toFixed(2)}</span>
            </div>
          `).join('')}
        </div>`
      }
    </div>
  </body>
  </html>
  `);
});

app.post('/admin/update-banner', (req, res) => {
  storeData.bannerUrl = req.body.bannerUrl;
  res.redirect('/');
});

app.post('/admin/add-product', (req, res) => {
  const { name, price, tnc } = req.body;
  storeData.products.push({ id: Date.now(), name, price: parseFloat(price), tnc: tnc || '' });
  res.redirect('/');
});

app.post('/admin/update-product', (req, res) => {
  const { id, name, price, tnc } = req.body;
  const product = storeData.products.find(p => p.id === parseInt(id));
  if (product) {
    product.name = name;
    product.price = parseFloat(price);
    product.tnc = tnc;
  }
  res.redirect('/');
});

app.get('/admin/delete-product/:id', (req, res) => {
  const productId = parseInt(req.params.id);
  storeData.products = storeData.products.filter(p => p.id !== productId);
  storeData.inventory = storeData.inventory.filter(i => i.product_id !== productId);
  res.redirect('/');
});

app.post('/admin/add-stock', (req, res) => {
  const { product_id, credentials } = req.body;
  const lines = credentials.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  lines.forEach(line => {
    storeData.inventory.push({ id: Date.now() + Math.random(), product_id: parseInt(product_id), credentials: line, is_sold: false });
  });
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server aktif pada port ${PORT}`);
});
