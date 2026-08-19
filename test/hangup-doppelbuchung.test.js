// Doppelte Zustellung des Auflege-Ereignisses: bucht finishCall den Anruf zweimal ab?
// Ein Post-Call-/Hangup-Webhook wird bei JEDEM Anbieter mehrfach zugestellt (Retry nach
// Timeout, At-least-once) - das ist der Normalfall, nicht die Ausnahme. Doppelt
// abgerechnete Kunden sind der schwerste Fehler, den ein Abo-Produkt haben kann, darum
// ist die Frage hier drei Lagen tief gepinnt: sequenziell, nebenlaeufig, ueber
// Prozessgrenzen.
//
// GEMESSEN wird bei JEDER Lage auf BEIDEN Buchungswegen getrennt (finishCall bucht auf
// zwei voneinander unabhaengige Achsen, ein Riegel-Defekt kann nur eine davon treffen):
//   1) Zaehler des Bezahlpfads - recordVoiceMinuteMeter -> usage_event(voice_minute),
//      nur bei paymentEnabled; das ist die Achse, aus der die Kundenrechnung entsteht.
//   2) Budget-Achse - reconcileVoiceBudget -> addVoiceUsageCostCents, IMMER und in beiden
//      Richtungen; das ist die Achse, die die pro-Tenant-Kostendecke liest.
//
// Alle vier Faelle starten GRUEN: gemessen wurde kein Defekt. Sie sind Regressionsschutz,
// und sie beissen - per Mutation am Produktionscode nachgewiesen, welcher Riegel welche
// Lage traegt: nimmt man den In-Prozess-Marker call._finished weg, bleibt alles gruen
// (billedAt faengt beides ab); nimmt man den billedAt-Riegel weg, faellt NUR (c); nimmt man
// beide weg, fallen (a), (b) und (c). Genau diese Aufteilung ist das, was die drei Faelle
// zusammen bewachen - einzeln wuerde jeder von ihnen einen halben Riegel-Verlust nicht sehen.
//
// ABGRENZUNG zum Bestand (G5, keine Kopie): store-pg-billing-idempotent.test.js pinnt den
// Marker markBilled/billedAt als reine State-Op plus seinen Persistenz-Roundtrip, ohne je
// eine Buchung auszuloesen. finishcall-billing-once.test.js faehrt die Restart-Lage ueber
// einen echten Server-Spawn, misst aber NUR die Budget-Achse. Hier laeuft der echte
// Produktions-Seam (billThunk -> finishCall -> metering) gegen einen echten Store, und
// beide Achsen werden je Lage einzeln nachgezaehlt.
//
// ISOLATION: pglite NIE mit einem Server-Spawn in einer Datei (P3/P6a-Lehre) - hier nur
// pglite (Postgres-in-WASM, kein Netz, offline und schnell).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { billThunk } from "../src/telephony/call-termination.js";
import { makeMetering, voiceMinutesOf, callTariffCentsPerMin } from "../src/billing/metering.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";

