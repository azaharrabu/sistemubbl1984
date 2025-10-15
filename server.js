const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');

// 1. KONFIGURASI
const app = express();
const port = 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabase;
try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
    console.error("FATAL: Gagal memulakan Supabase client. Sila semak URL dan Kunci.", e);
    process.exit(1);
}

// 2. MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Untuk memproses callback dari ToyyibPay

// 3. API ENDPOINTS
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, subscription_plan } = req.body;

        // 1. Dapatkan jumlah pengguna sedia ada
        const { count, error: countError } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            throw new Error('Ralat semasa mengira jumlah pengguna: ' + countError.message);
        }

        // 2. Tentukan harga berdasarkan pelan dan promosi
        let amount = 0;
        const isPromoUser = count < 100;

        const prices = {
            '6-bulan': { normal: 60, promo: 50 },
            '12-bulan': { normal: 100, promo: 80 }
        };

        if (prices[subscription_plan]) {
            amount = isPromoUser ? prices[subscription_plan].promo : prices[subscription_plan].normal;
        } else {
            return res.status(400).json({ error: 'Pelan langganan tidak sah.' });
        }

        // 3. Daftar pengguna baru di Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;

        // 4. Cipta profil pengguna (customer) dengan maklumat langganan
        if (authData.user) {
            const subscriptionMonths = subscription_plan === '6-bulan' ? 6 : 12;
            const subscriptionEndDate = new Date();
            subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + subscriptionMonths);

            const { error: profileError } = await supabase.from('customers').insert([{
                user_id: authData.user.id,
                email: authData.user.email,
                subscription_plan: subscription_plan,
                subscription_price: amount,
                // Simpan tarikh tamat dalam format YYYY-MM-DD
                subscription_end_date: subscriptionEndDate.toISOString().split('T')[0], 
                is_promo_user: isPromoUser,
                payment_status: 'pending' // Status awal pembayaran
            }]).select(); // Gunakan .select() untuk mendapatkan data yang dimasukkan

            if (profileError) {
                console.error('Ralat mencipta profil:', profileError.message);
                // Jika gagal cipta profil, lebih baik padam pengguna Auth yang baru didaftar untuk elak data tidak konsisten
                await supabase.auth.admin.deleteUser(authData.user.id);
                return res.status(500).json({ error: 'Gagal mencipta profil pengguna.' });
            }
        }

        // 5. Cipta bil ToyyibPay
        const toyyibpaySecretKey = process.env.TOYYIBPAY_SECRET_KEY;
        const toyyibpayCategoryCode = process.env.TOYYIBPAY_CATEGORY_CODE;

        if (!toyyibpaySecretKey || !toyyibpayCategoryCode) {
            throw new Error('Konfigurasi ToyyibPay tidak lengkap di server.');
        }

        const billDescription = `Langganan ${subscription_plan} (${isPromoUser ? 'Promosi' : 'Harga Biasa'})`;

        const billResponse = await axios.post('https://toyyibpay.com/index.php/api/createBill', {
            'userSecretKey': toyyibpaySecretKey,
            'categoryCode': toyyibpayCategoryCode,
            'billName': 'Langganan Sistem ABR',
            'billDescription': billDescription,
            'billPriceSetting': 1,
            'billPayorInfo': 1,
            'billAmount': amount * 100,
            'billReturnUrl': `${process.env.VERCEL_URL || 'http://localhost:3001'}/payment-success.html`,
            'billCallbackUrl': `${process.env.VERCEL_URL || 'http://localhost:3001'}/api/payment-callback`,
            'billExternalReferenceNo': `ABR-SUB-${authData.user.id}`,
            'billTo': email,
            'billEmail': email,
            'billPhone': ''
        });
        
        // Semak jika ada ralat dalam respons ToyyibPay
        if (!billResponse.data || !billResponse.data[0] || !billResponse.data[0].BillCode) {
            throw new Error('Gagal mendapat BillCode daripada ToyyibPay.');
        }

        const paymentUrl = `https://toyyibpay.com/${billResponse.data[0].BillCode}`;

        // Kemas kini profil pelanggan dengan BillCode untuk rujukan
        await supabase.from('customers').update({ toyyibpay_bill_code: billResponse.data[0].BillCode }).eq('user_id', authData.user.id);

        // Hantar URL pembayaran kembali ke frontend
        res.status(200).json({ user: authData.user, paymentUrl: paymentUrl });

    } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
    }
});

