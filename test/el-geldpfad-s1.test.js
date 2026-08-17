// ---- Der GELD-Pfad des ElevenLabs-Weges: drei Rotproben ---------------------------------
// Eine unabhaengige Durchsicht (17.08.2026) fand drei Wege, auf denen ein echter, bezahlter
// Anruf mit 0 oder mit dem Dreifachen gebucht wird - und der Beleg dafuer im selben Zug beim
// Anbieter geloescht wird. Jede der drei Zusicherungen hier ist eine ROTPROBE: sie faellt
// ohne den zugehoerigen Fix (nachgewiesen durch Herausnehmen des Fixes, s. Bericht), nicht
// bloss "sie ist gruen".
//
//   S1-A  Der Anbieter-Deckel (600 s) war nur DEFAULT, nicht Obergrenze. routes/api-calls.js
//         setzt maxDurationS bei JEDEM Anruf (gemessen: 1800) und schlug ihn damit - ein
//         dauerhaft stummer Ergebnisabruf liess den Poll bis 1800 s laufen und buchte 30
//         statt 10 Minuten (bei 30 ct/min 9,00 statt 3,00 EUR).
//   S1-B  Ein LAUFENDES Gespraech (Anbieter-Status "in-progress", Dauer 0) fiel auf dasselbe
//         Ergebnis wie "niemand hat abgenommen": der Buchungsanker wurde still auf null
//         gezogen, ein cancel_call nach vier Minuten Gespraech buchte 0 Minuten - und der
//         Beleg war 0,3 s spaeter beim Anbieter geloescht (DELETE).
//   S1-C  Der Loeschversuch lief weiter in die 120-s-Frist des AnrufSTARTS: der Abbruch
//         konnte 10 s + 120 s haengen, obwohl der Kommentar "hoechstens 10 s" versprach.
//
// Offline, kein Netz, kein Server (Attrappe fuer den Anbieter, P12 F.I.R.S.T.). Der Store
// ist KEIN Handnachbau: die Attrappe reicht jeden Aufruf an die ECHTEN state-ops-Mutatoren
// durch (Muster src/store/json.js) - so rechnet voiceMinutesOf am Ende gegen denselben
// Datensatz wie in Produktion, statt gegen ein Testobjekt mit Wunschfeldern.
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen
// Testbank (Lehre catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";

import { voiceMinutesOf } from "../src/billing/metering.js";
import { REQUEST_TIMEOUT_MS } from "../src/elevenlabs/convai.js";
import {
  EL_ABORT_PROVIDER_TIMEOUT_MS,
  ELEVENLABS_PROVIDER_MAX_DURATION_S,
  makeElevenLabsOutbound,
} from "../src/elevenlabs/outbound.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, MAX_CALL_DURATION_CAP_S } from "../src/store/defaults.js";
import { publicCall } from "../src/store/views.js";
import { billThunk, elevenLabsHangUpAction, terminateAndBillCall } from "../src/telephony/call-termination.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { CONVERSATION_IN_PROGRESS } from "./fixtures/elevenlabs-conversations.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const CONV_ID = "conv_geldpfad";
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const SECONDS_PER_MINUTE = 60;
const WAIT_UNTIL_TIMEOUT_MS = 500;
const WAIT_UNTIL_POLL_INTERVAL_MS = 5;

const elConfig = () => withConfigNamespaces({ elevenLabsOutbound: ACCOUNT });

async function withFetch(fetchImpl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = orig;
  }
}

async function waitUntil(predicate) {
  const deadline = Date.now() + WAIT_UNTIL_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Bedingung nicht innerhalb der Testfrist erreicht");
    await new Promise((resolve) => setTimeout(resolve, WAIT_UNTIL_POLL_INTERVAL_MS));
  }
}

// Fehlerebene-Log einsammeln, ohne ihn zu verschlucken - die Zeilen SIND hier die Zusicherung
// ("der Fall wird laut statt still").
async function mitFehlerLog(run) {
  const zeilen = [];
  const original = console.error;
  console.error = (...args) => zeilen.push(args.join(" "));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return zeilen;
}

// Ein AKTIVER EL-Anruf mit echter Store-Herkunft (createCall) - eigene Frist und bereits
// verstrichene Gespraechszeit sind die zwei Stellschrauben der Faelle unten.
function seedActiveCall({ maxDurationS, laufzeitSekunden }) {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    goal: "Termin vereinbaren",
    tenantId: BOOTSTRAP_TENANT_ID,
    maxDurationS,
  });
  const anker = new Date(Date.now() - laufzeitSekunden * MS_PER_SECOND).toISOString();
  call.elevenlabsConversationId = CONV_ID;
  call.startedAt = anker;
  call.answeredAt = anker; // der Verbindungsstempel des Anrufstarts (markAnswered)
  return { state, call };
}

