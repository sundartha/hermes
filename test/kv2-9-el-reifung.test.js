import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EL_REIFUNG_ERGEBNIS,
  EL_REIFUNG_SKIP,
  EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP,
  reifungsKandidat,
  reifeErgebnis,
  reifeElBelege,
} from "../src/billing/el-reifung.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { makeDefaultState, createCall, recordCallCostEvidence, callCostEvidence } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, REIFE } from "../src/store/defaults.js";
import { KOSTENART, KOSTENPROFIL, pflichttypenFuerProfil } from "../src/billing/kostenarten.js";
import { SIP_TRUNKING_RECORD_TYPE } from "../src/billing/sweep-kostenbeleg.js";
import { makeStubStore, fakeConfig, fakeVoiceControl, isoMinutesAgo } from "./cost-truing-harness.js";
import { captureConsole } from "./helpers.js";
import { MS_PER_MINUTE } from "../src/utils/timer.js";

const MIN_AGE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const BILLING = { elEvidenceMinAgeMinutes: MIN_AGE_MINUTES, costTruingMaxAttempts: MAX_ATTEMPTS };
const STANDARD_ENDED_MINUTES_AGO = 200;
const ALT_MIKRO_CENTS = 10_000_000;
const HOEHER_MIKRO_CENTS = 12_000_000;
const NIEDRIGER_MIKRO_CENTS = 5_000_000;
const ALT_COST_FIAT = 0.1;
const HOEHER_COST_FIAT = 0.12;
const NIEDRIGER_COST_FIAT = 0.05;
const CONV_ID = "conv_kv2_9_test0000000000000001";
const DROSSEL_ANZAHL = 30;
const CONV_ID_PAD_WIDTH = 2;
const Z2_SCHAETZUNG_CENTS = 30;
const Z2_SIP_BELEG_MIKRO_CENTS = 40_100;
const Z2_SIP_BELEG_BILLED_SEC = 60;

function elZeilenWerte({ reife, betragMikroCents }) {
  if (reife === REIFE.ERWARTET) return { betragMikroCents: undefined, waehrung: undefined };
  return { betragMikroCents, waehrung: "USD" };
}

const SEED_EL_CALL_DEFAULTS = Object.freeze({
  endedMinutesAgo: STANDARD_ENDED_MINUTES_AGO,
  elevenlabsConversationId: CONV_ID,
  versuche: 0,
  betragMikroCents: ALT_MIKRO_CENTS,
  nachreifbar: true,
  reife: REIFE.VORLAEUFIG,
  withElZeile: true,
  profil: KOSTENPROFIL.EL_CONVAI_SIP,
});

