import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeConfigOverrides } from "../helpers.js";

const EXA_KEY = "recherche-verhalten-exa-key";
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 503;
const KURZE_FRIST_MS = 30;
const LANGE_FRIST_MS = 5000;

let anfragen = [];
let antwort = { status: HTTP_OK, body: "{}" };
const haengende = [];

const bodyOf = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => resolve(raw));
  });

const exa = http.createServer(async (req, res) => {
  const raw = await bodyOf(req);
  anfragen.push({ method: req.method, url: req.url, headers: req.headers, raw });
  if (antwort.haengt) {
    haengende.push(res);
    return;
  }
  res.writeHead(antwort.status, { "content-type": "application/json" });
  res.end(antwort.body);
});
await new Promise((resolve) => exa.listen(0, "127.0.0.1", resolve));
process.env.EXA_API_BASE = `http://127.0.0.1:${exa.address().port}/`;

after(async () => {
  for (const res of haengende) res.destroy();
  exa.closeAllConnections();
  await new Promise((resolve) => exa.close(resolve));
});

const { config } = await import("../../src/config.js");
const { withConfig, withConfigOverrides } = makeConfigOverrides(config);
const registry = await import("../../src/research/registry.js");
const { LOOKUP_MAX_FACTS, LOOKUP_QUERY_MAX_CHARS, lookupFactsFrom, sanitizeLookupQuery } =
  await import("../../src/research/lookup-guard.js");
const { RESEARCH_EGRESS_FIELDS, researchEgressInput } =
  await import("../../src/research/sanitize.js");
const { KEY_FACTS_LIMITS } = await import("../../src/begriffe/anrufe.js");

const LOOKUP_AN = { lookupEnabled: true, exaApiKey: EXA_KEY };
const aktiverAusruf = (extra = {}) => ({
  id: "call_recherche",
  tenantId: "t1",
  direction: "outbound",
  status: "active",
  ...extra,
});
const profil = (allowLookup) => () => ({ allowLookup });

test("Sucheingabe: fuenf Ziffern am Stueck sind gesperrt, vier bleiben erlaubt", () => {
  assert.equal(sanitizeLookupQuery("Nummer 12345 pruefen"), null);
  assert.equal(sanitizeLookupQuery("Nummer 1234 pruefen"), "Nummer 1234 pruefen");
});

test("Sucheingabe: jedes Trennzeichen ueber die ganze Ziffernfolge wird durchschaut", () => {
  for (const geschrieben of [
    "1-2-3-4-5-6",
    "1/2/3/4/5/6",
    "(1)(2)(3)(4)(5)",
    "1.2.3.4.5.6",
    "1 2 3 4 5 6",
    "12 34 56",
  ]) {
    assert.equal(sanitizeLookupQuery(`Wert ${geschrieben}`), null, geschrieben);
  }
});

test("Sucheingabe: E-Mail-Form wird nur mit Text auf beiden Seiten des @ erkannt", () => {
  assert.equal(sanitizeLookupQuery("a@b"), null);
  assert.equal(sanitizeLookupQuery("Kontakt x@y.de bitte"), null);
  assert.equal(sanitizeLookupQuery("foo@"), "foo@");
  assert.equal(sanitizeLookupQuery("@bar"), "@bar");
  assert.equal(sanitizeLookupQuery("foo @ bar"), "foo @ bar");
});

test("Sucheingabe: die Zielnummer wird auch als kurze Ziffernfolge und ohne Gespraech erkannt", () => {
  const call = { to: "+49 30" };
  assert.equal(sanitizeLookupQuery("Vorwahl 4930 Berlin", call), null);
  assert.equal(sanitizeLookupQuery("Vorwahl 49 30 Berlin", call), null);
  assert.equal(sanitizeLookupQuery("Vorwahl 4931 Berlin", call), "Vorwahl 4931 Berlin");
  assert.equal(sanitizeLookupQuery("Hallo Welt", {}), "Hallo Welt");
  assert.equal(sanitizeLookupQuery("Hallo Welt", { to: "" }), "Hallo Welt");
  assert.equal(sanitizeLookupQuery("Hallo Welt"), "Hallo Welt");
  assert.equal(sanitizeLookupQuery("Hallo Welt", null), "Hallo Welt");
});