// Fixes Abrechnungsfenster statt Uhr: answeredAt..endedAt liegt fest, also ist auch die
// gebuchte Minutenzahl fest (Muster voice-budget-reconcile-finishcall.test.js).
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
// Beide Enden mit +49: der Leg-Tarif ist damit eindeutig der Inlandssatz.
const DOMESTIC_FROM = "+4915112345678";
const DOMESTIC_TO = "+4915199999999";

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert den Spiegel
// aus der DB) -> simuliert den Prozess-Neustart zwischen Abrechnung und Retry (Muster
// store-pg-billing-idempotent.test.js).
async function oeffneStore(db) {
  const runner = {
    withClient: (fn) =>
      fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// Ein Stub, der beim Aufruf scheitert: die genannten Mitarbeiter duerfen im
// Leeres-Transkript-Fruehe-Return-Zweig NICHT laufen (Muster
// gq-p15-failure-reason-notification.test.js). Ein stiller LLM-/SMS-Pfad im Test waere
// genau die Unschaerfe, die eine Doppelbuchungs-Messung wertlos macht.
function throwing(label) {
  return () => {
    throw new Error(`${label} haette im Fruehe-Return-Zweig nicht laufen duerfen`);
  };
}

// Verdrahtet den echten Produktionspfad gegen den echten Store: makeMetering + makeCallFinish
// wie in boot.js. withStoreLock kommt in Produktion aus der store.js-Fassade und nicht aus
// dem pg-Backend - hier dieselbe Rolle als durchreichender Single-Writer-Guard.
// paymentEnabled=true, weil sonst NUR die Budget-Achse liefe und der Zaehler des
// Bezahlpfads ungemessen bliebe (die Achse, aus der die Kundenrechnung entsteht).
function verdrahteFinishCall(pgStore) {
  const store = { ...pgStore, withStoreLock: async (fn) => fn() };
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: true, smsCostCents: 0 }, privacy: {} },
    metering: makeMetering({ store }),
    messaging: throwing("messaging"),
    summarizeCall: throwing("summarizeCall"),
    planSummarySms: throwing("planSummarySms"),
    audit: throwing("audit"),
  });
  return { store, finishCall: callFinish.finishCall };
}

