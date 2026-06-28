# FaceSearch AI v2.0 — Mesin Pencari Wajah Premium (Client-Side & Offline)

**FaceSearch AI v2.0** adalah mesin pencari wajah berbasis web (_client-side_) yang mengimplementasikan algoritma kecerdasan buatan (_AI Face Recognition_) untuk mendeteksi, mengenali, dan mencocokkan wajah dari galeri foto Anda secara instan dan sepenuhnya offline.

Didesain dengan estetika mewah **Obsidian Black & Champagne Gold**, aplikasi ini memberikan nuansa studio fotografi berkelas premium sekaligus menjamin keamanan privasi data Anda 100% karena tidak ada satu pun berkas gambar yang dikirim ke server luar.

---

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Spesifikasi Teknologi & Arsitektur](#spesifikasi-teknologi--arsitektur)
- [Struktur Proyek](#struktur-proyek)
- [Unduh & Persiapan Model AI](#unduh--persiapan-model-ai)
- [Panduan Instalasi Lokal](#panduan-instalasi-lokal)
- [Alur Kerja & Cara Penggunaan](#alur-kerja--cara-penggunaan)
- [Jaminan Keamanan & Privasi](#jaminan-keamanan--privasi)
- [Lisensi](#lisensi)

---

## Fitur Utama

### 1. Database Foto Lokal (IndexedDB Terenkripsi Memori)

- **Keamanan Mutlak:** Semua gambar yang diunggah serta vektor wajah (_face descriptors_) disimpan di browser perangkat Anda menggunakan **IndexedDB**. Data tetap aman dan privat bahkan jika koneksi internet dimatikan.
- **Ekspor & Impor Database:** Anda dapat mencadangkan seluruh indeks wajah yang telah terproses ke dalam berkas JSON tunggal dan memulihkannya (_restore_) kapan saja ke perangkat lain dengan cepat.

### 2. Multi-Target Face Query

- **Deteksi Cerdas:** Sistem memindai gambar target Anda secara otomatis, mendeteksi semua wajah yang terdeteksi, memotongnya (_crop_), dan menyajikannya dalam daftar wajah target.
- **Pencarian Multi-Wajah:** Pilih satu atau beberapa wajah query target secara simultan untuk mencocokkannya ke database foto.
- **Kontrol Threshold Presisi:** Atur batas Euclidean Distance (Toleransi Kemiripan) melalui slider interaktif. Threshold yang lebih rendah akan menghasilkan kecocokan yang sangat identik, sedangkan threshold tinggi memberikan kecocokan yang lebih luas.

### 3. Modul Kamera (Webcam) Terkalibrasi

- **Selfie Langsung:** Ambil foto wajah query target langsung dari kamera depan laptop atau smartphone Anda.
- **Mirror Toggle Calibration:** Tombol cermin kamera bawaan mempermudah pengambilan selfie. Proses konversi otomatis menjamin hasil foto query tersimpan secara **unmirrored** (tidak terbalik), sehingga mempertahankan orientasi spasial wajah asli demi akurasi pencocokan AI yang optimal.

### 4. Performa Super Cepat (Speed Boost Engine)

- **Parallel Processing Queue:** Menggunakan antrean Promise paralel yang membatasi hingga **3 unggahan simultan** secara cerdas agar browser tidak hang atau crash saat memproses ratusan foto sekaligus.
- **Smart Downscaling Canvas:** Gambar berukuran besar (> 5MB) dikompresi secara otomatis menggunakan kanvas HTML ke resolusi maksimum **1024px** (kualitas JPEG 90%) sebelum dikirim ke neural network. Proses ini memangkas waktu pemrosesan hingga **10x lipat** tanpa mengurangi akurasi pengenalan wajah.
- **WebGL GPU Acceleration:** Neural network berjalan dengan akselerasi GPU menggunakan backend WebGL TensorFlow.js dalam mode produksi (`enableProdMode`) untuk kecepatan inferensi milidetik.

### 5. Antarmuka Premium, Responsif & Elegan

- **Desain Luxury Obsidian Gold:** Palet warna kustom berkelas (Obsidian Black, Deep Navy, Glassmorphism, Champagne Gold accents) dengan mikro-animasi transisi halus dan modern.s
- **Responsivitas Perangkat Mobile:** Layout 3 panel adaptif yang bertransisi ke mode navigasi tab bawah di smartphone, memastikan kenyamanan penggunaan di perangkat genggam.
- **Modal Interaktif Terpadu:** Panduan tutorial alur kerja dan kebijakan privasi terintegrasi langsung dalam antarmuka dengan scrolling bar kustom dan animasi modal pegas (_spring-physics_).

---

## Spesifikasi Teknologi & Arsitektur

Aplikasi ini dibangun menggunakan arsitektur web modern tanpa framework berat (no-build setup) untuk efisiensi beban kerja:

- **Bahasa Dasar:** HTML5, CSS3 (Vanilla dengan CSS Variables & Grid/Flexbox), JavaScript (ES6+ Asynchronous).
- **Face Recognition Engine:** [face-api.js](https://github.com/justadudewhohacks/face-api.js/) dibangun di atas TensorFlow.js core.
- **Detektor Wajah:** SSD Mobilenet v1 (Akurasi tinggi untuk deteksi wajah multi-arah).
- **Penyelarasan Wajah:** Face Landmark 68-Point extractor.
- **Ekstraktor Ciri Wajah:** ResNet-34 Face Recognition neural network (menghasilkan 128-float representation vector).
- **Penyimpanan Lokal:** IndexedDB API (menggunakan wrapper Promise teroptimasi).

---

## Struktur Proyek

```bash
search-image/
├── models/                       # File bobot neural network face-api.js
│   ├── ssd_mobilenetv1_model-weights_manifest.json
│   ├── ssd_mobilenetv1_model-shard1
│   ├── ssd_mobilenetv1_model-shard2
│   ├── face_landmark_68_model-weights_manifest.json
│   ├── face_landmark_68_model-shard1
│   ├── face_recognition_model-weights_manifest.json
│   └── face_recognition_model-shard1
├── index.html                    # Struktur HTML5 aplikasi & Modal
├── style.css                     # Gaya desain premium CSS, Glassmorphism & Responsif
├── app.js                        # Logika AI, manajemen database IndexedDB & alur proses
├── LICENSE                       # Lisensi proyek (GNU AGPLv3 License)
└── README.md                     # Panduan dokumentasi proyek lengkap
```

---

## Unduh & Persiapan Model AI

Aplikasi membutuhkan file model AI `face-api.js` untuk ditempatkan pada folder `/models` di direktori utama proyek. Pastikan file model berikut ada di folder `/models`:

| Nama Model           | Deskripsi                                                        | Kegunaan                                                |
| :------------------- | :--------------------------------------------------------------- | :------------------------------------------------------ |
| **SSD Mobilenet v1** | `ssd_mobilenetv1_model-weights_manifest.json` (+ shard1, shard2) | Mendeteksi letak kotak wajah di dalam foto.             |
| **Face Landmark 68** | `face_landmark_68_model-weights_manifest.json` (+ shard1)        | Menentukan 68 titik kontur wajah (mata, hidung, mulut). |
| **Face Recognition** | `face_recognition_model-weights_manifest.json` (+ shard1)        | Mengekstrak ciri wajah menjadi 128 vektor numerik unik. |

_Catatan: Jika folder `/models` belum terisi, Anda bisa mengunduhnya dari repositori resmi `face-api.js` di GitHub._

---

## Panduan Instalasi Lokal

Aplikasi ini memerlukan lingkungan server web lokal (karena kebijakan keamanan browser melarang akses modul AI/IndexedDB melalui protokol `file://`).

### Opsi A: Menggunakan Laragon (Sangat Direkomendasikan untuk Windows)

1. Unduh dan pasang [Laragon](https://laragon.org/).
2. Salin folder proyek `search-image` ke direktori root server Laragon:
   ```bash
   C:\laragon\www\search-image
   ```
3. Klik **Start All** di panel Laragon untuk mengaktifkan Apache/Nginx.
4. Buka peramban browser Anda dan navigasikan ke tautan berikut:
   ```bash
   http://localhost/search-image/
   ```

### Opsi B: Menggunakan VS Code Live Server Extension

1. Jalankan editor VS Code dan buka folder proyek `search-image`.
2. Masuk ke tab Extensions (Ctrl+Shift+X) lalu pasang ekstensi **Live Server** (oleh Ritwick Dey).
3. Klik ikon **Go Live** di status bar pojok kanan bawah VS Code.
4. Browser akan terbuka otomatis mengarah ke alamat:
   ```bash
   http://127.0.0.1:5500/
   ```

### Opsi C: Menggunakan Python Simple HTTP Server

Apabila Anda sudah memiliki Python terinstal di sistem Anda, buka terminal di direktori proyek dan jalankan:

- **Python 3.x:**
  ```bash
  python -m http.server 8000
  ```
- Buka browser dan navigasikan ke `http://localhost:8000/`.

---

## Alur Kerja & Cara Penggunaan

### 1. Membangun Database Foto

- Di **Panel Kiri (Database)**, seret folder berisi kumpulan foto Anda (misal folder hasil dokumentasi acara, liburan, dll.) langsung ke area drop-zone.
- Indikator progres loading visual akan muncul menampilkan kecepatan, status persentase, dan jumlah foto yang terproses.
- Proses downscaling kompresi canvas bekerja otomatis untuk mempercepat proses impor gambar berukuran besar.

### 2. Memuat Wajah Target (Query)

- Di **Panel Tengah (Target)**, masukkan foto satu wajah target yang ingin Anda cari. Anda dapat mengunggah berkas foto, atau mengklik tombol **Webcam** untuk memotret langsung.
- Sistem AI akan mendeteksi wajah di foto target tersebut dan menampilkannya di daftar wajah query yang siap dipilih.

### 3. Eksekusi Pencarian Wajah

- Klik pada wajah target yang ingin Anda cari di database. Wajah yang terpilih akan diberi highlight border emas Champagne.
- Sesuaikan nilai toleransi kemiripan wajah di slider threshold (semakin rendah nilainya, pencocokan akan semakin ketat/mirip).
- Klik tombol **Cari Wajah**.

### 4. Menilai Hasil Pencocokan

- Di **Panel Kanan (Hasil)**, daftar foto yang memuat wajah target akan disajikan berdasarkan skor kemiripan tertinggi.
- Klik salah satu hasil foto untuk membuka **Detail Modal**: Anda dapat mengecek detail jarak Euclidean, mengunduh file asli, atau menghapus foto tersebut dari database lokal Anda.

---

## Jaminan Keamanan & Privasi

Aplikasi FaceSearch AI v2.0 dirancang dengan integritas keamanan data tertinggi:

- **Pemrosesan Offline:** Seluruh operasi klasifikasi neural network berjalan di memori browser lokal (_Client-Side Rendering_).
- **Nir-Server (Zero-Server):** Tidak ada pengiriman foto ke cloud, backend, server analitik, atau API pihak ketiga.
- **Kontrol Penuh:** Data Anda hanya milik Anda. Menghapus data situs pada pengaturan browser Anda akan langsung menghapus seluruh database foto IndexedDB secara permanen.

---

## Lisensi

Proyek ini didistribusikan di bawah lisensi **GNU Affero General Public License v3.0 (AGPL-3.0)**. Lisensi ini merupakan lisensi "strong copyleft" yang mewajibkan siapa pun yang memodifikasi atau mendistribusikan kode ini untuk membagikan kode sumbernya secara terbuka, termasuk jika perangkat lunak ini dijalankan sebagai layanan jaringan (network service/hosting). Selengkapnya lihat di berkas [LICENSE](LICENSE).

---

_Dikembangkan dengan penuh dedikasi oleh [Muhammad Fikri Haikal](https://www.instagram.com/fikrii_haikalll17/). Hubungi via Instagram jika Anda memiliki pertanyaan atau masukan lebih lanjut._
