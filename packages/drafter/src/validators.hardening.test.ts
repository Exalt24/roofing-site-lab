// Gaps an adversarial review found by writing drafts the validators let through. Each case below must now fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDraft, inputPrivacyProblems, type Draft, type Intake } from "./index.ts";
import { goodDraft, goodIntake, sampleContext } from "./fixtures.ts";

const ctx = sampleContext();
const clone = <T>(x: T): T => structuredClone(x);
const run = (d: Draft, i: Intake = goodIntake) => validateDraft(d, i, ctx);

const cases: [string, (d: Draft) => void, RegExp][] = [
  ["an invented brand at the START of a sentence", (d) => { d.sections[2].body = "Malarkey shingles were installed over new underlayment. " + d.sections[2].body; }, /brand-like name "Malarkey"/],
  ["an invented brand in the title", (d) => { d.title = "Malarkey Shingle Reroof With A Ventilated Ridge In Dundarave"; }, /brand-like name "Malarkey"/],
  ["a spelled-out invented number", (d) => { d.sections[3].body += " A crew of thirty finished it."; }, /number word "thirty"/],
  ["a spelled-out percentage", (d) => { d.summary = d.summary.slice(0, 200) + " It saved the owners forty percent."; }, /number word "forty"/],
  ["a duplicated section key carrying invented numbers", (d) => { d.sections.push({ key: "outcome", body: "It cost 48,000 dollars and lasts 40 years.", supportedBy: d.sections[3].supportedBy }); }, /appears more than once/],
  ["a day count that only the finish date supports", (d) => { d.sections[2].body += " The crew was on site for 10 days."; }, /number 10/],
  ["rubber, which was never entered", (d) => { d.sections[2].body += " We laid a rubber underlayment."; }, /material "rubber"/],
  ["a claim that something lasts for life", (d) => { d.sections[3].body += " The roof is dry for life."; }, /banned claim/],
  ["a phone number written with brackets", (d) => { d.sections[3].body += " Call (604) 555 0123 to book."; }, /phone number appears/],
];
for (const [name, mutate, expected] of cases) {
  test(`MUTANT: ${name} is caught`, () => {
    const d = clone(goodDraft);
    mutate(d);
    const r = run(d);
    assert.equal(r.ok, false, "the validator let it through");
    assert.match(r.errors.join(" | "), expected);
  });
}

test("the correct draft still passes after the stricter checks (no false alarm on ordinary words)", () => {
  assert.deepEqual(run(clone(goodDraft)).errors, []);
});

test("MUTANT: invisible and lookalike characters do not walk a banned word, a number or a phone number past the checks", () => {
  const withText = (t: string) => { const d = clone(goodDraft); d.sections[2].body += " " + t; return run(d).errors.join(" | "); };
  assert.notEqual(withText("We offer a lifetime guar​antee on the work."), "", "zero-width space inside a banned word");
  assert.notEqual(withText("That is a war­ranty on the work."), "", "soft hyphen inside a banned word");
  assert.notEqual(withText("Customers save ２５ percent."), "", "fullwidth digits");
  const i = clone(goodIntake); i.private.customerName = "Marguerite Tallow"; i.staffNotes = "Marguerite called";
  assert.match(inputPrivacyProblems(i).join(" | "), /customer detail/);
  const j = clone(goodIntake); j.staffNotes = "call ６０４-５５５-０１８８ tomorrow";
  assert.match(inputPrivacyProblems(j).join(" | "), /phone number/, "a fullwidth phone number");
});

test("MUTANT: a two-letter surname typed in the notes refuses the intake, and a draft repeating it fails", () => {
  const i = clone(goodIntake); i.private.customerName = "Li Wu"; i.staffNotes = "Li Wu called twice about the leak. Wu is the owner.";
  assert.match(inputPrivacyProblems(i).join(" | "), /"Wu" \(a customer detail\)/);
  const d = clone(goodDraft); d.sections[0].body += " Li Wu was thrilled with the result.";
  assert.match(run(d, i).errors.join(" | "), /a private customer detail appears/);
});

test("MUTANT: the intake screen reaches the colour, manufacturer, roof type and photo description boxes, and brackets-and-spaces phone numbers", () => {
  const withColour = clone(goodIntake); withColour.colour = "Marguerite Tallow green";
  assert.match(inputPrivacyProblems(withColour).join(" | "), /colour box/);
  const withMaker = clone(goodIntake); withMaker.manufacturer = "send to marguerite.tallow@example.com";
  assert.match(inputPrivacyProblems(withMaker).join(" | "), /manufacturer box/);
  const withRoof = clone(goodIntake); withRoof.roofType = "asphalt, owner email marguerite.tallow@example.com";
  assert.match(inputPrivacyProblems(withRoof).join(" | "), /roof type box/);
  const withVision = clone(goodIntake); withVision.photos[0].visibleDescription = "house at 4471 Birchwood Crescent";
  assert.match(inputPrivacyProblems(withVision).join(" | "), /description of photo 1 box/);
  const withBrackets = clone(goodIntake); withBrackets.staffNotes = "ring (604) 555 0123 after five";
  assert.match(inputPrivacyProblems(withBrackets).join(" | "), /phone number is typed in the staff notes box/);
  assert.deepEqual(inputPrivacyProblems(clone(goodIntake)), [], "and a clean intake is not flagged");
});

