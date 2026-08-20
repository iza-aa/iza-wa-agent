import { getSupabaseClient } from "../src/db/supabase.js";

async function fixUsers() {
  const supabase = getSupabaseClient();
  console.log("🛠️ Memperbarui data pengguna di Supabase...");

  // 1. Update Super Admin 1: Rezky Haikal (Owner)
  const { error: err1 } = await supabase.from("users").upsert({
    phone_number: "6281346367235",
    name: "Rezky Haikal (Owner)",
    role: "super_admin",
    status: "active",
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone_number" });
  if (err1) console.error("Error updating user 1:", err1.message);
  else console.log("✅ User 1: Rezky Haikal (Owner) (+6281346367235) updated.");

  // 2. Update Super Admin 2: Ayah (+62811422404)
  const { error: err2 } = await supabase.from("users").upsert({
    phone_number: "62811422404",
    name: "Ayah",
    role: "super_admin",
    status: "active",
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone_number" });
  if (err2) console.error("Error updating user 2:", err2.message);
  else console.log("✅ User 2: Ayah (+62811422404) updated.");

  // 3. Add LID mapping for Ayah
  const { error: err3 } = await supabase.from("users").upsert({
    phone_number: "168096866255025",
    name: "Ayah",
    role: "super_admin",
    status: "active",
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone_number" });
  if (err3) console.error("Error adding Ayah LID:", err3.message);
  else console.log("✅ Ayah LID (168096866255025) registered as Super Admin.");

  // 4. Add LID mapping for Rezky Haikal
  const { error: err4 } = await supabase.from("users").upsert({
    phone_number: "232130131046571",
    name: "Rezky Haikal (Owner)",
    role: "super_admin",
    status: "active",
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone_number" });
  if (err4) console.error("Error adding Rezky LID:", err4.message);
  else console.log("✅ Rezky LID (232130131046571) registered as Super Admin.");

  console.log("\n📋 Data tabel users saat ini:");
  const { data } = await supabase.from("users").select("*");
  console.log(JSON.stringify(data, null, 2));
}

fixUsers().catch(console.error);
