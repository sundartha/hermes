// OUTBOUND-E4 (F4, PLAN-OUTBOUND-RESILIENZ.md E-6): der reine Entscheidungskern
// (outbound-config-drift.js) gegen injizierte Messungen - KEIN Netz, KEIN Date.now im
// Kern. Fixtures aus tasks/befund-outbound-ausfall-2026-08-27.md (Abschnitt 2), als
// GEMESSEN markiert. Praefix "E4-Kern:" (Lehre catalog-id-prefix-misroutes-tests: kein
// Katalog-Praefix wie GAP-/OUT-/E2E- am Namensanfang, sonst landet der Test im
// test:gates-Lauf statt im Regressionslauf).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beurteileDrift,
  ausnahmeFehler,
  istBlockierend,
  DRIFT_KLASSE,
  DRIFT_BEFUND,
  UNBEKANNT_PRAEFIX,
} from "../src/telephony/outbound-config-drift.js";
import { telnyxJson } from "../src/telephony/adapters/telnyx/http.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_ID = "agent_5301kwkh9vv3ezesf100pggfj9rs";
const PLATTFORM_ANI = "+15739090177"; // die reale Plattform-ANI (Befund 27.08.2026), Testkontext

const SCHWELLEN = { staleMs: 21600000, balanceMinHours: 72 };
const SOLL = Object.freeze({
  elAgentId: AGENT_ID,
  elPhoneNumberId: "phnum_1101m00pjrg7e1js7aaxwp8hdw38",
  platformAniE164: PLATTFORM_ANI,
  fqdnConnectionId: "3026479542865757220",
  ovpId: "ovp_1",
  bedienteLaender: ["US", "CA", "DE"],
  alertSenderE164: "+15005550006",
  verbrauch24hMicroCents: 200_000_000, // 2,00 USD/24h (mit Luft zur Grenze, Blocker-Liste 6)
  letzteErfolgreicheMessungMs: undefined,
});

// GEMESSEN 27.08.2026 (tasks/befund-outbound-ausfall-2026-08-27.md, Abschnitt 2): die
// Plattform-Absendernummer gehoerte dem Telnyx-Konto NICHT MEHR, verifizierte Nummern
// leer, Connection weiter aktiv mit demselben ANI-Override.
const MESSUNG_2708 = Object.freeze({
  elNummer: { ok: true, wert: { e164: PLATTFORM_ANI, agentId: AGENT_ID, supportsOutbound: true } },
  connection: { ok: true, wert: { active: true, aniOverride: PLATTFORM_ANI } },
  aniKontotreffer: { ok: true, wert: { treffer: [] } },
  verifizierte: { ok: true, wert: { e164s: [] } },
  fqdns: { ok: true, wert: { connectionIds: ["3026479542865757220"] } },
  ovp: { ok: true, wert: { enabled: true, whitelistedDestinations: ["US", "CA", "DE"] } },
  // GEMESSEN 27.08.2026: Guthaben 3,09 USD = 309.000.000 Mikro-Cent (1 USD = 1e8
  // Mikro-Cent, s. cost-parse.js#MICRO_CENTS_PER_CURRENCY_UNIT), Verbrauch 2,00 USD/24h.
  // Reichweite ~37h < 72h -> balance_low (s. K-11) - das ist Teil der REALEN Messung.
  balance: { ok: true, wert: { availableCreditMicroCents: 309_000_000, verbrauch24hMicroCents: 200_000_000 } },
  alertSenderKontotreffer: { ok: true, wert: { treffer: [{ e164: "+15005550006", status: "active" }] } },
});

function messungMitAniBesitz() {
  return {
    ...MESSUNG_2708,
    aniKontotreffer: { ok: true, wert: { treffer: [{ e164: PLATTFORM_ANI, status: "active" }] } },
  };
}

// Fuer Positiv-Kontrollen (K-2/K-5): die REALE Messung traegt ABSICHTLICH ein niedriges
// Guthaben (s.o.) - eine echte "alles ist gesund"-Fixture braucht deshalb ZUSAETZLICH eine
// Reichweite deutlich ueber der Schwelle (Blocker-Liste 6: Luft zur Grenze).
function messungGesund() {
  return {
    ...messungMitAniBesitz(),
    balance: { ok: true, wert: { availableCreditMicroCents: 100_000_000_000, verbrauch24hMicroCents: 200_000_000 } },
  };
}

