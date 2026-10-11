// Word-shingle Jaccard similarity. Used for two gates: near-duplicate pages (doorway risk) and the neighbourhood "swap test".

export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean);
}

export function shingles(text: string, k = 5): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  if (w.length < k) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i <= w.length - k; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function similarity(a: string, b: string, k = 5): number {
  return jaccard(shingles(a, k), shingles(b, k));
}

export function maskName(text: string, name: string): string {
  return text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "AREA");
}
