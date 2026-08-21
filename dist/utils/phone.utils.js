/**
 * Utilitas Normalisasi Nomor Telepon WhatsApp
 * Memastikan semua nomor berformat standar Indonesia '628xxxxxxxx'
 */
export function normalizePhoneNumber(raw) {
    if (!raw)
        return "";
    // 1. Hapus suffix WhatsApp jid/lid/group dan semua karakter non-digit
    let digits = raw
        .replace(/@s\.whatsapp\.net|@c\.us|@lid|@g\.us/gi, "")
        .replace(/[^0-9]/g, "");
    // 2. Multi-device WhatsApp LID mapping yang dikenal
    if (digits === "232130131046571")
        return "6281346367235";
    if (digits === "168096866255025")
        return "62811422404";
    if (digits === "113404400390171")
        return "6282147440520";
    // 3. Konversi format awal (08xx -> 628xx, 8xx -> 628xx)
    if (digits.startsWith("08")) {
        digits = "62" + digits.slice(1);
    }
    else if (digits.startsWith("8") && digits.length >= 9 && digits.length <= 13) {
        digits = "62" + digits;
    }
    else if (digits.startsWith("0") && digits.length >= 9) {
        digits = "62" + digits.slice(1);
    }
    return digits;
}
//# sourceMappingURL=phone.utils.js.map