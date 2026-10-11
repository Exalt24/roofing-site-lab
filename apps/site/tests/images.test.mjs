// No published image may carry metadata: a phone photo's EXIF can hold GPS coordinates (a customer's address), and generated images can hold the whole prompt and workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const BAD = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);

function chunks(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), "PNG", `${file} is not a PNG`);
  const names = [];
  for (let i = 8; i < b.length;) { const len = b.readUInt32BE(i); names.push(b.subarray(i + 4, i + 8).toString("latin1")); i += 12 + len; }
  return names;
}

for (const dir of ["assets/source", "apps/site/public/photos"]) {
  test(`${dir}: every PNG is free of text and EXIF chunks`, () => {
    const files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".png"));
    assert.ok(files.length >= 10, "the folder should hold the sample photos");
    for (const f of files) {
      const bad = chunks(path.join(root, dir, f)).filter((n) => BAD.has(n));
      assert.deepEqual(bad, [], `${dir}/${f} still carries ${bad.join(", ")}`);
    }
  });
}

test("the check can fail: a PNG with a text chunk is caught", () => {
  const tmp = path.join(root, "qa", "_meta_probe.png");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const src = fs.readFileSync(path.join(root, "assets/source", fs.readdirSync(path.join(root, "assets/source")).find((f) => f.endsWith(".png"))));
  const text = Buffer.from("tEXtprompt\0secret", "latin1");
  const len = Buffer.alloc(4); len.writeUInt32BE(text.length - 4);
  const crc = Buffer.alloc(4);
  fs.writeFileSync(tmp, Buffer.concat([src.subarray(0, 33), len, text, crc, src.subarray(33)]));
  assert.ok(chunks(tmp).some((n) => BAD.has(n)));
  fs.rmSync(tmp);
});