test("Sucheingabe: Leerraum wird zusammengezogen und die Laenge bleibt hoechstens 120", () => {
  assert.equal(LOOKUP_QUERY_MAX_CHARS, 120);
  assert.equal(sanitizeLookupQuery("  Zwei   Woerter\n\tmehr  "), "Zwei Woerter mehr");
  const genau = "a".repeat(LOOKUP_QUERY_MAX_CHARS);
  assert.equal(sanitizeLookupQuery(genau), genau);
  const drueber = `${"b".repeat(LOOKUP_QUERY_MAX_CHARS - 1)} cd`;
  assert.equal(sanitizeLookupQuery(drueber), "b".repeat(LOOKUP_QUERY_MAX_CHARS - 1));
  const mitWorten = `${"wort ".repeat(30)}ende`;
  const gekappt = sanitizeLookupQuery(mitWorten);
  assert.equal(gekappt, "wort ".repeat(24).trim());
});

test("Sucheingabe: eine woertliche Anrufer-Wortfolge ohne Anrufer-Zeile wird nicht verworfen", () => {
  const call = { transcript: [{ role: "agent", text: "eins zwei drei vier fuenf sechs" }] };
  assert.equal(
    sanitizeLookupQuery("eins zwei drei vier fuenf sechs", call),
    "eins zwei drei vier fuenf sechs",
  );
});

test("Fakten: Menge, Reihenfolge und Laenge", () => {
  assert.equal(LOOKUP_MAX_FACTS, 3);
  assert.deepEqual(lookupFactsFrom(["", "a", "  ", "b", 7, "c", "d"]), ["a", "b", "c"]);
  assert.deepEqual(lookupFactsFrom(["x\u0007y", "p​q", "m\r\n\tn"]), ["x y", "p q", "m n"]);
  const lang = lookupFactsFrom([`${"wort ".repeat(60)}ende`]);
  assert.equal(KEY_FACTS_LIMITS.maxLen, 200);
  assert.equal(lang[0], "wort ".repeat(40).trim());
  assert.equal(lookupFactsFrom(["a".repeat(200)])[0].length, 200);
  assert.deepEqual(lookupFactsFrom(["a", "b"]), ["a", "b"]);
  assert.deepEqual(lookupFactsFrom([]), []);
});

test("Weitergabe an die Vorab-Recherche: nur Ziel, Notizen und Auflagen, nur wenn vorhanden", () => {
  assert.deepEqual(RESEARCH_EGRESS_FIELDS, ["objective", "ownerNotes", "constraints"]);
  assert.deepEqual(
    researchEgressInput({
      objective: "Termin",
      ownerNotes: "",
      constraints: 0,
      to: "+4915112345678",
      transcript: ["geheim"],
    }),
    { objective: "Termin", ownerNotes: "", constraints: 0 },
  );
  assert.deepEqual(researchEgressInput({ objective: null, ownerNotes: undefined }), {});
  assert.deepEqual(researchEgressInput(undefined), {});
  assert.deepEqual(researchEgressInput(null), {});
  assert.deepEqual(researchEgressInput({ constraints: false }), { constraints: false });
});

test("Vorab-Recherche: nur mit Schalter UND Mandantenrecht, mit der Websuche als Zugang", async () => {
  await withConfig("researchEnabled", true, () => {
    assert.equal(registry.precallResearchProvider({ tenantAllows: false }), null);
    const provider = registry.precallResearchProvider({ tenantAllows: true });
    assert.deepEqual(provider.researchTools(), [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: config.research.researchMaxUses,
      },
    ]);
    assert.equal(config.research.researchMaxUses, 1);
    assert.equal(
      provider.searchCount({ usage: { server_tool_use: { web_search_requests: 3 } } }),
      3,
    );
    assert.equal(
      provider.searchCount({ usage: { server_tool_use: { web_search_requests: 0 } } }),
      0,
    );
    assert.equal(provider.searchCount({ usage: {} }), null);
    assert.equal(provider.searchCount({}), null);
    assert.equal(provider.searchCount(undefined), null);
  });
  await withConfig("researchEnabled", false, () => {
    assert.equal(registry.precallResearchProvider({ tenantAllows: true }), null);
  });
});

test("Suche im Gespraech: nur mit Schalter, Mandantenrecht und Schluessel", () => {
  withConfigOverrides(LOOKUP_AN, () => {
    assert.equal(registry.inCallSearchProvider({ tenantAllows: false }), null);
    assert.equal(
      typeof registry.inCallSearchProvider({ tenantAllows: true }).searchFacts,
      "function",
    );
  });
  withConfigOverrides({ ...LOOKUP_AN, lookupEnabled: false }, () => {
    assert.equal(registry.inCallSearchProvider({ tenantAllows: true }), null);
  });
  withConfigOverrides({ ...LOOKUP_AN, exaApiKey: "" }, () => {
    assert.equal(registry.inCallSearchProvider({ tenantAllows: true }), null);
  });
});

