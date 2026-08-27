import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPresence,
  buildResearchPrompt,
  cleanHandle,
  cleanWebsite,
  emptyEvidence,
  normalizeCandidates,
  rankByOpportunity,
  readSiteEvidence,
  type ResearchedBusiness,
} from "../lib/extensions/research";

const now = new Date(2026, 7, 27);

test("the prompt names the towns and forbids invention", () => {
  const prompt = buildResearchPrompt({
    towns: ["Bangor", "Orono"],
    category: "cafes",
    criteria: "owner-operated",
  });
  assert.match(prompt, /Bangor, Orono/);
  assert.match(prompt, /cafes/);
  assert.match(prompt, /owner-operated/);
  assert.match(prompt, /Never invent a business/);
  assert.match(prompt, /empty string for website rather than guessing/);
});

test("already-shortlisted places are excluded from a rerun", () => {
  const prompt = buildResearchPrompt(
    { towns: ["Bangor"], category: "", criteria: "" },
    ["Nocturnem (Bangor)"],
  );
  assert.match(prompt, /Skip these[\s\S]*Nocturnem \(Bangor\)/);
});

test("only http(s) websites survive cleaning", () => {
  assert.equal(cleanWebsite("example.com"), "https://example.com/");
  assert.equal(cleanWebsite("http://example.com/x"), "http://example.com/x");
  assert.equal(cleanWebsite("javascript:alert(1)"), "");
  assert.equal(cleanWebsite("file:///etc/passwd"), "");
  assert.equal(cleanWebsite("not a url"), "");
  assert.equal(cleanWebsite("localhost"), "");
  assert.equal(cleanWebsite(42), "");
});

test("candidates are normalized, deduplicated, and capped", () => {
  const parsed = normalizeCandidates({
    businesses: [
      { name: "  The Cafe  ", town: "Bangor", website: "thecafe.com", instagram: "@thecafe" },
      { name: "The Cafe", town: "Bangor", website: "thecafe.com" },
      { name: "", town: "Bangor" },
      "not an object",
      ...Array.from({ length: 15 }, (_, index) => ({
        name: `Place ${index}`,
        town: "Orono",
      })),
    ],
  });
  assert.equal(parsed.length, 10);
  assert.equal(parsed[0].name, "The Cafe");
  assert.equal(parsed[0].instagram, "thecafe");
  assert.equal(parsed[0].website, "https://thecafe.com/");
});

test("a payload without a businesses array yields nothing", () => {
  assert.deepEqual(normalizeCandidates({ text: "I could not find any" }), []);
  assert.deepEqual(normalizeCandidates(null), []);
});

test("a modern site reads as solid", () => {
  const evidence = readSiteEvidence(
    `<html><head><title>Nocturnem</title><meta name="viewport" content="width=device-width">
     </head><body><a href="tel:+12075550000">Call</a><p>&copy; 2026</p></body></html>`,
    "https://example.com/",
    now,
  );
  assert.equal(evidence.mobileReady, true);
  assert.equal(evidence.https, true);
  assert.equal(evidence.hasContactLink, true);
  assert.equal(evidence.staleYear, null);
  assert.equal(evidence.title, "Nocturnem");
  const presence = assessPresence({ website: "https://example.com/" }, evidence);
  assert.equal(presence.verdict, "solid");
  assert.equal(presence.gapScore, 0);
});

test("a dated site accumulates specific, checkable reasons", () => {
  const evidence = readSiteEvidence(
    "<html><head><title>Old Shop</title></head><body>Copyright 2018</body></html>",
    "http://example.com/",
    now,
  );
  const presence = assessPresence({ website: "http://example.com/" }, evidence);
  assert.equal(presence.verdict, "needs-work");
  assert.equal(presence.gapScore, 80);
  assert.match(presence.reasons.join(" "), /mobile viewport/);
  assert.match(presence.reasons.join(" "), /No HTTPS/);
  assert.match(presence.reasons.join(" "), /2018/);
});

test("a recent copyright year is not called stale", () => {
  const evidence = readSiteEvidence("<body>&copy; 2025</body>", "https://x.com/", now);
  assert.equal(evidence.staleYear, null);
});