// Die Store-Fassade, wie src/store/json.js sie baut: jede Methode reicht an denselben
// state-ops-Mutator durch, den auch Produktion benutzt (endCallRecord liefert dort den
// Call, nicht das {call, changed}-Paar).
function storeFacade(state) {
  return {
    load: () => state,
    getCall: (id) => ops.getCall(state, id),
    addTranscript: (id, rolle, text) => ops.addTranscript(state, id, rolle, text),
    recordProviderCallResult: (id, ergebnis) => ops.recordProviderCallResult(state, id, ergebnis),
    recordProviderCollectedFields: (id, felder) => ops.recordProviderCollectedFields(state, id, felder),
    recordCalleeConfirmedTimezone: (id, zone) => ops.recordCalleeConfirmedTimezone(state, id, zone),
    trueUpAnsweredAt: (id, iso) => ops.trueUpAnsweredAt(state, id, iso),
    recordAnsweredUnclearReason: (id, grund) => ops.recordAnsweredUnclearReason(state, id, grund),
    setCallEndedAt: (id, status, iso) => ops.setCallEndedAt(state, id, status, iso),
    endCallRecord: (id, status) => ops.endCallRecord(state, id, status).call,
  };
}

function makeOutbound(store, extra) {
  return makeElevenLabsOutbound({
    store,
    config: elConfig(),
    terminateAndBillCall,
    billThunk,
    finishCall: () => {},
    ...extra,
  });
}

// ---- S1-A: der Anbieter-Deckel bindet die Buchung ---------------------------------------
// Der Anbieter legt bei ELEVENLABS_PROVIDER_MAX_DURATION_S auf; ein Call, der laenger
// "aktiv" ist, ist beim Anbieter nachweislich vorbei. Der Zombie unten steht deutlich ueber
// BEIDEN Grenzen - so terminiert er mit UND ohne Fix, und die Zusicherung ist nicht "er
// terminiert irgendwann", sondern "er bucht die richtige Zahl Minuten".
const ZOMBIE_UEBERZUG_S = 600;
const ANBIETER_MINUTEN = ELEVENLABS_PROVIDER_MAX_DURATION_S / SECONDS_PER_MINUTE;
const PLATTFORM_MINUTEN = MAX_CALL_DURATION_CAP_S / SECONDS_PER_MINUTE;

test("S1-A: eigene 1800-s-Frist + dauerhaft stummer Ergebnisabruf -> gebucht werden die ANBIETER-Minuten, nicht die Plattform-Minuten", async () => {
  const { state, call } = seedActiveCall({
    maxDurationS: MAX_CALL_DURATION_CAP_S,
    laufzeitSekunden: MAX_CALL_DURATION_CAP_S + ZOMBIE_UEBERZUG_S,
  });
  const store = storeFacade(state);
  let billed = false;
  const el = makeOutbound(store, {
    billThunk: () => () => {
      billed = true;
    },
  });

  await withFetch(
    async () => ({ ok: false, status: HTTP_SERVER_ERROR }), // der Anbieter bleibt stumm, dauerhaft
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );

  const gebuchteSekunden = (Date.parse(call.endedAt) - Date.parse(call.answeredAt)) / MS_PER_SECOND;
  assert.equal(
    gebuchteSekunden,
    ELEVENLABS_PROVIDER_MAX_DURATION_S,
    "der gekappte Ende-Anker muss am ANBIETER-Deckel haengen, nicht an der anrufeigenen Frist",
  );
  assert.equal(
    voiceMinutesOf(call),
    ANBIETER_MINUTEN,
    `gebucht gehoeren ${ANBIETER_MINUTEN} Minuten (Anbieter-Deckel)`,
  );
  assert.notEqual(
    voiceMinutesOf(call),
    PLATTFORM_MINUTEN,
    `${PLATTFORM_MINUTEN} statt ${ANBIETER_MINUTEN} Minuten ist der Defekt: das Dreifache, bei 30 ct/min 9,00 statt 3,00 EUR je Anruf`,
  );
});

