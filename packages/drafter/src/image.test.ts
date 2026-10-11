import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cleanImage, hasExif } from "./index.ts";

const withGps = async () => {
  const gps = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .withExif({ IFD0: { Make: "TestPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "49/1 20/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "123/1 10/1 0/1" } })
    .jpeg().toBuffer();
  return sharp(gps).withMetadata({ orientation: 6 }).toBuffer(); // a phone held upright stores a sideways picture plus orientation 6
};

test("MUTANT: a phone photo with GPS in its EXIF is detected, and cleaning removes every trace", async () => {
  const dirty = await withGps();
  assert.equal(await hasExif(dirty), true, "the fixture really carries EXIF, so the check can fail");
  const clean = await cleanImage(dirty);
  assert.equal(await hasExif(clean), false);
  assert.equal(clean.includes(Buffer.from("TestPhone")), false);
});

test("cleaning applies the orientation instead of leaving the picture sideways", async () => {
  const clean = await cleanImage(await withGps());
  const m = await sharp(clean).metadata();
  assert.deepEqual([m.width, m.height], [48, 64], "orientation 6 turns a 64x48 picture upright to 48x64");
});