test("a number word the vision model saw may appear in that photo's alt text, but not in the story", () => {
  const i = clone(goodIntake); i.photos[0].visibleDescription = "A sloped roof with seven brick chimneys.";
  const ok = clone(goodDraft); ok.photos[0].alt = "A sloped roof with seven brick chimneys and new shingles";
  assert.equal(run(ok, i).errors.some((e) => /number word/.test(e)), false);
  const bad = clone(goodDraft); bad.sections[2].body += " There are seven brick chimneys.";
  assert.match(run(bad, i).errors.join(" | "), /number word "seven"/);
});

// Gaps the second review found: each draft below was accepted before.
const accepted: [string, (d: Draft) => void, RegExp][] = [
  ["a metal roof on an asphalt job (service names no longer count as entered facts)", (d) => { d.sections[2].body += " We also installed a metal roof section over the porch."; }, /material "metal"/],
  ["cedar trim on an asphalt job", (d) => { d.sections[2].body += " The fascia was finished with cedar trim."; }, /material "cedar"/],
  ["a TPO cap on an asphalt job", (d) => { d.sections[2].body += " A TPO cap covers the low section."; }, /material "tpo"/],
  ["an invented brand that opens a sentence", (d) => { d.sections[2].body = "Mapleridge supplied everything. " + d.sections[2].body; }, /name "Mapleridge"/],
  ["an invented person that opens a sentence", (d) => { d.sections[3].body += " Dave was thrilled with the result."; }, /name "Dave"/],
  ["a person named with an honorific", (d) => { d.sections[3].body += " We spoke with Mr. Patel about it."; }, /person's name/],
  ["a web address", (d) => { d.sections[3].body += " See www.cheap-roofs-now.example for more."; }, /link or markup/],
  ["a markdown link", (d) => { d.sections[3].body += " [Get a quote](https://evil.example/quote)"; }, /link or markup/],
  ["an HTML tag", (d) => { d.sections[3].body += ' <a href="https://evil.example">here</a>'; }, /link or markup/],
  ["leakproof written without a space", (d) => { d.sections[3].body += " The new membrane is leakproof."; }, /banned claim/],
  ["a life time claim written with a space", (d) => { d.sections[3].body += " It carries a life time of protection."; }, /banned claim/],
  ["free estimates and financing", (d) => { d.sections[3].body += " Ask about free estimates and financing."; }, /banned claim/],
  ["a spelled number that is not in the fixture", (d) => { d.sections[3].body += " Thirteen crews were involved."; }, /number word "thirteen"/],
];
for (const [name, mutate, expected] of accepted) {
  test(`MUTANT: ${name} is caught`, () => {
    const d = clone(goodDraft); mutate(d);
    const r = run(d);
    assert.equal(r.ok, false, "the validator let it through");
    assert.match(r.errors.join(" | "), expected);
  });
}

test("MUTANT: a spelled-out number is caught even when the draft has no photos at all", () => {
  const i = clone(goodIntake); i.photos = [];
  const d = clone(goodDraft); d.photos = []; d.sections[3].body += " A crew of thirty finished it.";
  assert.match(run(d, i).errors.join(" | "), /number word "thirty"/);
});

test("MUTANT: a name is supported only by a WHOLE word of the entered facts, not by a substring of another word", () => {
  const i = clone(goodIntake); i.whatWeDid = (i.whatWeDid ?? "") + " We also fitted the kitchen vent.";
  const d = clone(goodDraft); d.sections[3].body += " Kit supplied the vent.";
  assert.match(run(d, i).errors.join(" | "), /name "Kit"/);
});

test("MUTANT: malformed model output is a failed attempt to retry, not a crash", async () => {
  const { draftProject } = await import("./index.ts");
  const outs: unknown[] = [{ ...clone(goodDraft), photos: [null] }, { ...clone(goodDraft), missingInformation: [null] }, clone(goodDraft)];
  const r = await draftProject(goodIntake, ctx, { llm: async () => outs.shift() as never, model: "stub" });
  assert.equal(r.status, "ready_for_review");
  assert.equal(r.attempts, 3);
  assert.match(r.history[0].errors.join(" "), /photos\[0\]/);
});

test("the ordinary good draft and an ordinary capitalised sentence start still pass", () => {
  const d = clone(goodDraft); d.sections[3].body += " Modern shingles were laid over fresh underlayment. Dark flashing finishes the ridge.";
  const r = run(d);
  assert.equal(r.errors.some((e) => /name "(Modern|Dark)"/.test(e)), false, r.errors.join(" | "));
});