test("S1-A: eine KUERZERE anrufeigene Frist bleibt wirksam - die Kappung ist das Minimum, kein Festwert", async () => {
  const KURZE_FRIST_S = 120;
  const { state, call } = seedActiveCall({
    maxDurationS: KURZE_FRIST_S,
    laufzeitSekunden: MAX_CALL_DURATION_CAP_S,
  });
  const store = storeFacade(state);
  let billed = false;
  const el = makeOutbound(store, {
    billThunk: () => () => {
      billed = true;
    },
  });

  await withFetch(
    async () => ({ ok: false, status: HTTP_SERVER_ERROR }),
    async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => billed);
    },
  );

  assert.equal(
    (Date.parse(call.endedAt) - Date.parse(call.answeredAt)) / MS_PER_SECOND,
    KURZE_FRIST_S,
    "eine Frist UNTER dem Anbieter-Deckel muss weiterhin gewinnen - sonst waere aus dem Minimum ein Festwert geworden",
  );
});

// ---- S1-B: ein laufendes Gespraech ist nicht "niemand hat abgenommen" --------------------
const GESPRAECHSDAUER_S = 240;
const ERWARTETE_MINUTEN_LAUFEND = GESPRAECHSDAUER_S / SECONDS_PER_MINUTE;
const GRUND_LAUFEND = "call_duration_secs_unknown_conversation_in_progress";
const GRUND_NICHT_ABGENOMMEN = "call_duration_secs_zero_not_answered";

test("S1-B: Abbruch auf ein LAUFENDES Gespraech (in-progress, Dauer 0) loescht den Buchungsanker NICHT - vier Minuten bleiben vier Minuten", async () => {
  const { state, call } = seedActiveCall({
    maxDurationS: MAX_CALL_DURATION_CAP_S,
    laufzeitSekunden: GESPRAECHSDAUER_S,
  });
  const store = storeFacade(state);
  const el = makeOutbound(store);
  const angenommenVorAbbruch = call.answeredAt;

  const fehlerzeilen = await mitFehlerLog(() =>
    withFetch(
      async (_url, init) =>
        init.method === "GET"
          ? { ok: true, status: HTTP_OK, json: async () => CONVERSATION_IN_PROGRESS }
          : { ok: true, status: HTTP_OK },
      () =>
        terminateAndBillCall({
          persistEnd: () => store.endCallRecord(call.id, "cancelled"),
          hangUp: elevenLabsHangUpAction(el.endActiveCall, call),
          bill: () => {},
          callId: call.id,
        }),
    ),
  );

  assert.equal(
    call.answeredAt,
    angenommenVorAbbruch,
    "der Buchungsanker eines LAUFENDEN Gespraechs darf nicht geloescht werden - der Anbieter kennt die Dauer nur noch nicht",
  );
  assert.equal(
    voiceMinutesOf(call),
    ERWARTETE_MINUTEN_LAUFEND,
    `gebucht gehoeren die tatsaechlich gesprochenen ${ERWARTETE_MINUTEN_LAUFEND} Minuten - 0 waere der Defekt (wir zahlen Anbieter und Carrier voll)`,
  );
  assert.equal(
    call.answeredUnclearReason,
    GRUND_LAUFEND,
    "der Fall traegt einen EIGENEN Grund - 'laufend' und 'nie abgenommen' duerfen nicht auf dasselbe Label fallen",
  );
  assert.ok(
    fehlerzeilen.some(
      (zeile) =>
        zeile.includes("Buchungsanker ohne Anbieter-Dauer") &&
        zeile.includes(call.id) &&
        zeile.includes(GRUND_LAUFEND),
    ),
    `kein lautes Log fuer den nicht aus der Anbieter-Dauer gebildeten Anker: ${fehlerzeilen.join(" | ")}`,
  );
  assert.ok(
    fehlerzeilen.every((zeile) => !zeile.includes(call.to)),
    "das Log darf die Rufnummer nicht tragen (Absolute Regel 4/5)",
  );
});

test("S1-B: ein BEENDETES Gespraech mit Dauer 0 bleibt 'niemand hat abgenommen' - eigener Grund, eigenes Log, kein Anker", async () => {
  const { state, call } = seedActiveCall({
    maxDurationS: MAX_CALL_DURATION_CAP_S,
    laufzeitSekunden: GESPRAECHSDAUER_S,
  });
  const store = storeFacade(state);
  const el = makeOutbound(store);

  const fehlerzeilen = await mitFehlerLog(() =>
    withFetch(
      async (_url, init) =>
        init.method === "GET"
          ? {
              ok: true,
              status: HTTP_OK,
              json: async () => ({ ...CONVERSATION_IN_PROGRESS, status: "done" }),
            }
          : { ok: true, status: HTTP_OK },
      () =>
        terminateAndBillCall({
          persistEnd: () => store.endCallRecord(call.id, "cancelled"),
          hangUp: elevenLabsHangUpAction(el.endActiveCall, call),
          bill: () => {},
          callId: call.id,
        }),
    ),
  );

  assert.equal(call.answeredAt, null, "ein beendetes Gespraech mit Dauer 0 hat niemand angenommen - der Anker faellt");
  assert.equal(voiceMinutesOf(call), 0, "ohne Rufannahme wird nichts gebucht (unveraenderte Eigentuemer-Auflage)");
  assert.equal(call.answeredUnclearReason, GRUND_NICHT_ABGENOMMEN, "auch der bekannte Fall traegt jetzt seinen Grund");
  assert.ok(
    fehlerzeilen.some((zeile) => zeile.includes(GRUND_NICHT_ABGENOMMEN) && zeile.includes(call.id)),
    `der 0-Sekunden-Fall war der EINZIGE, der bisher gar nichts meldete: ${fehlerzeilen.join(" | ")}`,
  );
});

