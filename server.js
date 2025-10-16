const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');

// 1. KONFIGURASI
const app = express();
const port = 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY; // Kunci awam sedia ada
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // Kunci servis (rahsia)

let supabase;
let supabaseAdmin;

try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
        throw new Error("Pembolehubah persekitaran Supabase (URL, KEY, dan SERVICE_KEY) tidak ditetapkan sepenuhnya.");
    }

    // Klien Supabase biasa (menggunakan kunci anon, tertakluk kepada RLS)
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Klien Supabase Admin (menggunakan kunci servis, bypass RLS)
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

} catch (e) {
    console.error("FATAL: Gagal memulakan Supabase client.", e.message);
    process.exit(1);
}

// -- DIAGNOSTIC LOG --
console.log("Supabase clients initialized successfully.");
if (process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_SERVICE_KEY.length > 10) {
    console.log("DIAGNOSTIC: SUPABASE_SERVICE_KEY is loaded. Starts with: " + process.env.SUPABASE_SERVICE_KEY.substring(0, 5));
} else {
    console.error("DIAGNOSTIC WARNING: SUPABASE_SERVICE_KEY is NOT loaded or is too short!");
}
// -- END DIAGNOSTIC LOG --


// 2. MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Untuk memproses callback dari ToyyibPay

// 3. API ENDPOINTS
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, subscription_plan } = req.body;

        // 1. Dapatkan jumlah pengguna sedia ada (guna klien admin)
        const { count, error: countError } = await supabaseAdmin
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

        // 3. Daftar pengguna baru di Supabase Auth (guna klien biasa)
        const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) throw authError;

        // 4. Cipta profil pengguna (customer) dengan maklumat langganan (guna klien admin)
        if (authData.user) {
            const subscriptionMonths = subscription_plan === '6-bulan' ? 6 : 12;
            const subscriptionEndDate = new Date();
            subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + subscriptionMonths);

            const { error: profileError } = await supabaseAdmin.from('customers').insert([{
                user_id: authData.user.id,
                email: authData.user.email,
                subscription_plan: subscription_plan,
                subscription_price: amount,
                subscription_end_date: subscriptionEndDate.toISOString().split('T')[0], 
                is_promo_user: isPromoUser,
                payment_status: 'pending'
            }]).select();

            if (profileError) {
                console.error('DIAGNOSTIC: Ralat Supabase semasa mencipta profil:', profileError); // Log the full error
                try {
                    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
                } catch (deleteError) {
                    console.error('DIAGNOSTIC: Ralat semasa memadam pengguna Auth selepas profil gagal:', deleteError);
                }
                // Hantar ralat yang lebih terperinci ke frontend untuk debug
                return res.status(500).json({ 
                    error: 'Gagal mencipta profil pengguna.',
                    details: profileError.message,
                    code: profileError.code // Include the error code
                });
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
        
        if (!billResponse.data || !billResponse.data[0] || !billResponse.data[0].BillCode) {
            throw new Error('Gagal mendapat BillCode daripada ToyyibPay.');
        }

        const paymentUrl = `https://toyyibpay.com/${billResponse.data[0].BillCode}`;

        // Kemas kini profil pelanggan dengan BillCode (guna klien admin)
        await supabaseAdmin.from('customers').update({ toyyibpay_bill_code: billResponse.data[0].BillCode }).eq('user_id', authData.user.id);

        // Hantar URL pembayaran kembali ke frontend
        res.status(200).json({ user: authData.user, paymentUrl: paymentUrl });

    } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
    }
});

app.post('/api/payment-callback', async (req, res) => {
    const { refno, status, reason, billcode, amount } = req.body;
    console.log('Callback diterima dari ToyyibPay:', req.body);

    if (status === '1') { // Pembayaran berjaya
        try {
            // Guna klien admin untuk kemaskini status
            const { data: customer, error } = await supabaseAdmin
                .from('customers')
                .update({ payment_status: 'paid' })
                .eq('toyyibpay_bill_code', billcode)
                .select();

            if (error) {
                console.error('Ralat mengemaskini status pembayaran:', error.message);
                return res.status(500).send('Internal Server Error');
            }
            if (customer && customer.length > 0) {
                console.log(`Status pembayaran untuk BillCode ${billcode} dikemaskini.`);
            } else {
                console.warn(`Tiada pelanggan ditemui dengan BillCode ${billcode}.`);
            }
        } catch (e) {
            console.error('Ralat server semasa memproses callback:', e.message);
            return res.status(500).send('Internal Server Error');
        }
    }
    res.status(200).send('OK');
});

app.post('/api/signin', async (req, res) => {
    try {
        // Guna klien biasa untuk log masuk
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
            email: req.body.email, 
            password: req.body.password 
        });
        if (authError) throw authError;

        // Guna klien biasa untuk dapatkan profil (tertakluk pada RLS)
        const { data: customer, error: customerError } = await supabase
            .from('customers')
            .select('*')
            .eq('user_id', authData.user.id)
            .single();

        if (customerError) {
            console.error('Ralat mendapatkan profil pelanggan:', customerError.message);
        }

        res.status(200).json({ user: authData.user, session: authData.session, customer: customer });

    } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
    }
});

// Endpoint di bawah ini adalah untuk tujuan pentadbiran/debug dan harus dilindungi
// atau dibuang dalam persekitaran produksi jika tidak digunakan.

app.get('/api/customers', async (req, res) => {
    // Guna klien admin untuk senaraikan semua pelanggan
    const { data, error } = await supabaseAdmin.from('customers').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
});

app.post('/api/customers', async (req, res) => {
    // Guna klien admin untuk cipta pelanggan secara manual
    const { data, error } = await supabaseAdmin.from('customers').insert([req.body]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
});

app.delete('/api/customers/:id', async (req, res) => {
    // Guna klien admin untuk padam pelanggan
    const { data, error } = await supabaseAdmin.from('customers').delete().match({ id: req.params.id });
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
