// KV-P1 (PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): faehrt die Kosten-Landkarte
// (src/billing/cost-ledger-map.js) gegen die REALITAET, nicht gegen eine zweite Konstante.
// Fuer JEDE Zeile wird der echte Produktions-Buchungspfad ausgeloest (recordVoiceMinuteMeter/
// reconcileOutboundVoiceBudget, bookTokenUsage, bookResearchSearchFee/bookLookupSearchFee,
// finishCall (SMS), recordNumberMonthMeter, recordTenantTtsCharacters) und danach werden
// BEIDE Buecher gelesen: Buch A = der Verbrauchs-Ledger (usage_event), Buch B = die
// Gate-Achse (usage.costCents/costMicroCentsRem). Kein Server-Spawn, kein Netz (P12).
//
// ZWEI Testnaehte in dieser Datei, bewusst getrennt:
//   (1) direkter state-ops-Zugriff (Muster test/metering-unit.test.js): makeMetering/
//       makeCallFinish/recordTenantTtsCharacters gegen einen selbst gebauten `s =
//       makeDefaultState()`, ueber einen duennen Adapter, der echte state-ops-Funktionen
//       aufruft. Kein config.js/store.js-Singleton involviert.
//   (2) dynamischer Import NACH Env (Muster test/al-p10-precall-research.test.js) fuer
//       ai_token/research_fee: bookTokenUsage/bookResearchSearchFee/bookLookupSearchFee in
//       src/llm-usage.js sprechen mit dem ECHTEN src/store.js-Singleton, der wiederum
//       src/config.js singleton-artig laedt. Deshalb duerfen metering.js/outbound-gates.js
//       (transitiv config.js) in DIESER Datei NICHT statisch importiert werden - ein
//       frueher Import wuerde config.js VOR unserem before()-Env-Setup fixieren und
//       DATA_DIR/PAYMENT_ENABLED aus (2) wirkungslos machen. makeMetering/tariffCentsPerMin
//       werden deshalb ebenfalls dynamisch importiert (in DEMSELBEN before()), obwohl Naht
//       (1) sie selbst nicht braucht - Sicherheitsabstand statt Beweislast.
//
// MUTATIONSPROBEN (manuell waehrend der Abnahme, NICHT Teil dieses Testcodes):
//   (a) EINE Zeile luegen lassen (z.B. sms.gate testweise auf true) -> der zugehoerige
//       Verhaltenstest unten muss ROT werden (er liest weiterhin usageOf(...).costCents
//       unveraendert). Bleibt er gruen, ist der Test eine Tautologie.
//   (b) einen Wert in USAGE_EVENT_KIND ergaenzen ohne Tabellenzeile -> KV-P1-8 rot.
//   (c) eine Tabellenzeile entfernen, deren Kosten-Art es weiterhin gibt -> KV-P1-9 rot
//       (verwaiste ledger:true-Zeile) bzw. KV-P1-8 rot (Enum-Wert ohne Zeile).
//   (d) einen zweiten Aufruf von store.addVoiceUsageCostCents( anlegen -> KV-P1-10 rot,
//       UNABHAENGIG davon, ob dieser zweite Aufruf in src/billing/metering.js selbst
//       steht (zweiter Aufruf in DERSELBEN Datei) oder in einer anderen src-Datei -
//       der Riegel zaehlt Vorkommen ueber alle src-Dateien hinweg, nicht Dateinamen.
// Jede Mutation danach zuruecknehmen, npm test wieder gruen.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDataDir, seedState, seedCall, DOMESTIC_TEST_NUMBER } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID, USAGE_EVENT_KIND, NUMBER_STATUS } from "../src/store/defaults.js";
import {
  makeDefaultState,
  recordUsageEvent,
  addVoiceUsageCostCents,
  recordCallEstimatedCostCents,
  usageOf,
  recordTenantTtsCharacters,
  aiCostCents,
} from "../src/store/state-ops.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { COST_LEDGER_MAP } from "../src/billing/cost-ledger-map.js";

