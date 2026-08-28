import { createClient } from "@supabase/supabase-js";
import { config } from "../src/config/env.js";

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);

async function checkMandiri() {
  const { data: allTrx, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: true });

  if (error) {
    console.error("Supabase query error:", error);
    return;
  }

  console.log(`\n=== TOTAL TRANSAKSI DI SUPABASE: ${allTrx?.length} ===\n`);

  // Group by payment method
  const pockets: Record<string, { income: number; expense: number; balance: number; count: number }> = {};
  
  for (const trx of allTrx || []) {
    let method = (trx.payment_method || "Cash").trim();
    if (!method) method = "Cash";
    if (!pockets[method]) {
      pockets[method] = { income: 0, expense: 0, balance: 0, count: 0 };
    }
    const amt = Number(trx.total_amount) || 0;
    const isInc = trx.type === "income" || trx.status === "income" || (trx.category && trx.category.toLowerCase().startsWith("pemasukan"));
    
    pockets[method].count++;
    if (isInc) {
      pockets[method].income += amt;
      pockets[method].balance += amt;
    } else {
      pockets[method].expense += amt;
      pockets[method].balance -= amt;
    }
  }

  console.log("=== RINGKASAN SALDO PER KANTONG / METODE ===");
  for (const [p, val] of Object.entries(pockets)) {
    console.log(
      `Kantong: [${p.padEnd(15)}] | Transaksi: ${String(val.count).padStart(3)} | Masuk: Rp${val.income.toLocaleString("id-ID").padStart(12)} | Keluar: Rp${val.expense.toLocaleString("id-ID").padStart(12)} | Saldo: Rp${val.balance.toLocaleString("id-ID").padStart(12)}`
    );
  }

  console.log("\n=== KRONOLOGI ARUS KAS MANDIRI DARI AWAL BULAN ===");
  const mandiriTrx = (allTrx || []).filter(t => (t.payment_method || "").toLowerCase().includes("mandiri"));
  
  // Sort properly: first by transaction date (C), then by ID or timestamp
  mandiriTrx.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  let runningBalance = 0;
  for (const t of mandiriTrx) {
    const isInc = t.type === "income" || t.status === "income" || (t.category && t.category.toLowerCase().startsWith("pemasukan"));
    const amt = Number(t.total_amount) || 0;
    if (isInc) {
      runningBalance += amt;
    } else {
      runningBalance -= amt;
    }
    const sign = isInc ? "[+ MASUK ]" : "[- KELUAR]";
    console.log(
      `${t.date} | ${t.id.padEnd(10)} | ${sign} Rp${amt.toLocaleString("id-ID").padStart(10)} | Saldo: Rp${runningBalance.toLocaleString("id-ID").padStart(12)} | ${t.merchant.padEnd(25)} | Raw: "${t.raw_text}"`
    );
  }

  console.log("\n=== CEK KEMUNGKINAN PENGELUARAN MANDIRI YANG SALAH INPUT / PERLU DIUJI ===");
  const mandiriExpenses = (allTrx || []).filter(t => {
    const isInc = t.type === "income" || t.status === "income" || (t.category && t.category.toLowerCase().startsWith("pemasukan"));
    return !isInc && (t.payment_method || "").toLowerCase().includes("mandiri");
  });

  const targetDiff = 8200407; // Selisih untuk mencapai +5 jt
  console.log(`Target penyesuaian untuk mencapai saldo +Rp5.000.000: Rp${targetDiff.toLocaleString("id-ID")}\n`);

  for (const exp of mandiriExpenses) {
    const amt = Number(exp.total_amount);
    const newBalIfRemoved = -3200407 + amt;
    console.log(
      `Jika [${exp.id}] (${exp.date}) Rp${amt.toLocaleString("id-ID").padStart(10)} [${exp.merchant}] DIHAPUS / BUKAN MANDIRI:`
    );
    console.log(`  -> Saldo Mandiri Menjadi: Rp${newBalIfRemoved.toLocaleString("id-ID")}`);
  }
}

checkMandiri().catch(console.error);