function seedElCall(state, overrides = {}) {
  const {
    nowMs, endedMinutesAgo, elevenlabsConversationId, versuche,
    betragMikroCents, nachreifbar, reife, withElZeile, profil,
  } = { ...SEED_EL_CALL_DEFAULTS, ...overrides };
  const call = createCall(state, { direction: "outbound", from: "+49", to: "+49", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  call.status = "completed";
  call.answeredAt = isoMinutesAgo(nowMs, endedMinutesAgo + 1);
  call.endedAt = isoMinutesAgo(nowMs, endedMinutesAgo);
  call.costProfile = profil;
  call.elevenlabsConversationId = elevenlabsConversationId;
  if (withElZeile) {
    recordCallCostEvidence(state, {
      callId: call.id,
      traeger: KOSTENART.ELEVENLABS_CONVAI,
      reife,
      quelle: "el_kosten_beleg",
      versuche,
      nachreifbar,
      ...elZeilenWerte({ reife, betragMikroCents }),
    });
  }
  return call;
}

function makePortStub(handler) {
  const aufrufe = [];
  return {
    aufrufe,
    async fetchConversation(conversationId) {
      aufrufe.push(conversationId);
      return handler(conversationId);
    },
  };
}

function antwortMit(costFiat) {
  return { metadata: { cost_fiat: costFiat } };
}

function wirftMit404() {
  const err = new Error("ElevenLabs Gespraechsabruf fehlgeschlagen: HTTP 404");
  err.providerStatus = 404;
  throw err;
}

function wirftNetzfehler() {
  throw new Error("fetch failed");
}

test("reifeErgebnis: gleicher Wert -> bestaetigt, kein Wechsel", () => {
  const ergebnis = reifeErgebnis({ altMikroCents: ALT_MIKRO_CENTS, neuMikroCents: ALT_MIKRO_CENTS });
  assert.deepEqual(ergebnis, { mikroCents: ALT_MIKRO_CENTS, ergebnis: EL_REIFUNG_ERGEBNIS.BESTAETIGT });
});

test("reifeErgebnis: hoeherer Wert -> hoeher, der NEUE gilt", () => {
  const ergebnis = reifeErgebnis({ altMikroCents: ALT_MIKRO_CENTS, neuMikroCents: HOEHER_MIKRO_CENTS });
  assert.deepEqual(ergebnis, { mikroCents: HOEHER_MIKRO_CENTS, ergebnis: EL_REIFUNG_ERGEBNIS.HOEHER });
});

test("reifeErgebnis: niedrigerer Wert -> niedriger, der ALTE (hoehere) bleibt", () => {
  const ergebnis = reifeErgebnis({ altMikroCents: ALT_MIKRO_CENTS, neuMikroCents: NIEDRIGER_MIKRO_CENTS });
  assert.deepEqual(ergebnis, { mikroCents: ALT_MIKRO_CENTS, ergebnis: EL_REIFUNG_ERGEBNIS.NIEDRIGER });
});

test("reifungsKandidat: fremdes Profil -> KEIN_EL_PROFIL", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET });
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.KEIN_EL_PROFIL });
});

test("reifungsKandidat: keine elevenlabsConversationId -> KEINE_CONVERSATION_ID", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, withElZeile: false });
  call.elevenlabsConversationId = null;
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.KEINE_CONVERSATION_ID });
});

test("reifungsKandidat: keine elevenlabs_convai-Zeile -> KEINE_EL_ZEILE (disjunkt zum KV2-7-Nachlauf)", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, withElZeile: false });
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.KEINE_EL_ZEILE });
});

test("reifungsKandidat: Zeile bereits belegt -> ZEILE_FERTIG", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, reife: REIFE.BELEGT });
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.ZEILE_FERTIG });
});

test("reifungsKandidat: Zeile terminal (beleg_strukturell_unbeschaffbar) -> ZEILE_FERTIG, kein Abruf", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, betragMikroCents: undefined });
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.ZEILE_FERTIG });
});

test("reifungsKandidat: nachreifbar:false -> NICHT_NACHREIFBAR (Abbruchweg)", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, nachreifbar: false });
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.NICHT_NACHREIFBAR });
});

test("reifungsKandidat: unter dem Mindestalter -> ZU_JUNG; eine Minute aelter -> Kandidat", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const jung = seedElCall(state, { nowMs, endedMinutesAgo: MIN_AGE_MINUTES - 1 });
  const rJung = reifungsKandidat({
    call: jung, belege: callCostEvidence(state, jung.id), nowMs,
    minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS,
  });
  assert.deepEqual(rJung, { kandidat: false, grund: EL_REIFUNG_SKIP.ZU_JUNG });

  const alt = seedElCall(state, { nowMs, endedMinutesAgo: MIN_AGE_MINUTES + 1 });
  const rAlt = reifungsKandidat({
    call: alt, belege: callCostEvidence(state, alt.id), nowMs,
    minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS,
  });
  assert.equal(rAlt.kandidat, true);
});