// ---- Fixtures (benannt statt Magic Numbers, G25) --------------------------------------
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT_PLUS_ONE_MINUTE = "2026-01-01T00:01:00.000Z";
const VOICE_CALL_TO = "+491701234567"; // DE, wie DOMESTIC_TEST_NUMBER.from -> Inlandstarif
const MONTHLY_RENT_CENTS = 92; // beliebiger, von 0 verschiedener Fixture-Wert (Muster metering-unit.test.js)
const SMS_COST_CENTS_FIXTURE = 7; // bewusst NICHT 0 - eine 0 waere eine leere 0===0-Assertion
const RESEARCH_FEE_CENTS_FIXTURE = 3;
const LOOKUP_FEE_CENTS_FIXTURE = 4;
const TTS_CHARACTERS_FIXTURE = 42;
// Ein 5/5-Token-Turn rundet mit den heutigen Modellpreisen (claude-haiku-4-5: 1,0/5,0 USD
// je Mio. Token, usdToEur 0,92) auf 0 EUR-Cent - das demonstriert die ai_token-Zeile. Die
// Fixture-Behauptung wird unten GEGEN DIE ECHTE FORMEL (aiCostCents) geprueft, nicht
// hart erwartet - aendern sich die Preise, faellt genau diese Assertion zuerst auf.
const AI_TOKEN_TURN = Object.freeze({ input_tokens: 5, output_tokens: 5 });
const AI_TOKEN_MODEL = "claude-haiku-4-5";
const AI_TOKEN_TURNS_COUNT = 3; // mind. 2 (Plan-Vorgabe): die Divergenz ist ein Verlauf, kein Einzelwert

const TENANT_VOICE_OUT = "kvp1_voice_out";
const TENANT_VOICE_IN = "kvp1_voice_in";
const TENANT_NUMBER_MONTH = "kvp1_number_month";
const TENANT_TTS = "kvp1_tts";
const TENANT_AI = "kvp1_ai_token";
const TENANT_RESEARCH = "kvp1_research_fee";

// ---- Naht (2): dynamischer Import NACH Env (Muster al-p10-precall-research.test.js) ----
let config, store, makeMetering, tariffCentsPerMin, bookTokenUsage, bookResearchSearchFee, bookLookupSearchFee;

before(async () => {
  process.env.PAYMENT_ENABLED = "true"; // ai_token-Zeile: meterAiTokens gated auf PAYMENT_ENABLED
  process.env.RESEARCH_SEARCH_FEE_CENTS = String(RESEARCH_FEE_CENTS_FIXTURE);
  process.env.LOOKUP_SEARCH_FEE_CENTS = String(LOOKUP_FEE_CENTS_FIXTURE);
  process.env.DATA_DIR = tempDataDir(
    seedState({ tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }] }),
  );
  config = (await import("../src/config.js")).config;
  store = await import("../src/store.js");
  ({ makeMetering } = await import("../src/billing/metering.js"));
  ({ tariffCentsPerMin } = await import("../src/telephony/outbound-gates.js"));
  ({ bookTokenUsage, bookResearchSearchFee, bookLookupSearchFee } = await import("../src/llm-usage.js"));
});

// Kreuzprobe GEGEN DIE TABELLE (nicht nur gegen eine hart erwartete Zahl): jede Zeile
// unten berechnet aus dem beobachteten Verhalten zwei Booleans (ledgerWrote/gateWrote)
// und diese Funktion vergleicht sie mit COST_LEDGER_MAP[rowName].ledger/.gate. Eine
// geluegene Tabellenzeile (z.B. sms.gate testweise auf true) aendert damit die
// ERWARTUNG, nicht die Beobachtung - assert.equal schlaegt dann fehl, weil der
// tatsaechliche Code sich nicht mitgeaendert hat. Ohne diese Kreuzprobe wuerden die
// Tests unten nur gegen eine hart einprogrammierte Erwartung pruefen und liefen bei
// einer geluegenen Zeile weiterhin gruen durch - genau die Tautologie-Falle des Plans.
function assertRowMatchesObservation(rowName, { ledgerWrote, gateWrote }) {
  const row = COST_LEDGER_MAP[rowName];
  assert.equal(
    ledgerWrote,
    row.ledger,
    `Zeile '${rowName}': Tabelle sagt ledger=${row.ledger}, beobachtet wurde ${ledgerWrote}`,
  );
  assert.equal(
    gateWrote,
    row.gate,
    `Zeile '${rowName}': Tabelle sagt gate=${row.gate}, beobachtet wurde ${gateWrote}`,
  );
}

