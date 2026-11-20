import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { inboundAbgewiesen } from "../../src/elevenlabs/inbound-bridge-state.ts";
import * as pfad from "../../src/elevenlabs/inbound-path-decision.ts";
import * as beleg from "../../src/elevenlabs/inbound-trunk-beleg.ts";
import { INBOUND_PATH } from "../../src/telephony/inbound-path.ts";

const SIP_USER = "iex-a9-sip-benutzer";
const ALTER_SIP_USER = "iex-a9-alter-benutzer";
const GEPINNT = "tenant_iex_a9_gepinnt";
const FREMD = "tenant_iex_a9_fremd";
const FP_HEX = 16;
const BELEG_ZEITPUNKT = "2026-09-15T08:00:00.000Z";
const MARKER_ZEITPUNKT = "2026-09-15T09:00:00.000Z";

function fpReferenz(sipUser) {
  const hexDigest = crypto.createHash("sha256").update(sipUser).digest("hex");
  return hexDigest.slice(0, FP_HEX);
}

function weicheConfig({
  enabled = true,
  scope = "registrierte_dids",
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

const { ELEVENLABS, ABGEWIESEN } = INBOUND_PATH;
const ALLOWLIST = "allowlist";

const WEICHE_FAELLE = [
  { name: "1 Schalter aus, allowlist, gepinnt", config: { enabled: false, scope: ALLOWLIST }, erwartet: ELEVENLABS },
  { name: "2 Schalter aus, registrierte_dids", config: { enabled: false }, erwartet: ELEVENLABS },
  { name: "3 enabled als String", config: { enabled: "true" }, erwartet: ELEVENLABS },
  {
    name: "4 Zugang unvollstaendig (Passwort 31 Zeichen)",
    config: { sipPassword: "p".repeat(pfad.SIP_PASSWORD_MIN_LENGTH - 1) },
    erwartet: ABGEWIESEN,
  },
  { name: "5 allowlist, gepinnt, ohne Beleg", config: { scope: ALLOWLIST }, nummer: { belegtAt: null, fp: null }, erwartet: ELEVENLABS },
  { name: "6 allowlist, nicht gepinnt, Beleg gleich", config: { scope: ALLOWLIST }, tenantId: FREMD, erwartet: ELEVENLABS },
  { name: "7 registrierte_dids, nicht gepinnt, Beleg gleich", config: {}, tenantId: FREMD, erwartet: ELEVENLABS },
  { name: "8 registrierte_dids, Tenant-Liste leer, Beleg gleich", config: { tenantIds: [] }, erwartet: ELEVENLABS },
  { name: "9 registrierte_dids, gepinnt, belegtAt null", config: {}, nummer: { belegtAt: null }, erwartet: ELEVENLABS },
  { name: "10 registrierte_dids, Fingerabdruck eines rotierten Zugangs", config: {}, nummer: { fp: fpReferenz(ALTER_SIP_USER) }, erwartet: ELEVENLABS },
  { name: "11 registrierte_dids, belegtAt gesetzt, fp null", config: {}, nummer: { fp: null }, erwartet: ELEVENLABS },
  { name: "12 registrierte_dids, fp gleich, belegtAt null", config: {}, nummer: { belegtAt: null }, erwartet: ELEVENLABS },
  { name: "13 registrierte_dids, numberRecord null", config: {}, ohneNummer: true, erwartet: ELEVENLABS },
  { name: "14 Scope alle, gepinnt", config: { scope: "alle" }, erwartet: ELEVENLABS },
  { name: "15 Scope *", config: { scope: "*" }, erwartet: ELEVENLABS },
  { name: "16 Scope undefined", config: {}, ohneScope: true, erwartet: ELEVENLABS },
  { name: "17 Scope ALLOWLIST (Grossschreibung)", config: { scope: "ALLOWLIST" }, erwartet: ELEVENLABS },
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

const STICHPROBEN = Object.freeze({ "4 ": false, "6 ": true, "7 ": true, "13 ": true });

test("IEX-A9-3: inboundElPathFor ist genau dann true, wenn die Weiche elevenlabs liefert", () => {
  for (const [praefix, erwartet] of Object.entries(STICHPROBEN)) {
    const fall = WEICHE_FAELLE.find((eintrag) => eintrag.name.startsWith(praefix));
    const eingabe = entscheidungFuer(fall);
    assert.equal(pfad.inboundElPathFor(eingabe), erwartet, fall.name);
    assert.equal(erwartet, pfad.inboundPfadEntscheidung(eingabe) === ELEVENLABS, fall.name);
  }
});

test("IEX-A9-4: der Zugangs-Fingerabdruck lebt an der Zugangs-Definition, nicht mehr im Beleg-Modul", () => {
  assert.equal(pfad.zugangsFingerabdruck(SIP_USER), fpReferenz(SIP_USER));
  assert.equal(pfad.ZUGANG_FP_HEX_ZEICHEN, FP_HEX);
  assert.equal("zugangsFingerabdruck" in beleg, false);
  assert.equal("ZUGANG_FP_HEX_ZEICHEN" in beleg, false);
});

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

