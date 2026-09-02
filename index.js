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
  products: [
    { 
      id: 1, 
      name: 'CapCut Pro 1 Bulan', 
      price: 10.00, 
      tnc: '1. Akaun private 30 hari.\n2. Dilarang tukar password.\n3. Warranty 30 hari jika ada isu login.' 
    }
  ],
  inventory: [
    { id: 1, product_id: 1, credentials: 'capcutuser@gmail.com | Pass1234', is_sold: false }
  ],
  orders: []
};

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 1. TELEGRAM BOT
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (storeData.products.length === 0) {
    return bot.sendMessage(chatId, '👋 Hai! Tiada produk tersenarai pada masa ini.');
  }

  const buttons = storeData.products.map(p => {
    const stockCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
    return [{ text: `🛒 ${p.name} - RM${p.price.toFixed(2)} (Stok: ${stockCount})`, callback_data: `buy_${p.id}` }];
  });

  bot.sendMessage(chatId, `👋 *Selamat Datang ke Waniiisha Store!*\n\nSila pilih produk digital di bawah untuk membuat pembelian:`, {
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

          return bot.sendMessage(chatId, `🛒 *Pesanan:* ${product.name}\n💰 *Jumlah:* RM${product.price.toFixed(2)}\n\nTekan pautan di bawah untuk pembayaran FPX / QR:\n👉 ${paymentUrl}`, {
            parse_mode: 'Markdown'
          });
        }
      } catch (e) {
        console.error('ToyyibPay Error:', e.message);
      }
    }

    bot.sendMessage(chatId, '⚠️ Gateway pembayaran sedang diselenggara.');
  }
});

// Callback Auto-Delivery Selepas Bayar (Hantar Akaun + T&C)
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
          `_Terima kasih atas pembelian anda! Sila simpan butiran ini._`;

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
    <title>Store Admin - Dark</title>
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
        <p class="text-xs text-emerald-400 font-semibold">● Aktif & Milik Penuh</p>
      </div>
      <span class="text-xs bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1 rounded-full font-bold">Dark Edition</span>
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
      <h2 class="font-bold text-sm mb-3">➕ Tambah Produk Baru</h2>
      <form action="/admin/add-product" method="POST" class="space-y-3">
        <input type="text" name="name" placeholder="Nama Produk (Cth: Netflix Premium)" required class="w-full text-xs p-3 rounded-xl dark-input">
        <input type="number" step="0.01" name="price" placeholder="Harga (RM)" required class="w-full text-xs p-3 rounded-xl dark-input">
        <textarea name="tnc" placeholder="Terma & Syarat Produk (Akan dihantar bersama email & pass selepas bayar)" rows="3" class="w-full text-xs p-3 rounded-xl dark-input"></textarea>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-3 rounded-xl font-bold">Simpan Produk</button>
      </form>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">📦 Masukkan Stok Akaun</h2>
      <form action="/admin/add-stock" method="POST" class="space-y-3">
        <select name="product_id" class="w-full text-xs p-3 rounded-xl dark-input">
          ${storeData.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
        <textarea name="credentials" placeholder="email@gmail.com | pass123 (Satu akaun setiap baris)" required rows="3" class="w-full text-xs p-3 rounded-xl dark-input"></textarea>
        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-3 rounded-xl font-bold">Tambah ke Inventori</button>
      </form>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">🛠️ Senarai & Edit Produk</h2>
      <div class="space-y-3">
        ${storeData.products.map(p => {
          const sCount = storeData.inventory.filter(i => i.product_id === p.id && !i.is_sold).length;
          return `
          <div class="bg-slate-900 border border-slate-800 p-3 rounded-xl">
            <form action="/admin/update-product" method="POST" class="space-y-2 text-xs">
              <input type="hidden" name="id" value="${p.id}">
              <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-blue-400">ID #${p.id}</span>
                <span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold">Stok: ${sCount}</span>
              </div>
              <label class="text-[10px] text-slate-400">Nama Produk</label>
              <input type="text" name="name" value="${p.name}" class="w-full p-2 rounded-lg dark-input">
              <label class="text-[10px] text-slate-400">Harga (RM)</label>
              <input type="number" step="0.01" name="price" value="${p.price}" class="w-full p-2 rounded-lg dark-input">
              <label class="text-[10px] text-slate-400">Terma & Syarat (Dihantar selepas bayaran)</label>
              <textarea name="tnc" rows="2" class="w-full p-2 rounded-lg dark-input">${p.tnc || ''}</textarea>
              <div class="flex gap-2 pt-1">
                <button type="submit" class="flex-1 bg-blue-600 text-white py-2 rounded-lg font-semibold">Simpan Edit</button>
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