// ---- Naht (1): duenner Adapter, der echte state-ops-Funktionen gegen ein `s` aufruft ----
// (Muster test/metering-unit.test.js: fakeStore faengt NICHTS - er REICHT DURCH.)
function realMeteringStore(s) {
  return {
    recordUsageEvent: (ev) => recordUsageEvent(s, ev),
    addVoiceUsageCostCents: (tenantId, costCents) => addVoiceUsageCostCents(s, tenantId, costCents),
    recordCallEstimatedCostCents: (callId, input) => recordCallEstimatedCostCents(s, callId, input),
  };
}

function makeVoiceCall(tenantId, overrides = {}) {
  return {
    id: `${tenantId}_call`,
    tenantId,
    to: VOICE_CALL_TO,
    from: DOMESTIC_TEST_NUMBER.e164,
    direction: "outbound",
    answeredAt: ANSWERED_AT,
    endedAt: ENDED_AT_PLUS_ONE_MINUTE,
    ...overrides,
  };
}

test("KV-P1-1 voice_minute_outbound: Ledger UND Gate tragen denselben Betrag", () => {
  const s = makeDefaultState();
  const { recordVoiceMinuteMeter, reconcileOutboundVoiceBudget } = makeMetering({
    store: realMeteringStore(s),
  });
  const call = makeVoiceCall(TENANT_VOICE_OUT);

  recordVoiceMinuteMeter(call);
  reconcileOutboundVoiceBudget(call);

  const events = s.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE);
  const gateCents = usageOf(s, TENANT_VOICE_OUT).costCents;
  assertRowMatchesObservation("voice_minute_outbound", {
    ledgerWrote: events.length > 0,
    gateWrote: gateCents > 0,
  });

  assert.equal(events.length, 1, "Buch A: genau ein Voice-Minute-Beleg");
  const erwarteterTarif = tariffCentsPerMin(call.to, call.from);
  assert.equal(events[0].costCents, 1 * erwarteterTarif);
  assert.equal(gateCents, 1 * erwarteterTarif, "Buch B: der Budget-Bucket traegt denselben Betrag");
});

test("KV-P1-2 voice_minute_inbound: Ledger feuert trotzdem, Gate bleibt bei 0 (die Hauptluecke)", () => {
  const s = makeDefaultState();
  const { recordVoiceMinuteMeter, reconcileOutboundVoiceBudget } = makeMetering({
    store: realMeteringStore(s),
  });
  const call = makeVoiceCall(TENANT_VOICE_IN, { direction: "inbound" });

  recordVoiceMinuteMeter(call);
  reconcileOutboundVoiceBudget(call);

  const events = s.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE);
  const gateCents = usageOf(s, TENANT_VOICE_IN).costCents;
  assertRowMatchesObservation("voice_minute_inbound", {
    ledgerWrote: events.length > 0,
    gateWrote: gateCents > 0,
  });

  assert.equal(events.length, 1, "Buch A: der Ledger kennt keine Richtung - der Beleg steht trotzdem");
  assert.equal(
    gateCents,
    0,
    "Buch B: reconcileOutboundVoiceBudget filtert inbound heraus - das ist die Luecke, die KV-P2 schliesst",
  );
});

