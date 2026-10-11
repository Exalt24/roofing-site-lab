// Record how a lead turned out, so the estimate and sold-job stages can reach Google. This is the input path until a connector to the office's estimating software exists.
//   node --experimental-sqlite packages/tracking/src/stage.ts <ledger.sqlite> <lead id> estimate|sold|lost [value in dollars]
import { Ledger } from "./ledger.ts";

const [path, idText, stage, valueText] = process.argv.slice(2);
const id = Number(idText);
const value = valueText === undefined ? undefined : Number(valueText);
if (!path || !Number.isInteger(id) || id < 1 || !["estimate", "sold", "lost"].includes(stage ?? "") || (value !== undefined && !(Number.isFinite(value) && value >= 0))) {
  console.error("usage: node --experimental-sqlite packages/tracking/src/stage.ts <ledger.sqlite> <lead id> estimate|sold|lost [value]");
  process.exit(2);
}
const ledger = new Ledger(path);
if (!ledger.get(id)) { console.log(`lead ${id}: not found`); process.exit(1); }
try { ledger.setStage(id, stage as "estimate" | "sold" | "lost", value === undefined ? {} : { value }); } catch (e) { console.error(`lead ${id}: ${(e as Error).message}`); process.exit(1); }
const row = ledger.get(id)!;
console.log(`lead ${id}: stage ${row.stage}, estimate ${row.estimate_value ?? "none"}, sold ${row.sold_value ?? "none"}`);
process.exit(0);
