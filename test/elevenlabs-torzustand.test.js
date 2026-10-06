import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pinCall, pinStore, sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
process.env.LOOKUP_ENABLED = "true";
process.env.EXA_API_KEY = "exa-test-key-torzustand";
const { makeElevenLabsOutbound } = await import("../src/elevenlabs/outbound.js");
const { consultAllowedForCall } = await import("../src/consult/gate.js");
const { elevenLabsLookupAvailableFor } = await import("../src/research/registry.js");
const { openingLineHash } = await import("../src/store/state-ops.js");
const { LOCALES } = await import("../src/i18n/locales.js");

const VARIABLE = "consult_available";
const OFFEN = "available";
const ZU = "unavailable";

const torzustandBei = async (profil) => {
  const variablen = await sendeAnrufstart({
    makeElevenLabsOutbound,
    consultAllowedForCall,
    store: pinStore({ profil }),
  });
  return variablen[VARIABLE];
};

describe("Torzustand des Rueckfragekanals: der Wert folgt der Torkette", () => {
  it("Per-Tenant-Recht gesetzt und beide Schalter an -> available", async () => {
    assert.equal(await torzustandBei({ allowConsult: true }), OFFEN);
  });

  it("Per-Tenant-Recht NICHT gesetzt -> unavailable", async () => {
    assert.equal(await torzustandBei({ allowConsult: false }), ZU);
  });
});

describe("Torzustand: der Standard ist fail-closed - 'unbekannt' sieht aus wie 'nicht verfuegbar'", () => {
  const UNBEKANNT = [
    { name: "gar kein Profil (null)", profil: null },
    { name: "Profil ohne das Recht", profil: {} },
    { name: "Recht als Zeichenkette statt Wahrheitswert", profil: { allowConsult: "true" } },
    { name: "Recht als Zahl", profil: { allowConsult: 1 } },
  ];

  for (const fall of UNBEKANNT) {
    it(`${fall.name} -> unavailable`, async () => {
      assert.equal(await torzustandBei(fall.profil), ZU);
    });
  }

  it("die Variable ist IMMER gesetzt - auch im unbekannten Fall, und nie leer", async () => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedForCall,
      store: pinStore({ profil: null }),
    });
    assert.ok(
      Object.hasOwn(variablen, VARIABLE),
      `${VARIABLE} fehlt ganz - eine fehlende dynamische Variable hat am 14.08.2026 das ` +
        "Gespraech stumm abbrechen lassen (Close 1008)",
    );
    assert.equal(typeof variablen[VARIABLE], "string");
    assert.ok(variablen[VARIABLE].length > 0, "leerer Wert - der Prompt verzweigt ins Nichts");
  });

  it("Positiv-Kontrolle: der offene und der geschlossene Zustand sind verschiedene Werte", async () => {
    assert.notEqual(await torzustandBei({ allowConsult: true }), await torzustandBei(null));
  });
});

describe("Torzustand ohne verdrahtetes Tor: die Fabrik faellt auf 'nein'", () => {
  it("ohne consultAllowedForCall -> unavailable, obwohl das Profil das Recht traegt", async () => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedForCall: undefined,
      store: pinStore({ profil: { allowConsult: true } }),
    });
    assert.equal(variablen[VARIABLE], ZU);
  });

  it("Positiv-Kontrolle: mit Tor liefert derselbe Aufruf available", async () => {
    assert.equal(await torzustandBei({ allowConsult: true }), OFFEN);
  });
});

describe("Torzustand der Recherche: der Wert folgt der Torkette", () => {
  const LOOKUP_VARIABLE = "lookup_available";

  const lookupZustandBei = async ({ profil, call }) => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedForCall,
      lookupAvailableFor: elevenLabsLookupAvailableFor,
      store: pinStore({ profil }),
      call,
    });
    return variablen[LOOKUP_VARIABLE];
  };

  it("Per-Tenant-Recht allowLookup gesetzt -> available", async () => {
    assert.equal(await lookupZustandBei({ profil: { allowLookup: true } }), OFFEN);
  });

  it("Per-Tenant-Recht NICHT gesetzt -> unavailable (Auflage B4, Default AUS)", async () => {
    assert.equal(await lookupZustandBei({ profil: { allowConsult: true } }), ZU);
  });

  it("Deckel erreicht (lookupLog voll) -> unavailable trotz Recht", async () => {
    const call = pinCall();
    call.lookupLog = [
      { seq: 0, query: "a", askedAt: "2026-08-19T00:00:00Z" },
      { seq: 1, query: "b", askedAt: "2026-08-19T00:00:10Z" },
    ];
    assert.equal(await lookupZustandBei({ profil: { allowLookup: true }, call }), ZU);
  });

  it("ohne verdrahtetes Tor -> unavailable, obwohl das Profil das Recht traegt", async () => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedForCall,
      lookupAvailableFor: undefined,
      store: pinStore({ profil: { allowLookup: true } }),
    });
    assert.equal(variablen[LOOKUP_VARIABLE], ZU);
  });
});

describe("Wert von opening_line am Anrufstart", () => {
  const LINE = "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.";

  const openingLineBei = async (call) => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedForCall,
      store: pinStore({ profil: { allowConsult: true } }),
      call,
    });
    return variablen.opening_line;
  };

  it("festgelegte Zeile mit passendem Hash wird WOERTLICH gesendet (Umlaute ueberleben)", async () => {
    const call = pinCall();
    call.openingLine = LINE;
    call.openingLineSha256 = openingLineHash(LINE);
    assert.equal(await openingLineBei(call), LINE);
  });

  it("ROTPROBE A6: mutierte Zeile (Hash passt nicht) wird NIE gesendet - Rueckfall greift", async () => {
    const call = pinCall();
    call.openingLine = "Ich rufe an, um einen Termin zur Bremsenpruefung zu vereinbaren.";
    call.openingLineSha256 = openingLineHash(LINE);
    const gesendet = await openingLineBei(call);
    assert.notEqual(gesendet, call.openingLine);
    assert.equal(gesendet, `Es geht um Folgendes: Termin vereinbaren. ${LOCALES.de.openingQuestion}`);
  });

  it("Alt-Datensatz ohne Zeile -> deterministischer Rueckfall aus dem Auftrag, NIE roh unbegrenzt", async () => {
    assert.equal(
      await openingLineBei(pinCall()),
      `Es geht um Folgendes: Termin vereinbaren. ${LOCALES.de.openingQuestion}`,
    );
  });
});