test("KV-P1-3 ai_token: jede Buchung landet 0-gerundet im Ledger, das Gate akkumuliert den Mikro-Cent-Rest weiter", () => {
  // aiCostCents erwartet die BEREITS KONVERTIERTE Form {inputTokens, outputTokens, model}
  // (billedTokens in llm-usage.js), nicht die rohe Anthropic-usage {input_tokens,
  // output_tokens} - dieselbe Umbenennung, die bookTokenUsage intern vornimmt.
  const billedForm = {
    inputTokens: AI_TOKEN_TURN.input_tokens,
    outputTokens: AI_TOKEN_TURN.output_tokens,
    model: AI_TOKEN_MODEL,
  };
  assert.equal(
    aiCostCents(billedForm, config.llm),
    0,
    "Fixture-Anspruch: ein 5/5-Token-Turn rundet mit den heutigen Modellpreisen auf 0 EUR-Cent",
  );

  const microRestVerlauf = [];
  for (let turn = 0; turn < AI_TOKEN_TURNS_COUNT; turn++) {
    bookTokenUsage({ tenantId: TENANT_AI, callId: "kvp1_call_ai", usage: AI_TOKEN_TURN, model: AI_TOKEN_MODEL });
    microRestVerlauf.push(store.usageOf(TENANT_AI).costMicroCentsRem);
  }

  const ledgerEvents = store
    .load()
    .usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.AI_TOKEN && e.tenantId === TENANT_AI);

  // Gate-Signal DIESER Zeile ist bewusst der Mikro-Cent-Rest, nicht die Ganzzahl-Projektion
  // usageOf(...).costCents: die Fixture ist ABSICHTLICH so klein gewaehlt, dass costCents
  // ueber alle AI_TOKEN_TURNS_COUNT Turns hinweg 0 bleibt (der volle Cent-Uebertrag
  // braucht weit mehr Turns) - genau costMicroCentsRem ist die Groesse, die die Zeile
  // behauptet ("verliert den Rest NIE").
  assertRowMatchesObservation("ai_token", {
    ledgerWrote: ledgerEvents.length > 0,
    gateWrote: microRestVerlauf[microRestVerlauf.length - 1] > 0,
  });

  assert.equal(ledgerEvents.length, AI_TOKEN_TURNS_COUNT, "Buch A: ein Beleg je Turn");
  assert.ok(
    ledgerEvents.every((e) => e.costCents === 0),
    "Buch A: JEDE einzelne Buchung zeigt 0 - der Turn ist zu klein",
  );

  assert.ok(microRestVerlauf[0] > 0, "Buch B: schon nach dem ERSTEN Turn traegt der Mikro-Cent-Rest > 0");
  for (let i = 1; i < microRestVerlauf.length; i++) {
    assert.ok(
      microRestVerlauf[i] > microRestVerlauf[i - 1],
      "Buch B: der Rest waechst mit jedem weiteren Turn - genau die Divergenz, die Buch A pro Ereignis nie zeigt",
    );
  }
});

test("KV-P1-4 research_fee: die Suchgebuehr erreicht NUR das Gate, nie den Ledger", () => {
  const eventsVorher = store.load().usageEvents.length;
  const gateVorher = store.usageOf(TENANT_RESEARCH).costCents;

  bookResearchSearchFee({ tenantId: TENANT_RESEARCH, searches: 1 });
  bookLookupSearchFee({ tenantId: TENANT_RESEARCH });

  const eventsNachher = store.load().usageEvents.length;
  const gateNachher = store.usageOf(TENANT_RESEARCH).costCents;

  assertRowMatchesObservation("research_fee", {
    ledgerWrote: eventsNachher > eventsVorher,
    gateWrote: gateNachher > gateVorher,
  });

  assert.equal(eventsNachher, eventsVorher, "Buch A: usage_event kennt kein research-kind - kein Beleg entsteht");
  assert.equal(
    gateNachher - gateVorher,
    config.research.researchSearchFeeCents + config.research.lookupSearchFeeCents,
    "Buch B: beide Gebuehren addieren sich auf denselben Bucket",
  );
});

