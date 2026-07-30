// P1 (S1-6): Unit-Test fuer resolveMaxDurationS (src/telephony/outbound-gates.js).
// Reine Funktion (raw, brakeSeconds) -> Sekunden, kein Netz/Store/Server (F.I.R.S.T.).
// Beweist den Positivitaets-/Endlichkeits-Guard: negative/0/NaN/leere Body-Werte fallen
// NIE bis zu einer negativen Reserve durch (vorheriger `x || DEFAULT`-Trap liess negative
// Zahlen als "truthy" passieren), und die Frist wird auch bei einem riesigen Body-Wert
// gedeckelt.
//
// KS-P3 (b): der zweite Parameter ist seit dieser Phase die guthaben-abgeleitete
// NOTBREMSE dieses Legs, kein config-Objekt mehr - eine feste Maximaldauer
// (MAX_CALL_DURATION_S) gibt es nicht mehr (E2/E3). Damit entfaellt auch der frueher hier
// geprueste Fall "ungueltiger config-Default -> Hard-Default": beide Fallback-Stufen sind
// ersatzlos weg, es bleibt genau EINE Rueckfallgroesse.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeOutboundGates,
  resolveMaxDurationS,
  tariffCentsPerMin,
} from "../src/telephony/outbound-gates.js";
import { config } from "../src/config.js";
import { MAX_CALL_DURATION_CAP_S, outboundReserveCents } from "../src/store/defaults.js";

// Eine Notbremse, wie sie emergencyBrakeSeconds fuer 10 bezahlbare Minuten liefert.
const BRAKE_S = 660;

test("resolveMaxDurationS: negativer/0/NaN/leerer/fehlender Body-Wert faellt auf die Notbremse", () => {
  assert.equal(resolveMaxDurationS(-300, BRAKE_S), BRAKE_S, "negativ -> nie truthy-durchgereicht");
  assert.equal(resolveMaxDurationS(0, BRAKE_S), BRAKE_S, "0 -> Notbremse");
  assert.equal(resolveMaxDurationS(NaN, BRAKE_S), BRAKE_S, "NaN -> Notbremse");
  assert.equal(resolveMaxDurationS(undefined, BRAKE_S), BRAKE_S, "undefined -> Notbremse");
  assert.equal(resolveMaxDurationS("", BRAKE_S), BRAKE_S, "leerer String -> Notbremse");
  assert.equal(resolveMaxDurationS("abc", BRAKE_S), BRAKE_S, "nicht-numerisch -> Notbremse");
  assert.ok(Number.isFinite(resolveMaxDurationS(undefined, BRAKE_S)), "niemals NaN");
});

test("resolveMaxDurationS: ein gueltiger, KUERZERER Body-Wert (String oder Zahl) gewinnt", () => {
  assert.equal(resolveMaxDurationS("250", BRAKE_S), 250, "numerischer String wird geparst");
  assert.equal(resolveMaxDurationS(250, BRAKE_S), 250, "Zahl direkt");
  assert.equal(resolveMaxDurationS(1, BRAKE_S), 1, "kleinster gueltiger Wert bleibt 1");
});

test("KS-P3: der Body-Override kann die Frist NIE ueber die Notbremse hinaus verlaengern", () => {
  assert.equal(resolveMaxDurationS(99999, BRAKE_S), BRAKE_S, "riesiger Body-Wert wird gekappt");
  assert.equal(resolveMaxDurationS(BRAKE_S + 1, BRAKE_S), BRAKE_S, "ein Tick darueber wird gekappt");
  assert.equal(resolveMaxDurationS(BRAKE_S, BRAKE_S), BRAKE_S, "exakt die Notbremse bleibt");
});

// ---- PAY-26: dieselbe Achse eine Ebene hoeher - im echten compute_reserve-Gate ----
// Oben steht resolveMaxDurationS als reine Funktion; hier laeuft der ECHTE Gate mit
// feindlichem Body. Der Angriff, den der S1-6-Wurzelfix abwehrt, zielt nicht auf die
// Funktion, sondern auf die RESERVE: eine negative Dauer haette eine negative Reserve
// ergeben - der Gate haette Geld "zurueckgegeben" statt zu reservieren.
//
// KS-P3 (a): die Reserve haengt nicht mehr an der Dauer - der Deckelungs-Beweis wandert
// deshalb von der Reserve auf die FRIST (ctx.maxDur), wo er seit dieser Phase sitzt.
const US_TARGET = "+15551234567"; // keine Inlands-Vorwahl -> Auslandssatz
const DE_OWN_DID = "+4930111222333"; // eigene DID mit Inlands-Vorwahl
const ABSURD_MAX_DURATION_S = 99999; // weit ueber jedem Cap
const TENANT = "T";
// compute_reserve liest seit KS-P3 den Guthaben-Snapshot (Eingabe der Notbremse), sonst
// nur ctx.b/ctx.to/ctx.fromNumber - die Gate-Kette davor bleibt aussen vor. Reichlich
// Guthaben, damit die Notbremse auf der absoluten Obergrenze liegt: nur so ist die
// Cap-Aussage unten ueberhaupt pruefbar.
const storeFake = {
  tenantBudgetSnapshot: () => ({ capCents: 1_000_000, spentCents: 0, remainingCents: 1_000_000 }),
};
const computeReserveGate = makeOutboundGates({ store: storeFake, config }).gates.find(
  (g) => g.name === "compute_reserve",
);

async function gateCtxFor(rawMaxDurationS) {
  const ctx = {
    b: { max_duration_s: rawMaxDurationS },
    to: US_TARGET,
    fromNumber: DE_OWN_DID,
    tenantId: TENANT,
  };
  await computeReserveGate.run(ctx);
  return ctx;
}

test("PAY-26: negatives/nicht-numerisches max_duration_s im Body kann die Reserve nicht senken", async () => {
  const baseline = (await gateCtxFor(undefined)).reserveCents;
  assert.ok(baseline > 0, "Vorbedingung: der unmanipulierte Fall reserviert ueberhaupt etwas");
  for (const hostile of [-300, "abc", 0, NaN])
    assert.equal(
      (await gateCtxFor(hostile)).reserveCents,
      baseline,
      `${hostile}: senkt die Reserve nicht`,
    );
});

test("PAY-26: ein ueberhoehtes max_duration_s wird auf die Notbremse gedeckelt", async () => {
  const { maxDur, reserveCents } = await gateCtxFor(ABSURD_MAX_DURATION_S);
  assert.equal(
    maxDur,
    MAX_CALL_DURATION_CAP_S,
    "die Frist waechst hoechstens bis zur absoluten Obergrenze",
  );
  assert.ok(maxDur < ABSURD_MAX_DURATION_S, "Vorbedingung: der Body-Wunsch lag darueber");
  assert.equal(
    reserveCents,
    outboundReserveCents(tariffCentsPerMin(US_TARGET, DE_OWN_DID)),
    "und die Reserve bleibt davon unberuehrt (KS-P3 (a): Satz * Vorlauffenster)",
  );
});
