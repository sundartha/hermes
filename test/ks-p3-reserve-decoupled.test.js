// KS-P3 (a): die Vorab-Reserve haengt NICHT mehr an der Gespraechsdauer. Sie deckt seit
// dieser Phase nur noch das feste Vorlauffenster bis zum ersten Griff des Live-Zaehlers
// (KS-P2) und die Gleichzeitigkeit mehrerer Legs desselben Tenants. Bestand faerbt die
// erste Aussage rot (dort war die Reserve Satz * angefangene Minuten der Maximaldauer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOutboundGates, tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { config } from "../src/config.js";
import {
  MAX_CALL_DURATION_CAP_S,
  RESERVE_LEAD_MINUTES,
  outboundReserveCents,
} from "../src/store/defaults.js";
import { planCapReserveFindings, spendCapCoherence } from "../src/boot-guard.js";
import { CATALOG_SLUGS } from "../src/plans.js";
import { planCapCents } from "../src/billing/plan-caps.js";

const US_TARGET = "+15551234567"; // keine Inlands-Vorwahl -> Auslandssatz (Worst Case)
const DE_OWN_DID = "+4930111222333";
const TENANT = "T";

// Der Guthaben-Snapshot ist ab KS-P3 eine Eingabe des Gates (Notbremse) - fuer die
// REINE Reserve-Aussage dieser Datei ist sein Wert egal, er muss nur lesbar sein.
const storeFake = {
  tenantBudgetSnapshot: () => ({ capCents: 100000, spentCents: 0, remainingCents: 100000 }),
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

test("outboundReserveCents ist eine reine Satz-Funktion - keine Dauer geht ein", () => {
  assert.equal(outboundReserveCents(30), 30 * RESERVE_LEAD_MINUTES);
  assert.equal(outboundReserveCents(20), 20 * RESERVE_LEAD_MINUTES);
  assert.equal(outboundReserveCents.length, 1, "genau EIN Argument - die Dauer ist raus");
});

test("KS-P3: compute_reserve reserviert unabhaengig von der gewuenschten Gespraechsdauer denselben Betrag", async () => {
  // DIE Kernaussage der Phase. Im Bestand ergab das 30 ct (60 s) gegen 900 ct (1800 s).
  const kurz = await gateCtxFor(60);
  const lang = await gateCtxFor(MAX_CALL_DURATION_CAP_S);
  assert.equal(kurz.reserveCents, lang.reserveCents, "kurze und lange Frist reservieren gleich viel");
  assert.equal(
    kurz.reserveCents,
    outboundReserveCents(tariffCentsPerMin(US_TARGET, DE_OWN_DID)),
    "und zwar genau Satz * Vorlauffenster",
  );
});

test("KS-P3: die Reserve ist auch bei feindlichem max_duration_s nie 0 und nie negativ", async () => {
  const baseline = (await gateCtxFor(undefined)).reserveCents;
  assert.ok(baseline > 0, "Vorbedingung: der unmanipulierte Fall reserviert ueberhaupt etwas");
  for (const hostile of [-300, 0, NaN, "abc", 99999]) {
    const { reserveCents } = await gateCtxFor(hostile);
    assert.equal(reserveCents, baseline, `${hostile}: die Reserve bleibt unveraendert`);
    assert.ok(Number.isInteger(reserveCents) && reserveCents > 0, `${hostile}: positive Ganzzahl`);
  }
});

// ---- Die Boot-Guards sind seit dieser Phase dauer-blind -------------------------

test("KS-P3: spendCapCoherence nimmt keine Gespraechsdauer mehr entgegen", () => {
  // Ein durchgereichtes maxCallDurationS wuerde ignoriert; die Aussage haengt allein am
  // Satz. Genau das macht die Anhebung der Zeitgrenze fuer den Boot ungefaehrlich.
  const eingabe = { tenantDefaultCents: 1500, platformCapCents: 3000, maxTariffCents: 30 };
  assert.deepEqual(spendCapCoherence(eingabe), [], "ausgelieferte Konfiguration ist kohaerent");
  assert.deepEqual(
    spendCapCoherence({ ...eingabe, maxCallDurationS: MAX_CALL_DURATION_CAP_S }),
    [],
    "ein zusaetzliches Dauer-Feld aendert nichts (es wird nicht gelesen)",
  );
});

test("KS-P3: die angehobene Obergrenze erzeugt bei der ausgelieferten Konfiguration keinen fatalen Plan-Decken-Befund", () => {
  const findings = planCapReserveFindings({
    slugs: CATALOG_SLUGS,
    capForSlug: (slug) => planCapCents(slug, config.billing),
    maxTariffCents: config.billing.voiceTariffDefaultCents,
  });
  assert.deepEqual(findings, [], "Reserve (Satz * Vorlauffenster) traegt die kleinste Plan-Decke");
});

test("KS-P3: die Plan-Decken-Pruefung bleibt SCHARF - eine zu kleine Decke feuert weiterhin fatal", () => {
  // Gegenprobe zur Zeile darueber: der Guard hat nur seine Bezugsgroesse gewechselt,
  // nicht seine Schaerfe verloren (Reserve 400*2 = 800 > Decke 600).
  const findings = planCapReserveFindings({
    slugs: ["winzig"],
    capForSlug: () => 600,
    maxTariffCents: 400,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.match(findings[0].message, /800 Cent/, "die Meldung nennt die tatsaechliche Reserve");
});
