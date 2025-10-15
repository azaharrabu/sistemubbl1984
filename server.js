const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

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

// 3. API ENDPOINTS
app.post('/api/signup', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.signUp({ 
            email: req.body.email, 
            password: req.body.password 
        });
        if (error) throw error;
        res.status(200).json({ user: data.user });
    } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
    }
});

app.post('/api/signin', async (req, res) => {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ 
            email: req.body.email, 
            password: req.body.password 
        });
        if (error) throw error;
        res.status(200).json({ user: data.user, session: data.session });
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

app.post('/api/create-bill', async (req, res) => {
    try {
        const { amount, customerName, customerEmail, billDescription } = req.body;

        // Ambil kunci dari environment variables
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
            'billPriceSetting': 1, // 1 = Harga tetap, 0 = Pengguna boleh pilih harga
            'billPayorInfo': 1, // 1 = Wajibkan maklumat pembayar
            'billAmount': amount * 100, // Amaun dalam sen
            'billReturnUrl': `${process.env.VERCEL_URL || 'http://localhost:3001'}/payment-success.html`,
            'billCallbackUrl': '', // Boleh dibiarkan kosong
            'billExternalReferenceNo': `ABR-${Date.now()}`,
            'billTo': customerName,
            'billEmail': customerEmail,
            'billPhone': '' // Boleh tambah jika perlu
        });

        // Hantar URL pembayaran kembali ke frontend
        const paymentUrl = `https://toyyibpay.com/${response.data[0].BillCode}`;
        res.status(200).json({ paymentUrl });

    } catch (error) {
        console.error('Ralat semasa mencipta bil ToyyibPay:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Gagal mencipta bil pembayaran.' });
    }
});

// 4. STATIC FILE SERVING
app.use(express.static('.'));

// 5. MULAKAN SERVER
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});