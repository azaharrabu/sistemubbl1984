const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const path = require('path');

// 1. KONFIGURASI
const app = express();
const port = 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase;
let supabaseAdmin;

try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
        throw new Error("Pembolehubah persekitaran Supabase tidak ditetapkan sepenuhnya.");
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
} catch (e) {
    console.error("FATAL: Gagal memulakan Supabase client.", e.message);
    process.exit(1);
}

// 2. MIDDLEWARE
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware untuk pengesahan (Authentication)
const requireAuth = async (req, res, next) => {
    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith('Bearer ')) {
        // Jika tiada token, cuba redirect ke login untuk akses browser
        return res.redirect('/index.html');
    }

    const token = authorization.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        // Jika token tidak sah, hantar ralat (untuk API calls) atau redirect
        return res.status(401).json({ error: 'Akses tidak sah. Sila log masuk semula.' });
    }

    req.user = user;
    next();
};

// Middleware untuk kebenaran (Authorization) - Admin sahaja
const requireAdmin = async (req, res, next) => {
    const { user } = req; // Pengguna dari middleware requireAuth

    const { data: customer, error } = await supabaseAdmin
        .from('customers')
        .select('role')
        .eq('user_id', user.id)
        .single();

    if (error || !customer || customer.role !== 'admin') {
        return res.status(403).json({ error: 'Akses terhad kepada admin sahaja.' });
    }

    next();
};


// 3. STATIC FILE SERVING (Fail Awam)
// Secara eksplisit menghantar fail-fail yang diperlukan sahaja untuk keselamatan.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/app.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.js'));
});
app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style.css'));
});


// 4. API ENDPOINTS

// Endpoint Pendaftaran (Awam)
app.post('/api/signup', async (req, res) => {
    // ... (logik pendaftaran sedia ada kekal sama)
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
                payment_status: 'pending',
                role: 'user' // Tetapkan peranan default sebagai 'user'
            }]).select();

            if (profileError) {
                console.error('DIAGNOSTIC: Ralat Supabase semasa mencipta profil:', profileError);
                try {
                    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
                } catch (deleteError) {
                    console.error('DIAGNOSTIC: Ralat semasa memadam pengguna Auth selepas profil gagal:', deleteError);
                }
                return res.status(500).json({ 
                    error: 'Gagal mencipta profil pengguna.',
                    details: profileError.message,
                    code: profileError.code
                });
            }
        }

        // 5. Cipta bil ToyyibPay
        const toyyibpaySecretKey = process.env.TOYYIBPAY_SECRET_KEY;
        const toyyibpayCategoryCode = process.env.TOYYIBPAY_CATEGORY_CODE;

        console.log(`DIAGNOSTIC: Checking keys. Key found: |${toyyibpaySecretKey}|. Code found: |${toyyibpayCategoryCode}|`);

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
        
        console.log('DIAGNOSTIC: Respons dari ToyyibPay:', JSON.stringify(billResponse.data));

        if (!billResponse.data || !billResponse.data[0] || !billResponse.data[0].BillCode) {
            throw new Error('Gagal mendapat BillCode daripada ToyyibPay.');
        }

        const paymentUrl = `https://toyyibpay.com/${billResponse.data[0].BillCode}`;
        await supabaseAdmin.from('customers').update({ toyyibpay_bill_code: billResponse.data[0].BillCode }).eq('user_id', authData.user.id);
        res.status(200).json({ user: authData.user, paymentUrl: paymentUrl });

    } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
    }
});

// Endpoint Log Masuk (Awam)
app.post('/api/signin', async (req, res) => {
    try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
            email: req.body.email, 
            password: req.body.password 
        });
        if (authError) throw authError;

        // Dapatkan profil termasuk 'role'
        const { data: customer, error: customerError } = await supabase
            .from('customers')
            .select('*, role') // Pastikan 'role' dipilih
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

// Callback Pembayaran (Awam)
app.post('/api/payment-callback', async (req, res) => {
    // ... (logik callback sedia ada kekal sama)
    const { refno, status, reason, billcode, amount } = req.body;
    console.log('Callback diterima dari ToyyibPay:', req.body);

    if (status === '1') { // Pembayaran berjaya
        try {
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


// 5. LALUAN DILINDUNGI (Protected Routes)

// Laluan untuk kandungan interaktif (perlu log masuk)
app.get('/rujukan_interaktif.html', requireAuth, async (req, res) => {
    // Pastikan pengguna mempunyai langganan yang aktif dan telah dibayar
    const { data: customer, error } = await supabaseAdmin
        .from('customers')
        .select('payment_status, subscription_end_date')
        .eq('user_id', req.user.id)
        .single();

    if (error || !customer || customer.payment_status !== 'paid' || new Date(customer.subscription_end_date) < new Date()) {
        return res.status(403).send('Akses ditolak. Sila pastikan langganan anda aktif.');
    }
    
    res.sendFile(path.join(__dirname, 'rujukan_interaktif.html'));
});


// Endpoint untuk dapatkan profil pengguna semasa
app.get('/api/profile', requireAuth, async (req, res) => {
    const { data: customer, error } = await supabaseAdmin
        .from('customers')
        .select('*, role')
        .eq('user_id', req.user.id)
        .single();

    if (error || !customer) {
        return res.status(404).json({ error: 'Profil pelanggan tidak ditemui.' });
    }

    res.status(200).json(customer);
});

// 6. API ADMIN (Perlu log masuk sebagai admin)

app.get('/api/customers', requireAuth, requireAdmin, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('customers').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
});

app.post('/api/customers', requireAuth, requireAdmin, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('customers').insert([req.body]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data[0]);
});

app.delete('/api/customers/:id', requireAuth, requireAdmin, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('customers').delete().match({ id: req.params.id });
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ message: 'Customer dipadam' });
});


// 7. MULAKAN SERVER
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});