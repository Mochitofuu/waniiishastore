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

// Pangkalan Data Lengkap Kedai
let storeData = {
  products: [
    { 
      id: 1, 
      name: 'CapCut Pro 1 Bulan', 
      price: 10.00, 
      tnc: '1. Akaun diberi dalam bentuk email & password.\n2. Warranty 30 hari bermula dari tarikh pembelian.\n3. Dilarang menukar password akaun.' 
    }
  ],
  inventory: [
    { id: 1, product_id: 1, credentials: 'capcutuser@gmail.com | Pass1234', is_sold: false }
  ],
  orders: []
};

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==========================================
// 1. TELEGRAM BOT
// ==========================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (storeData.products.length === 0) {
    return bot.sendMessage(chatId, '👋 Hai! Tiada produk tersenarai pada masa ini.');
  }

  const buttons = storeData.products.map(p => {
    const stockCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
    return [{ text: `🛒 ${p.name} - RM${p.price.toFixed(2)} (Stok: ${stockCount})`, callback_data: `view_${p.id}` }];
  });

  bot.sendMessage(chatId, `👋 *Selamat Datang ke Waniiisha Store!*\n\nSila pilih produk di bawah untuk melihat butiran & membuat pembelian:`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  // Papar Butiran Produk & T&C Sebelum Bayar
  if (data.startsWith('view_')) {
    const productId = parseInt(data.split('_')[1]);
    const product = storeData.products.find(p => p.id === productId);
    const stockCount = storeData.inventory.filter(i => i.product_id === productId && !i.is_sold).length;

    if (!product) return;

    const message = `📦 *${product.name}*\n💰 *Harga:* RM${product.price.toFixed(2)}\n📊 *Baki Stok:* ${stockCount}\n\n📜 *Terma & Syarat (T&C):*\n${product.tnc || 'Tiada terma khusus.'}`;

    const buttons = [
      [{ text: `💳 Beli Sekarang (RM${product.price.toFixed(2)})`, callback_data: `buy_${product.id}` }],
      [{ text: `⬅️ Kembali ke Senarai`, callback_data: `menu_main` }]
    ];

    return bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }

  if (data === 'menu_main') {
    const buttons = storeData.products.map(p => {
      const stockCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
      return [{ text: `🛒 ${p.name} - RM${p.price.toFixed(2)} (Stok: ${stockCount})`, callback_data: `view_${p.id}` }];
    });

    return bot.sendMessage(chatId, `👋 *Menu Produk Waniiisha Store:*`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }

  // Proses Pembelian
  if (data.startsWith('buy_')) {
    const productId = parseInt(data.split('_')[1]);
    const product = storeData.products.find(p => p.id === productId);
    const availableStock = storeData.inventory.filter(i => i.product_id === productId && !i.is_sold);

    if (availableStock.length === 0) {
      return bot.sendMessage(chatId, '❌ Maaf, stok untuk item ini telah habis.');
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
            productId,
            productName: product.name,
            chatId: String(chatId),
            amount: product.price,
            status: 'pending',
            date: new Date().toLocaleString('ms-MY')
          });

          return bot.sendMessage(chatId, `🛒 *Pesanan: ${product.name}*\n💰 *Jumlah:* RM${product.price.toFixed(2)}\n\nTekan pautan di bawah untuk bayaran segera:\n👉 ${paymentUrl}`, {
            parse_mode: 'Markdown'
          });
        }
      } catch (e) {
        console.error('ToyyibPay Error:', e.message);
      }
    }

    bot.sendMessage(chatId, '⚠️ Sistem gerbang pembayaran belum dikonfigurasi sepenuhnya.');
  }
});

