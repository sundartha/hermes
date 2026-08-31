// KV2-3 (tasks/kostenv2/spec-kv2-3.md): das Kosten-Buch (call_cost_evidence). In-Memory
// ueber state-ops + cost-evidence, kein Server-Spawn, kein Netz (F.I.R.S.T.). Diese Phase
// baut NUR die Tabelle, das Regelwerk und die zwei Store-Operationen - kein Schreiber
// ausserhalb dieses Tests, keine Route, kein Gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  registerTenant,
  createCall,
  recordCallCostEvidence,
  callCostEvidence,
} from "../src/store/state-ops.js";
import { REIFE, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { belegDetailAusRohdaten, costEvidenceSumMicroCents } from "../src/store/cost-evidence.js";
import { CONVERSATION_DONE_MIT_KOSTEN } from "./fixtures/elevenlabs-conversations.js";

const TENANT_ID = "t_kv23";
const TRAEGER_AI_TOKEN = "ai_token";
const TRAEGER_TELNYX_SIP = "telnyx_sip";
// G25: benannte Testbetraege statt nackter Zahlen in den assert-Aufrufen unten.
const VORLAEUFIG_BETRAG_MIKRO_CENTS = 5000;
const BELEGT_BETRAG_MIKRO_CENTS = 120;
const ZWEI_ZEILEN = 2;
const SUMME_VORLAEUFIG_PLUS_BELEGT_MIKRO_CENTS = 3_500;

// Build: EIN Tenant + EIN Call, geteilt von jedem Test unten (P13: Build/Operate/Check).
function seedCall() {
  const state = makeDefaultState();
  registerTenant(state, TENANT_ID);
  const call = createCall(state, {
    direction: "outbound",
    from: "+49123",
    to: "+49456",
    tenantId: TENANT_ID,
  });
  return { state, callId: call.id };
}

// ---- Kriterium (a): Idempotenz je (callId, traeger) -------------------------------------

test("KV2-3 (a): zweiter Aufruf mit derselben (callId, traeger) legt keine zweite Zeile an", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: REIFE.ERWARTET });
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.VORLAEUFIG,
    betragMikroCents: VORLAEUFIG_BETRAG_MIKRO_CENTS,
    waehrung: "USD",
  });
  const zeilen = callCostEvidence(state, callId);
  assert.equal(zeilen.length, 1, "genau eine Zeile fuer diesen Traeger");
  assert.equal(
    zeilen[0].betragMikroCents,
    VORLAEUFIG_BETRAG_MIKRO_CENTS,
    "der zweite Aufruf hat fortgeschrieben",
  );
});

test("KV2-3 (a): dieselbe callId mit ANDEREM traeger legt eine zweite Zeile an", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: REIFE.ERWARTET });
  recordCallCostEvidence(state, { callId, traeger: TRAEGER_TELNYX_SIP, reife: REIFE.ERWARTET });
  assert.equal(callCostEvidence(state, callId).length, ZWEI_ZEILEN, "zwei Traeger = zwei Zeilen");
});

// ---- Kriterium (b): Reife-Uebergaenge --------------------------------------------------

test("KV2-3 (b): erwartet -> vorlaeufig -> belegt schreibt, jeder Schritt erlaubt", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: REIFE.ERWARTET });
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.VORLAEUFIG,
    betragMikroCents: 100,
    waehrung: "USD",
  });
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.BELEGT,
    betragMikroCents: BELEGT_BETRAG_MIKRO_CENTS,
    waehrung: "USD",
  });
  const [zeile] = callCostEvidence(state, callId);
  assert.equal(zeile.reife, REIFE.BELEGT);
  assert.equal(zeile.betragMikroCents, BELEGT_BETRAG_MIKRO_CENTS);
});

test("KV2-3 (b): erwartet -> belegt (Ueberspringen von vorlaeufig) wirft nicht", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: REIFE.ERWARTET });
  assert.doesNotThrow(() =>
    recordCallCostEvidence(state, {
      callId,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.BELEGT,
      betragMikroCents: 50,
      waehrung: "USD",
    }),
  );
});

test("KV2-3 (b)(i): erwartet/vorlaeufig/belegt -> beleg_strukturell_unbeschaffbar werfen nicht", () => {
  for (const vorReife of [REIFE.ERWARTET, REIFE.VORLAEUFIG, REIFE.BELEGT]) {
    const { state, callId } = seedCall();
    recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: vorReife });
    assert.doesNotThrow(
      () =>
        recordCallCostEvidence(state, {
          callId,
          traeger: TRAEGER_AI_TOKEN,
          reife: REIFE.STRUKTURELL_UNBESCHAFFBAR,
        }),
      `Vorzustand '${vorReife}' darf nach beleg_strukturell_unbeschaffbar wechseln`,
    );
  }
});