test("KV-P1-5 sms: die Summary-SMS bucht den Ledger, das Gate bleibt unberuehrt", async () => {
  const s = makeDefaultState();
  const call = seedCall({
    tenantId: BOOTSTRAP_TENANT_ID,
    direction: "outbound",
    status: "completed",
    to: "+12025550123",
    transcript: [{ role: "caller", text: "Hallo", at: ANSWERED_AT }],
  });
  const callFinishConfig = { billing: { paymentEnabled: false, smsCostCents: SMS_COST_CENTS_FIXTURE }, privacy: {} };
  const { finishCall } = makeCallFinish({
    store: {
      withStoreLock: (fn) => fn(),
      releaseOutboundReserve: async () => {},
      save: () => {},
      addNotification: () => {},
      purgeTranscript: () => {},
      tenantContext: () => ({ settings: { agentName: "Hermes" } }),
      recordUsageEvent: (ev) => recordUsageEvent(s, ev),
      markSummarySmsSent: () => {},
      markBilled: () => {},
    },
    config: callFinishConfig,
    // Metering isoliert ausgeschaltet (Muster test/web-14-call-finish-sms-text-language.test.js):
    // diese Zeile prueft NUR den SMS-Pfad, nicht die Voice-Metering-Zeilen aus KV-P1-1/2.
    metering: { recordVoiceMinuteMeter: () => {}, reconcileOutboundVoiceBudget: () => {} },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: async () => ({ summary: "Testzusammenfassung", actionItems: [] }),
    planSummarySms: () => ({ send: true, to: "+12025550199", smsFrom: { e164: "+12025550001" } }),
    audit: () => {},
  });

  await finishCall(call);

  const events = s.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.SMS);
  const gateCents = usageOf(s, BOOTSTRAP_TENANT_ID).costCents;
  assertRowMatchesObservation("sms", { ledgerWrote: events.length > 0, gateWrote: gateCents > 0 });

  assert.equal(events.length, 1, "Buch A: genau ein SMS-Beleg");
  assert.equal(events[0].costCents, SMS_COST_CENTS_FIXTURE);
  assert.equal(gateCents, 0, "Buch B: kein addUsageCostCents/trackUsage-Aufruf im SMS-Pfad");
});

function makeNumberFixture(tenantId) {
  return {
    id: `${tenantId}_num`,
    tenantId,
    country: "DE",
    status: NUMBER_STATUS.ACTIVE,
    monthlyCostCents: MONTHLY_RENT_CENTS,
  };
}

test("KV-P1-6 number_month: mit gelerntem Preis feuert der Ledger, das Gate bleibt unberuehrt", () => {
  const s = makeDefaultState();
  const { recordNumberMonthMeter } = makeMetering({ store: realMeteringStore(s) });
  const number = makeNumberFixture(TENANT_NUMBER_MONTH);

  const gebucht = recordNumberMonthMeter(number, ANSWERED_AT);

  assert.ok(gebucht, "mit gelerntem Preis feuert der Ledger - widerlegt eine ledger:false-Deklaration");
  const events = s.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.NUMBER_MONTH);
  const gateCents = usageOf(s, TENANT_NUMBER_MONTH).costCents;
  assertRowMatchesObservation("number_month", { ledgerWrote: events.length > 0, gateWrote: gateCents > 0 });

  assert.equal(events.length, 1);
  assert.equal(events[0].costCents, MONTHLY_RENT_CENTS);
  assert.equal(gateCents, 0, "kein addUsageCostCents-Aufruf im number_month-Pfad, unabhaengig vom Preis");
});

test("KV-P1-7 play_tts_characters: zaehlt Zeichen, beruehrt weder Ledger noch Gate", () => {
  const s = makeDefaultState();

  recordTenantTtsCharacters(s, TENANT_TTS, TTS_CHARACTERS_FIXTURE);

  const usage = usageOf(s, TENANT_TTS);
  assertRowMatchesObservation("play_tts_characters", {
    ledgerWrote: s.usageEvents.length > 0,
    gateWrote: usage.costCents > 0,
  });

  assert.equal(s.usageEvents.length, 0, "Buch A: kein recordUsageEvent-Aufruf im TTS-Zaehlpfad");
  assert.equal(usage.costCents, 0, "Buch B: keine Cent-Achse beruehrt");
  assert.equal(usage.ttsCharacters, TTS_CHARACTERS_FIXTURE, "einziger Effekt ist das Zeichen-Feld");
});