test("reifungsKandidat: Versuche erschoepft -> VERSUCHE_ERSCHOEPFT (Traeger-eigener Zaehler)", () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, versuche: MAX_ATTEMPTS });
  const belege = callCostEvidence(state, call.id);
  const ergebnis = reifungsKandidat({ call, belege, nowMs, minAgeMs: MIN_AGE_MINUTES * MS_PER_MINUTE, maxVersuche: MAX_ATTEMPTS });
  assert.deepEqual(ergebnis, { kandidat: false, grund: EL_REIFUNG_SKIP.VERSUCHE_ERSCHOEPFT });
});

function makeStore(state, nowMs) {
  return makeStubStore(state, { nowMs });
}

test("(a) bestaetigt: gleicher cost_fiat -> Zeile belegt, Betrag unveraendert, el_abweichung=0", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });

  assert.deepEqual(bericht.ergebnisse, [EL_REIFUNG_ERGEBNIS.BESTAETIGT]);
  assert.equal(bericht.abweichungen, 0);
  assert.equal(bericht.geprueft, 1);
  assert.equal(bericht.uebrig, 0);
  const [zeile] = callCostEvidence(state, call.id).filter((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.equal(zeile.reife, REIFE.BELEGT);
  assert.equal(zeile.betragMikroCents, ALT_MIKRO_CENTS);
  assert.equal(zeile.versuche, 1);
  assert.ok(zeile.gemessenAt);
  assert.equal(typeof zeile.abstandZumGespraechsendeS, "number");
});

test("(b) hoeher: der ANBIETER-Wert ist hoeher -> belegt mit dem hoeheren, el_abweichung=1", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(HOEHER_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });

  assert.deepEqual(bericht.ergebnisse, [EL_REIFUNG_ERGEBNIS.HOEHER]);
  assert.equal(bericht.abweichungen, 1);
  const [zeile] = callCostEvidence(state, call.id).filter((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.equal(zeile.reife, REIFE.BELEGT);
  assert.equal(zeile.betragMikroCents, HOEHER_MIKRO_CENTS);
});

test("(c) niedriger: der ANBIETER-Wert ist niedriger -> belegt, der ALTE (hoehere) Betrag bleibt, el_abweichung=1", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(NIEDRIGER_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });

  assert.deepEqual(bericht.ergebnisse, [EL_REIFUNG_ERGEBNIS.NIEDRIGER]);
  assert.equal(bericht.abweichungen, 1);
  const [zeile] = callCostEvidence(state, call.id).filter((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.equal(zeile.reife, REIFE.BELEGT);
  assert.equal(zeile.betragMikroCents, ALT_MIKRO_CENTS, "der HOEHERE (alte) Betrag bleibt");
});

test("(d) HTTP 404 -> Zeile bleibt vorlaeufig MIT Betrag, nachreifbar faellt, kein Alarm", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  const port = makePortStub(wirftMit404);

  let bericht;
  const zeilen = await captureConsole(async () => {
    bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });
  });
  assert.ok(!zeilen.some((zeile) => zeile.startsWith("[el-reifung] Befund") || zeile.includes("warn")), "kein Alarm/Befund-Kanal");
  assert.deepEqual(bericht.ergebnisse, [EL_REIFUNG_ERGEBNIS.UNBESCHAFFBAR]);
  const [zeile] = callCostEvidence(state, call.id).filter((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.equal(zeile.reife, REIFE.VORLAEUFIG, "kein terminaler Reifegrad an der ZEILE");
  assert.equal(zeile.nachreifbar, false);
  assert.equal(zeile.betragMikroCents, ALT_MIKRO_CENTS, "der Betrag bleibt stehen (zaehlt weiter in die Belegsumme)");
});

