/**
 * Kamus Terpusat Metode Pembayaran & E-Wallet
 * Digunakan secara seragam di CommandHandler, EditParser, SearchParser, dan SheetsService
 */
export const CANONICAL_PAYMENT_MAP = {
    // Bank Transfer & M-Banking
    mandiri: "Mandiri",
    livin: "Mandiri",
    "livin mandiri": "Mandiri",
    bca: "BCA",
    blu: "BCA",
    "bca mobile": "BCA",
    bri: "BRI",
    brimo: "BRI",
    "bri mo": "BRI",
    bni: "BNI",
    "bni mobile": "BNI",
    bsi: "BSI",
    "bsi mobile": "BSI",
    cimb: "CIMB",
    "cimb niaga": "CIMB",
    octo: "CIMB",
    permata: "Permata",
    danamon: "Danamon",
    jago: "Bank Jago",
    "bank jago": "Bank Jago",
    seabank: "SeaBank",
    "sea bank": "SeaBank",
    // Cash / Tunai
    cash: "Cash",
    tunai: "Cash",
    kesh: "Cash",
    fisik: "Cash",
    uang: "Cash",
    // QRIS & E-Wallet
    qris: "QRIS",
    kris: "QRIS",
    qrisku: "QRIS",
    gopay: "GoPay",
    "go pay": "GoPay",
    "go-pay": "GoPay",
    ovo: "OVO",
    dana: "DANA",
    shopeepay: "ShopeePay",
    "shopee pay": "ShopeePay",
    shoopepay: "ShopeePay",
    shoppepay: "ShopeePay",
    shopee: "ShopeePay",
    spay: "ShopeePay",
    "s-pay": "ShopeePay",
    linkaja: "LinkAja",
    "link aja": "LinkAja",
    // Kartu & Generic
    transfer: "Transfer Bank",
    "transfer bank": "Transfer Bank",
    tf: "Transfer Bank",
    trf: "Transfer Bank",
    tranfer: "Transfer Bank",
    debit: "Debit",
    kredit: "Kartu Kredit",
    "kartu kredit": "Kartu Kredit",
    cc: "Kartu Kredit",
};
/**
 * Mencari nama kanonikal dari input mentah
 */
export function getCanonicalPaymentMethod(raw) {
    if (!raw)
        return null;
    const clean = raw.toLowerCase().trim();
    // 1. Exact match
    if (CANONICAL_PAYMENT_MAP[clean]) {
        return CANONICAL_PAYMENT_MAP[clean];
    }
    // 2. Token match (sort by longest keyword first to match "shopee pay" before "shopee")
    const sortedKeys = Object.keys(CANONICAL_PAYMENT_MAP).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        const regex = new RegExp(`\\b${key.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
        if (regex.test(clean) || clean.includes(key)) {
            return CANONICAL_PAYMENT_MAP[key];
        }
    }
    return null;
}
//# sourceMappingURL=payment-methods.js.map