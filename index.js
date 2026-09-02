const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Konfigurasi Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TOYYIB_SECRET = process.env.TOYYIB_SECRET;
const TOYYIB_CAT = process.env.TOYYIB_CAT;
const SERVER_URL = process.env.SERVER_URL; // domain render nanti

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. Perintah /start - Senaraikan Produk
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const { data: products, error } = await supabase
    .from('products')
    .select('*');

  if (error || !products || products.length === 0) {
    return bot.sendMessage(chatId, 'Tiada produk yang tersenarai pada masa ini.');
  }

  const buttons = products.map((p) => [
    { text: `${p.name} - RM${p.price}`, callback_data: `buy_${p.id}` }
  ]);

  bot.sendMessage(chatId, '👋 Selamat datang! Sila pilih produk yang ingin dibeli:', {
    reply_markup: { inline_keyboard: buttons }
  });
});

// 2. Apabila Pelanggan Klik Beli
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('buy_')) {
    const productId = data.split('_')[1];

    // Semak baki stok
    const { data: stock } = await supabase
      .from('digital_inventory')
      .select('id')
      .eq('product_id', productId)
      .eq('is_sold', false)
      .limit(1);

    if (!stock || stock.length === 0) {
      return bot.sendMessage(chatId, 'Maaf, stok untuk item ini telah habis.');
    }

    // Ambil info produk
    const { data: product } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    const orderId = `ORD-${Date.now()}`;
    const amountInCents = Math.round(Number(product.price) * 100);

    // Cipta bil di ToyyibPay
    try {
      const response = await axios.post('https://toyyibpay.com/index.php/api/createBill', new URLSearchParams({
        userSecretKey: TOYYIB_SECRET,
        categoryCode: TOYYIB_CAT,
        billName: product.name,
        billDescription: `Order ${orderId}`,
        billPriceSetting: 1,
        billPayorInfo: 0,
        billAmount: amountInCents,
        billReturnUrl: `${SERVER_URL}/payment-return`,
        billCallbackUrl: `${SERVER_URL}/payment-callback`,
        billExternalReferenceNo: orderId,
        billTo: `Customer-${chatId}`,
        billEmail: 'customer@tgstore.com',
        billPhone: '0123456789'
      }));

      const billCode = response.data[0].BillCode;
      const paymentUrl = `https://toyyibpay.com/${billCode}`;

      // Simpan rekod pesanan 'pending'
      await supabase.from('orders').insert({
        order_id: orderId,
        product_id: product.id,
        buyer_telegram_id: String(chatId),
        amount: product.price,
        status: 'pending'
      });

      bot.sendMessage(chatId, `Pesanan anda untuk *${product.name}* (RM${product.price}) sedia untuk dibayar.\n\nSila klik pautan di bawah untuk pembayaran FPX/QR:\n${paymentUrl}`, {
        parse_mode: 'Markdown'
      });
    } catch (err) {
      bot.sendMessage(chatId, 'Terdapat masalah menghasilkan pautan bayaran. Sila cuba sebentar lagi.');
    }
  }
});

// 3. Webhook ToyyibPay - Auto Hantar Akaun Bila Bayaran Berjaya
app.post('/payment-callback', async (req, res) => {
  const { status_id, order_id } = req.body;

  // status_id = 1 bermaksud bayaran berjaya di ToyyibPay
  if (status_id === '1') {
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', order_id)
      .single();

    if (order && order.status === 'pending') {
      // Ambil satu akaun daripada stok
      const { data: item } = await supabase
        .from('digital_inventory')
        .select('*')
        .eq('product_id', order.product_id)
        .eq('is_sold', false)
        .limit(1)
        .single();

      if (item) {
        // Tandakan stok sebagai terjual
        await supabase
          .from('digital_inventory')
          .update({
            is_sold: true,
            sold_at: new Date(),
            buyer_telegram_id: order.buyer_telegram_id
          })
          .eq('id', item.id);

        // Kemas kini status order
        await supabase
          .from('orders')
          .update({ status: 'paid' })
          .eq('order_id', order_id);

        // Hantar credentials ke Telegram pembeli secara automatik
        await bot.sendMessage(
          order.buyer_telegram_id,
          `✅ *Pembayaran Berjaya!*\n\nBerikut adalah maklumat akaun digital anda:\n\n\`\`\`\n${item.credentials}\n\`\`\`\n\nTerima kasih atas pembelian!`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
    
