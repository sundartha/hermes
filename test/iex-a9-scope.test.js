// ---- IEX-A9: Scope-Schalter des EL-Inbound-Wegs und Abweisung ohne Registrierungs-Beleg ----------
// Rein: Enum, dreiwertige Weiche (inboundPfadEntscheidung), boolesche Sicht der Init-Route, Ort des
// Zugangs-Fingerabdrucks, Boot-Befund, Abweisungs-Praedikat. Dazu EIN Boot-Spawn (unbekannter Scope).
// Die Spawn-Tests der Weiche am echten /voice/incoming stehen in test/iel-b8-weiche.test.js (IEX-A9-11..16).
// Namen beginnen mit "IEX-A9-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { EL_INBOUND_SCOPE_FINDING, elInboundScopeFindings } from "../src/boot-guard.js";
import { inboundAbgewiesen } from "../src/elevenlabs/inbound-bridge-state.js";
import * as pfad from "../src/elevenlabs/inbound-path-decision.js";
import * as beleg from "../src/elevenlabs/inbound-trunk-beleg.js";
import { DEFAULT_INBOUND_EL_SCOPE, INBOUND_EL_SCOPE, isInboundElScope } from "../src/elevenlabs/inbound-scope.js";
import { INBOUND_PATH } from "../src/telephony/inbound-path.js";
import { startServerExpectExit } from "./helpers.js";

const SIP_USER = "iex-a9-sip-benutzer";
const ALTER_SIP_USER = "iex-a9-alter-benutzer";
const GEPINNT = "tenant_iex_a9_gepinnt";
const FREMD = "tenant_iex_a9_fremd";
const FP_HEX = 16;
const SCOPE_SENTINEL = "alle_iexa9_sentinel";
const BELEG_ZEITPUNKT = "2026-09-15T08:00:00.000Z";
const MARKER_ZEITPUNKT = "2026-09-15T09:00:00.000Z";
const EXIT_ABBRUCH = 1;

// Unabhaengige Referenz (nicht aus dem Testobjekt abgeleitet): der Test waere sonst tautologisch.
function fpReferenz(sipUser) {
  const hexDigest = crypto.createHash("sha256").update(sipUser).digest("hex");
  return hexDigest.slice(0, FP_HEX);
}

function weicheConfig({
  enabled = true,
  scope = INBOUND_EL_SCOPE.REGISTRIERTE_DIDS,
  tenantIds = [GEPINNT],
  sipUser = SIP_USER,
  sipPassword = "p".repeat(pfad.SIP_PASSWORD_MIN_LENGTH),
} = {}) {
  return {
    voice: {
      elevenLabsInbound: {
        enabled,
        scope,
        tenantIds,
        sipUser,
        sipPassword,
        initWebhookToken: "t".repeat(pfad.INIT_WEBHOOK_TOKEN_MIN_LENGTH),
      },
    },
  };
}

function nummer({ belegtAt = BELEG_ZEITPUNKT, fp = fpReferenz(SIP_USER) } = {}) {
  return { e164: "+4915255555555", tenantId: GEPINNT, elInboundTrunkBelegtAt: belegtAt, elInboundTrunkZugangFp: fp };
}

// ---- 1: Enum ------------------------------------------------------------------------------------

test("IEX-A9-1: Scope-Enum hat genau zwei Werte, Default allowlist, kein Wildcard, strikte Gleichheit", () => {
  assert.deepEqual({ ...INBOUND_EL_SCOPE }, { ALLOWLIST: "allowlist", REGISTRIERTE_DIDS: "registrierte_dids" });
  assert.equal(DEFAULT_INBOUND_EL_SCOPE, "allowlist");
  assert.equal(isInboundElScope("allowlist"), true);
  assert.equal(isInboundElScope("registrierte_dids"), true);
  for (const unbekannt of ["alle", "*", "", "ALLOWLIST", undefined, null])
    assert.equal(isInboundElScope(unbekannt), false, JSON.stringify(unbekannt));
});

