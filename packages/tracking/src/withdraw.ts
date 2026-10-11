// Withdraw one person's advertising-measurement consent (the privacy page promises this is possible).
//   node --experimental-sqlite packages/tracking/src/withdraw.ts <ledger.sqlite> <lead id>
// It deletes the click details, landing page and Google visitor number kept with that quote request, stops any Google upload for it, and scrubs the file.
import { Ledger } from "./ledger.ts";

const [path, idText] = process.argv.slice(2);
const id = Number(idText);
if (!path || !Number.isInteger(id) || id < 1) {
  console.error("usage: node --experimental-sqlite packages/tracking/src/withdraw.ts <ledger.sqlite> <lead id>");
  process.exit(2);
}
const ledger = new Ledger(path);
const done = ledger.withdrawMeasurement(id);
if (!done) { console.log(`lead ${id}: not found, or not a quote form lead`); process.exit(1); }
// another process (the running receiver) may be reading: the deleted text stays in the write-ahead log until it is emptied, so retry for a few seconds and fail loudly if it cannot be
let clean = ledger.scrub();
for (let i = 0; !clean && i < 10; i++) { await new Promise((r) => setTimeout(r, 500)); clean = ledger.scrub(); }
if (!clean) { console.error(`lead ${id}: the click details are deleted from the database but could not be cleared from the write-ahead log because another process is reading it; run this again in a minute`); process.exit(3); }
console.log(`lead ${id}: measurement consent withdrawn, click details deleted`);
process.exit(0);