// Ein beendeter Outbound-Call mit festen Ankern - der Zustand, in dem ein Auflege-Ereignis
// den Call antrifft. endedAt ueber den echten Terminalisierer mit explizitem Anker;
// answeredAt direkt, weil markAnswered die Uhr nimmt und die Minutenzahl dann driftete.
// Leeres Transkript -> finishCall returnt vor jedem LLM-Aufruf (kein Modell-Mock noetig).
function seedeBeendetenCall(store) {
  const call = store.createCall({
    direction: "outbound",
    from: DOMESTIC_FROM,
    to: DOMESTIC_TO,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.answeredAt = ANSWERED_AT;
  store.setCallEndedAt(call.id, "completed", ENDED_AT);
  return call;
}

// Der Betrag EINER korrekten Buchung, aus denselben zwei Quellen gerechnet, aus denen
// finishCall ihn rechnet (Minuten x Leg-Tarif). Bewusst nicht als Cent-Literal gepinnt:
// der Tarif kommt aus der Konfiguration, und dieser Test misst die ANZAHL der Buchungen,
// nicht ihre Hoehe. Der Riegel gegen eine leere Messung sitzt in der Assertion: waere der
// Betrag 0, wuerden "einmal gebucht" und "zweimal gebucht" ununterscheidbar.
function erwarteteBuchungCents(call) {
  const cents = voiceMinutesOf(call) * callTariffCentsPerMin(call);
  assert.ok(cents > 0, "Messvoraussetzung: eine Buchung muss von null unterscheidbar sein");
  return cents;
}

// Beide Buchungswege eines Calls, getrennt gezaehlt (Spiegel-Lesung, kein DB-Roundtrip).
function buchungsachsen(store, callId) {
  const state = store.load();
  return {
    budgetCents: store.usageOf(BOOTSTRAP_TENANT_ID).costCents,
    meterBelege: state.usageEvents.filter(
      (beleg) => beleg.callId === callId && beleg.kind === USAGE_EVENT_KIND.VOICE_MINUTE,
    ).length,
  };
}

// Das Auflege-Ereignis, so wie es jeder der Terminierungspfade ausloest: billThunk liest den
// Call FRISCH aus dem Store (nicht das evtl. veraltete Objekt des Aufrufers) und uebergibt
// ihn an finishCall.
const auflegeEreignis = (store, finishCall, callId) => billThunk(finishCall, store, callId);

// POSITIV-KONTROLLE (Pflicht): ohne sie besteht ein "Fix", der gar nichts mehr bucht, jeden
// der drei Faelle unten - "nicht doppelt" waere dann trivial wahr. Dieser Fall pinnt die
// andere Haelfte: EIN Ereignis bucht auf BEIDEN Wegen genau EINMAL, und zwar nicht null.
test("Positiv-Kontrolle: EIN Auflege-Ereignis bucht auf beiden Wegen genau einmal", async () => {
  const store0 = await oeffneStore(new PGlite());
  const { store, finishCall } = verdrahteFinishCall(store0);
  const call = seedeBeendetenCall(store);

  await auflegeEreignis(store, finishCall, call.id)();

  assert.deepEqual(buchungsachsen(store, call.id), {
    budgetCents: erwarteteBuchungCents(call),
    meterBelege: 1,
  });
  assert.ok(store.getCall(call.id).billedAt, "der Bucht-Riegel steht nach der Buchung");
});

// LAGE (a): dasselbe Auflege-Ereignis zweimal NACHEINANDER - der klassische Webhook-Retry,
// nachdem unsere Antwort den Anbieter nicht mehr erreicht hat.
test("(a) sequenziell: dasselbe Auflege-Ereignis zweimal nacheinander bucht nicht doppelt", async () => {
  const store0 = await oeffneStore(new PGlite());
  const { store, finishCall } = verdrahteFinishCall(store0);
  const call = seedeBeendetenCall(store);
  const einmal = { budgetCents: erwarteteBuchungCents(call), meterBelege: 1 };

  await auflegeEreignis(store, finishCall, call.id)();
  await auflegeEreignis(store, finishCall, call.id)();

  assert.deepEqual(buchungsachsen(store, call.id), einmal);
});

// LAGE (b): zwei Auflege-Ereignisse GLEICHZEITIG, ohne await dazwischen - zwei
// Zustellungen desselben Webhooks, die sich im selben Prozess ueberlappen.
test("(b) nebenlaeufig: zwei gleichzeitige Auflege-Ereignisse buchen nicht doppelt", async () => {
  const store0 = await oeffneStore(new PGlite());
  const { store, finishCall } = verdrahteFinishCall(store0);
  const call = seedeBeendetenCall(store);
  const einmal = { budgetCents: erwarteteBuchungCents(call), meterBelege: 1 };

  await Promise.all([
    auflegeEreignis(store, finishCall, call.id)(),
    auflegeEreignis(store, finishCall, call.id)(),
  ]);

  assert.deepEqual(buchungsachsen(store, call.id), einmal);
});

// LAGE (c): der Riegel muss auch ueber Prozessgrenzen halten. Der In-Prozess-Marker
// call._finished ueberlebt keinen Neustart (er wird nie persistiert) - traegt allein der
// persistierte billedAt-Marker, findet der zweite Prozess ihn und bucht nicht erneut.
test("(c) ueber Prozessgrenzen: nach einem Neustart bucht dasselbe Auflege-Ereignis nicht erneut", async () => {
  const db = new PGlite();
  const ersterProzess = verdrahteFinishCall(await oeffneStore(db));
  const call = seedeBeendetenCall(ersterProzess.store);
  const einmal = { budgetCents: erwarteteBuchungCents(call), meterBelege: 1 };

  await auflegeEreignis(ersterProzess.store, ersterProzess.finishCall, call.id)();
  await ersterProzess.store.save();

  // Neustart auf DERSELBEN DB: frischer Spiegel, frisches (leeres) call._finished.
  const zweiterProzess = verdrahteFinishCall(await oeffneStore(db));
  assert.equal(
    zweiterProzess.store.getCall(call.id)._finished,
    undefined,
    "der In-Prozess-Marker ueberlebt den Neustart nicht - nur billedAt kann hier riegeln",
  );

  await auflegeEreignis(zweiterProzess.store, zweiterProzess.finishCall, call.id)();

  assert.deepEqual(buchungsachsen(zweiterProzess.store, call.id), einmal);
});