// Callback Auto-Delivery ToyyibPay
app.post('/payment-callback', (req, res) => {
  const { status_id, order_id } = req.body;
  if (status_id === '1') {
    const order = storeData.orders.find(o => o.orderId === order_id && o.status === 'pending');
    if (order) {
      const item = storeData.inventory.find(i => i.product_id === order.productId && !i.is_sold);
      if (item) {
        item.is_sold = true;
        item.sold_to = order.chatId;
        order.status = 'paid';
        order.completedAt = new Date().toLocaleString('ms-MY');

        bot.sendMessage(order.chatId, `🎉 *Pembayaran Berjaya!*\n\nProduk: *${order.productName}*\nMaklumat Akaun:\n\`\`\`\n${item.credentials}\n\`\`\`\n\nTerima kasih atas sokongan anda!`, { parse_mode: 'Markdown' });
      }
    }
  }
  res.send('OK');
});

// ==========================================
// 2. DASHBOARD WEB (DARK MODE & FULL MANAGEMENT)
// ==========================================
app.get('/', (req, res) => {
  const totalProducts = storeData.products.length;
  const readyStock = storeData.inventory.filter(i => !i.is_sold).length;
  const successfulOrders = storeData.orders.filter(o => o.status === 'paid');
  const totalSales = successfulOrders.reduce((sum, o) => sum + o.amount, 0);

  res.send(`
  <!DOCTYPE html>
  <html lang="ms" class="dark">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Waniiisha Store Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              brandDark: '#0f172a',
              cardDark: '#1e293b',
              borderDark: '#334155'
            }
          }
        }
      }
    </script>
  </head>
  <body class="bg-brandDark text-slate-100 min-h-screen p-4 max-w-xl mx-auto font-sans pb-16">
    <!-- Header -->
    <div class="bg-cardDark border border-borderDark p-4 rounded-2xl shadow-lg mb-4 flex justify-between items-center">
      <div>
        <h1 class="text-lg font-bold text-white flex items-center gap-2">
          🏪 Waniiisha Admin
        </h1>
        <p class="text-xs text-emerald-400 font-semibold flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span> Sistem Aktif
        </p>
      </div>
      <span class="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-3 py-1 rounded-full font-bold">
        Dark Mode • RM
      </span>
    </div>

    <!-- Statistik Kad -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="bg-cardDark border border-borderDark p-4 rounded-2xl">
        <p class="text-xs text-slate-400 font-medium">Total Produk</p>
        <p class="text-2xl font-black text-blue-400 mt-1">${totalProducts}</p>
      </div>
      <div class="bg-cardDark border border-borderDark p-4 rounded-2xl">
        <p class="text-xs text-slate-400 font-medium">Total Stok Siap</p>
        <p class="text-2xl font-black text-emerald-400 mt-1">${readyStock}</p>
      </div>
      <div class="bg-cardDark border border-borderDark p-4 rounded-2xl col-span-2">
        <p class="text-xs text-slate-400 font-medium">Total Jualan Berjaya</p>
        <p class="text-2xl font-black text-amber-400 mt-1">RM ${totalSales.toFixed(2)}</p>
      </div>
    </div>

    <!-- Borang Tambah Produk -->
    <div class="bg-cardDark border border-borderDark p-4 rounded-2xl mb-4 shadow-sm">
      <h2 class="font-bold text-white text-sm mb-3 flex items-center gap-2">➕ Tambah Produk Baru</h2>
      <form action="/admin/add-product" method="POST" class="space-y-3">
        <input type="text" name="name" placeholder="Nama Produk (Cth: Netflix Premium)" required 
          class="w-full text-xs p-3 rounded-xl bg-slate-900/60 border border-borderDark text-white focus:outline-none focus:border-blue-500">
        <input type="number" step="0.01" name="price" placeholder="Harga (RM)" required 
          class="w-full text-xs p-3 rounded-xl bg-slate-900/60 border border-borderDark text-white focus:outline-none focus:border-blue-500">
        <textarea name="tnc" placeholder="Terma & Syarat Produk (Warranty, Rules, etc.)" rows="2"
          class="w-full text-xs p-3 rounded-xl bg-slate-900/60 border border-borderDark text-white focus:outline-none focus:border-blue-500"></textarea>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-3 rounded-xl font-bold transition">
          Simpan Produk
        </button>
      </form>
    </div>

    <!-- Borang Masukkan Stok Akaun (Bulk / Baris Demi Baris) -->
    <div class="bg-cardDark border border-borderDark p-4 rounded-2xl mb-4 shadow-sm">
      <h2 class="font-bold text-white text-sm mb-3 flex items-center gap-2">📦 Masukkan Stok Akaun</h2>
      <form action="/admin/add-stock" method="POST" class="space-y-3">
        <select name="product_id" class="w-full text-xs p-3 rounded-xl bg-slate-900/60 border border-borderDark text-white focus:outline-none focus:border-emerald-500">
          ${storeData.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
        <textarea name="credentials" placeholder="email@gmail.com | pass123 (Boleh letak satu atau banyak baris sekaligus)" required rows="3"
          class="w-full text-xs p-3 rounded-xl bg-slate-900/60 border border-borderDark text-white focus:outline-none focus:border-emerald-500"></textarea>
        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-3 rounded-xl font-bold transition">
          Tambah ke Inventori
        </button>
      </form>
    </div>

    <!-- Senarai Produk & Butang Kemas Kini (Edit) -->
    <div class="bg-cardDark border border-borderDark p-4 rounded-2xl mb-4 shadow-sm">
      <h2 class="font-bold text-white text-sm mb-3">🛠️ Pengurusan Produk & Stok</h2>
      <div class="space-y-4">
        ${storeData.products.map(p => {
          const sCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
          return `
          <div class="bg-slate-900/50 border border-borderDark/60 p-3 rounded-xl">
            <form action="/admin/update-product" method="POST" class="space-y-2 text-xs">
              <input type="hidden" name="id" value="${p.id}">
              <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-blue-400">ID #${p.id}</span>
                <span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">Baki Stok: ${sCount}</span>
              </div>
              <label class="text-[10px] text-slate-400">Nama Produk</label>
              <input type="text" name="name" value="${p.name}" class="w-full p-2 rounded-lg bg-slate-800 border border-borderDark text-white">
              
              <label class="text-[10px] text-slate-400">Harga (RM)</label>
              <input type="number" step="0.01" name="price" value="${p.price}" class="w-full p-2 rounded-lg bg-slate-800 border border-borderDark text-white">
              
              <label class="text-[10px] text-slate-400">Terma & Syarat (T&C)</label>
              <textarea name="tnc" rows="2" class="w-full p-2 rounded-lg bg-slate-800 border border-borderDark text-white">${p.tnc || ''}</textarea>
              
              <div class="flex gap-2 pt-1">
                <button type="submit" class="flex-1 bg-blue-600/80 hover:bg-blue-600 text-white py-2 rounded-lg font-semibold transition">
                  Simpan Perubahan
                </button>
                <a href="/admin/delete-product/${p.id}" onclick="return confirm('Padam produk ini?')" class="px-3 bg-rose-600/20 text-rose-400 border border-rose-600/30 flex items-center justify-center rounded-lg font-semibold">
                  Padam
                </a>
              </div>
            </form>
          </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Rekod Sejarah Transaksi Berjaya -->
    <div class="bg-cardDark border border-borderDark p-4 rounded-2xl shadow-sm">
      <h2 class="font-bold text-white text-sm mb-3 flex items-center gap-2">📜 Sejarah Pembelian Berjaya</h2>
      ${successfulOrders.length === 0 ? 
        `<p class="text-xs text-slate-400 py-4 text-center">Belum ada transaksi berjaya lagi.</p>` :
        `<div class="divide-y divide-borderDark text-xs">
          ${successfulOrders.slice().reverse().map(o => `
            <div class="py-2.5 flex justify-between items-center">
              <div>
                <p class="font-bold text-white">${o.productName}</p>
                <p class="text-[10px] text-slate-400">Tarikh: ${o.completedAt || o.date}</p>
                <p class="text-[10px] text-slate-500">Chat ID: ${o.chatId}</p>
              </div>
              <div class="text-right">
                <span class="text-emerald-400 font-bold block">+RM ${o.amount.toFixed(2)}</span>
                <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Paid</span>
              </div>
            </div>
          `).join('')}
        </div>`
      }
    </div>
  </body>
  </html>
  `);
});

// Endpoint Kemas Kini Produk & Padam
app.post('/admin/add-product', (req, res) => {
  const { name, price, tnc } = req.body;
  storeData.products.push({
    id: Date.now(),
    name,
    price: parseFloat(price),
    tnc: tnc || ''
  });
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
    storeData.inventory.push({
      id: Date.now() + Math.random(),
      product_id: parseInt(product_id),
      credentials: line,
      is_sold: false
    });
  });
  
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server aktif pada port ${PORT}`);
});
    return bot.sendMessage(chatId, '👋 Hai! Kedai sedang dikemas kini. Tiada produk buat masa ini.');
  }

  const buttons = storeData.products.map(p => {
    const stockCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
    return [{ text: `🛒 ${p.name} - RM${p.price.toFixed(2)} (Stok: ${stockCount})`, callback_data: `buy_${p.id}` }];
  });

  bot.sendMessage(chatId, `👋 *Selamat Datang ke Waniiisha Store!*\n\nSila pilih produk digital yang anda inginkan di bawah:`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('buy_')) {
    const productId = parseInt(data.split('_')[1]);
    const product = storeData.products.find(p => p.id === productId);
    const availableStock = storeData.inventory.filter(i => i.product_id === productId && !i.is_sold);

    if (availableStock.length === 0) {
      return bot.sendMessage(chatId, '❌ Maaf, stok untuk item ini telah habis.');
    }

    const orderId = `ORD-${Date.now()}`;
    const amountCents = Math.round(product.price * 100);

    // Cuba buat bil ToyyibPay
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
            productId,
            chatId: String(chatId),
            amount: product.price,
            status: 'pending',
            date: new Date().toLocaleString('ms-MY')
          });

          return bot.sendMessage(chatId, `🛒 *Pesanan Anda:*\nProduk: ${product.name}\nHarga: RM${product.price.toFixed(2)}\n\nTekan pautan di bawah untuk bayar secara automatik via *FPX / DuitNow QR*:\n👉 ${paymentUrl}`, {
            parse_mode: 'Markdown'
          });
        }
      } catch (e) {
        console.error('ToyyibPay Error:', e.message);
      }
    }

    // Pilihan Manual QR DuitNow jika ToyyibPay belum set
    bot.sendPhoto(chatId, storeData.duitnowQrUrl, {
      caption: `🛒 *Pesanan: ${product.name} (RM${product.price.toFixed(2)})*\n\nSila imbas DuitNow QR di atas dan buat bayaran.\nSelepas bayar, hantar gambar resit di sini untuk pengesahan.`
    });
  }
});