test("site builders are identified", () => {
  const evidence = readSiteEvidence(
    '<html><head><meta name="generator" content="Squarespace"><meta name="viewport" content="w"></head><body><a href="mailto:a@b.co">x</a></body></html>',
    "https://x.com/",
    now,
  );
  assert.equal(evidence.builder, "Squarespace");
});

test("no website found is reported as unknown, not as certain absence", () => {
  // Regression: a live run reported a real business as having no website when
  // the search had simply missed it. Not finding a site is not proof there
  // isn't one, and it must not outrank a verified problem.
  const presence = assessPresence({ website: "" }, { ...emptyEvidence, checked: true });
  assert.equal(presence.verdict, "unknown");
  assert.ok(presence.gapScore < 85);
  assert.match(presence.reasons[0], /confirm before assuming/);
});

test("a site that blocks bots is not called broken", () => {
  // Regression: a 403 from a bot-blocking site was reported as "did not
  // respond", implying the business's site was down when it was fine.
  const presence = assessPresence(
    { website: "https://example.com/" },
    { ...emptyEvidence, checked: true, reachable: false, blocked: true },
  );
  assert.equal(presence.verdict, "blocked");
  assert.equal(presence.gapScore, 0);
  assert.match(presence.reasons[0], /refused the automated check/);
});

test("a genuinely dead site is still reported as unreachable", () => {
  const presence = assessPresence(
    { website: "https://example.com/" },
    { ...emptyEvidence, checked: true, reachable: false },
  );
  assert.equal(presence.verdict, "unreachable");
  assert.equal(presence.gapScore, 85);
});

test("a verified problem outranks an unverified maybe", () => {
  const dead = assessPresence(
    { website: "https://x.com/" },
    { ...emptyEvidence, checked: true, reachable: false },
  );
  const unknown = assessPresence({ website: "" }, { ...emptyEvidence, checked: true });
  assert.ok(dead.gapScore > unknown.gapScore);
});

test("an unchecked candidate is never scored as a gap", () => {
  // Guards against showing an opportunity badge before verification has run.
  const presence = assessPresence({ website: "https://example.com/" }, emptyEvidence);
  assert.equal(presence.gapScore, 0);
  assert.match(presence.reasons[0], /Not checked/);
});

test("ranking puts the biggest opportunity first", () => {
  const build = (name: string, gapScore: number) =>
    ({
      id: name,
      name,
      category: "",
      town: "",
      website: "",
      instagram: "",
      facebook: "",
      note: "",
      evidence: emptyEvidence,
      presence: { gapScore, reasons: [], verdict: "solid" },
    }) as ResearchedBusiness;
  assert.deepEqual(
    rankByOpportunity([build("A", 10), build("B", 90), build("C", 50)]).map(
      (item) => item.name,
    ),
    ["B", "C", "A"],
  );
});

test("social handles are reduced to a bare handle however they arrive", () => {
  // A live run returned full profile URLs where handles were expected, which
  // rendered as "@https://www.instagram.com/name/" and produced a dead link.
  assert.equal(cleanHandle("https://www.instagram.com/oronobrewingcompany/", "instagram\\.com"), "oronobrewingcompany");
  assert.equal(cleanHandle("@thecafe", "instagram\\.com"), "thecafe");
  assert.equal(cleanHandle("thecafe", "instagram\\.com"), "thecafe");
  assert.equal(cleanHandle("instagram.com/place?hl=en", "instagram\\.com"), "place");
  assert.equal(cleanHandle("", "instagram\\.com"), "");
  assert.equal(cleanHandle("not a handle at all", "instagram\\.com"), "");
});

test("normalized candidates expose linkable handles", () => {
  const [business] = normalizeCandidates({
    businesses: [
      {
        name: "Orono Brewing",
        town: "Orono",
        instagram: "https://www.instagram.com/oronobrewingcompany/",
        facebook: "https://www.facebook.com/oronobrewing",
      },
    ],
  });
  assert.equal(business.instagram, "oronobrewingcompany");
  assert.equal(business.facebook, "oronobrewing");
});
