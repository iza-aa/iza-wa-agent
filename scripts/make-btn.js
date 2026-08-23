import fs from "fs";

// Let's create a clean 140x32 PNG button in pure node using jimp or sharp or canvas or direct png buffer or shields.io PNG fetch
async function main() {
  const res = await fetch("https://img.shields.io/badge/%F0%9F%94%84_RESET_FILTER-0052cc?style=for-the-badge&logoColor=white.png");
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  console.log("Base64 Length:", base64.length);
  console.log("Base64 string snippet:", base64.slice(0, 50));
  fs.writeFileSync("scripts/button_base64.txt", base64);
}

main().catch(console.error);