test("(d) Gegenprobe: 500/Netzfehler -> vorlaeufig, nachreifbar bleibt TRUE, nur versuche+1", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  const port = makePortStub(wirftNetzfehler);

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });
  assert.deepEqual(bericht.ergebnisse, [EL_REIFUNG_ERGEBNIS.FEHLVERSUCH]);
  const [zeile] = callCostEvidence(state, call.id).filter((zeile) => zeile.traeger === KOSTENART.ELEVENLABS_CONVAI);
  assert.equal(zeile.reife, REIFE.VORLAEUFIG);
  assert.equal(zeile.nachreifbar, true, "ein Ausfall ist kein Abbruchweg");
  assert.equal(zeile.versuche, 1);
  assert.equal(zeile.betragMikroCents, ALT_MIKRO_CENTS);
});

test("(e) Drossel: bei 30 faelligen Anrufen werden GENAU 25 abgerufen - die AELTESTEN", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const calls = [];
  for (let i = 0; i < DROSSEL_ANZAHL; i++) {
    calls.push(seedElCall(state, {
      nowMs, endedMinutesAgo: STANDARD_ENDED_MINUTES_AGO + DROSSEL_ANZAHL - i,
      elevenlabsConversationId: `conv_${String(i).padStart(CONV_ID_PAD_WIDTH, "0")}0000000000000000000`,
    }));
  }
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: calls, store, elKostenRead: port, billing: BILLING, nowMs });

  assert.equal(port.aufrufe.length, EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP);
  assert.equal(bericht.geprueft, EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP);
  assert.equal(bericht.uebrig, DROSSEL_ANZAHL - EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP);
  const erwarteteAeltesten = calls.slice(0, EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP).map((candidate) => candidate.elevenlabsConversationId);
  assert.deepEqual(port.aufrufe, erwarteteAeltesten, "die abgerufenen Kennungen sind genau die AELTESTEN");
});

test("Mindestalter je Traeger: erschoepfter Versuchszaehler beruehrt call.costTruingAttempts NICHT (Trennung Telnyx/EL)", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, versuche: MAX_ATTEMPTS });
  const vorher = call.costTruingAttempts;
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });
  assert.equal(port.aufrufe.length, 0);
  assert.equal(bericht.geprueft, 0);
  assert.equal(call.costTruingAttempts, vorher, "der Telnyx-Traegerzaehler bleibt unberuehrt");
});

test("Abbruchweg: nachreifbar:false -> 0 Abrufe (kein Anbieter-Datensatz mehr da)", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, nachreifbar: false });
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });
  assert.equal(port.aufrufe.length, 0);
  assert.equal(bericht.geprueft, 0);
});

test("Terminal: beleg_strukturell_unbeschaffbar -> 0 Abrufe, kein Wurf", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, reife: REIFE.STRUKTURELL_UNBESCHAFFBAR, betragMikroCents: undefined });
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  await assert.doesNotReject(() => reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs }));
  assert.equal(port.aufrufe.length, 0);
});

test("Fremdes Profil: telnyx_budget-Anruf mit EL-Zeile-Attrappe -> 0 Abrufe", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs, profil: KOSTENPROFIL.TELNYX_BUDGET });
  const store = makeStore(state, nowMs);
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  const bericht = await reifeElBelege({ candidates: [call], store, elKostenRead: port, billing: BILLING, nowMs });
  assert.equal(port.aufrufe.length, 0);
  assert.equal(bericht.geprueft, 0);
});

test("Port fehlt (elKostenRead: null) -> vollstaendiges No-op, kein Store-Zugriff", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  let geladen = false;
  const spionStore = { ...store, load: () => { geladen = true; return store.load(); } };

  const bericht = await reifeElBelege({ candidates: [call], store: spionStore, elKostenRead: null, billing: BILLING, nowMs });
  assert.deepEqual(bericht, { ergebnisse: [], abweichungen: 0, geprueft: 0, uebrig: 0 });
  assert.equal(geladen, false, "ohne Port wird der Store nicht einmal gelesen");
});

