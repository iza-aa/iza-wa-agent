# Daftar Metode Pembayaran & Dompet Kas

## 1. Daftar Metode Pembayaran Resmi

| Kategori | Nama Resmi (Canonical) | Variasi / Typo / Slang yang Dikenali |
| :--- | :--- | :--- |
| **Kas Tunai** | `Cash` | cash, tunai, kesh, fisik, uang cash, bayar langsung |
| **Bank Mandiri** | `Mandiri` | mandiri, livin, livin mandiri, m-mandiri, rek mandiri |
| **Bank BCA** | `BCA` | bca, blu, bca mobile, mybca, rek bca |
| **Bank BRI** | `BRI` | bri, brimo, bri mo, rek bri |
| **Bank BNI** | `BNI` | bni, bni mobile, wondr, rek bni |
| **Bank Syariah** | `BSI` | bsi, bsi mobile, bank syariah |
| **Bank Lainnya** | `CIMB` | cimb, cimb niaga, octo |
| | `Permata` | permata, permata mobile |
| | `Danamon` | danamon, d-bank |
| | `Bank Jago` | jago, bank jago |
| | `SeaBank` | seabank, sea bank |
| **QRIS & E-Wallet** | `QRIS` | qris, kris, qrisku, barcode |
| | `GoPay` | gopay, go pay, go-pay |
| | `OVO` | ovo, saldo ovo |
| | `DANA` | dana, saldo dana |
| | `ShopeePay` | shopeepay, shopee pay, spay, shopee |
| | `LinkAja` | linkaja, link aja |
| **Transfer Umum** | `Transfer Bank` | transfer, tf, trf, tranfer |
| **Kartu** | `Debit` | debit, kartu debit |
| | `Kartu Kredit` | kredit, kartu kredit, cc |

---

## 2. Aturan Dompet Multi-Kantong & Mutasi Kas

1. Setiap metode pembayaran berfungsi sebagai **kantong saldo (wallet pocket)** mandiri.
2. Saat mutasi/transfer uang antar kantong (misal: Tarik tunai Rp 1.000.000 dari Mandiri ke Cash laci):
   - Dicatat sebagai pengeluaran pada kantong sumber (`Mandiri`) dengan kategori `Mutasi Kas: Keluar`.
   - Dicatat sebagai pemasukan pada kantong tujuan (`Cash`) dengan kategori `Pemasukan: Mutasi Kas`.
3. Transfer dari dan ke kantong yang sama tidak diperbolehkan.