test("S1-B: der Grund verlaesst den Server ueber den Anruf-Datensatz (publicCall/GET /api/calls/{id}) - ohne Kostenfelder", () => {
  const { state, call } = seedActiveCall({
    maxDurationS: MAX_CALL_DURATION_CAP_S,
    laufzeitSekunden: GESPRAECHSDAUER_S,
  });
  ops.recordAnsweredUnclearReason(state, call.id, GRUND_LAUFEND);
  const sichtbar = publicCall(call);

  assert.equal(
    sichtbar.answeredUnclearReason,
    GRUND_LAUFEND,
    "der Grund muss nach aussen sichtbar sein - sonst ist er nur ein Eintrag, den niemand je liest",
  );
  for (const geldfeld of ["estimatedCostCents", "actualCostMicroCents", "costTruedAt", "costTruingAttempts"]) {
    assert.ok(
      !(geldfeld in sichtbar),
      `${geldfeld} gehoert NICHT nach aussen - die Sichtbarkeit des Grundes darf keine Kostenwerte mitnehmen`,
    );
  }
});

// ---- S1-C: der Abbruch haengt nicht 130 Sekunden ----------------------------------------
// ZEITRAFFER: AbortSignal.timeout wird durch dieselbe echte Implementierung ersetzt, nur mit
// gestauchter Zahl - die FRIST, die der Produktionscode anfordert, entscheidet damit
// weiterhin ueber die Rueckkehrzeit, nur eben in Millisekunden statt Minuten. Ohne den Fix
// fordert der DELETE 120000 an (-> 1200 ms), mit Fix 10000 (-> 100 ms); die Schwelle unten
// liegt sicher zwischen beiden Summen (200 ms bzw. 1300 ms).
const ZEITRAFFER = 100;
const RUECKKEHR_SCHWELLE_MS = 600;

async function withZeitrafferAbortSignal(run) {
  const original = AbortSignal.timeout;
  const angefordert = [];
  AbortSignal.timeout = (ms) => {
    angefordert.push(ms);
    return original.call(AbortSignal, ms / ZEITRAFFER);
  };
  try {
    await run();
  } finally {
    AbortSignal.timeout = original;
  }
  return angefordert;
}

// Ein Anbieter, der die Verbindung annimmt und dann schweigt: die Antwort kommt NIE, der
// Aufruf endet ausschliesslich ueber sein eigenes Zeitlimit (wie echtes fetch).
const stummerAnbieter = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted due to timeout")));
  });

test("S1-C: ein stummer Anbieter laesst den Abbruch nach der KURZEN Frist zurueckkommen, nicht nach 120 s", async () => {
  const { state, call } = seedActiveCall({
    maxDurationS: MAX_CALL_DURATION_CAP_S,
    laufzeitSekunden: GESPRAECHSDAUER_S,
  });
  const el = makeOutbound(storeFacade(state));
  const start = Date.now();

  const angeforderteFristen = await withZeitrafferAbortSignal(() =>
    withFetch(stummerAnbieter, () => el.endActiveCall(call.id)),
  );
  const gemesseneRueckkehrMs = Date.now() - start;

  assert.deepEqual(
    angeforderteFristen,
    [EL_ABORT_PROVIDER_TIMEOUT_MS, EL_ABORT_PROVIDER_TIMEOUT_MS],
    "BEIDE Anbieter-Aufrufe des Abbruch-Pfades (Ergebnisabruf GET, Loeschversuch DELETE) muessen die kurze Frist anfordern",
  );
  assert.ok(
    gemesseneRueckkehrMs < RUECKKEHR_SCHWELLE_MS,
    `der Abbruch kam erst nach ${gemesseneRueckkehrMs} ms zurueck (Zeitraffer 1:${ZEITRAFFER}) - mit der 120-s-Bestandsfrist am DELETE waeren es ueber ${REQUEST_TIMEOUT_MS / ZEITRAFFER} ms`,
  );
});
