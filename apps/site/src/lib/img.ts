// Responsive image URLs. Sanity serves AVIF or WebP on request (auto=format) at any width; fixtures fall back to the original file.
import type { Photo } from "@lab/content";

export const WIDTHS = [480, 800, 1200, 1600];

export function imgUrl(file: string, width: number, quality = 72): string {
  if (file.startsWith("http")) return `${file}?w=${width}&auto=format&q=${quality}`;
  return `/photos/${file}`;
}

export function srcset(file: string): string {
  if (!file.startsWith("http")) return "";
  return WIDTHS.map((w) => `${imgUrl(file, w)} ${w}w`).join(", ");
}

export function posterUrl(poster: string, photos: Photo[], width = 800): string {
  if (poster.startsWith("http")) return imgUrl(poster, width);
  const p = photos.find((x) => x.id === poster);
  return p ? imgUrl(p.file, width) : "";
}

/** The share-preview image: 1200 by 630 (the size link previews use), cropped, as a JPEG, so a messaging app is not handed a 2 MB PNG. */
export function ogUrl(file: string): string {
  if (file.startsWith("http")) return `${file}?w=1200&h=630&fit=crop&fm=jpg&q=72`;
  return `/photos/${file}`;
}