test("fail-soft: wirft der Store beim Schreiben, laeuft der Reifungs-Zweig trotzdem zu Ende", async () => {
  const state = makeDefaultState();
  const nowMs = Date.now();
  const call = seedElCall(state, { nowMs });
  const store = makeStore(state, nowMs);
  const werfenderStore = {
    ...store,
    recordCallCostEvidence: () => {
      throw new Error("Store kaputt");
    },
  };
  const port = makePortStub(() => antwortMit(ALT_COST_FIAT));

  await assert.doesNotReject(() =>
    reifeElBelege({ candidates: [call], store: werfenderStore, elKostenRead: port, billing: BILLING, nowMs }),
  );
});

test("(f) die vollstaendige Sweep-Zeile traegt el_reifung=/el_abweichung=/el_uebrig= am Ende, Bestandsfelder unveraendert", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  seedElCall(state, { nowMs });
  const store = makeStubStore(state, { nowMs });
  const elKostenRead = makePortStub(() => antwortMit(ALT_COST_FIAT));
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({}), audit: () => {}, elKostenRead, now: () => nowMs,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = lines.filter((zeile) => zeile.startsWith("[cost-truing] sweep "));
  assert.match(line, /abschluesse=\S+ el_reifung=bestaetigt\(1\) el_abweichung=0 el_uebrig=0$/);
});

test("elKostenRead nicht injiziert -> el_reifung=keine in der Sweep-Zeile (Bestandssweep unveraendert gruen)", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const store = makeStubStore(state, { nowMs });
  const { runCostTruingSweep } = makeCostTruing({
    store, config: fakeConfig(), voiceControl: fakeVoiceControl({}), audit: () => {}, now: () => nowMs,
  });

  const lines = await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
  const [line] = lines.filter((zeile) => zeile.startsWith("[cost-truing] sweep "));
  assert.match(line, /el_reifung=keine el_abweichung=0 el_uebrig=0$/);
});

test("Z1: pflichttypenFuerProfil(EL_CONVAI_SIP) liefert ['sip-trunking'], eingefroren, identisch mit dem Sweep-Belegtyp", () => {
  const menge = pflichttypenFuerProfil(KOSTENPROFIL.EL_CONVAI_SIP, []);
  assert.deepEqual(menge, ["sip-trunking"]);
  assert.ok(Object.isFrozen(menge));
  assert.notEqual(menge, []);
  assert.equal(menge[0], SIP_TRUNKING_RECORD_TYPE);
});

test("Z2: die gesetzte Pflicht-Typmenge ist auf dem Geldweg heute VERHALTENSNEUTRAL - " +
  "ein el_convai_sip-Anruf bleibt 'incomplete', mit UND ohne sip-trunking-Beleg im Pool", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  const call = seedElCall(state, { nowMs, withElZeile: false });
  call.sipCallId = "SCL_kv2_9_z2_test";
  call.estimatedCostCents = Z2_SCHAETZUNG_CENTS;
  const store = makeStubStore(state, { nowMs });
  const controlOhneBeleg = {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords() {
      return { ok: true, records: [] };
    },
  };
  const controlMitBeleg = {
    async fetchCostRecordPool() {
      return { ok: true, raw: [], complete: true };
    },
    assignCostRecords() {
      return {
        ok: true,
        records: [{
          recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: Z2_SIP_BELEG_MIKRO_CENTS,
          currency: "USD", billedSec: Z2_SIP_BELEG_BILLED_SEC, legId: "SCL_kv2_9_z2_test",
        }],
      };
    },
  };

  for (const control of [controlOhneBeleg, controlMitBeleg]) {
    const { runCostTruingSweep } = makeCostTruing({
      store, config: fakeConfig(), voiceControl: fakeVoiceControl({ telnyx: control }), audit: () => {}, now: () => nowMs,
    });
    await captureConsole(() => runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL }));
    assert.notEqual(
      call.costTruedSource, "telnyx_detail_records",
      `Kontrolle mit records=${control === controlMitBeleg}: darf NIE 'telnyx_detail_records' behaupten`,
    );
  }
});
