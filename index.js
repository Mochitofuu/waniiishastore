const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const TOYYIB_SECRET = process.env.TOYYIB_SECRET || '';
const TOYYIB_CAT = process.env.TOYYIB_CAT || '';
const SERVER_URL = process.env.SERVER_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// Sambungan ke Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 1. FUNGSI TELEGRAM BOT
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

async function sendProductList(chatId) {
  // Tarik data terus dari Supabase
  const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
  const { data: inventory } = await supabase.from('inventory').select('*').eq('is_sold', false);
  const { data: settings } = await supabase.from('store_settings').select('banner_url').eq('id', 1).single();

  const bannerUrl = settings?.banner_url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop&q=80';
  const prods = products || [];
  const inv = inventory || [];

  let listText = 'LIST PRODUCT\n\n';

  prods.forEach((p, index) => {
    const stockCount = inv.filter(i => i.product_id === p.id).length;
    listText += `[${index + 1}]. ${p.name.toUpperCase()} ( ${stockCount} )\n`;
  });

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  listText += `\n📄 Halaman 1 / 1\n📅 ${now}`;

  const keyboard = buildStoreKeyboard(prods);

  try {
    await bot.sendPhoto(chatId, bannerUrl, {
      caption: listText,
      reply_markup: { keyboard: keyboard, resize_keyboard: true }
    });
  } catch (err) {
    bot.sendMessage(chatId, listText, {
      reply_markup: { keyboard: keyboard, resize_keyboard: true }
    });
  }
}

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
    const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
    const { data: inventory } = await supabase.from('inventory').select('*').eq('is_sold', false);

    let report = '📁 *LAPORAN STOK SEMASA:*\n\n';
    (products || []).forEach((p, index) => {
      const stockCount = (inventory || []).filter(i => i.product_id === p.id).length;
      report += `${index + 1}. ${p.name}: *${stockCount} unit*\n`;
    });
    return bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  // Pilih produk guna nombor
  const selectedIndex = parseInt(text) - 1;
  if (!isNaN(selectedIndex)) {
    const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
    
    if (products && products[selectedIndex]) {
      const product = products[selectedIndex];
      const { data: availableStock } = await supabase
        .from('inventory')
        .select('*')
        .eq('product_id', product.id)
        .eq('is_sold', false);

      if (!availableStock || availableStock.length === 0) {
        return bot.sendMessage(chatId, `❌ Maaf, stok untuk *${product.name}* telah habis (0).`, { parse_mode: 'Markdown' });
      }

      const orderId = `ORD-${Date.now()}`;
      const amountCents = Math.round(product.price * 100);

      if (TOYYIB_SECRET && TOYYIB_CAT) {
        try {
          const cleanServerUrl = SERVER_URL.replace(/\/$/, '');
          const response = await axios.post('https://toyyibpay.com/index.php/api/createBill', new URLSearchParams({
            userSecretKey: TOYYIB_SECRET,
            categoryCode: TOYYIB_CAT,
            billName: product.name,
            billDescription: `Pesanan ${orderId}`,
            billPriceSetting: 1,
            billPayorInfo: 0,
            billAmount: amountCents,
            billReturnUrl: `${cleanServerUrl}/payment-return`,
            billCallbackUrl: `${cleanServerUrl}/payment-callback`,
            billExternalReferenceNo: orderId,
            billTo: `Pelanggan-${chatId}`,
            billEmail: 'customer@tgstore.com',
            billPhone: '0123456789'
          }));

          const billCode = response.data[0]?.BillCode;
          if (billCode) {
            const paymentUrl = `https://toyyibpay.com/${billCode}`;

            // Simpan pesanan ke pangkalan data Supabase secara kekal
            await supabase.from('orders').insert([{
              order_id: orderId,
              product_id: product.id,
              product_name: product.name,
              chat_id: String(chatId),
              amount: product.price,
              status: 'pending'
            }]);

            const billMessage = 
              `🛒 *Pesanan #${selectedIndex + 1}: ${product.name}*\n` +
              `💰 *Jumlah:* RM${Number(product.price).toFixed(2)}\n\n` +
              `Tekan butang di bawah untuk membuat pembayaran FPX / DuitNow QR:\n\n` +
              `⚡ *Maklumat akaun akan dihantar serta-merta selepas bayaran disahkan.*`;

            return bot.sendMessage(chatId, billMessage, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '💳 Bayar Sekarang (FPX / DuitNow)', url: paymentUrl }]
                ]
              }
            });
          }
        } catch (e) {
          console.error('ToyyibPay Error:', e.message);
        }
      }

      return bot.sendMessage(chatId, `🛒 *Pesanan: ${product.name}*\n⚠️ Gateway pembayaran sedang diselenggara.`, { parse_mode: 'Markdown' });
    }
  }
});

