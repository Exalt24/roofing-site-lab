// A phone photo carries EXIF: GPS coordinates (a customer's address), the device, the time. Anything uploaded to the public CMS goes through here first.
// sharp drops all metadata on output unless asked to keep it, and rotate() with no argument applies the EXIF orientation first so the picture is not left sideways.
import sharp from "sharp";
import fs from "node:fs";

export async function cleanImage(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().toBuffer();
}

export async function cleanImageFile(file: string): Promise<Buffer> {
  return cleanImage(fs.readFileSync(file));
}

/** True when the image still carries EXIF, ICC aside. Used by tests and the uploader as a last check. */
export async function hasExif(input: Buffer): Promise<boolean> {
  const m = await sharp(input).metadata();
  return !!m.exif && m.exif.length > 0;
}
