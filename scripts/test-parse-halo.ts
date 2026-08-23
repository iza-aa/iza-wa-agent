import { parseTransactionText } from "../src/ai/parsers/text.parser.js";

async function main() {
  console.log("Testing parseTransactionText with 'halo'...");
  const res1 = await parseTransactionText("halo");
  console.log("Response for 'halo':", res1);

  console.log("\nTesting parseTransactionText with 'Beli bensin 50rb cash'...");
  const res2 = await parseTransactionText("Beli bensin 50rb cash");
  console.log("Response for transaction:", JSON.stringify(res2, null, 2));
}

main().catch(console.error);