// Webhook Pengesahan ToyyibPay Automatik
app.post('/payment-callback', (req, res) => {
  const { status_id, order_id } = req.body;
  if (status_id === '1') {
    const order = storeData.orders.find(o => o.orderId === order_id && o.status === 'pending');
    if (order) {
      const item = storeData.inventory.find(i => i.product_id === order.productId && !i.is_sold);
      if (item) {
        item.is_sold = true;
        order.status = 'paid';
        bot.sendMessage(order.chatId, `🎉 *Pembayaran Berjaya!*\n\nBerikut butiran akaun anda:\n\`\`\`\n${item.credentials}\n\`\`\`\nTerima kasih!`, { parse_mode: 'Markdown' });
      }
    }
  }
  res.send('OK');
});

// ==========================================
// 2. WEB ADMIN PANEL (PAPARAN SEBIJI MACAM GAMBAR)
// ==========================================
app.get('/', (req, res) => {
  const totalProducts = storeData.products.length;
  const readyStock = storeData.inventory.filter(i => !i.is_sold).length;
  const totalSales = storeData.orders.filter(o => o.status === 'paid').reduce((sum, o) => sum + o.amount, 0);

  res.send(`
  <!DOCTYPE html>
  <html lang="ms">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Store Admin - Waniiisha</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-gray-100 p-4 font-sans max-w-xl mx-auto">
    <!-- Header -->
    <div class="bg-white p-4 rounded-xl shadow-sm mb-4 flex justify-between items-center border">
      <div>
        <h1 class="text-xl font-bold text-gray-800">🏪 Store Admin</h1>
        <p class="text-xs text-green-600 font-semibold">● Sistem Aktif (Milik Sendiri)</p>
      </div>
      <span class="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-full font-bold">RM Version</span>
    </div>

    <!-- Statistik Kad (Macam Gambar Awak) -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="bg-white p-4 rounded-xl border shadow-sm">
        <p class="text-xs text-gray-500 font-medium">Total Produk</p>
        <p class="text-2xl font-extrabold text-blue-600">${totalProducts}</p>
      </div>
      <div class="bg-white p-4 rounded-xl border shadow-sm">
        <p class="text-xs text-gray-500 font-medium">Total Stok Siap</p>
        <p class="text-2xl font-extrabold text-green-600">${readyStock}</p>
      </div>
      <div class="bg-white p-4 rounded-xl border shadow-sm col-span-2">
        <p class="text-xs text-gray-500 font-medium">Total Jualan Terkumpul</p>
        <p class="text-2xl font-extrabold text-amber-500">RM ${totalSales.toFixed(2)}</p>
      </div>
    </div>

    <!-- Borang Tambah Produk Baru -->
    <div class="bg-white p-4 rounded-xl border shadow-sm mb-4">
      <h2 class="font-bold text-gray-800 text-sm mb-3">➕ Tambah Produk Baru</h2>
      <form action="/admin/add-product" method="POST" class="space-y-2">
        <input type="text" name="name" placeholder="Nama Produk (Cth: Netflix 1 Bulan)" required class="w-full text-xs p-2.5 border rounded-lg">
        <input type="number" step="0.5" name="price" placeholder="Harga (RM)" required class="w-full text-xs p-2.5 border rounded-lg">
        <button type="submit" class="w-full bg-blue-600 text-white text-xs py-2.5 rounded-lg font-bold">Simpan Produk</button>
      </form>
    </div>

    <!-- Borang Isi Stok Akaun Digital -->
    <div class="bg-white p-4 rounded-xl border shadow-sm mb-4">
      <h2 class="font-bold text-gray-800 text-sm mb-3">📦 Masukkan Stok Akaun (Email/Password)</h2>
      <form action="/admin/add-stock" method="POST" class="space-y-2">
        <select name="product_id" class="w-full text-xs p-2.5 border rounded-lg">
          ${storeData.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
        <textarea name="credentials" placeholder="email@gmail.com | pass123" required class="w-full text-xs p-2.5 border rounded-lg" rows="2"></textarea>
        <button type="submit" class="w-full bg-green-600 text-white text-xs py-2.5 rounded-lg font-bold">Tambah Stok</button>
      </form>
    </div>

    <!-- Senarai Produk Sedia Ada -->
    <div class="bg-white p-4 rounded-xl border shadow-sm mb-4">
      <h2 class="font-bold text-gray-800 text-sm mb-2">📋 Senarai Produk & Baki Stok</h2>
      <div class="divide-y text-xs">
        ${storeData.products.map(p => {
          const s = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
          return `<div class="py-2 flex justify-between items-center">
            <div>
              <p class="font-semibold text-gray-800">${p.name}</p>
              <p class="text-gray-500">RM${p.price.toFixed(2)}</p>
            </div>
            <span class="px-2 py-1 bg-gray-100 rounded text-gray-600 font-bold">Baki: ${s}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </body>
  </html>
  `);
});

// Endpoint Tambah Data dari Web
app.post('/admin/add-product', (req, res) => {
  const { name, price } = req.body;
  storeData.products.push({
    id: Date.now(),
    name,
    price: parseFloat(price),
    desc: ''
  });
  res.redirect('/');
});

app.post('/admin/add-stock', (req, res) => {
  const { product_id, credentials } = req.body;
  storeData.inventory.push({
    id: Date.now(),
    product_id: parseInt(product_id),
    credentials,
    is_sold: false
  });
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server aktif pada port ${PORT}`);
});
                