// ---- 2: Weiche (tabellengetrieben) -----------------------------------------------------------------

const { BUDGET, ELEVENLABS, ABGEWIESEN } = INBOUND_PATH;
const ALLOWLIST = INBOUND_EL_SCOPE.ALLOWLIST;

const WEICHE_FAELLE = [
  { name: "1 Schalter aus, allowlist, gepinnt", config: { enabled: false, scope: ALLOWLIST }, erwartet: BUDGET },
  { name: "2 Schalter aus, registrierte_dids", config: { enabled: false }, erwartet: BUDGET },
  { name: "3 enabled als String", config: { enabled: "true" }, erwartet: BUDGET },
  {
    name: "4 Zugang unvollstaendig (Passwort 31 Zeichen)",
    config: { sipPassword: "p".repeat(pfad.SIP_PASSWORD_MIN_LENGTH - 1) },
    erwartet: BUDGET,
  },
  { name: "5 allowlist, gepinnt, ohne Beleg", config: { scope: ALLOWLIST }, nummer: { belegtAt: null, fp: null }, erwartet: ELEVENLABS },
  { name: "6 allowlist, nicht gepinnt, Beleg gleich", config: { scope: ALLOWLIST }, tenantId: FREMD, erwartet: BUDGET },
  { name: "7 registrierte_dids, nicht gepinnt, Beleg gleich", config: {}, tenantId: FREMD, erwartet: ELEVENLABS },
  { name: "8 registrierte_dids, Tenant-Liste leer, Beleg gleich", config: { tenantIds: [] }, erwartet: ELEVENLABS },
  { name: "9 registrierte_dids, gepinnt, belegtAt null", config: {}, nummer: { belegtAt: null }, erwartet: ABGEWIESEN },
  { name: "10 registrierte_dids, Fingerabdruck eines rotierten Zugangs", config: {}, nummer: { fp: fpReferenz(ALTER_SIP_USER) }, erwartet: ABGEWIESEN },
  { name: "11 registrierte_dids, belegtAt gesetzt, fp null", config: {}, nummer: { fp: null }, erwartet: ABGEWIESEN },
  { name: "12 registrierte_dids, fp gleich, belegtAt null", config: {}, nummer: { belegtAt: null }, erwartet: ABGEWIESEN },
  { name: "13 registrierte_dids, numberRecord null", config: {}, ohneNummer: true, erwartet: ABGEWIESEN },
  { name: "14 Scope alle, gepinnt", config: { scope: "alle" }, erwartet: BUDGET },
  { name: "15 Scope *", config: { scope: "*" }, erwartet: BUDGET },
  { name: "16 Scope undefined", config: {}, ohneScope: true, erwartet: BUDGET },
  { name: "17 Scope ALLOWLIST (Grossschreibung)", config: { scope: "ALLOWLIST" }, erwartet: BUDGET },
];

function entscheidungFuer(fall) {
  const config = weicheConfig(fall.config);
  if (fall.ohneScope) config.voice.elevenLabsInbound.scope = undefined;
  const numberRecord = fall.ohneNummer ? null : nummer(fall.nummer);
  const tenantId = fall.tenantId ?? GEPINNT;
  return { config, tenantId, numberRecord };
}

for (const fall of WEICHE_FAELLE) {
  test(`IEX-A9-2: Weiche - ${fall.name} -> ${fall.erwartet}`, () => {
    assert.equal(pfad.inboundPfadEntscheidung(entscheidungFuer(fall)), fall.erwartet);
  });
}

// Stichproben je Ergebnis: BUDGET (4, 6), ELEVENLABS (7), ABGEWIESEN (13).
const STICHPROBEN = Object.freeze({ "4 ": false, "6 ": false, "7 ": true, "13 ": false });

