# Portal Reorganisasi MPK

Portal ujian SMK Telkom Purwokerto menggunakan login Peserta dan Admin. Panitia dapat membuat akun peserta, menambah soal pilihan ganda atau esai, mengatur durasi, membuka ujian, dan menilai hasil. Jawaban tersimpan di database.

## Jalankan di komputer

Gunakan Node.js 24 atau lebih baru.

```powershell
node local.mjs
```

Buka http://127.0.0.1:4385. Pilih **Admin** dan masuk dengan ID `admin`. Saat dijalankan pertama kali, terminal menampilkan kata sandi acak. Simpan kata sandi itu setelah login. Untuk menentukan kata sandi sebelum login pertama, isi variabel lingkungan `ADMIN_PASSWORD` saat menjalankan server.

Mode normal menyimpan data di `portal.sqlite`. Jalankan `node local.mjs --preview` untuk mencoba portal dengan database sementara yang dihapus saat server berhenti.

## Siapkan ujian

1. Buka **Bank Soal** dan masukkan soal seleksi.
2. Buka **Peserta**, buat akun dengan NIS atau ID, lalu pilih **Kelas X** atau **Kelas XI** dan isi rombel. Tingkat kelas dan rombel bisa diperbarui dengan **Edit Kelas**.
3. Pada **Ringkasan**, tentukan durasi dan pilih **Dibuka**.
4. Bagikan akses situs beserta akun masing-masing peserta. Satu akun dapat mengikuti satu percobaan. Perubahan soal dan durasi berlaku untuk percobaan yang belum dimulai.
5. Buka **Hasil Ujian** untuk melihat pengumpulan, nilai, dan jumlah pelanggaran. Gunakan filter **Tingkat kelas** dan klik jumlah pelanggaran untuk melihat waktu serta jenis kejadiannya.

### Impor soal dari Word atau Excel

Di **Bank Soal**, pilih **Unggah Word / Excel**, lalu unduh template `.docx` atau `.xlsx` terbaru. Ganti soal contoh dengan soal ujian. Format Word menggunakan nomor yang diketik langsung (`1. Pertanyaan`), pilihan `A.` sampai `D.`, serta baris `Jenis: PG`, `Bobot A: 2`, `Bobot B: 6`, `Bobot C: 10`, `Bobot D: 8`, dan `Kelas: X`. Setiap pilihan memiliki poin sendiri, tanpa kunci benar/salah. Bobot pilihan harus bilangan bulat 0–1.000; nilai maksimal soal mengikuti pilihan berbobot tertinggi. Soal tidak dijawab mendapat 0 poin. Untuk esai, gunakan `Jenis: Esai` dan `Bobot: 20` (1–100), lalu kosongkan pilihan serta bobot A–D. Excel menggunakan satu baris per soal pada lembar pertama yang terlihat, dengan kolom **Bobot A–D**, **Bobot Esai**, dan **Kelas**. Header berbahasa Inggris seperti `Question Text`, `Question Type`, `Option 1`–`Option 4`, serta `Option 1 Points`–`Option 4 Points` juga diterima.

Pilih kelas bawaan untuk soal yang tidak mencantumkan kelas. Isi kelas X/XI di berkas jika ingin mencampur kedua kategori. Klik **Baca dan Pratinjau Soal**, periksa pertanyaan dan bobot tiap jawaban, lalu **Simpan**. Jika ada kesalahan, perbaiki berkas dan unggah ulang. Belum ada perubahan bank soal sebelum disimpan. Batas: 5 MB per berkas, 100 soal per impor dan per bank soal, teks tanpa gambar/persamaan, serta nilai Excel tanpa rumus. `.doc` dan `.xls` perlu disimpan ulang menjadi `.docx` dan `.xlsx`. Bobot yang sudah tersimpan pada percobaan ujian tidak berubah saat bank soal diedit; hasil lama tetap menggunakan aturan penilaian saat peserta mulai.

## Layar penuh dan pelanggaran

Saat peserta menekan **Mulai Ujian**, portal meminta layar penuh jika browser mendukung. Ketika tab ujian tersembunyi atau peserta keluar dari layar penuh, portal menampilkan peringatan dan menyimpan kejadian untuk panitia. Dua sinyal dari kejadian yang sama dicatat sekali sebelum peserta memilih untuk melanjutkan. Timer tetap berjalan saat peringatan tampil. Peserta tetap bisa mengerjakan di browser yang tidak mendukung layar penuh, dengan pemantauan visibilitas tab.

