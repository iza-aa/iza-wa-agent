const data = `
T026-H002	24/8/2026, 21.36.46	24/08/2026	Pemasukan	Pemasukan: Lain-lain	Saldo Bulan Juli	Rp751.593	Mandiri	62811422404	Ayah	-	Saldo Bulan Juli 751593 Mandiri
T026-H003	25/8/2026, 11.53.38	01/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.225.200	Mandiri	62811422404	Ayah	-	/Pemasukan 1225200 tanggal 1 Agustus Mandiri
T026-H008	25/8/2026, 11.59.58	02/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp582.400	Mandiri	62811422404	Ayah	-	/Pemasukan 582400 tanggal 2 Agustus Mandiri
T026-H013	25/8/2026, 12.04.25	03/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp232.000	Mandiri	62811422404	Ayah	-	/Pemasukan 232000 tanggal 3 Agustus Mandiri
T026-H017	25/8/2026, 12.08.00	04/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.147.800	Mandiri	62811422404	Ayah	-	/Pemasukan 1147800 tanggal 4 Agustus Mandiri
T026-H022	25/8/2026, 12.12.38	05/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp819.500	Mandiri	62811422404	Ayah	-	/Pemasukan 819500 tanggal 5 Agustus Mandiri
T026-H027	25/8/2026, 12.17.31	06/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp714.400	Mandiri	62811422404	Ayah	-	/Pemasukan 714400 tanggal 6 Agustus Mandiri
T026-H032	25/8/2026, 12.21.25	07/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp786.700	Mandiri	62811422404	Ayah	-	/Pemasukan 786700 tanggal 7 Agustus Mandiri
T026-H036	25/8/2026, 12.24.47	08/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp2.246.500	Mandiri	62811422404	Ayah	-	/Pemasukan 2246500 tanggal 8 Agustus Mandiri
T026-H042	25/8/2026, 12.31.57	09/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp324.500	Mandiri	62811422404	Ayah	-	/Pemasukan 324500 tanggal 9 Agustus Mandiri
T026-H045	25/8/2026, 12.36.15	10/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.615.600	Mandiri	62811422404	Ayah	-	/Pemasukan 1615600 tanggal 10 Agustus Mandiri
T026-H050	25/8/2026, 12.40.55	11/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp2.050.500	Mandiri	62811422404	Ayah	-	/Pemasukan 2050500 tanggal 11 Agustus Mandiri
T026-H055	25/8/2026, 12.45.48	12/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp826.200	Mandiri	62811422404	Ayah	-	/Pemasukan 826200 tanggal 12 Agustus Mandiri
T026-H059	25/8/2026, 12.48.44	13/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.025.600	Mandiri	62811422404	Ayah	-	/Pemasukan 1025600 tanggal 13 Agustus Mandiri
T026-H065	25/8/2026, 12.55.35	14/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp920.800	Mandiri	62811422404	Ayah	-	/Pemasukan 920800 tanggal 14 Agustus Mandiri
T026-H071	25/8/2026, 13.25.07	15/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.581.800	Mandiri	62811422404	Ayah	-	/Pemasukan 1581800 tanggal 15 Agustus Mandiri
T026-H076	25/8/2026, 13.31.03	16/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.986.700	Mandiri	62811422404	Ayah	-	/Pemasukan 1986700 tanggal 16 Agustus Mandiri
T026-H081	25/8/2026, 21.26.26	17/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.412.200	Mandiri	62811422404	Ayah	-	/Pemasukan 1412200 tanggal 17 Agustus Mandiri
T026-H085	25/8/2026, 21.29.52	18/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp4.068.500	Mandiri	62811422404	Ayah	-	/Pemasukan 4068500 tanggal 18 Agustus Mandiri
T026-H089	25/8/2026, 21.34.15	19/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.493.300	Mandiri	62811422404	Ayah	-	/Pemasukan 1493300 tanggal 19 Agustus Mandiri
T026-H092	25/8/2026, 21.37.11	02/08/2026	Pengeluaran	Tagihan & Utilitas	Gaji Karyawan Juli	Rp10.000.000	Mandiri	62811422404	Ayah	-	Bayar Gaji Karyawan Juli 10000000 tanggal 2 Agustus Mandiri
T026-H093	25/8/2026, 21.39.36	22/08/2026	Pengeluaran	Tagihan & Utilitas	Bayar Ruko	Rp15.000.000	Mandiri	62811422404	Ayah	-	Bayar Ruko 15000000 Tanggal 22 Agustus Mandiri
T026-H094	25/8/2026, 21.43.42	22/08/2026	Pengeluaran	Tagihan & Utilitas	Bayar Kopi dan Internet	Rp7.389.000	Mandiri	62811422404	Ayah	-	Bayar Kopi dan Internet 7389000 Tanggal 22 Agustus Mandiri
T026-H095	25/8/2026, 21.55.42	06/08/2026	Pengeluaran	Tagihan & Utilitas	Keperluan Kafe	Rp503.500	Mandiri	62811422404	Ayah	-	Belanja Keperluan Kafe Mandiri Tanggal 6 Agustus • Token Listrik 32165310320 1 Kali 503500
T026-H096	25/8/2026, 21.56.37	07/08/2026	Pengeluaran	Tagihan & Utilitas	Keperluan Kafe	Rp203.500	Mandiri	62811422404	Ayah	-	Belanja Keperluan Kafe Mandiri Tanggal 7 Agustus • Token Listrik 326300361155 1 Kali 203500
T026-H097	25/8/2026, 21.57.25	09/08/2026	Pengeluaran	Tagihan & Utilitas	Keperluan Kafe	Rp503.500	Mandiri	62811422404	Ayah	-	Belanja Keperluan Kafe Mandiri Tanggal 9 Agustus • Token Listrik 326300363261 1 Kali 503500
T026-H098	25/8/2026, 21.57.45	09/08/2026	Pengeluaran	Belanja Bulanan	Keperluan Barista	Rp4.347.000	Mandiri	62811422404	Ayah	-	Belanja Keperluan Barista Mandiri Tanggal 9 Agustus • Makanan Baku 1 Set 2101500 • Sirup 1 Set 888000 • Powder 1 Set 1357500
T026-H099	25/8/2026, 21.58.09	15/08/2026	Pengeluaran	Tagihan & Utilitas	Keperluan Kafe	Rp503.500	Mandiri	62811422404	Ayah	-	Belanja Keperluan Kafe Mandiri Tanggal 15 Agustus • Token Listrik 326300363261 1 kali 503500
T026-H100	25/8/2026, 22.01.44	23/08/2026	Pengeluaran	Tagihan & Utilitas	Keperluan Kafe	Rp103.500	Mandiri	62811422404	Ayah	-	Belanja Keperluan Kafe Mandiri Tanggal 23 Agustus • Token Listrik 326300363279 1 Kali 103500
T026-H101	26/8/2026, 20.12.03	20/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.505.100	Mandiri	62811422404	Ayah	-	/Pemasukan 1505100 tanggal 20 Agustus Mandiri
T026-H104	26/8/2026, 20.14.17	21/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.351.000	Mandiri	62811422404	Ayah	-	/Pemasukan 1351000 tanggal 21 Agustus Mandiri
T026-H107	26/8/2026, 20.16.11	22/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.708.200	Mandiri	62811422404	Ayah	-	/Pemasukan 1708200 tanggal 22 Agustus Mandiri
T026-H110	26/8/2026, 20.17.36	23/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp829.000	Mandiri	62811422404	Ayah	-	/Pemasukan 829000 tanggal 23 Agustus Mandiri
T026-H112	26/8/2026, 20.18.48	24/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.448.000	Mandiri	62811422404	Ayah	-	/Pemasukan 1448000 tanggal 24 Agustus Mandiri
T026-H115	26/8/2026, 20.20.29	25/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp467.000	Mandiri	62811422404	Ayah	-	/Pemasukan 467000 tanggal 25 Agustus Mandiri
T026-H117	27/8/2026, 07.18.58	26/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp1.746.000	Mandiri	62811422404	Ayah	-	/Pemasukan 1746000 tanggal 26 Agustus Mandiri
T026-H137	28/8/2026, 20.22.53	27/08/2026	Pemasukan	Pemasukan: Top Up Kas	Pemasukan Kas	Rp487.000	Mandiri	62811422404	Ayah	-	/Pemasukan 487000 tanggal 27 Agustus Mandiri
`;

let totalPemasukan = 0;
let totalPengeluaran = 0;

data.trim().split('\n').forEach(line => {
    const parts = line.split('\t');
    const type = parts[3];
    const amountStr = parts[6].replace(/[^0-9]/g, '');
    const amount = parseInt(amountStr, 10);
    
    if (type === 'Pemasukan') {
        totalPemasukan += amount;
    } else if (type === 'Pengeluaran') {
        totalPengeluaran += amount;
    }
});

console.log('Total Pemasukan:', totalPemasukan);
console.log('Total Pengeluaran:', totalPengeluaran);
console.log('Sisa Saldo Mandiri:', totalPemasukan - totalPengeluaran);
