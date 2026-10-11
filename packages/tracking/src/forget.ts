// Delete one person's quote request, or record that they withdrew their marketing email consent.
//   node --experimental-sqlite packages/tracking/src/forget.ts <ledger.sqlite> <lead id>                    delete the lead, its notifications and everything in the file
//   node --experimental-sqlite packages/tracking/src/forget.ts <ledger.sqlite> <lead id> --marketing-only   keep the lead, set marketing_opt_in to 0
// A notification that was already delivered to your inbox or channel is outside this ledger and has to be deleted there.
import { Ledger } from "./ledger.ts";

const [path, idText, flag] = process.argv.slice(2);
const id = Number(idText);
if (!path || !Number.isInteger(id) || id < 1) {
  console.error("usage: node --experimental-sqlite packages/tracking/src/forget.ts <ledger.sqlite> <lead id> [--marketing-only]");
  process.exit(2);
}
const ledger = new Ledger(path);
if (flag === "--marketing-only") {
  const done = ledger.withdrawMarketing(id);
  console.log(done ? `lead ${id}: marketing consent withdrawn` : `lead ${id}: not found, or not a quote form lead`);
  process.exit(done ? 0 : 1);
}
const done = ledger.deleteLead(id);
if (!done) { console.log(`lead ${id}: not found`); process.exit(1); }
let clean = ledger.scrub();
for (let i = 0; !clean && i < 10; i++) { await new Promise((r) => setTimeout(r, 500)); clean = ledger.scrub(); }
if (!clean) { console.error(`lead ${id}: deleted from the database, but the write-ahead log could not be cleared because another process is reading it; run this again in a minute`); process.exit(3); }
console.log(`lead ${id}: deleted`);
process.exit(0);