test("KV2-3 (b)(ii): aus beleg_strukturell_unbeschaffbar heraus werfen erwartet/vorlaeufig/belegt", () => {
  for (const nachReife of [REIFE.ERWARTET, REIFE.VORLAEUFIG, REIFE.BELEGT]) {
    const { state, callId } = seedCall();
    recordCallCostEvidence(state, {
      callId,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.STRUKTURELL_UNBESCHAFFBAR,
    });
    assert.throws(
      () => recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: nachReife }),
      /Rueckschritt/,
      `terminal -> '${nachReife}' muss werfen`,
    );
  }
});

test("KV2-3 (b)(iii): terminal -> terminal ist ein No-Op und wirft nicht", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.STRUKTURELL_UNBESCHAFFBAR,
  });
  assert.doesNotThrow(() =>
    recordCallCostEvidence(state, {
      callId,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.STRUKTURELL_UNBESCHAFFBAR,
      betragMikroCents: 999,
      waehrung: "USD",
    }),
  );
  const [zeile] = callCostEvidence(state, callId);
  assert.equal(zeile.betragMikroCents, null, "der abweichende Betrag wurde NICHT uebernommen");
});

test("KV2-3 (b)(iv): belegt->vorlaeufig, belegt->erwartet, vorlaeufig->erwartet werfen", () => {
  const faelle = [
    [REIFE.BELEGT, REIFE.VORLAEUFIG],
    [REIFE.BELEGT, REIFE.ERWARTET],
    [REIFE.VORLAEUFIG, REIFE.ERWARTET],
  ];
  for (const [von, nach] of faelle) {
    const { state, callId } = seedCall();
    recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: von });
    assert.throws(
      () => recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: nach }),
      /Rueckschritt/,
      `'${von}' -> '${nach}' muss werfen`,
    );
  }
});

// ---- Kriterium (e): Summenregel --------------------------------------------------------

test("KV2-3 (e): die Summe zaehlt nur vorlaeufig und belegt", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, { callId, traeger: "research_fee", reife: REIFE.ERWARTET });
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.VORLAEUFIG,
    betragMikroCents: 1_000,
    waehrung: "USD",
  });
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_TELNYX_SIP,
    reife: REIFE.BELEGT,
    betragMikroCents: 2_500,
    waehrung: "USD",
  });
  assert.equal(
    costEvidenceSumMicroCents(callCostEvidence(state, callId)),
    SUMME_VORLAEUFIG_PLUS_BELEGT_MIKRO_CENTS,
  );
});

test("KV2-3 (e): eine erwartet-Zeile traegt NICHTS bei, auch nicht die 0", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: REIFE.ERWARTET });
  const zeilen = callCostEvidence(state, callId);
  assert.equal(zeilen[0].betragMikroCents, null, "kein erfundener Betrag");
  assert.equal(costEvidenceSumMicroCents(zeilen), 0);
});

test("KV2-3 (e): eine terminale Zeile mit Betrag traegt nicht bei", () => {
  const { state, callId } = seedCall();
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.BELEGT,
    betragMikroCents: 777,
    waehrung: "USD",
  });
  recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.STRUKTURELL_UNBESCHAFFBAR,
  });
  assert.equal(costEvidenceSumMicroCents(callCostEvidence(state, callId)), 0);
});

// ---- Kriterium (f): detail-Allowlist ---------------------------------------------------

test("KV2-3 (f): das VOLLSTAENDIGE EL-Antwortobjekt erzeugt nur Allowlist-Schluessel", () => {
  const detail = belegDetailAusRohdaten(CONVERSATION_DONE_MIT_KOSTEN);
  assert.ok(detail, "die Fixture traegt Allowlist-Treffer");
  const ALLOWLIST_AUSGABE = new Set([
    "llm_price",
    "platform_price",
    "analysis_price",
    "billed_sec",
    "call_duration_secs",
    "rate",
    "tier",
  ]);
  for (const schluessel of Object.keys(detail)) assert.ok(ALLOWLIST_AUSGABE.has(schluessel));
  assert.equal(detail.llm_price, CONVERSATION_DONE_MIT_KOSTEN.metadata.charging.llm_price);
  assert.equal(
    detail.platform_price,
    CONVERSATION_DONE_MIT_KOSTEN.metadata.charging.platform_price,
  );
  assert.equal(detail.analysis_price, 0);
  assert.equal(detail.call_duration_secs, CONVERSATION_DONE_MIT_KOSTEN.metadata.call_duration_secs);
  assert.equal(detail.tier, "starter");
});