Browser dan sistem operasi tetap mengendalikan perpindahan tab dan aplikasi. Riwayat mencatat sinyal yang diterima browser, termasuk halaman tersembunyi karena perpindahan aplikasi. Panitia meninjau catatan tanpa pengurangan nilai otomatis.

Server lokal menerapkan migrasi pada `portal.sqlite` saat dijalankan. Akun lama dengan awalan rombel X/XI atau 10/11 dikelompokkan otomatis. Akun lain dapat diperbarui lewat **Edit Kelas**.

## Hosting di Vercel dengan Supabase

1. Buka **SQL Editor** di proyek Supabase dan jalankan [migrasi PostgreSQL](supabase/migrations/20261117000000_mpk.sql). Tabel portal dibuat di skema privat `mpk`.
2. Impor repositori GitHub di Vercel. Pilih root repositori dan gunakan konfigurasi yang sudah ada di `vercel.json`.
3. Tambahkan `DATABASE_URL` di **Settings → Environment Variables**. Gunakan URI **Transaction pooler** dari menu **Connect** di Supabase. Isi placeholder kata sandi dan enkode karakter khusus pada kata sandi sebagai bagian dari URI.
4. Tambahkan `ADMIN_PASSWORD` sebagai secret Vercel untuk inisialisasi akun `admin`. Gunakan kata sandi yang kuat. Setelah admin pertama masuk, aplikasi memakai hash kata sandi yang tersimpan di database. Mengganti secret ini tidak mereset kata sandi akun yang sudah dibuat.
5. Deploy atau redeploy setelah kedua variabel diatur. Buka `/admin`, login, masukkan bank soal, buat akun peserta, lalu buka ujian. Periksa login peserta sebelum membagikan URL.

Supabase dimulai dengan database kosong dan ujian ditutup. Data yang sudah ada di `portal.sqlite` tetap tersimpan di komputer. `portal.sqlite` dan file konfigurasi yang berisi secret diabaikan oleh Git.

### Pengaturan server untuk pelaksanaan bersama

Fungsi Vercel ditempatkan di Dublin (`dub1`), berdekatan dengan database proyek yang berada di `eu-west-1`. Pool database dibatasi lima koneksi per proses dan didaftarkan ke pengelola koneksi Vercel. Jangan memindahkan region fungsi tanpa menyesuaikan lokasi database.

Pembacaan status dan penyimpanan normal masing-masing menggunakan paling banyak tiga operasi database. Penyimpanan otomatis mengirim balasan ringkas; soal dan jawaban lengkap dimuat saat membuka atau melanjutkan ujian. Jawaban yang sudah dikumpulkan tidak dapat ditimpa oleh kiriman otomatis yang terlambat. Perubahan jawaban ditunda 800 milidetik sebelum penyimpanan otomatis untuk mengurangi permintaan saat peserta mengetik.

Batas login untuk satu alamat jaringan adalah 300 percobaan per 10 menit agar jaringan sekolah dapat dipakai bersama. Batas per akun tetap 12 percobaan per 10 menit dan direset setelah login berhasil. Koneksi database yang sementara tidak tersedia menghasilkan status 503 agar proses simpan dapat dicoba ulang.

Jalankan `npm test` untuk menguji 50 peserta simulasi melakukan login, membuka ujian, menyimpan, memuat ulang, dan mengumpulkan secara bersamaan pada database uji lokal. Pengujian ini memeriksa pemisahan jawaban, batas waktu, serta pengumpulan akhir; hasilnya tidak menggantikan pengukuran beban di hosting atau pemeriksaan internet peserta.

## Build Cloudflare Worker

Jalankan `node build.mjs` untuk membuat Worker di `dist/server/index.js`. Hosting mengikat D1 sebagai `DB`, menjalankan migrasi yang ada di `drizzle/`, lalu menyediakan kata sandi awal melalui secret `ADMIN_PASSWORD`. Atur akses hosting untuk peserta yang diundang sebelum hari ujian.
