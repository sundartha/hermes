// ---- Der TORZUSTAND des Rueckfragekanals als dynamische Variable ---------------------
// Eigentuemer-Entscheidung 17.08.2026, Punkte 1 und 3, woertlich:
//   1. "Eine dynamische Variable traegt den Torzustand (ob der Rueckfragekanal fuer
//      DIESEN Anruf offen ist). Der Wert kommt aus derselben Torkette wie alles andere,
//      NICHT aus dem MCP-Aufruf."
//   3. "DIE VARIABLE IST IMMER GESETZT, mit definiertem Standard. [...] Der Standard
//      wirkt so, dass 'unbekannt' wie 'nicht verfuegbar' aussieht: fail-closed."
//
// WARUM DAS EIN EIGENER TEST IST und nicht im Variablen-Abgleich mitlaeuft: der Abgleich
// misst die NAMEN (ein fehlender Name bricht das Gespraech mit Code 1008 ab). Hier geht es
// um den WERT - und der falsche Wert bricht nichts ab, er laesst den Agenten eine
// Rueckfrage zusagen, die nie kommt. Woertlich vom Eigentuemer: "Ein Agent, der etwas
// zusagt und nicht liefert, beschaedigt genau das, worueber sich das Produkt verkauft.
// Das ist die teuerste Art von Fehler, die wir hier machen koennen."
//
// DIE TORKETTE WIRD NICHT NACHGEBAUT: die Attrappe liefert ein PROFIL, und der Wert laeuft
// durch das echte consultAllowedForCall (Master-Schalter, Kontext-Kanal, Per-Tenant-Recht).
// Eine Attrappe, die "available" zurueckgibt, wuerde sich selbst pruefen.
//
// REIHENFOLGE BINDEND: die beiden Schalter stehen VOR dem Import - src/config.js liest
// process.env beim Laden. Wer sie danach setzt, misst den Default und merkt es nicht.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pinCall, pinStore, sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
// Thema B: dieselbe Regel fuer das Recherche-Tor - Master-Schalter + Secret VOR dem
// Import, sonst misst die lookup_available-Suite unten nur den Default.
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
  // WO DIE ZUSAGE WIRKLICH HAENGT, gemessen und nicht vermutet: nicht am `=== true` in
  // dynamicVariables, sondern am Tor selbst. consultAllowedForCall liefert einen STRIKTEN
  // Wahrheitswert - jeder der Faelle unten kommt dort schon als false heraus. Beide
  // Rotproben am 2026-08-17 gefahren:
  //   `=== true` -> `!== false` in dynamicVariables : 0 rote Faelle (unerreichbar, solange
  //       das Tor strikt bleibt - die Schreibweise ist Doppelsicherung, kein Waechter)
  //   `=== true` -> `!== false` IM TOR                : 5 rote Faelle
  // Das Ergebnis der ersten Probe steht hier, statt sie als Waechter auszugeben: eine
  // Zusicherung, die auf einen unerreichbaren Zweig zeigt, ist keine.
  //
  // Jeder dieser Faelle ist ein Zustand, in dem NIEMAND je 'nein' gesagt hat. Genau darum
  // geht es: ein fehlender Wert darf nicht wie ein erlaubender wirken.
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

  // Positiv-Kontrolle: ohne sie bestuende ein Anrufstart, der IMMER "unavailable" sendet,
  // jeden Fall darueber. Die beiden Werte muessen unterscheidbar sein.
  it("Positiv-Kontrolle: der offene und der geschlossene Zustand sind verschiedene Werte", async () => {
    assert.notEqual(await torzustandBei({ allowConsult: true }), await torzustandBei(null));
  });
});

// ---- Der Standard OHNE verdrahtetes Tor ----------------------------------------------
// Ein eigener Fall, weil er eine andere Frage beantwortet als die Faelle oben: dort sagt
// das Tor nein, hier gibt es GAR KEINS. Beides muss "unavailable" ergeben - sonst haette
// eine vergessene Verdrahtung den Agenten eine Rueckfrage zusagen lassen, die kein
// Webhook je annimmt.
describe("Torzustand ohne verdrahtetes Tor: die Fabrik faellt auf 'nein'", () => {
  it("ohne consultAllowedForCall -> unavailable, obwohl das Profil das Recht traegt", async () => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedForCall: undefined,
      store: pinStore({ profil: { allowConsult: true } }),
    });
    assert.equal(variablen[VARIABLE], ZU);
  });

  // Positiv-Kontrolle: derselbe Aufruf MIT Tor liefert "available" - ohne sie koennte
  // der Fall darueber auch von einem Anrufstart bestanden werden, der nie "available"
  // sendet.
  it("Positiv-Kontrolle: mit Tor liefert derselbe Aufruf available", async () => {
    assert.equal(await torzustandBei({ allowConsult: true }), OFFEN);
  });
});

// ---- Thema B (2026-08-19): der Torzustand der RECHERCHE ({{lookup_available}}) --------
// Dieselbe Messanordnung wie oben, dieselbe Regel: der Wert laeuft durch die ECHTE
// Torkette (research/registry.js#elevenLabsLookupAvailableFor - Master-Schalter und
// Secret stehen als Env VOR dem Import, s. Kopf), die Attrappe liefert nur das Profil.
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

// ---- Thema A (2026-08-19): der WERT von {{opening_line}} am gesendeten Rumpf ----------
// Review-Befund R1: der Namens-Abgleich sieht nur, DASS opening_line reist - nicht, WAS.
// Diese Faelle messen den Wert am einzigen POST des Anrufstarts und fangen damit genau
// die Sabotage, die der Abgleich nicht sehen kann (z.B. rohes call.goal statt der
// festgelegten Zeile).
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
    call.openingLineSha256 = openingLineHash(LINE); // Hash der UNveraenderten Zeile
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
