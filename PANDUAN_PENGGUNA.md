# Panduan Pengguna - Sistem Rujukan ABR

Dokumen ini menerangkan cara untuk mengurus dan menggunakan Sistem Rujukan ABR.

---

## Bahagian 1: Untuk Admin (Anda)

Bahagian ini adalah untuk rujukan anda sebagai pemilik dan pengurus sistem.

### 1.1 Cara Memulakan Server

Sistem ini berjalan secara setempat (local) di komputer anda. Ia tidak akan dapat diakses sehingga anda memulakannya.

1.  Buka aplikasi Terminal (Command Prompt, PowerShell, dll.).
2.  Navigasi ke direktori projek dengan menaip arahan ini dan tekan Enter:
    ```bash
    cd "c:\Users\Hp\Documents\ABR\buku ABR\reference"
    ```
3.  Mulakan server dengan menaip arahan ini dan tekan Enter:
    ```bash
    node index.js
    ```
4.  Anda akan nampak mesej `Server sedia untuk digunakan di http://localhost:3000`.
5.  **PENTING:** Jangan tutup tetingkap terminal ini. Jika ia ditutup, server akan berhenti dan sistem tidak dapat diakses.

### 1.2 Cara Menyemak Permohonan Langganan

Apabila pengguna menghantar bukti pembayaran, maklumat tersebut akan disimpan di dalam database.

1.  Muat turun dan pasang perisian **DB Browser for SQLite** dari [sqlitebrowser.org/dl](https://sqlitebrowser.org/dl/). Pilih "Standard installer for 64-bit Windows".
2.  Buka perisian tersebut.
3.  Klik butang **"Open Database"**.
4.  Cari dan buka fail `abr_database.db` yang terletak di dalam folder projek anda.
5.  Klik pada tab **"Browse Data"**.
6.  Dari senarai `Table`, pilih **`subscription_requests`**.
7.  Anda akan dapat melihat semua permohonan yang dihantar oleh pengguna, termasuk `user_id`, `plan_months`, `transaction_reference`, dan `payment_date`.

### 1.3 Cara Mengaktifkan Langganan Pengguna

Selepas anda mengesahkan bayaran pengguna di dalam akaun bank anda, anda perlu mengaktifkan langganan mereka secara manual.

1.  Di dalam DB Browser for SQLite, klik pada tab **"Execute SQL"**.
2.  Berdasarkan maklumat dari jadual `subscription_requests`, cari `user_id` dan `plan_months` untuk pengguna yang ingin anda aktifkan.
3.  Salin dan tampal templat arahan SQL di bawah ke dalam kotak "Execute SQL".

    **Untuk langganan 6 bulan:**
    ```sql
    UPDATE users
    SET subscription_end_date = date('now', '+6 months')
    WHERE id = GANTIKAN_DENGAN_USER_ID;
    ```

    **Untuk langganan 12 bulan:**
    ```sql
    UPDATE users
    SET subscription_end_date = date('now', '+12 months')
    WHERE id = GANTIKAN_DENGAN_USER_ID;
    ```

4.  Gantikan `GANTIKAN_DENGAN_USER_ID` dengan `user_id` pengguna tersebut. Contohnya: `WHERE id = 3;`.
5.  Tekan butang "Execute SQL" (ikon ►) untuk menjalankan arahan. Langganan pengguna tersebut kini aktif.
6.  (Pilihan) Anda boleh kembali ke tab "Browse Data", pilih jadual `subscription_requests` dan kemas kini `status` permohonan tersebut dari `pending` kepada `approved`.

---

## Bahagian 2: Untuk Pengguna Akhir

Ini adalah aliran kerja yang akan dilalui oleh pengguna anda.

### 2.1 Pendaftaran Akaun Baru
- Pengguna melayari `http://localhost:3000`.
- Pengguna menekan pautan "Daftar" dan mengisi emel serta kata laluan untuk mencipta akaun.

### 2.2 Log Masuk
- Selepas mendaftar, pengguna akan log masuk menggunakan emel dan kata laluan mereka.

### 2.3 Membuat Permohonan Langganan
- Selepas log masuk, pengguna akan dibawa ke halaman langganan.
- Pengguna akan melihat maklumat akaun bank anda dan perlu membuat bayaran secara manual (pindahan bank).
- Selepas membuat bayaran, pengguna mengisi borang di halaman tersebut dengan maklumat pelan, nombor rujukan transaksi, dan tarikh bayaran.
- Pengguna menekan butang "Hantar Bukti Bayaran".

### 2.4 Menunggu Pengesahan
- Sistem akan memaparkan mesej bahawa permohonan mereka sedang diproses.
- Pengguna perlu menunggu anda (admin) untuk mengesahkan bayaran dan mengaktifkan akaun mereka.

### 2.5 Mengakses Kandungan
- Apabila pengguna log masuk semula selepas akaunnya diaktifkan, mereka akan nampak status langganan mereka telah aktif.
- Pengguna kini boleh menekan pautan "Lihat Kandungan" untuk mengakses bahan-bahan di dalamnya.

### 2.6 Log Keluar
- Pengguna boleh menekan pautan "Log Keluar" pada bila-bila masa untuk menamatkan sesi mereka.
