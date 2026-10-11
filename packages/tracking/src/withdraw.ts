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
console.log(done ? `lead ${id}: measurement consent withdrawn, click details deleted` : `lead ${id}: not found, or not a quote form lead`);
process.exit(done ? 0 : 1);
