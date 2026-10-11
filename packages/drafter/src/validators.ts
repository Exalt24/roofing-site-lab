// Deterministic checks in code. The model's own citations are pointers, never proof: every one of these is re-derived from the entered facts.
import { similarity } from "@lab/content";
import { buildFacts, missingSlots } from "./facts.ts";
import { shapeErrors } from "./schema.ts";
import type { Context, Draft, Fact, Intake, Report, SectionKey } from "./types.ts";

const SECTION_FACT_LABEL: Record<SectionKey, string> = { existingConditions: "what the roof was like before", challenges: "what was hard", solution: "what was installed", outcome: "the result" };
const SECTION_INTAKE: Record<SectionKey, keyof Intake> = { existingConditions: "existingConditions", challenges: "whatWasHard", solution: "whatWeDid", outcome: "outcome" };

export const BANNED = /\b(guarantee[ds]?|guaranty|warrant(?:y|ies)|life ?time|best in|number one|cheapest|lowest price|unbeatable|free estimates?|financing|fully[- ]insured|licen[sc]ed|certified|award[- ]winning|years of experience|storm[- ]?proof|leak[- ]?proof|never leak|for life|forever|for decades|will stay dry)\b|#1/i;

/** Spelled-out numbers (digits are checked separately). "one" is left out because it is ordinary English ("no one", "one of the"). */
const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, thirteen: 13, fourteen: 14, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12 };
/** A North American phone number written any common way: 604-555-0142, (604) 555 0142, 604.555.0142, 6045550142, +1 604 555 0142. */
const PHONE_PATTERN = /(?<![\d])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/;
const STOP_CAPS = new Set(["this", "that", "these", "those", "the", "new", "old", "all", "each", "both", "same", "some", "every", "other", "another", "standing", "composite", "synthetic", "architectural", "dark", "light", "grey", "gray", "black", "white", "charcoal"]);
const BRAND_BEFORE_MATERIAL = /\b([A-Z][a-z]{3,})\s+(?:[Ss]hingles?|[Ss]hakes?|[Pp]anels?|[Mm]embranes?|[Tt]iles?|[Mm]etal|[Ss]late|[Dd]ecking)\b/g;
export const MATERIAL_LEXICON = ["standing seam", "standing-seam", "cedar", "shake", "shingle", "asphalt", "slate", "composite", "synthetic", "tpo", "epdm", "pvc", "torch-on", "bitumen", "membrane", "steel", "aluminium", "aluminum", "copper", "zinc", "clay", "tile", "metal", "solar panel", "fibreglass", "fiberglass", "rubber", "polymer", "vinyl", "gravel"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function hasWord(hay: string, needle: string): boolean {
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const before = hay[i - 1] ?? " ";
    const after = hay[i + needle.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

const numbersOf = (s: string): string[] => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, ""));
const lc = (s: string) => s.toLowerCase();

export function draftText(d: Draft): string {
  return [d.title, d.summary, ...d.sections.map((s) => s.body), d.seo.title, d.seo.description, ...d.photos.flatMap((p) => [p.alt, p.caption]), ...d.internalLinkSuggestions.flatMap((l) => [l.anchor, l.why])].join("\n");
}

/** Ordinary words that begin a sentence and are capitalised only for that reason. A sentence-initial word NOT in this list and not in the entered facts is treated as a possible invented name or brand. */
const SENTENCE_STARTERS = new Set(("the a an we our it its this that these those they their there then than after before during with without because since while although once when where which who what why how all each every some most many few several both either neither new old " +
  "roof roofs roofing shingle shingles metal cedar slate tile tiles flat sloped skylight skylights solar panel panels ridge eaves valley valleys flashing underlayment membrane vent vents deck decks house home homes owners owner crew crews job jobs work works project projects ice water leak leaks damage rain wind snow moss " +
  "installing installed replacing replaced repairing repaired removing removed adding added fixing fixed using used built building finished finishing completed completing started starting also still now today next last first second third one two three four five six seven eight nine ten into onto over under around across through between against along " +
  "instead rather however therefore thus so but and or nor yet if unless until whether as at by for from in of on to up down out off no not never always often sometimes only just even very much more less better best good great clean careful carefully every other another such same different easy hard tight narrow steep wet dry damp warm cold dark modern light bright strong solid durable quality premium natural traditional classic simple smooth heavy thick thin tall small large big long short high low full whole entire original existing previous proper secure safe fresh additional extra sealed standard typical local rotted rotten failed failing worn aging damaged cracked leaking loose missing broken bare open rough uneven stained mossy").split(/\s+/));
const HONORIFIC_NAME = /\b(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?\s+[A-Z][A-Za-z'’-]+/g;
const LINK_OR_MARKUP = /https?:\/\/\S+|\bwww\.\S+|\]\(|<\/?[a-z][^>]*>|\b[a-z0-9-]+\.(?:com|ca|net|org|io|example)\b/gi;

function properNames(text: string): string[] {
  const out = new Set<string>();
  for (const sentence of text.replace(/\b(Mr|Mrs|Ms|Dr|St|Ave|Rd)\./g, "$1").split(/(?<=[.!?])\s+|\n+/)) {
    const toks = sentence.split(/\s+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      const m = toks[i].replace(/[^A-Za-z'’-]/g, "");
      if (i === 0 && SENTENCE_STARTERS.has(m.toLowerCase())) continue;
      if (/^[A-Z][a-z]{2,}/.test(m)) {
        let name = m; let j = i + 1;
        while (j < toks.length && /^[A-Z][a-z]{2,}/.test(toks[j].replace(/[^A-Za-z'’-]/g, ""))) { name += " " + toks[j].replace(/[^A-Za-z'’-]/g, ""); j++; }
        out.add(name);
        i = j - 1;
      }
    }
    for (const a of sentence.match(/\b[A-Z]{2,6}\b/g) ?? []) out.add(a);
  }
  return [...out];
}

/** Compatibility-fold a string (fullwidth and Arabic-Indic digits, ligatures) and drop invisible format characters (zero-width space, soft hyphen). */
export const nfk = (s: string): string => s.normalize("NFKC").replace(/\p{Cf}/gu, "");
function normaliseStrings<T>(x: T): T {
  if (typeof x === "string") return nfk(x) as T;
  if (Array.isArray(x)) return x.map(normaliseStrings) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, normaliseStrings(v)])) as T;
  return x;
}

/** The customer details that must never appear in public text, split into the pieces a draft could repeat on their own. */
export function privateBits(intake: Intake): string[] {
  const pv = intake.private;
  // a name part of two letters counts (Li, Wu, Ng, Ho, Xu are ordinary surnames); the other details keep the three character floor
  const nameParts = pv.customerName.split(/\s+/).filter((x) => x.length >= 2);
  return [...nameParts, ...[...pv.streetAddress.split(/[,\s]+/).filter((x) => x.length > 3 || /\d/.test(x)), pv.email, ...(pv.phone.match(/\d{3,}/g) ?? [])].filter((x) => x.length >= 3)];
}

/** The free-text boxes an employee types into reach the model. A customer's name, phone, email or street address typed there would be sent out, so the intake is refused BEFORE any model call and the employee is told which box to fix. */
export function inputPrivacyProblems(intake: Intake): string[] {
  const boxes: [string, string | null | undefined][] = [
    ["existing conditions", intake.existingConditions], ["what was hard", intake.whatWasHard], ["what we did", intake.whatWeDid], ["outcome", intake.outcome], ["staff notes", intake.staffNotes],
    ["manufacturer", intake.manufacturer], ["colour", intake.colour], ["roof type", intake.roofType],
    ...intake.photos.map((p, i): [string, string | null | undefined] => [`caption of photo ${i + 1}`, p.staffCaption]),
    ...intake.photos.map((p, i): [string, string | null | undefined] => [`description of photo ${i + 1}`, p.visibleDescription]),
  ];
  const out: string[] = [];
  const bits = privateBits(intake);
  for (const [label, value] of boxes) {
    if (!value) continue;
    const nv = nfk(value); const t = nv.toLowerCase();
    for (const b of bits) if (hasWord(t, b.toLowerCase())) out.push(`"${b}" (a customer detail) is typed in the ${label} box`);
    if (PHONE_PATTERN.test(nv)) out.push(`a phone number is typed in the ${label} box`);
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(nv)) out.push(`an email address is typed in the ${label} box`);
    if (/\b\d{2,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Crescent|Cres|Lane|Court|Place|Way)\b/.test(nv)) out.push(`a street address is typed in the ${label} box`);
  }
  return out;
}

export function validateDraft(draft: unknown, intake: Intake, ctx: Context): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const shape = shapeErrors(draft);
  if (shape.length) return { ok: false, errors: shape, warnings };
  // look through lookalike characters and invisible ones (fullwidth digits, zero-width spaces, soft hyphens) before any check, or they walk a banned word or a number past every pattern
  const d = normaliseStrings(draft) as Draft;
  const facts = buildFacts(intake, ctx);
  const byId = new Map<string, Fact>(facts.map((f) => [f.id, f]));
  const entered = facts.filter((f) => f.kind === "entered");
  const enteredText = lc(entered.map((f) => f.value).join("\n") + "\n" + ctx.services.filter((s) => intake.serviceSlugs.includes(s.slug)).map((s) => s.name).join(" ") + " " + ctx.materials.filter((m) => intake.materialSlugs.includes(m.slug)).map((m) => m.name).join(" "));
  const text = draftText(d);
  // numbers the staff entered, WITHOUT the digits of the finish date (the "10" in 2026-10-05 must not make "10 days" look supported); the year itself is allowed
  const enteredNumbers = new Set<string>([...entered.filter((f) => f.label !== "completed on").flatMap((f) => numbersOf(f.value)), ...(intake.completedOn.match(/^\d{4}/) ?? [])]);
  const vocabOf = (s: string) => new Set(lc(s).split(/[^a-z0-9']+/).filter(Boolean));

  // 1. sections: only for slots the employee filled, each citing the matching entered field
  for (const key of Object.keys(SECTION_FACT_LABEL) as SectionKey[]) {
    const slot = intake[SECTION_INTAKE[key]];
    const filled = typeof slot === "string" && slot.trim().length > 0;
    const sec = d.sections.find((s) => s.key === key);
    if (!filled && sec) errors.push(`section "${key}" was written but the employee never entered that detail (invented content)`);
    if (filled && !sec) errors.push(`section "${key}" is missing although the employee entered it`);
    if (!sec) continue;
    if (!sec.supportedBy.length) errors.push(`section "${key}" cites no source fact`);
    for (const id of sec.supportedBy) if (!byId.has(id)) errors.push(`section "${key}" cites ${id}, which does not exist`);
    const cited = sec.supportedBy.map((id) => byId.get(id)).filter(Boolean) as Fact[];
    if (cited.length && cited.every((f) => f.kind === "visual")) errors.push(`section "${key}" rests only on what a vision model saw`);
    if (filled && !cited.some((f) => lc(f.label).includes(SECTION_FACT_LABEL[key]))) errors.push(`section "${key}" does not cite the employee's own "${SECTION_FACT_LABEL[key]}" entry`);
    // 2. numbers: each must come from an entered fact; cited facts preferred
    const citedNums = new Set(cited.filter((f) => f.kind === "entered").flatMap((f) => numbersOf(f.value)));
    const allNums = enteredNumbers;
    for (const n of numbersOf(sec.body)) {
      if (!allNums.has(n)) errors.push(`section "${key}" states the number ${n}, which appears in no entered fact`);
      else if (!citedNums.has(n)) warnings.push(`section "${key}" states ${n} but cites a different fact than the one that holds it`);
    }
  }

  // numbers anywhere else in public text
  for (const n of numbersOf([d.title, d.summary, d.seo.title, d.seo.description, ...d.photos.flatMap((p) => [p.alt, p.caption])].join(" "))) {
    if (!enteredNumbers.has(n)) errors.push(`the number ${n} appears in a title, summary, SEO text or photo text but in no entered fact`);
  }

  // spelled-out numbers ("a crew of thirty", "saved forty percent") are numbers too: each must appear as that word or as its digits in an entered fact
  const enteredWords = new Set(lc(entered.map((f) => f.value).join(" ")).split(/[^a-z]+/).filter(Boolean));
  const spelled = new Set<string>();
  // what a vision model saw in a photo ("two brick chimneys") may be repeated in that photo's alt text and caption, and only there
  const visualWords = new Set(lc(facts.filter((f) => f.kind === "visual").map((f) => f.value).join(" ")).split(/[^a-z]+/).filter(Boolean));
  const photoText = d.photos.flatMap((p) => [p.alt, p.caption]).join("\n");
  const nonPhotoText = photoText ? text.split(photoText).join(" ") : text;
  const flag = (t: string, known: Set<string>) => { for (const w of lc(t).split(/[^a-z]+/)) if (Object.hasOwn(NUMBER_WORDS, w) && !known.has(w) && !enteredNumbers.has(String(NUMBER_WORDS[w]))) spelled.add(w); };
  flag(nonPhotoText, enteredWords);
  flag(photoText, new Set([...enteredWords, ...visualWords]));
  for (const w of spelled) errors.push(`the number word "${w}" appears in the draft but in no entered fact`);

  // a brand-like capitalised word in front of a material noun ("Malarkey shingles"), anywhere, including the first word of a sentence and the headings
  for (const m of text.matchAll(BRAND_BEFORE_MATERIAL)) {
    const w = lc(m[1]);
    if (!enteredWords.has(w) && !vocabOf(enteredText).has(w) && !STOP_CAPS.has(w) && !SENTENCE_STARTERS.has(w)) errors.push(`the brand-like name "${m[1]}" in "${m[0]}" appears in the draft but nowhere in the entered facts`);
  }

  const keys = d.sections.map((s) => s.key);
  for (const k of new Set(keys.filter((x, i) => keys.indexOf(x) !== i))) errors.push(`section "${k}" appears more than once`);

  // 3. invented names and brands. Sentences are checked for proper nouns; Title Case headings (title, SEO title, link anchors) are not,
  // because Title Case makes every word look like a name. Headings get a brand-shape check and a vocabulary warning instead.
  const allowedNames = new Set([...MONTHS, ...ctx.neighbourhoods.map((n) => n.name), ...ctx.businessName.split(/\s+/), "West Vancouver", "North Vancouver", "Vancouver", "British", "Properties"].map(lc));
  const sentences = [d.summary, ...d.sections.map((s) => s.body), d.seo.description, ...d.photos.flatMap((p) => [p.alt, p.caption]), ...d.internalLinkSuggestions.map((l) => l.why)].join("\n");
  for (const name of properNames(sentences)) {
    const n = lc(name);
    if (allowedNames.has(n) || name.split(" ").every((w) => allowedNames.has(lc(w)))) continue;
    // every word of the name has to be a WHOLE word of the entered facts ("Kit" is not supported by "kitchen")
    if (!name.split(" ").every((w) => vocabOf(enteredText).has(lc(w)))) errors.push(`the name "${name}" appears in the draft but nowhere in the entered facts`);
  }
  for (const m of text.matchAll(HONORIFIC_NAME)) errors.push(`a person's name "${m[0]}" appears in the draft; public text names no individual`);
  for (const m of text.matchAll(LINK_OR_MARKUP)) errors.push(`public text carries a link or markup ("${m[0].slice(0, 40)}"); the draft may not add addresses or tags`);
  for (const m of text.matchAll(/\b([A-Z][a-z]{3,})(?:\s+[A-Z][a-z]+)*\s+(?:Systems|Mill|Ltd|Inc|Corp|Industries|Manufacturing|Supply|Co)\b/g)) {
    if (!enteredText.includes(lc(m[1]))) errors.push(`the brand-like name "${m[0]}" appears in the draft but nowhere in the entered facts`);
  }
  const vocab = new Set(lc(enteredText).split(/[^a-z0-9']+/).filter(Boolean));
  const stop = new Set("a an and the of in on at to for with from by new old roof roofs roofing replacement replaced repair repaired install installed installation job project fix fixed after before house home".split(" "));
  for (const heading of [d.title, d.seo.title]) for (const w of lc(heading).split(/[^a-z0-9']+/).filter((x) => x.length > 3)) if (!vocab.has(w) && !stop.has(w) && !allowedNames.has(w)) warnings.push(`the heading "${heading}" uses "${w}", which is in no entered fact`);

  // 4. invented materials
  const cedarFamily = /\b(cedar|shakes?|shingles?)\b/i.test(enteredText); // a cedar job is described as shakes or shingles interchangeably
  for (const term of MATERIAL_LEXICON) {
    if (cedarFamily && (term === "shake" || term === "shingle")) continue;
    if (new RegExp(`\\b${term.replace(/[-\s]/g, "[-\\s]?")}s?\\b`, "i").test(text) && !new RegExp(term.replace(/[-\s]/g, "[-\\s]?"), "i").test(enteredText)) errors.push(`the material "${term}" appears in the draft but not in the entered facts`);
  }

  // 5. claims
  const banned = text.match(BANNED);
  if (banned) errors.push(`banned claim in the draft: "${banned[0]}" (warranty, guarantee, superlative and licence claims need a person to write them)`);
  if (/ignore (all )?(previous|prior) instructions/i.test(text)) errors.push("the draft repeats an injected instruction");
  const canary = (intake.staffNotes ?? "").match(/CANARY-[A-Z0-9]+/);
  if (canary && text.includes(canary[0])) errors.push(`the draft contains ${canary[0]}, so it followed an instruction hidden in the staff notes`);

  // 6. private data
  for (const b of privateBits(intake)) if (hasWord(lc(text), lc(b))) errors.push("a private customer detail appears in public text");
  if (PHONE_PATTERN.test(text)) errors.push("a phone number appears in public text");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) errors.push("an email address appears in public text");
  if (/\b\d{2,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Crescent|Cres|Lane|Court|Place|Way)\b/.test(text)) errors.push("a street address appears in public text");

  // 7. lengths and SEO hygiene
  if (d.title.length < 10 || d.title.length > 110) errors.push(`title length ${d.title.length} is outside 10 to 110`);
  if (d.summary.length > 300) errors.push(`summary is ${d.summary.length} characters, the limit is 300`);
  if (d.seo.title.length < 20 || d.seo.title.length > 60) errors.push(`SEO title length ${d.seo.title.length} is outside 20 to 60`);
  if (d.seo.description.length < 70 || d.seo.description.length > 155) errors.push(`SEO description length ${d.seo.description.length} is outside 70 to 155`);

  // 8. photos
  const ids = new Set(intake.photos.map((p) => p.id));
  for (const p of d.photos) {
    if (!ids.has(p.photoId)) errors.push(`photo ${p.photoId} is not one of the uploaded photos`);
    if (p.alt.length < 12 || p.alt.length > 140) errors.push(`alt text for ${p.photoId} has length ${p.alt.length}, needs 12 to 140`);
    if (/^(image|photo|picture|photograph) of\b/i.test(p.alt)) errors.push(`alt text for ${p.photoId} starts with a filler phrase`);
    const w = lc(p.alt).split(/\W+/).filter((x) => x.length > 3);
    if (w.some((x) => w.filter((y) => y === x).length > 2)) errors.push(`alt text for ${p.photoId} repeats a word (keyword stuffing)`);
    if (p.caption.length > 120) errors.push(`caption for ${p.photoId} is longer than 120 characters`);
  }
  for (const id of ids) if (!d.photos.some((p) => p.photoId === id)) errors.push(`photo ${id} has no alt text in the draft`);

  // 9. missing information is declared, never papered over
  const declared = d.missingInformation.map(lc).join(" | ");
  for (const label of missingSlots(intake)) if (!declared.includes(lc(label).split(" ").slice(0, 2).join(" "))) errors.push(`"${label}" was not entered and is not listed under missingInformation`);

  // 10. links and relations
  const urls = new Set(ctx.pageUrls);
  for (const l of d.internalLinkSuggestions) if (!urls.has(l.targetUrl)) errors.push(`link suggestion points at ${l.targetUrl}, which is not a page on the site`);
  for (const s of d.relatedServiceSlugs) if (!ctx.services.some((x) => x.slug === s)) errors.push(`unknown service slug ${s}`);
  if (!ctx.neighbourhoods.some((n) => n.slug === d.relatedNeighbourhoodSlug)) errors.push(`unknown neighbourhood slug ${d.relatedNeighbourhoodSlug}`);
  else if (d.relatedNeighbourhoodSlug !== intake.neighbourhoodSlug) errors.push("the draft relates the job to a different neighbourhood than the employee entered");

  // 11. near-duplicate of existing pages (doorway and scaled-content risk)
  const narrative = [d.title, d.summary, ...d.sections.map((s) => s.body)].join(" ");
  for (const ex of ctx.existingNarratives) {
    const s = similarity(narrative, ex.text);
    if (s > 0.35) errors.push(`${(s * 100).toFixed(0)}% the same as the existing page ${ex.id}`);
    else if (s > 0.2) warnings.push(`${(s * 100).toFixed(0)}% similar to the existing page ${ex.id}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}
