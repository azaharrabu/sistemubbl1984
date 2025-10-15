const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;
const saltRounds = 10;

// --- Sambungan ke Database ---
const db = new sqlite3.Database('./abr_database.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) { return console.error('Ralat menyambung ke database:', err.message); }
    console.log('Berjaya disambungkan ke database SQLite.');
});

// --- Konfigurasi Middleware ---
app.use(express.static(__dirname)); // Menghidang fail statik (imej, css, dll)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'kunci-rahsia-anda-yang-sangat-sulit',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- Middleware Khas ---
function checkAuth(req, res, next) {
    if (req.session.loggedin) {
        next();
    } else {
        res.redirect('/login');
    }
}

function checkSubscription(req, res, next) {
    const sql = 'SELECT subscription_end_date FROM users WHERE id = ?';
    db.get(sql, [req.session.userId], (err, user) => {
        if (err) { return res.status(500).send('Ralat server.'); }
        if (user && user.subscription_end_date && new Date(user.subscription_end_date) > new Date()) {
            next(); // Langganan aktif
        } else {
            res.redirect('/subscribe'); // Tiada langganan aktif
        }
    });
}

// --- Paparan HTML ---
const loginPage = `<h1>Log Masuk</h1><form action="/login" method="post"><input type="email" name="email" placeholder="Emel" required><br><br><input type="password" name="password" placeholder="Kata Laluan" required><br><br><button type="submit">Log Masuk</button></form><p>Belum ada akaun? <a href="/register">Daftar di sini</a></p>`;
const registerPage = `<h1>Daftar Akaun Baru</h1><form action="/register" method="post"><input type="email" name="email" placeholder="Emel" required><br><br><input type="password" name="password" placeholder="Kata Laluan" required><br><br><button type="submit">Daftar</button></form><p>Sudah ada akaun? <a href="/login">Log masuk di sini</a></p>`;
// Paparan langganan kini dijana secara dinamik dalam laluan /subscribe

// --- Laluan (Routes) ---
app.get('/', (req, res) => {
    if (req.session.loggedin) {
        const sql = 'SELECT subscription_end_date FROM users WHERE id = ?';
        db.get(sql, [req.session.userId], (err, user) => {
            let subStatus = 'Tiada Langganan Aktif';
            if (user && user.subscription_end_date && new Date(user.subscription_end_date) > new Date()) {
                subStatus = `Aktif sehingga ${new Date(user.subscription_end_date).toLocaleDateString()}`;
            }
            const nav = `<p>Selamat datang, ${req.session.email}! (Status: ${subStatus})</p><p><a href="/rujukan">Lihat Kandungan</a> | <a href="/subscribe">Perbaharui Langganan</a> | <a href="/logout">Log Keluar</a></p>`;
            res.send(`<h1>Selamat Datang ke Sistem Rujukan ABR</h1>${nav}`);
        });
    } else {
        const nav = '<p><a href="/login">Log Masuk</a> | <a href="/register">Daftar</a></p>';
        res.send(`<h1>Selamat Datang ke Sistem Rujukan ABR</h1>${nav}`);
    }
});

app.get('/register', (req, res) => res.send(registerPage));
app.post('/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).send('Sila isi emel dan kata laluan.'); }
    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) { return res.status(500).send('Ralat sistem.'); }
        db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hash], function(err) {
            if (err) { return res.status(400).send('Emel ini telah digunakan.'); }
            res.redirect('/login');
        });
    });
});

app.get('/login', (req, res) => res.send(loginPage));
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).send('Sila isi emel dan kata laluan.'); }
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err || !user) { return res.status(400).send('Emel atau kata laluan salah.'); }
        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.loggedin = true;
                req.session.email = user.email;
                req.session.userId = user.id;
                res.redirect('/');
            } else {
                res.send('Emel atau kata laluan salah.');
            }
        });
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- Laluan Langganan ---
app.get('/subscribe', checkAuth, (req, res) => {
    // Semak jika pengguna sudah ada permohonan yang sedang diproses
    db.get('SELECT * FROM subscription_requests WHERE user_id = ? AND status = \'pending\'', [req.session.userId], (err, pendingRequest) => {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ralat server.');
        }

        if (pendingRequest) {
            // Jika ada, papar mesej status
            res.send('<h1>Permohonan Langganan Diterima</h1><p>Permohonan langganan anda telah diterima dan sedang diproses. Sila tunggu pengesahan dalam masa 3 hari bekerja. Terima kasih.</p>');
        } else {
            // Jika tiada, papar borang permohonan
            const bankDetails = `
                <h3>Maklumat Pembayaran</h3>
                <p>Sila buat pembayaran ke akaun bank di bawah:</p>
                <ul>
                    <li><strong>Nama Bank:</strong> CIMB Bank</li>
                    <li><strong>Nama Akaun:</strong> ABR Brillante PLT</li>
                    <li><strong>Nombor Akaun:</strong> 8009740600</li>
                </ul>
                <p>Selepas membuat pembayaran, sila isi borang di bawah dan hantar.</p>
            `;

            const submissionForm = `
                <h3>Borang Pengesahan Bayaran</h3>
                <form action="/submit-payment" method="post">
                    <label for="plan">Pilih Pelan:</label><br>
                    <select name="plan" id="plan" required>
                        <option value="6">6 Bulan</option>
                        <option value="12">12 Bulan</option>
                    </select><br><br>
                    
                    <label for="transaction_ref">Nombor Rujukan Transaksi:</label><br>
                    <input type="text" id="transaction_ref" name="transaction_ref" required><br><br>
                    
                    <label for="payment_date">Tarikh Bayaran:</label><br>
                    <input type="date" id="payment_date" name="payment_date" required><br><br>
                    
                    <button type="submit">Hantar Bukti Bayaran</button>
                </form>
                <p><small><b>Nota:</b> Langganan anda akan diproses dalam masa 3 hari bekerja selepas pengesahan bayaran diterima.</small></p>
            `;

            res.send(`<h1>Permohonan Langganan</h1>${bankDetails}${submissionForm}`);
        }
    });
});

app.post('/submit-payment', checkAuth, (req, res) => {
    const { plan, transaction_ref, payment_date } = req.body;
    const userId = req.session.userId;

    if (!plan || !transaction_ref || !payment_date) {
        return res.status(400).send('Sila lengkapkan semua medan.');
    }

    const sql = 'INSERT INTO subscription_requests (user_id, plan_months, transaction_reference, payment_date) VALUES (?, ?, ?, ?)';
    db.run(sql, [userId, plan, transaction_ref, payment_date], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).send('Ralat semasa menghantar permohonan.');
        }
        // Arahkan semula ke /subscribe untuk lihat mesej status
        res.redirect('/subscribe');
    });
});

// --- Laluan Kandungan Dilindungi ---
app.get('/rujukan', checkAuth, checkSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, 'rujukan_interaktif.html'));
});

// --- Mula Server ---
app.listen(port, () => {
  console.log(`Server sedia untuk digunakan di http://localhost:${port}`);
});