app.post('/api/payment-callback', async (req, res) => {
    // ToyyibPay hantar data dalam format x-www-form-urlencoded
    const { refno, status, reason, billcode, amount } = req.body;

    console.log('Callback diterima dari ToyyibPay:', req.body);

    // Keselamatan: Sahkan sumber panggilan (disyorkan tambah validasi signature)

    if (status === '1') { // Status '1' bermaksud pembayaran berjaya
        try {
            // Cari pelanggan berdasarkan billcode
            const { data: customer, error } = await supabase
                .from('customers')
                .update({ payment_status: 'paid' })
                .eq('toyyibpay_bill_code', billcode)
                .select();

            if (error) {
                console.error('Ralat mengemaskini status pembayaran:', error.message);
                return res.status(500).send('Internal Server Error');
            }

            if (customer && customer.length > 0) {
                console.log(`Status pembayaran untuk pelanggan dengan BillCode ${billcode} telah dikemaskini kepada 'paid'.`);
            } else {
                console.warn(`Tiada pelanggan ditemui dengan BillCode ${billcode}.`);
            }

        } catch (e) {
            console.error('Ralat pada server semasa memproses callback:', e.message);
            return res.status(500).send('Internal Server Error');
        }
    }

    // Balas kepada ToyyibPay untuk mengesahkan penerimaan callback
    res.status(200).send('OK');
});


app.post('/api/signin', async (req, res) => {
    try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
            email: req.body.email, 
            password: req.body.password 
        });
        if (authError) throw authError;

        // Dapatkan profil pelanggan untuk semak status pembayaran
        const { data: customer, error: customerError } = await supabase
            .from('customers')
            .select('*')
            .eq('user_id', authData.user.id)
            .single();

        if (customerError) {
            // Walaupun log masuk berjaya, profil mungkin tiada atau ada isu lain
            console.error('Ralat mendapatkan profil pelanggan selepas log masuk:', customerError.message);
            // Teruskan tanpa data pelanggan, frontend akan uruskan
        }

        res.status(200).json({ user: authData.user, session: authData.session, customer: customer });

    } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
    }
});

app.get('/api/customers', async (req, res) => {
    const { data, error } = await supabase.from('customers').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
});

app.post('/api/customers', async (req, res) => {
    const { data, error } = await supabase.from('customers').insert([req.body]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
});

app.delete('/api/customers/:id', async (req, res) => {
    const { data, error } = await supabase.from('customers').delete().match({ id: req.params.id });
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ message: 'Customer dipadam' });
});

// Endpoint ini mungkin tidak lagi relevan jika bil dicipta semasa signup
app.post('/api/create-bill', async (req, res) => {
    try {
        const { amount, customerName, customerEmail, billDescription } = req.body;

        const toyyibpaySecretKey = process.env.TOYYIBPAY_SECRET_KEY;
        const toyyibpayCategoryCode = process.env.TOYYIBPAY_CATEGORY_CODE;

        if (!toyyibpaySecretKey || !toyyibpayCategoryCode) {
            throw new Error('Konfigurasi ToyyibPay tidak lengkap di server.');
        }

        const response = await axios.post('https://toyyibpay.com/index.php/api/createBill', {
            'userSecretKey': toyyibpaySecretKey,
            'categoryCode': toyyibpayCategoryCode,
            'billName': 'Pembayaran untuk ABR',
            'billDescription': billDescription || 'Terima kasih atas sokongan anda',
            'billPriceSetting': 1,
            'billPayorInfo': 1,
            'billAmount': amount * 100,
            'billReturnUrl': `${process.env.VERCEL_URL || 'http://localhost:3001'}/payment-success.html`,
            'billCallbackUrl': '',
            'billExternalReferenceNo': `ABR-${Date.now()}`,
            'billTo': customerName,
            'billEmail': customerEmail,
            'billPhone': ''
        });

        const paymentUrl = `https://toyyibpay.com/${response.data[0].BillCode}`;
        res.status(200).json({ paymentUrl });

    } catch (error) {
        console.error('Ralat semasa mencipta bil ToyyibPay:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Gagal mencipta bil pembayaran.' });
    }
});

// 4. STATIC FILE SERVING
app.use(express.static(__dirname));

// 5. MULAKAN SERVER
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