// K-1: REGRESSIONSFANG 27.08. ---------------------------------------------------------
test("E4-Kern: K-1 REGRESSIONSFANG 27.08. - ani_override gesetzt, phone_numbers-Filter liefert 0 Treffer -> ownership_lost", () => {
  const { befunde, zaehler } = beurteileDrift({ messung: MESSUNG_2708, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  const treffer = befunde.filter((befund) => befund.code === DRIFT_BEFUND.OWNERSHIP_LOST);
  assert.equal(treffer.length, 1, "genau EIN ownership_lost-Befund");
  assert.equal(treffer[0].klasse, DRIFT_KLASSE.OWNERSHIP);
  assert.equal(zaehler.unknown, 0);
});

// K-2: Positiv-Kontrolle -----------------------------------------------------------
test("E4-Kern: K-2 Positiv-Kontrolle - alles stimmt -> LEERE Befundliste, gemessen === soll", () => {
  const { befunde, gemessen, soll } = beurteileDrift({
    messung: messungGesund(),
    soll: SOLL,
    schwellen: SCHWELLEN,
    nowMs: 1,
  });
  assert.deepEqual(befunde, []);
  assert.equal(gemessen, soll);
});

// K-3: N_el != N_ani -> config, NIE ownership ----------------------------------------
test("E4-Kern: K-3 N_el != N_ani -> config_ani_mismatch, NIE ownership", () => {
  const messung = {
    ...messungMitAniBesitz(),
    elNummer: { ok: true, wert: { e164: "+15804504874", agentId: AGENT_ID, supportsOutbound: true } },
    aniKontotreffer: { ok: true, wert: { treffer: [{ e164: PLATTFORM_ANI, status: "active" }] } },
  };
  const { befunde } = beurteileDrift({ messung, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  const mismatch = befunde.filter((befund) => befund.code === DRIFT_BEFUND.ANI_MISMATCH);
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].klasse, DRIFT_KLASSE.CONFIG);
  assert.ok(!befunde.some((befund) => befund.klasse === DRIFT_KLASSE.OWNERSHIP), "Weg 1 darf nicht gaten");
});

// K-4: Alarm-Absender nicht kontoeigen (Pruefung 9) -----------------------------------
test("E4-Kern: K-4 Alarm-Absender nicht kontoeigen -> alert_sender_not_owned, Klasse ownership", () => {
  const messung = { ...messungMitAniBesitz(), alertSenderKontotreffer: { ok: true, wert: { treffer: [] } } };
  const { befunde } = beurteileDrift({ messung, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  const treffer = befunde.filter((befund) => befund.code === DRIFT_BEFUND.ALERT_SENDER_NOT_OWNED);
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].klasse, DRIFT_KLASSE.OWNERSHIP);
});

// K-5/K-6: Ausnahmen -----------------------------------------------------------------
test("E4-Kern: K-5 Ausnahme mit Grund+Datum -> Befund bleibt sichtbar, blockiert nicht", () => {
  // Ansonsten gesunde Messung, NUR der ANI-Verlust bleibt (isoliert die Ausnahme-Wirkung
  // von jedem anderen Befund - sonst braeuchte istBlockierend===false eine Ausnahme fuer
  // JEDEN Fund, nicht nur den hier geprueften).
  const messung = { ...messungGesund(), aniKontotreffer: { ok: true, wert: { treffer: [] } } };
  const ausnahmen = [{ befund: DRIFT_BEFUND.OWNERSHIP_LOST, grund: "Weg 1 der Wiederherstellung", seit: "2026-08-28" }];
  const ergebnis = beurteileDrift({ messung, soll: SOLL, ausnahmen, schwellen: SCHWELLEN, nowMs: 1 });
  const treffer = ergebnis.befunde.find((befund) => befund.code === DRIFT_BEFUND.OWNERSHIP_LOST);
  assert.ok(treffer, "Befund erscheint weiterhin");
  assert.equal(treffer.ausgenommen, true);
  assert.equal(istBlockierend(ergebnis), false);
});

test("E4-Kern: K-6 Ausnahme OHNE Grund/OHNE Datum -> Fehler, blockiert", () => {
  const ohneGrund = [{ befund: DRIFT_BEFUND.OWNERSHIP_LOST, grund: "", seit: "2026-08-28" }];
  const fehler1 = ausnahmeFehler(ohneGrund);
  assert.equal(fehler1.length, 1);
  const ergebnis1 = beurteileDrift({ messung: MESSUNG_2708, soll: SOLL, ausnahmen: ohneGrund, schwellen: SCHWELLEN, nowMs: 1 });
  assert.equal(istBlockierend(ergebnis1), true);

  const ohneDatum = [{ befund: DRIFT_BEFUND.OWNERSHIP_LOST, grund: "Weg 1", seit: "" }];
  const fehler2 = ausnahmeFehler(ohneDatum);
  assert.equal(fehler2.length, 1);
  const ergebnis2 = beurteileDrift({ messung: MESSUNG_2708, soll: SOLL, ausnahmen: ohneDatum, schwellen: SCHWELLEN, nowMs: 1 });
  assert.equal(istBlockierend(ergebnis2), true);
  // eine UNGUELTIGE Ausnahme wird NIE stillschweigend zu einer gueltigen aufgewertet -
  // der Befund selbst bleibt trotzdem sichtbar, aber NICHT ausgenommen.
  const treffer = ergebnis2.befunde.find((befund) => befund.code === DRIFT_BEFUND.OWNERSHIP_LOST);
  assert.equal(treffer.ausgenommen, false);
});

// K-7: Fehler/Timeout/fehlender Schluessel -> unknown, NIE ownership -----------------
test("E4-Kern: K-7 aniKontotreffer=http_429 -> genau EIN unbekannt:pruefung3, KEIN ownership_lost", () => {
  const messung = { ...MESSUNG_2708, aniKontotreffer: { ok: false, grund: "http_429" } };
  const { befunde, zaehler } = beurteileDrift({ messung, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  const unbekannte = befunde.filter((befund) => befund.code === `${UNBEKANNT_PRAEFIX}pruefung3`);
  assert.equal(unbekannte.length, 1);
  assert.equal(unbekannte[0].klasse, DRIFT_KLASSE.UNKNOWN);
  assert.ok(!befunde.some((befund) => befund.code === DRIFT_BEFUND.OWNERSHIP_LOST), "unknown ist NIE ownership");
  assert.equal(zaehler.unknown, 1);
});

// K-8: watchdog_stale -----------------------------------------------------------------
test("E4-Kern: K-8 letzte erfolgreiche Messung aelter als staleMs -> watchdog_stale", () => {
  const nowMs = 100_000_000;
  const soll = { ...SOLL, letzteErfolgreicheMessungMs: nowMs - SCHWELLEN.staleMs - 1 };
  const { befunde } = beurteileDrift({ messung: messungMitAniBesitz(), soll, schwellen: SCHWELLEN, nowMs });
  const stale = befunde.filter((befund) => befund.code === DRIFT_BEFUND.WATCHDOG_STALE);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].klasse, DRIFT_KLASSE.STALE);
});

test("E4-Kern: K-8b letzte erfolgreiche Messung INNERHALB staleMs -> KEIN watchdog_stale", () => {
  const nowMs = 100_000_000;
  const EINE_SEKUNDE_MS = 1000;
  const soll = { ...SOLL, letzteErfolgreicheMessungMs: nowMs - EINE_SEKUNDE_MS };
  const { befunde } = beurteileDrift({ messung: messungMitAniBesitz(), soll, schwellen: SCHWELLEN, nowMs });
  assert.ok(!befunde.some((befund) => befund.code === DRIFT_BEFUND.WATCHDOG_STALE));
});

// K-9: connection_id als 19-stellige JSON-Zahl mit Praezisionsverlust ----------------
test("E4-Kern: K-9 telnyxJson bewahrt eine 19-stellige connection_id als String (kein Praezisionsverlust)", async () => {
  const roh = '{"data":[{"connection_id":3026479542865757220}]}';
  const res = { text: async () => roh };
  const json = await telnyxJson(res);
  assert.equal(typeof json.data[0].connection_id, "string");
  assert.equal(json.data[0].connection_id, "3026479542865757220");
  // Ohne den Schutz wuerde JSON.parse hier 3026479542865757000 liefern (STILL gerundet) -
  // der nachgelagerte String-Vergleich im Kern (pruefeFqdns) wuerde dann NIE treffen,
  // obwohl beide Seiten dieselbe Ressource meinen.
  const geparst = JSON.parse(roh);
  assert.notEqual(String(geparst.data[0].connection_id), "3026479542865757220");
});

test("E4-Kern: K-9b die praezisionssichere ID trifft im Kern (kein config_fqdn_unbound)", () => {
  const messung = { ...MESSUNG_2708, fqdns: { ok: true, wert: { connectionIds: ["3026479542865757220"] } } };
  const { befunde } = beurteileDrift({ messung, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  assert.ok(!befunde.some((befund) => befund.code === DRIFT_BEFUND.FQDN_UNBOUND));
});

// K-10: bedientes Land fehlt in whitelisted_destinations -----------------------------
test("E4-Kern: K-10 bedientes Zielland fehlt in whitelisted_destinations -> config_ovp_destination_missing, Detail nennt die Codes", () => {
  const soll = { ...SOLL, bedienteLaender: ["DE", "FR", "GB"] };
  const messung = { ...messungMitAniBesitz(), ovp: { ok: true, wert: { enabled: true, whitelistedDestinations: ["US", "CA", "DE"] } } };
  const { befunde } = beurteileDrift({ messung, soll, schwellen: SCHWELLEN, nowMs: 1 });
  const treffer = befunde.find((befund) => befund.code === DRIFT_BEFUND.OVP_DESTINATION_MISSING);
  assert.ok(treffer);
  assert.equal(treffer.klasse, DRIFT_KLASSE.CONFIG);
  assert.match(treffer.detail, /FR/);
  assert.match(treffer.detail, /GB/);
  assert.doesNotMatch(treffer.detail, /\bDE\b/, "DE ist bedient UND in der Whitelist - kein Fehl-Eintrag");
});

// K-11: Guthaben-Reichweite < 72h -----------------------------------------------------
test("E4-Kern: K-11 Guthaben-Reichweite < 72h (Fixture 3,09 USD / 2,00 USD pro 24h = 37h, Luft zur Grenze) -> balance_low, Klasse warn", () => {
  const { befunde } = beurteileDrift({ messung: messungMitAniBesitz(), soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  const treffer = befunde.find((befund) => befund.code === DRIFT_BEFUND.BALANCE_LOW);
  assert.ok(treffer, "37h < 72h muss den Befund ausloesen");
  assert.equal(treffer.klasse, DRIFT_KLASSE.WARN);
});

// K-12: Verbrauch 24h == 0 -> unbekannt, NICHT balance_low, NICHT gruen ---------------
test("E4-Kern: K-12 Verbrauch 24h == 0 -> unbekannt:pruefung8, NICHT balance_low", () => {
  const messung = {
    ...messungMitAniBesitz(),
    balance: { ok: true, wert: { availableCreditMicroCents: 3_090_000, verbrauch24hMicroCents: 0 } },
  };
  const { befunde, zaehler } = beurteileDrift({ messung, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  assert.ok(befunde.some((befund) => befund.code === `${UNBEKANNT_PRAEFIX}pruefung8`));
  assert.ok(!befunde.some((befund) => befund.code === DRIFT_BEFUND.BALANCE_LOW));
  assert.equal(zaehler.unknown, 1);
});

// K-13: ein offener drift:-Marker faellt NICHT in runOutageRecoverySweep -------------
test("E4-Kern: K-13 ein drift:-Marker-Code faellt NICHT unter die NOT_PLACED-Whitelist (istFehlergrundEimer)", async () => {
  const { NOT_PLACED } = await import("../src/telephony/failure-reason.js");
  const beispiel = "drift:ownership_lost";
  assert.ok(!beispiel.startsWith(NOT_PLACED), "ein drift:-Code traegt nie das NOT_PLACED-Praefix");
});

// K-14: NUR-LESE-PIN ------------------------------------------------------------------
test("E4-Kern: K-14 Nur-Lese-Pin - keine schreibende HTTP-Methode in Kern/Probe/Config-Read", () => {
  const dateien = [
    "src/telephony/outbound-config-drift.js",
    "src/telephony/outbound-config-probe.js",
    "src/telephony/adapters/telnyx/config-read.js",
  ];
  const schreibMethoden = /method:\s*["'](POST|PATCH|PUT|DELETE)["']/;
  for (const rel of dateien) {
    const quelltext = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    assert.ok(!schreibMethoden.test(quelltext), `${rel} darf keine schreibende HTTP-Methode enthalten`);
  }
});

// K-15: supports_outbound fehlt in der Antwort ---------------------------------------
test("E4-Kern: K-15 supports_outbound fehlt in der EL-Antwort -> unbekannt:pruefung1_supports_outbound, KEIN config-Befund", () => {
  const messung = { ...messungMitAniBesitz(), elNummer: { ok: true, wert: { e164: PLATTFORM_ANI, agentId: AGENT_ID } } };
  const { befunde, zaehler } = beurteileDrift({ messung, soll: SOLL, schwellen: SCHWELLEN, nowMs: 1 });
  assert.ok(befunde.some((befund) => befund.code === `${UNBEKANNT_PRAEFIX}pruefung1_supports_outbound`));
  assert.ok(!befunde.some((befund) => befund.code === DRIFT_BEFUND.EL_OUTBOUND_DISABLED));
  assert.equal(zaehler.unknown, 1);
});
