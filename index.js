const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfigurasi Kunci & Data
const BOT_TOKEN = process.env.BOT_TOKEN;
const TOYYIB_SECRET = process.env.TOYYIB_SECRET || '';
const TOYYIB_CAT = process.env.TOYYIB_CAT || '';
const SERVER_URL = process.env.SERVER_URL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // Kata laluan web admin awak

// Pangkalan Data Dalaman (Boleh tambah & pantau terus di Web Dashboard)
let storeData = {
  products: [
    { id: 1, name: 'CapCut Pro 1 Bulan', price: 10.00, desc: 'Akaun Private 30 Hari' }
  ],
  inventory: [
    { id: 1, product_id: 1, credentials: 'capcutuser@gmail.com | Pass1234', is_sold: false }
  ],
  orders: [],
  duitnowQrUrl: 'https://placehold.co/400x400/png?text=Letak+Link+QR+DuitNow+Awak'
};

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==========================================
// 1. TELEGRAM BOT (BAHASA MELAYU SENDIRI)
// ==========================================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (storeData.products.length === 0) {
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
                