test("ElevenLabs-Suche: nur fuer aktive ausgehende Anrufe mit Mandantenrecht", () => {
  withConfigOverrides(LOOKUP_AN, () => {
    const darf = profil(true);
    assert.notEqual(registry.elevenLabsLookupProviderFor(aktiverAusruf(), darf), null);
    assert.equal(registry.elevenLabsLookupProviderFor(aktiverAusruf(), profil(false)), null);
    assert.equal(
      registry.elevenLabsLookupProviderFor(aktiverAusruf(), () => null),
      null,
    );
    assert.equal(
      registry.elevenLabsLookupProviderFor(aktiverAusruf({ direction: "inbound" }), darf),
      null,
    );
    assert.equal(
      registry.elevenLabsLookupProviderFor(aktiverAusruf({ status: "completed" }), darf),
      null,
    );
    assert.equal(registry.elevenLabsLookupProviderFor(undefined, darf), null);
  });
});

test("ElevenLabs-Suche: hoechstens zwei Abfragen je Anruf", () => {
  assert.equal(registry.LOOKUP_MAX_PER_CALL, 2);
  withConfigOverrides(LOOKUP_AN, () => {
    const darf = profil(true);
    const mitLog = (n) => aktiverAusruf({ lookupLog: new Array(n).fill({}) });
    assert.equal(registry.elevenLabsLookupAvailableFor(aktiverAusruf(), darf), true);
    assert.equal(registry.elevenLabsLookupAvailableFor(mitLog(1), darf), true);
    assert.equal(registry.elevenLabsLookupAvailableFor(mitLog(2), darf), false);
    assert.equal(registry.elevenLabsLookupAvailableFor(mitLog(3), darf), false);
    assert.equal(registry.elevenLabsLookupAvailableFor(mitLog(0), profil(false)), false);
  });
});

const exaSuche = (query, timeoutMs = LANGE_FRIST_MS) =>
  withConfigOverrides(LOOKUP_AN, () =>
    registry.inCallSearchProvider({ tenantAllows: true }).searchFacts({ query, timeoutMs }),
  );

test("Exa: die Anfrage geht als POST mit Schluessel und Suchauftrag an /search", async () => {
  anfragen = [];
  antwort = { status: HTTP_OK, body: JSON.stringify({ results: [] }) };
  await exaSuche("Oeffnungszeiten Baumarkt");
  assert.equal(anfragen.length, 1);
  const [a] = anfragen;
  assert.equal(a.method, "POST");
  assert.equal(a.url, "/search");
  assert.equal(a.headers["x-api-key"], EXA_KEY);
  assert.equal(a.headers["content-type"], "application/json");
  assert.equal(a.headers.accept, "application/json");
  assert.deepEqual(JSON.parse(a.raw), {
    query: "Oeffnungszeiten Baumarkt",
    type: "auto",
    numResults: LOOKUP_MAX_FACTS,
    contents: { highlights: true },
  });
});

test("Exa: Fakten aus Titel und erstem Treffertext, Leeres faellt weg", async () => {
  antwort = {
    status: HTTP_OK,
    body: JSON.stringify({
      results: [
        { title: "Titel A", highlights: ["Text A", "Text A2"] },
        { title: "Nur Titel" },
        { highlights: ["Nur Text"] },
        { title: "", highlights: [] },
        null,
        {},
      ],
    }),
  };
  assert.deepEqual(await exaSuche("x"), {
    ok: true,
    facts: ["Titel A: Text A", "Nur Titel", "Nur Text"],
  });
  antwort = { status: HTTP_OK, body: JSON.stringify({}) };
  assert.deepEqual(await exaSuche("x"), { ok: true, facts: [] });
  antwort = { status: HTTP_OK, body: "null" };
  assert.deepEqual(await exaSuche("x"), { ok: true, facts: [] });
});

test("Exa: Fehler werden als Grund gemeldet statt geworfen", async () => {
  antwort = { status: HTTP_SERVER_ERROR, body: "{}" };
  assert.deepEqual(await exaSuche("x"), { ok: false, reason: "http_503" });
  antwort = { status: HTTP_OK, body: "kein json" };
  assert.deepEqual(await exaSuche("x"), { ok: false, reason: "error" });
  antwort = { haengt: true };
  assert.deepEqual(await exaSuche("x", KURZE_FRIST_MS), { ok: false, reason: "timeout" });
});