test("KV2-3 (f): kein Transkript-, Rufnummern- oder Analysetext-Feld rutscht durch", () => {
  const detail = belegDetailAusRohdaten(CONVERSATION_DONE_MIT_KOSTEN);
  const serialisiert = JSON.stringify(detail);
  assert.ok(!serialisiert.includes("Jonas Beispiel"), "kein Transkript-Wortlaut");
  assert.ok(!serialisiert.includes("***2163"), "keine (auch maskierte) Rufnummer");
  assert.ok(!serialisiert.includes("completed the test call"), "kein Analysetext");
});

test("KV2-3 (f): ein gleichnamiger price-Leaf unter fremdem Elternsegment faellt raus", () => {
  const detail = belegDetailAusRohdaten(CONVERSATION_DONE_MIT_KOSTEN);
  const serialisiert = JSON.stringify(detail);
  // charging.llm_usage.<modell>.input.price - Elternsegment ist 'input', nicht 'analysis'.
  assert.equal(detail.input_price, undefined);
  assert.ok(!serialisiert.includes("0.0036"), "der llm_usage-Preis ist nicht durchgerutscht");
});

// ---- Abhaengigkeit KV2-2, Waechter -------------------------------------------------------

test("KV2-3: unbekannter traeger / unbekannte reife werfen", () => {
  const { state, callId } = seedCall();
  assert.throws(
    () => recordCallCostEvidence(state, { callId, traeger: "kein_solcher_traeger", reife: REIFE.ERWARTET }),
    /Traeger/,
  );
  assert.throws(
    () => recordCallCostEvidence(state, { callId, traeger: TRAEGER_AI_TOKEN, reife: "kein_solcher_wert" }),
    /Reife/,
  );
});

test("KV2-3: erwartet mit Betrag wirft (nie 0, nie ein Platzhalter)", () => {
  const { state, callId } = seedCall();
  assert.throws(() =>
    recordCallCostEvidence(state, {
      callId,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.ERWARTET,
      betragMikroCents: 0,
    }),
  );
});

test("KV2-3: Betrag ohne Waehrung wirft; Bruchzahl/negativ werfen", () => {
  const { state, callId } = seedCall();
  assert.throws(() =>
    recordCallCostEvidence(state, {
      callId,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.VORLAEUFIG,
      betragMikroCents: 100,
    }),
  );
  const { state: state2, callId: callId2 } = seedCall();
  assert.throws(() =>
    recordCallCostEvidence(state2, {
      callId: callId2,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.VORLAEUFIG,
      betragMikroCents: 1.5,
      waehrung: "USD",
    }),
  );
  const { state: state3, callId: callId3 } = seedCall();
  assert.throws(() =>
    recordCallCostEvidence(state3, {
      callId: callId3,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.VORLAEUFIG,
      betragMikroCents: -5,
      waehrung: "USD",
    }),
  );
});

test("KV2-3: eine Rufnummer als beleg_ref wirft", () => {
  const { state, callId } = seedCall();
  assert.throws(() =>
    recordCallCostEvidence(state, {
      callId,
      traeger: TRAEGER_AI_TOKEN,
      reife: REIFE.ERWARTET,
      belegRef: "+4915799990001",
    }),
  );
});

test("KV2-3: unbekannte callId wirft (keine verwaiste Zeile)", () => {
  const state = makeDefaultState();
  registerTenant(state, TENANT_ID);
  assert.throws(
    () =>
      recordCallCostEvidence(state, {
        callId: "call_nicht_vorhanden",
        traeger: TRAEGER_AI_TOKEN,
        reife: REIFE.ERWARTET,
      }),
    /nicht gefunden/,
  );
});

test("KV2-3: tenantId stammt aus dem Anruf, nicht aus der Eingabe", () => {
  const { state, callId } = seedCall();
  const { evidence } = recordCallCostEvidence(state, {
    callId,
    traeger: TRAEGER_AI_TOKEN,
    reife: REIFE.ERWARTET,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.equal(evidence.tenantId, TENANT_ID, "die Eingabe-tenantId wird ignoriert");
});