// Fungsi Serahan Akaun
async function deliverProduct(orderId) {
  const { data: order } = await supabase.from('orders').select('*').eq('order_id', orderId).eq('status', 'pending').single();
  if (!order) return false;

  const { data: item } = await supabase.from('inventory').select('*').eq('product_id', order.product_id).eq('is_sold', false).limit(1).single();
  const { data: product } = await supabase.from('products').select('*').eq('id', order.product_id).single();

  if (item) {
    // Kemas kini status stok dan pesanan di Supabase
    await supabase.from('inventory').update({ is_sold: true, sold_to: order.chat_id }).eq('id', item.id);
    await supabase.from('orders').update({ status: 'paid', completed_at: new Date().toISOString() }).eq('order_id', orderId);

    const tncText = product?.tnc ? `\n\n📌 *Terma & Syarat (T&C):*\n${product.tnc}` : '';
    const deliveryMessage = 
      `🎉 *Pembayaran Berjaya Disahkan!*\n\n` +
      `Produk: *${order.product_name}*\n\n` +
      `🔐 *Maklumat Akaun Anda:*\n` +
      `\`\`\`\n${item.credentials}\n\`\`\`` +
      `${tncText}\n\n` +
      `_Terima kasih atas sokongan anda! Sila simpan butiran ini._`;

    bot.sendMessage(order.chat_id, deliveryMessage, { parse_mode: 'Markdown' });
    return true;
  }
  return false;
}

// Webhook Pengesahan ToyyibPay
app.all('/payment-callback', async (req, res) => {
  const data = { ...req.query, ...req.body };
  const status = data.status_id || data.status;
  const orderId = data.order_id || data.refno;

  if (status === '1' && orderId) {
    await deliverProduct(orderId);
  }
  res.send('OK');
});

// Halaman Kembali
app.get('/payment-return', async (req, res) => {
  const { status_id, order_id } = req.query;
  if (status_id === '1' && order_id) {
    await deliverProduct(order_id);
  }
  res.send(`
    <html>
      <body style="font-family:sans-serif; text-align:center; padding:50px; background:#0b0f19; color:#fff;">
        <h1 style="color:#10b981;">Bayaran Berjaya!</h1>
        <p>Sila buka aplikasi Telegram anda. Butiran akaun digital telah dihantar oleh Bot.</p>
      </body>
    </html>
  `);
});

// 2. DASHBOARD WEB (BACA TERUS DARI SUPABASE)
app.get('/', async (req, res) => {
  const { data: products } = await supabase.from('products').select('*').order('id', { ascending: true });
  const { data: inventory } = await supabase.from('inventory').select('*');
  const { data: orders } = await supabase.from('orders').select('*').order('date_created', { ascending: false });
  const { data: settings } = await supabase.from('store_settings').select('banner_url').eq('id', 1).single();

  const prods = products || [];
  const inv = inventory || [];
  const ords = orders || [];
  const bannerUrl = settings?.banner_url || '';

  const totalProducts = prods.length;
  const readyStock = inv.filter(i => !i.is_sold).length;
  const successfulOrders = ords.filter(o => o.status === 'paid');
  const totalSales = successfulOrders.reduce((sum, o) => sum + Number(o.amount), 0);

  res.send(`
  <!DOCTYPE html>
  <html lang="ms">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Store Admin - Supabase Database</title>
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
        <p class="text-xs text-emerald-400 font-semibold">● Pangkalan Data Supabase (Kekal)</p>
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
        <p class="text-xs text-slate-400">Total Jualan Terkumpul</p>
        <p class="text-2xl font-black text-amber-400 mt-1">RM ${totalSales.toFixed(2)}</p>
      </div>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">🖼️ Kemas Kini Pautan Banner</h2>
      <form action="/admin/update-banner" method="POST" class="space-y-2">
        <input type="url" name="bannerUrl" value="${bannerUrl}" required class="w-full text-xs p-3 rounded-xl dark-input">
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
          ${prods.map((p, idx) => `<option value="${p.id}">[${idx + 1}] ${p.name}</option>`).join('')}
        </select>
        <textarea name="credentials" placeholder="email@gmail.com | pass123 (Satu baris setiap akaun)" required rows="3" class="w-full text-xs p-3 rounded-xl dark-input"></textarea>
        <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-3 rounded-xl font-bold">Tambah ke Inventori</button>
      </form>
    </div>

    <div class="dark-card p-4 rounded-2xl mb-4">
      <h2 class="font-bold text-sm mb-3">🛠️ Senarai & Edit Produk</h2>
      <div class="space-y-3">
        ${prods.map((p, idx) => {
          const sCount = inv.filter(i => i.product_id === p.id && !i.is_sold).length;
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
          ${successfulOrders.map(o => `
            <div class="py-2.5 flex justify-between items-center">
              <div>
                <p class="font-bold text-white">${o.product_name}</p>
                <p class="text-[10px] text-slate-400">${new Date(o.completed_at || o.date_created).toLocaleString('ms-MY')}</p>
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

app.post('/admin/update-banner', async (req, res) => {
  await supabase.from('store_settings').upsert({ id: 1, banner_url: req.body.bannerUrl });
  res.redirect('/');
});

app.post('/admin/add-product', async (req, res) => {
  const { name, price, tnc } = req.body;
  await supabase.from('products').insert([{ name, price: parseFloat(price), tnc: tnc || '' }]);
  res.redirect('/');
});

app.post('/admin/update-product', async (req, res) => {
  const { id, name, price, tnc } = req.body;
  await supabase.from('products').update({ name, price: parseFloat(price), tnc }).eq('id', id);
  res.redirect('/');
});

app.get('/admin/delete-product/:id', async (req, res) => {
  await supabase.from('products').delete().eq('id', req.params.id);
  res.redirect('/');
});

app.post('/admin/add-stock', async (req, res) => {
  const { product_id, credentials } = req.body;
  const lines = credentials.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const rows = lines.map(line => ({
    product_id: parseInt(product_id),
    credentials: line,
    is_sold: false
  }));
  
  if (rows.length > 0) {
    await supabase.from('inventory').insert(rows);
  }
  res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server aktif pada port ${PORT}`);
});
  
