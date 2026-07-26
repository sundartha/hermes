// P1 (S1-6): Unit-Test fuer resolveMaxDurationS (src/telephony/outbound-gates.js).
// Reine Funktion (raw, cfg) -> Sekunden, kein Netz/Store/Server (F.I.R.S.T.). Beweist
// den Positivitaets-/Endlichkeits-Guard: negative/0/NaN/leere Body-Werte fallen NIE
// bis zu einer negativen Reserve durch (vorheriger `x || DEFAULT`-Trap liess negative
// Zahlen als "truthy" passieren), und der Cap greift auch bei einem riesigen Body-Wert.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeOutboundGates,
  resolveMaxDurationS,
  tariffCentsPerMin,
} from "../src/telephony/outbound-gates.js";
import { config } from "../src/config.js";
import { MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const CFG = withConfigNamespaces({ maxCallDurationS: 180 });
const DEFAULT_S = 180; // == CFG.safety.maxCallDurationS in diesem Setup (kein config-Fallback-Fall)
const CAP_S = MAX_CALL_DURATION_CAP_S;

test("resolveMaxDurationS: negativer/0/NaN/leerer/fehlender Body-Wert faellt auf den config-Default", () => {
  assert.equal(resolveMaxDurationS(-300, CFG), DEFAULT_S, "negativ -> nie truthy-durchgereicht");
  assert.equal(resolveMaxDurationS(0, CFG), DEFAULT_S, "0 -> Default");
  assert.equal(resolveMaxDurationS(NaN, CFG), DEFAULT_S, "NaN -> Default");
  assert.equal(resolveMaxDurationS(undefined, CFG), DEFAULT_S, "undefined -> Default");
  assert.equal(resolveMaxDurationS("", CFG), DEFAULT_S, "leerer String -> Default");
});

test("resolveMaxDurationS: gueltiger Body-Wert (String oder Zahl) gewinnt", () => {
  assert.equal(resolveMaxDurationS("250", CFG), 250, "numerischer String wird geparst");
  assert.equal(resolveMaxDurationS(250, CFG), 250, "Zahl direkt");
  assert.equal(resolveMaxDurationS(1, CFG), 1, "kleinster gueltiger Wert bleibt 1");
});

test("resolveMaxDurationS: MAX_CALL_DURATION_CAP_S deckelt jeden ueberlangen Wert", () => {
  assert.equal(resolveMaxDurationS(99999, CFG), CAP_S, "riesiger Body-Wert wird gekappt");
  assert.equal(resolveMaxDurationS(301, CFG), CAP_S, "ein Tick ueber dem Cap wird gekappt");
});

test("resolveMaxDurationS: ungueltiger Body UND ungueltiger config-Default -> DEFAULT_CALL_DURATION_S, nie NaN", () => {
  const result = resolveMaxDurationS(undefined, withConfigNamespaces({ maxCallDurationS: undefined }));
  assert.equal(result, DEFAULT_S, "harter Hard-Default greift, wenn beide Kandidaten ungueltig sind");
  assert.ok(Number.isFinite(result), "niemals NaN");
});

// ---- PAY-26: dieselbe Achse eine Ebene hoeher - im echten compute_reserve-Gate ----
// Oben steht resolveMaxDurationS als reine Funktion; hier laeuft der ECHTE Gate mit
// feindlichem Body. Der Angriff, den der S1-6-Wurzelfix abwehrt, zielt nicht auf die
// Funktion, sondern auf die RESERVE: eine negative Dauer haette eine negative Reserve
// ergeben - der Gate haette Geld "zurueckgegeben" statt zu reservieren.
const SECONDS_PER_MINUTE = 60;
const US_TARGET = "+15551234567"; // keine Inlands-Vorwahl -> Auslandssatz
const DE_OWN_DID = "+4930111222333"; // eigene DID mit Inlands-Vorwahl
const ABSURD_MAX_DURATION_S = 99999; // weit ueber jedem Cap
// Der Gate liest weder store noch die Gate-Kette davor - compute_reserve ist ein reines
// Derivations-Gate ueber ctx.b/ctx.to/ctx.fromNumber.
const computeReserveGate = makeOutboundGates({ store: {}, config }).gates.find(
  (g) => g.name === "compute_reserve",
);

async function reserveCentsFor(rawMaxDurationS) {
  const ctx = { b: { max_duration_s: rawMaxDurationS }, to: US_TARGET, fromNumber: DE_OWN_DID };
  await computeReserveGate.run(ctx);
  return ctx.reserveCents;
}

test("PAY-26: negatives/nicht-numerisches max_duration_s im Body kann die Reserve nicht senken", async () => {
  const baseline = await reserveCentsFor(undefined);
  assert.ok(baseline > 0, "Vorbedingung: der unmanipulierte Fall reserviert ueberhaupt etwas");
  for (const hostile of [-300, "abc", 0, NaN])
    assert.equal(await reserveCentsFor(hostile), baseline, `${hostile}: senkt die Reserve nicht`);
});

test("PAY-26: ein ueberhoehtes max_duration_s wird auf MAX_CALL_DURATION_CAP_S gedeckelt", async () => {
  const minutesAtCap = Math.ceil(MAX_CALL_DURATION_CAP_S / SECONDS_PER_MINUTE);
  const capped = await reserveCentsFor(ABSURD_MAX_DURATION_S);
  assert.equal(
    capped,
    tariffCentsPerMin(US_TARGET, DE_OWN_DID) * minutesAtCap,
    "die Reserve waechst hoechstens bis zum harten Dauer-Cap",
  );
  assert.ok(
    capped > (await reserveCentsFor(undefined)),
    "Vorbedingung: der Cap liegt ueber dem config-Default, sonst waere die Aussage leer",
  );
});
