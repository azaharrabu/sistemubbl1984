const sqlite3 = require('sqlite3').verbose();

// Sambung ke atau cipta fail database 'abr_database.db'
const db = new sqlite3.Database('./abr_database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        return console.error('Ralat semasa menyambung ke database:', err.message);
    }
    console.log('Berjaya disambungkan ke database SQLite.');
});

// Skrip untuk cipta jadual 'users'
const createTableSql = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    subscription_type TEXT, -- Boleh jadi '6-bulan' atau '12-bulan'
    subscription_end_date DATE
);`;

db.run(createTableSql, function(err) {
    if (err) {
        return console.error('Ralat semasa mencipta jadual:', err.message);
    }
    console.log("Jadual 'users' telah sedia atau telah pun wujud.");
});

// Skrip untuk cipta jadual 'subscription_requests'
const createRequestsTableSql = `
CREATE TABLE IF NOT EXISTS subscription_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_months INTEGER NOT NULL,
    transaction_reference TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    request_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
);`;

db.run(createRequestsTableSql, function(err) {
    if (err) {
        return console.error('Ralat semasa mencipta jadual subscription_requests:', err.message);
    }
    console.log("Jadual 'subscription_requests' telah sedia atau telah pun wujud.");
});


// Tutup sambungan database
db.close((err) => {
    if (err) {
        return console.error('Ralat semasa menutup sambungan database:', err.message);
    }
    console.log('Sambungan ke database telah ditutup.');
});
