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
