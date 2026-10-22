# RuangUsaha

RuangUsaha adalah aplikasi pencatatan keuangan dan pemeriksaan kesehatan keuangan untuk UMKM. Aplikasi menggunakan React + Vite untuk tampilan, FastAPI untuk API dan perhitungan laporan, serta OWL/SWRL + Pellet untuk analisis berbasis aturan.

## Isi proyek

- `frontend/`: tampilan aplikasi React.
- `backend/`: API FastAPI, perhitungan laporan keuangan, dan layanan reasoning OWL/Pellet.
- `Finance_Health_Expert_System_v2.owl`: basis pengetahuan yang digunakan oleh layanan reasoning.
- `build_v2.py`: pembuat basis pengetahuan OWL.
- `test_rules.py`: tes regresi aturan OWL/SWRL.
- `supabase/schema.sql`: skema Supabase opsional untuk menyimpan workspace pengguna.

## Persiapan pertama kali

Pastikan sudah memasang:

- Python 3.12 atau lebih baru.
- Java JDK 25 atau lebih baru untuk analisis OWL/Pellet.
- Node.js dan npm.

Buka folder utama proyek di VS Code. Perintah di bawah ini dijalankan di terminal PowerShell dari folder utama proyek, kecuali jika disebutkan lain.

### Siapkan backend

Jika folder virtual environment `.venv` belum ada, buat terlebih dahulu:

```powershell
py -m venv .venv
```

Pasang kebutuhan Python:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

### Siapkan frontend

Buka terminal PowerShell baru, lalu jalankan:

```powershell
Set-Location frontend
npm ci
```

Langkah persiapan ini cukup dilakukan sekali, atau diulangi jika dependency berubah.

## Menjalankan aplikasi secara lokal

Aplikasi perlu **dua terminal yang tetap terbuka**: satu untuk backend dan satu untuk frontend.

### Terminal 1 — backend

Dari folder utama proyek, jalankan:

```powershell
$env:JAVA25 = "C:\Program Files\BellSoft\LibericaJDK-25\bin\java.exe"
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

Jika Java 25 terpasang di lokasi lain, ganti nilai `JAVA25` dengan alamat file `java.exe` yang benar. Backend berhasil dimulai jika terminal menampilkan `Application startup complete`.

Untuk memastikan API aktif, buka alamat ini:

<http://127.0.0.1:8000/api/health>

API yang aktif akan menampilkan data JSON, termasuk status dan versi Java.

### Terminal 2 — frontend

Buka terminal PowerShell kedua. Dari folder utama proyek, jalankan:

```powershell
Set-Location frontend
npm run dev
```

Buka alamat lokal yang muncul di terminal, biasanya:

<http://127.0.0.1:5173>

Jangan buka port `8000` untuk melihat tampilan website. Port `8000` adalah API backend; tampilan website dibuka dari port `5173`.

Frontend meneruskan permintaan `/api` ke backend di `http://127.0.0.1:8000` melalui proxy Vite.

## Pencatatan transaksi

Halaman **Transaksi** menyediakan pilihan jenis catatan. Pada pilihan **Pendapatan & penjualan**, uang masuk dan pengeluaran ditampilkan berdampingan, dengan daftar terpisah serta tombol ubah dan hapus di masing-masing daftar. Formulir tidak meminta nama transaksi: kategori dan metode menjadi detailnya, sedangkan catatan tampil di bawah transaksi dan membungkus bila panjang. Pembelian aset tetap meminta nama aset. Pilihan lain menampilkan formulir dan daftar catatan untuk setoran modal, pinjaman masuk, prive, perpindahan saldo, pembayaran pokok pinjaman, atau pembelian aset. Nilai rupiah ditampilkan utuh, tidak disingkat atau dibulatkan. Metode akun ditampilkan sebagai **Cash** atau **Rekening**.

Perpindahan saldo mencatat akun asal dan tujuan, misalnya Cash ke Rekening. Transfer mengurangi saldo akun asal dan menambah saldo akun tujuan, tetapi tidak mengubah total uang, pendapatan, laba, maupun arus kas bersih.

## Jika website atau laporan tidak bisa dimuat

### Port 8000 sudah dipakai

Kalau backend gagal dimulai dengan pesan bahwa port `8000` sedang digunakan, mungkin masih ada server lama yang berjalan. Periksa proses yang memakai port tersebut:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Jika PID yang muncul memang proses server proyek yang lama, hentikan proses tersebut. Ganti `12345` dengan nomor PID dari hasil perintah:

```powershell
Stop-Process -Id 12345
```

Setelah itu, jalankan kembali perintah backend di atas. Jangan hentikan proses jika belum memastikan proses tersebut adalah server proyek ini.

### Muncul pesan `Unexpected token '<'` atau laporan gagal dimuat

Pesan itu biasanya berarti frontend menerima halaman HTML, padahal mengharapkan JSON dari API. Pastikan:

1. Terminal backend masih berjalan dan menampilkan `Application startup complete`.
2. `http://127.0.0.1:8000/api/health` menampilkan JSON.
3. Terminal frontend masih berjalan dan alamat browser adalah `http://127.0.0.1:5173` (atau alamat lokal yang tercetak di terminal).
4. Tidak ada server lama yang masih mengambil alih port `8000`.

Sesudah memperbaiki server, muat ulang halaman frontend. Jika Vite memilih port lain karena `5173` sedang digunakan, gunakan alamat yang ditampilkan di terminal frontend.

## Login, daftar akun, dan mode demo

Tanpa konfigurasi Supabase, aplikasi langsung membuka data contoh lokal. Setelah Supabase dikonfigurasi, halaman awal menyediakan **Masuk**, **Buat akun**, dan **Coba akun demo**. Akun demo tetap memakai data lokal di browser dan terpisah dari data akun Supabase. Akun baru mendapat workspace kosong sendiri; data contoh tidak disalin ke workspace baru.

Untuk mengaktifkan autentikasi dan penyimpanan per akun:

1. Salin `frontend/.env.example` menjadi `frontend/.env.local`.
2. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dari project Supabase.
3. Jalankan isi `supabase/schema.sql` melalui SQL Editor Supabase.
4. Pastikan **Email** aktif di Authentication → Sign In / Providers pada Supabase.
5. Atur konfirmasi email di Supabase sesuai kebutuhan pengujian. Jika aktif, pengguna harus mengonfirmasi email sebelum masuk.
6. Mulai ulang server frontend setelah mengubah file environment.

Jangan pernah menaruh Supabase service-role key di frontend.

## Deployment

Konfigurasi Render tersedia di `render.yaml` dan mengunduh Java 25 saat proses build. Untuk deployment terpisah, frontend Vercel perlu memakai `VITE_API_URL` yang berisi alamat publik backend, sedangkan backend perlu mengizinkan origin frontend melalui `FRONTEND_ORIGINS`.

Deployment cloud belum dijalankan atau diverifikasi dari komputer ini. Siapkan akun dan alamat layanan yang diperlukan sebelum mengisi environment variable deployment.

## Catatan API

- `POST /api/reports`: menghitung laporan laba rugi, arus kas, neraca, perbandingan periode sebelumnya, dan tren.
- `POST /api/analyze`: menjalankan analisis OWL/SWRL menggunakan Pellet dan Java 25+.

Aplikasi ini masih berupa MVP. Data workspace dikirim ke API untuk perhitungan dan belum merupakan sistem akuntansi produksi.


$env:JAVA25 = "C:\Program Files\BellSoft\LibericaJDK-25\bin\java.exe"
>> .\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000