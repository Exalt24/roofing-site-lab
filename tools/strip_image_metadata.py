"""Re-encode every PNG so it carries no metadata chunks (the ComfyUI workflow, EXIF, GPS, text). Run it before photos are committed or published.
   python tools/strip_image_metadata.py [folder ...]    (default: assets/source and apps/site/public/photos)
A real crew photo from a phone can carry GPS coordinates in its EXIF block, which would publish a customer's address; the same step covers it."""
import glob
import os
import sys

from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
folders = sys.argv[1:] or [os.path.join(root, "assets", "source"), os.path.join(root, "apps", "site", "public", "photos")]
changed = 0
for folder in folders:
    for path in sorted(glob.glob(os.path.join(folder, "*.png"))):
        with Image.open(path) as im:
            had = dict(im.info)
            clean = Image.new(im.mode, im.size)
            clean.putdata(list(im.getdata()))
        if had:
            clean.save(path, format="PNG", optimize=True)
            changed += 1
            print("stripped", os.path.relpath(path, root), list(had.keys()))
print(f"{changed} file(s) re-encoded without metadata")