// ---- Vollstaendigkeits-Riegel (Teil 3 des Plans) --------------------------------------

test("KV-P1-8: jeder USAGE_EVENT_KIND-Wert hat mindestens eine Tabellenzeile", () => {
  const gedeckt = new Set(
    Object.values(COST_LEDGER_MAP)
      .map((r) => r.kind)
      .filter((k) => k !== null),
  );
  for (const kind of Object.values(USAGE_EVENT_KIND))
    assert.ok(gedeckt.has(kind), `USAGE_EVENT_KIND '${kind}' hat keine Tabellenzeile`);
});

test("KV-P1-9: jede ledger:true-Zeile referenziert einen echten USAGE_EVENT_KIND", () => {
  for (const [name, row] of Object.entries(COST_LEDGER_MAP)) {
    if (!row.ledger) continue;
    assert.ok(
      Object.values(USAGE_EVENT_KIND).includes(row.kind),
      `Zeile '${name}' hat ledger:true aber kind='${row.kind}' ist kein USAGE_EVENT_KIND`,
    );
  }
});

// ---- Ein-Aufrufer-Riegel (Teil 4 des Plans, TOD 2) -------------------------------------

// Rekursiver .js-Scan unter <repo-root>/<relDir>. Kein bestehender Helfer in helpers.js
// (geprueft) - privat hier, weil nur dieser eine Test ihn braucht (G5).
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git"]);

function alleSrcDateien(relDir) {
  const treffer = [];
  const stack = [path.join(REPO_ROOT, relDir)];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) treffer.push(full);
    }
  }
  return treffer;
}

test("KV-P1-10: addVoiceUsageCostCents hat genau EIN Vorkommen von store.addVoiceUsageCostCents() in src/", () => {
  const CALL_SITE_PATTERN = /store\.addVoiceUsageCostCents\(/g;
  const EXPECTED_CALL_SITE = "src/billing/metering.js";
  const ERWARTETE_VORKOMMEN = 1;

  // matchAll zaehlt ALLE Treffer je Datei (nicht nur, OB die Datei ueberhaupt trifft) -
  // genau das deckt einen zweiten Aufruf INNERHALB derselben Datei auf, den ein reiner
  // Dateiname-Vergleich uebersehen wuerde (der urspruengliche Fehler dieses Riegels).
  // matchAll verlangt den /g-Flag und klont den Regex intern: der hier wiederverwendete
  // CALL_SITE_PATTERN behaelt ueber alle Dateien hinweg lastIndex=0 (empirisch geprueft) -
  // der klassische /g-Fallstrick (zustandsbehaftetes lastIndex bei exec()/test()-Wiederverwendung)
  // greift bei matchAll nicht.
  const vorkommenJeDatei = alleSrcDateien("src")
    .map((datei) => ({
      datei: path.relative(REPO_ROOT, datei),
      anzahl: [...fs.readFileSync(datei, "utf8").matchAll(CALL_SITE_PATTERN)].length,
    }))
    .filter((eintrag) => eintrag.anzahl > 0);

  const gesamtVorkommen = vorkommenJeDatei.reduce((summe, eintrag) => summe + eintrag.anzahl, 0);
  const fundstellen = vorkommenJeDatei.map((eintrag) => `${eintrag.datei}:${eintrag.anzahl}`).join(", ") || "keine";

  assert.equal(
    gesamtVorkommen,
    ERWARTETE_VORKOMMEN,
    `ein zweiter Aufruf waere eine potenzielle Doppelbelastung (TOD 2) - ` +
      `gefunden: ${gesamtVorkommen} Vorkommen [${fundstellen}]`,
  );
  assert.deepEqual(
    vorkommenJeDatei.map((eintrag) => eintrag.datei),
    [EXPECTED_CALL_SITE],
    `das einzige Vorkommen muss in ${EXPECTED_CALL_SITE} liegen - gefunden: [${fundstellen}]`,
  );
});
