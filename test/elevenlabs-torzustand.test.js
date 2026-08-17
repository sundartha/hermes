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
// durch das echte consultAllowedFor (Master-Schalter, Kontext-Kanal, Per-Tenant-Recht).
// Eine Attrappe, die "available" zurueckgibt, wuerde sich selbst pruefen.
//
// REIHENFOLGE BINDEND: die beiden Schalter stehen VOR dem Import - src/config.js liest
// process.env beim Laden. Wer sie danach setzt, misst den Default und merkt es nicht.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pinStore, sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

process.env.CONSULT_ENABLED = "true";
process.env.ASSISTANT_CONTEXT_ENABLED = "true";
const { makeElevenLabsOutbound } = await import("../src/elevenlabs/outbound.js");
const { consultAllowedFor } = await import("../src/consult/gate.js");

const VARIABLE = "consult_available";
const OFFEN = "available";
const ZU = "unavailable";

const torzustandBei = async (profil) => {
  const variablen = await sendeAnrufstart({
    makeElevenLabsOutbound,
    consultAllowedFor,
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
  // dynamicVariables, sondern am Tor selbst. consultAllowedFor liefert einen STRIKTEN
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
      consultAllowedFor,
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
  it("ohne consultAllowedFor -> unavailable, obwohl das Profil das Recht traegt", async () => {
    const variablen = await sendeAnrufstart({
      makeElevenLabsOutbound,
      consultAllowedFor: undefined,
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