test("IEX-A9-3: inboundElPathFor ist genau dann true, wenn die Weiche elevenlabs liefert", () => {
  for (const [praefix, erwartet] of Object.entries(STICHPROBEN)) {
    const fall = WEICHE_FAELLE.find((eintrag) => eintrag.name.startsWith(praefix));
    const eingabe = entscheidungFuer(fall);
    assert.equal(pfad.inboundElPathFor(eingabe), erwartet, fall.name);
    assert.equal(erwartet, pfad.inboundPfadEntscheidung(eingabe) === ELEVENLABS, fall.name);
  }
});

// ---- 4: Ort des Fingerabdrucks ---------------------------------------------------------------------

test("IEX-A9-4: der Zugangs-Fingerabdruck lebt an der Zugangs-Definition, nicht mehr im Beleg-Modul", () => {
  assert.equal(pfad.zugangsFingerabdruck(SIP_USER), fpReferenz(SIP_USER));
  assert.equal(pfad.ZUGANG_FP_HEX_ZEICHEN, FP_HEX);
  assert.equal("zugangsFingerabdruck" in beleg, false);
  assert.equal("ZUGANG_FP_HEX_ZEICHEN" in beleg, false);
});

// ---- 5: Boot-Befund --------------------------------------------------------------------------------

test("IEX-A9-5: elInboundScopeFindings - gueltig leer, unbekannt genau ein fataler Befund ohne den Wert", () => {
  for (const gueltig of Object.values(INBOUND_EL_SCOPE)) assert.deepEqual(elInboundScopeFindings(gueltig), [], gueltig);
  for (const unbekannt of [SCOPE_SENTINEL, "*", "", "ALLOWLIST", undefined]) {
    const befunde = elInboundScopeFindings(unbekannt);
    assert.equal(befunde.length, 1, JSON.stringify(unbekannt));
    const [befund] = befunde;
    assert.equal(befund.code, EL_INBOUND_SCOPE_FINDING.UNKNOWN);
    assert.equal(befund.fatal, true);
    assert.ok(befund.message.includes("ELEVENLABS_INBOUND_SCOPE"));
    assert.ok(befund.message.includes("allowlist|registrierte_dids"));
    assert.ok(!befund.message.includes(SCOPE_SENTINEL));
  }
});

// ---- 6: Abweisungs-Praedikat -----------------------------------------------------------------------

const ABGEWIESEN_FAELLE = [
  { name: "Budget-Profil mit Marker", call: { costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, elFallbackAt: MARKER_ZEITPUNKT }, erwartet: true },
  { name: "Budget-Profil ohne Marker", call: { costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, elFallbackAt: null }, erwartet: false },
  { name: "EL-Profil mit Marker (Rueckfall)", call: { costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, elFallbackAt: MARKER_ZEITPUNKT }, erwartet: false },
  { name: "EL-Profil wartend", call: { costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI, elFallbackAt: null }, erwartet: false },
  { name: "kein Call", call: null, erwartet: false },
  { name: "Outbound-Profil mit Marker", call: { costProfile: KOSTENPROFIL.TELNYX_BUDGET, elFallbackAt: MARKER_ZEITPUNKT }, erwartet: false },
];

for (const fall of ABGEWIESEN_FAELLE) {
  test(`IEX-A9-6: inboundAbgewiesen - ${fall.name} -> ${fall.erwartet}`, () => {
    assert.equal(inboundAbgewiesen(fall.call), fall.erwartet);
  });
}

// ---- 7: Boot-Spawn -------------------------------------------------------------------------------

test("IEX-A9-7: unbekannter ELEVENLABS_INBOUND_SCOPE bei Schalter aus - Boot-Refusal, Wert nicht im Log", async () => {
  const { code, output } = await startServerExpectExit({ env: { ELEVENLABS_INBOUND_SCOPE: SCOPE_SENTINEL } });
  assert.equal(code, EXIT_ABBRUCH);
  assert.match(output, /Start abgebrochen/);
  assert.match(output, /ELEVENLABS_INBOUND_SCOPE ist unbekannt/);
  assert.ok(!output.includes(SCOPE_SENTINEL), "der eingegebene Wert steht nie im Boot-Log");
});
