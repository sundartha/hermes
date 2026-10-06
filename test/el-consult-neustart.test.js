import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { CONSULT_POLL_HOLD_MS } from "../src/consult/delivery.js";
import { CONSULT_STATUS } from "../src/store/defaults.js";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const GATE_ABGELEHNT = "kein_laufender_anruf";

const CONSULT_RAISED_LOG = /\[consult-raised\] gestellt/;
const LOG_WARTE_MS = 5000;

const CALL_ID = "call_el_neustart";
const CONVERSATION_ID = "conv_el_neustart_1";
const CALL_ID_ZWEI = "call_el_neustart_2";
const CONVERSATION_ID_ZWEI = "conv_el_neustart_2";
const EVENT_ID = "c0";
const ZWEITES_EVENT_ID = "c1";
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const ANSWER_FACT = "Donnerstag ab 15 Uhr passt.";

const OPEN_MS = 20000;
const DRAIN_TIMEOUT_MS = 4000;
const DRAIN_ANTWORT_MAX_MS = 8000;
const POLL_ANKUNFT_MS = 300;

const KURZ_OFFEN_MS = 1500;
const ABLEHNUNG_MAX_MS = 3000;
const RUECKFRAGE_WARTE_MS = 4000;
const RUECKFRAGE_TAKT_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EL_RESULT_POLL_MS_OHNE_INTERFERENZ = "60000";

function elStagesFlach(ms) {
  return {
    EL_CONSULT_DELIVERY_MS: String(ms),
    EL_CONSULT_ACK_MS: "0",
    EL_CONSULT_ANSWER_MS: String(ms),
  };
}

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: String(OPEN_MS),
  SHUTDOWN_DRAIN_TIMEOUT_MS: String(DRAIN_TIMEOUT_MS),
  ELEVENLABS_RESULT_POLL_MS: EL_RESULT_POLL_MS_OHNE_INTERFERENZ,
  ...elStagesFlach(OPEN_MS),
});

const KURZE_FRIST_ENV = Object.freeze({
  ...CONSULT_ON_ENV,
  CONSULT_OPEN_MS: String(KURZ_OFFEN_MS),
  ...elStagesFlach(KURZ_OFFEN_MS),
});

const laufenderAnruf = (id, conversationId) =>
  seedCall({
    id,
    status: "active",
    direction: "outbound",
    maxDurationS: 600,
    answeredAt: new Date().toISOString(),
    elevenlabsConversationId: conversationId,
  });

const seed = () => seedState({ calls: [laufenderAnruf(CALL_ID, CONVERSATION_ID)] });

const seedMitZweitemAnruf = () =>
  seedState({
    calls: [
      laufenderAnruf(CALL_ID, CONVERSATION_ID),
      laufenderAnruf(CALL_ID_ZWEI, CONVERSATION_ID_ZWEI),
    ],
  });

function raiseConsult(srv, conversationId = CONVERSATION_ID) {
  const started = Date.now();
  return fetch(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: JSON.stringify({ conversation_id: conversationId, question: QUESTION }),
  }).then(
    async (res) => ({ status: res.status, body: await res.json(), ms: Date.now() - started }),
    (err) => ({ status: null, fehler: String(err), ms: Date.now() - started }),
  );
}

function pollAfterOpenConsult(srv) {
  const started = Date.now();
  return fetch(`${srv.localUrl}/api/calls/${CALL_ID}/consult?after=${EVENT_ID}`).then(
    async (res) => ({ status: res.status, body: await res.json(), ms: Date.now() - started }),
    (err) => ({ status: null, fehler: String(err), ms: Date.now() - started }),
  );
}

function pollNextConsult(srv, callId = CALL_ID) {
  return fetch(`${srv.localUrl}/api/calls/${callId}/consult`).then(
    async (res) => ({ status: res.status, body: await res.json() }),
    (err) => ({ status: null, fehler: String(err) }),
  );
}

function sendAnswer(srv, eventId, callId = CALL_ID) {
  return fetch(`${srv.localUrl}/api/calls/${callId}/consult/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId, answers: [ANSWER_FACT] }),
  });
}

async function startWithOpenConsult(state = seed()) {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: state });
  const webhook = raiseConsult(srv);
  await waitForLog(srv, CONSULT_RAISED_LOG, LOG_WARTE_MS);
  return { srv, webhook };
}

async function startWithExpiredConsult() {
  const srv = await startServer({ env: KURZE_FRIST_ENV, seed: seed() });
  const webhook = raiseConsult(srv);
  await waitForLog(srv, CONSULT_RAISED_LOG, LOG_WARTE_MS);
  return { srv, abgelaufen: await webhook };
}

function persistedCall(srv, callId = CALL_ID) {
  return srv.readStore().calls.find((call) => call.id === callId);
}

function shutdown(srv) {
  const sentAt = Date.now();
  const exited = new Promise((resolve) =>
    srv.child.once("exit", (code) => resolve({ code, ms: Date.now() - sentAt })),
  );
  srv.child.kill("SIGTERM");
  return { sentAt, exited };
}

function hardKill(srv) {
  const exited = new Promise((resolve) =>
    srv.child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  srv.child.kill("SIGKILL");
  return exited;
}

const HAELT_OFFEN = Object.freeze({ status: null, fehler: "haelt offen statt abzulehnen" });

function gedeckelterVersuch(srv) {
  const versuch = raiseConsult(srv);
  const ergebnis = Promise.race([versuch, sleep(ABLEHNUNG_MAX_MS).then(() => HAELT_OFFEN)]);
  return { versuch, ergebnis };
}

async function pruefeKontingentVerbraucht(ctx, srv) {
  const { versuch, ergebnis } = gedeckelterVersuch(srv);
  const abgelehnt = await ergebnis;
  await ctx.test("eine zweite Rueckfrage am selben Anruf wird abgelehnt", () => {
    assert.equal(
      abgelehnt.status,
      HTTP_NOT_FOUND,
      `Ablehnung erwartet, war ${abgelehnt.fehler ?? abgelehnt.status} - das Kontingent ` +
        "dieses Anrufs ist verbraucht (MAX_IN_CALL_CONSULTS_PER_CALL=1), und es freizugeben " +
        "hiesse, den Kosten-Riegel abzuschalten: beliebig viele Rueckfragen, indem man sie " +
        "ablaufen laesst",
    );
    assert.equal(abgelehnt.body.error, GATE_ABGELEHNT, "abgelehnt am Faehigkeits-Gate");
  });
  return versuch;
}

async function pruefeAblaufOhneAntwort(ctx, abgelaufen) {
  await ctx.test("Vorbedingung: die Rueckfrage lief ab, weil niemand geantwortet hat", () => {
    assert.equal(
      abgelaufen.status,
      HTTP_OK,
      `beantwortet erwartet, war ${abgelaufen.fehler ?? abgelaufen.status}`,
    );
    assert.equal(abgelaufen.body.status, "timeout", "abgelaufen, NICHT beantwortet");
    assert.ok(
      abgelaufen.ms >= KURZ_OFFEN_MS,
      `nach ${abgelaufen.ms} ms zurueck - erst die volle Haltefrist ${KURZ_OFFEN_MS} ms ` +
        "ist die Gespraechszeit, die diese Rueckfrage gekostet hat. Kaeme die Absage " +
        "frueher, maesse der Fall einen abgerissenen Warter statt eines Fristablaufs.",
    );
  });
}

async function warteAufRueckfrage(srv, eventId) {
  const deadline = Date.now() + RUECKFRAGE_WARTE_MS;
  for (;;) {
    const kette = persistedCall(srv)?.consults ?? [];
    const consult = kette.find((eintrag) => eintrag.id === eventId);
    if (consult) return consult;
    if (Date.now() >= deadline) return null;
    await sleep(RUECKFRAGE_TAKT_MS);
  }
}

test("EL-NEUSTART 1 (Positiv-Kontrolle): ohne Neustart kommt die Rueckfrage durch und wird beantwortet", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  try {
    const angenommen = await sendAnswer(srv, EVENT_ID);

    await ctx.test("die Antwort des Auftraggebers wird angenommen", async () => {
      assert.equal(angenommen.status, HTTP_OK, await angenommen.clone().text());
    });

    const result = await webhook;

    await ctx.test("der wartende Anbieter-Aufruf bekommt genau diese Antwort", () => {
      assert.equal(
        result.status,
        HTTP_OK,
        `angenommen erwartet, war ${result.fehler ?? result.status}`,
      );
      assert.equal(result.body.status, "answered");
      assert.equal(result.body.answer, ANSWER_FACT);
    });

    await ctx.test("der Datensatz steht danach auf beantwortet, nicht mehr offen", () => {
      assert.equal(persistedCall(srv).consults[0].status, CONSULT_STATUS.ANSWERED);
    });
  } finally {
    await srv.stop();
  }
});

test("EL-NEUSTART 2: faehrt der Dienst herunter, bekommt der wartende Anbieter-Aufruf eine Absage statt einer haengenden Verbindung", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  try {
    const { sentAt, exited } = shutdown(srv);
    const result = await webhook;
    const antwortNachMs = Date.now() - sentAt;
    const ende = await exited;

    await ctx.test("die Verbindung wird beantwortet, nicht gekappt", () => {
      assert.equal(
        result.status,
        HTTP_OK,
        `beantwortet erwartet, war ${result.fehler ?? result.status}`,
      );
      assert.equal(result.body.status, "timeout", "klare Absage, kein Erfolg vorgetaeuscht");
      assert.ok(result.body.answer, "der Anbieter bekommt einen aussprechbaren Text");
    });

    await ctx.test("die Absage kommt aus der Freigabe, nicht aus dem Aussitzen der Frist", () => {
      assert.ok(
        antwortNachMs < DRAIN_ANTWORT_MAX_MS,
        `Antwort erst nach ${antwortNachMs} ms - die Haltefrist ist ${OPEN_MS} ms`,
      );
    });

    await ctx.test("der Dienst endet mit 0, nicht am Signal-Kill", () => {
      assert.equal(ende.code, 0);
    });
  } finally {
    await srv.stop();
  }
});

test("EL-NEUSTART 3: faehrt der Dienst herunter, wird der wartende Auftraggeber-Long-Poll freigegeben", async (ctx) => {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: seed() });
  const poll = pollAfterOpenConsult(srv);
  const webhook = raiseConsult(srv);
  try {
    await waitForLog(srv, CONSULT_RAISED_LOG, LOG_WARTE_MS);
    await sleep(POLL_ANKUNFT_MS);
    const { sentAt } = shutdown(srv);
    const result = await poll;
    const antwortNachMs = Date.now() - sentAt;

    await ctx.test("der Poll kehrt zurueck, statt bis zum Prozesstod zu haengen", () => {
      assert.equal(
        result.status,
        HTTP_OK,
        `beantwortet erwartet, war ${result.fehler ?? result.status}`,
      );
      assert.equal(result.body.event, "none", "kein Ereignis - der Klient hoert auf zu warten");
    });

    await ctx.test("auch hier aus der Freigabe, nicht aus dem Aussitzen der Haltezeit", () => {
      assert.ok(
        antwortNachMs < DRAIN_ANTWORT_MAX_MS,
        `Antwort erst nach ${antwortNachMs} ms - die Haltezeit ist ${CONSULT_POLL_HOLD_MS} ms`,
      );
    });

    await webhook;
  } finally {
    await srv.stop();
  }
});

test("EL-NEUSTART 4: nach dem Neustart steht die verwaiste Rueckfrage nicht mehr als offen im Store", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  let neu = null;
  try {
    const { exited } = shutdown(srv);
    await webhook;
    await exited;

    neu = await startServer({ env: CONSULT_ON_ENV, dataDir: srv.dataDir });

    await ctx.test("Vorbedingung: der Anruf laeuft nach dem Neustart weiter", () => {
      assert.equal(persistedCall(neu).status, "active");
    });

    await ctx.test("die Rueckfrage ist erkennbar beendet, nicht weiter offen", () => {
      const consult = persistedCall(neu).consults[0];
      assert.notEqual(
        consult.status,
        CONSULT_STATUS.OPEN,
        "auf niemanden wartet mehr eine Antwort: der Anbieter-Aufruf ist mit dem Prozess " +
          "gestorben. Ein Datensatz, der trotzdem offen bleibt, IST das dauerhafte Haengen.",
      );
    });

    await ctx.test("der Auftraggeber bekommt die verwaiste Frage nicht erneut vorgelegt", async () => {
      const vorgelegt = await pollNextConsult(neu);
      assert.equal(vorgelegt.status, HTTP_OK);
      assert.notEqual(
        vorgelegt.body.event,
        "consult",
        "die Antwort auf diese Frage kann niemanden mehr erreichen - sie darf nicht " +
          "noch einmal gestellt werden",
      );
    });
  } finally {
    await srv.stop();
    if (neu) await neu.stop();
  }
});

test("EL-NEUSTART 5: nach einem HARTEN Abbruch schliesst der Neustart die verwaiste Rueckfrage, ohne den laufenden Anruf oder den Kanal zu beschaedigen", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult(seedMitZweitemAnruf());
  let neu = null;
  try {
    const ende = await hardKill(srv);
    await webhook;

    await ctx.test("Vorbedingung: der Abbruch war hart, kein Drain ist gelaufen", () => {
      assert.equal(ende.signal, "SIGKILL");
      assert.equal(
        ende.code,
        null,
        "vom Signal beendet, NICHT geordnet heruntergefahren - sonst maesse der Fall den " +
          "Drain-Pfad aus Fall 4 statt das Netz beim Boot",
      );
    });

    await ctx.test("Vorbedingung: die verwaiste Rueckfrage steht offen auf Platte", () => {
      assert.equal(
        persistedCall(srv).consults[0].status,
        CONSULT_STATUS.OPEN,
        "ohne offenen Datensatz gibt es beim Neustart nichts zu schliessen - der Fall waere " +
          "gruen, ohne je etwas gemessen zu haben",
      );
    });

    neu = await startServer({ env: CONSULT_ON_ENV, dataDir: srv.dataDir });

    const verwaisterPoll = pollNextConsult(neu);

    await ctx.test("Positiv-Kontrolle: beide Anrufe laufen nach dem Neustart weiter", () => {
      assert.equal(
        persistedCall(neu).status,
        "active",
        "das Netz raeumt eine Rueckfrage ab, nicht den Anruf",
      );
      assert.equal(persistedCall(neu, CALL_ID_ZWEI).status, "active");
    });

    await ctx.test("die verwaiste Rueckfrage ist geschlossen, nicht weiter offen", () => {
      assert.equal(
        persistedCall(neu).consults[0].status,
        CONSULT_STATUS.EXPIRED,
        "abgelaufen, NICHT beantwortet - auf diese Frage wartet niemand mehr, sie hat aber " +
          "auch nie eine Antwort bekommen",
      );
    });

    const frischeFrage = raiseConsult(neu, CONVERSATION_ID_ZWEI);
    await waitForLog(neu, CONSULT_RAISED_LOG, LOG_WARTE_MS);
    const vorgelegt = await pollNextConsult(neu, CALL_ID_ZWEI);

    await ctx.test("die frische Rueckfrage wird normal vorgelegt", async () => {
      assert.equal(
        vorgelegt.status,
        HTTP_OK,
        `beantwortet erwartet, war ${vorgelegt.fehler ?? vorgelegt.status}`,
      );
      assert.equal(vorgelegt.body.event, "consult", "der Kanal traegt weiter Rueckfragen");
      assert.equal(vorgelegt.body.eventId, EVENT_ID);
    });

    const angenommen = await sendAnswer(neu, EVENT_ID, CALL_ID_ZWEI);

    await ctx.test("die frische Rueckfrage ist normal beantwortbar", async () => {
      assert.equal(angenommen.status, HTTP_OK, await angenommen.clone().text());
    });

    const result = await frischeFrage;

    await ctx.test("der wartende Anbieter-Aufruf bekommt genau diese Antwort", () => {
      assert.equal(
        result.status,
        HTTP_OK,
        `angenommen erwartet, war ${result.fehler ?? result.status}`,
      );
      assert.equal(result.body.status, "answered");
      assert.equal(result.body.answer, ANSWER_FACT);
    });

    const verwaist = await verwaisterPoll;

    await ctx.test("dem frischen Poll wird die verwaiste Frage nicht mehr vorgelegt", () => {
      assert.equal(
        verwaist.status,
        HTTP_OK,
        `beantwortet erwartet, war ${verwaist.fehler ?? verwaist.status}`,
      );
      assert.equal(
        verwaist.body.event,
        "none",
        "die Antwort auf diese Frage kann niemanden mehr erreichen - sie darf nicht noch " +
          "einmal gestellt werden",
      );
    });
  } finally {
    if (neu) await neu.stop();
  }
});

test("EL-NEUSTART 6: nach einem HARTEN Abbruch darf DERSELBE Anruf wieder rueckfragen - die verwaiste Rueckfrage verbrennt sein Kontingent nicht", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  let neu = null;
  let zweite = null;
  try {
    const ende = await hardKill(srv);
    await webhook;

    await ctx.test("Vorbedingung: der Abbruch war hart, kein Drain ist gelaufen", () => {
      assert.equal(ende.signal, "SIGKILL");
      assert.equal(
        ende.code,
        null,
        "vom Signal beendet, NICHT geordnet heruntergefahren - sonst maesse der Fall den " +
          "Drain-Pfad statt das Netz beim Boot",
      );
    });

    await ctx.test("Vorbedingung: die verwaiste Rueckfrage steht offen auf Platte", () => {
      assert.equal(persistedCall(srv).consults[0].status, CONSULT_STATUS.OPEN);
    });

    neu = await startServer({ env: CONSULT_ON_ENV, dataDir: srv.dataDir });

    await ctx.test("Vorbedingung: der Anruf laeuft weiter, die verwaiste Frage ist tot", () => {
      assert.equal(
        persistedCall(neu).status,
        "active",
        "das Gespraech laeuft beim Anbieter weiter - genau deshalb braucht dieser Anruf " +
          "seine Rueckfrage-Moeglichkeit noch",
      );
      assert.equal(persistedCall(neu).consults[0].status, CONSULT_STATUS.EXPIRED);
    });

    zweite = raiseConsult(neu);
    const datensatz = await warteAufRueckfrage(neu, ZWEITES_EVENT_ID);
    const absage = datensatz
      ? null
      : await Promise.race([zweite, sleep(ABLEHNUNG_MAX_MS).then(() => HAELT_OFFEN)]);

    await ctx.test("derselbe Anruf bekommt eine zweite Rueckfrage angelegt", () => {
      assert.ok(
        datensatz,
        `abgewiesen mit ${absage?.status} ${JSON.stringify(absage?.body ?? absage?.fehler)} - ` +
          "die verwaiste Rueckfrage zaehlt weiter aufs Kontingent, obwohl ihr Wartender mit " +
          "dem Prozess gestorben ist und sie keine Gespraechszeit gekostet hat. Dieser Anruf " +
          "kann NIE WIEDER rueckfragen.",
      );
    });

    const angenommen = await sendAnswer(neu, ZWEITES_EVENT_ID);

    await ctx.test("die zweite Rueckfrage ist normal beantwortbar", async () => {
      assert.equal(angenommen.status, HTTP_OK, await angenommen.clone().text());
    });

    const result = await zweite;

    await ctx.test("der wartende Anbieter-Aufruf bekommt genau diese Antwort", () => {
      assert.equal(
        result.status,
        HTTP_OK,
        `angenommen erwartet, war ${result.fehler ?? result.status}`,
      );
      assert.equal(result.body.status, "answered");
      assert.equal(result.body.answer, ANSWER_FACT);
    });
  } finally {
    if (neu) await neu.stop();
    if (zweite) await zweite;
  }
});

test("EL-NEUSTART 7 (Positiv-Kontrolle): eine Rueckfrage, die ABLIEF, weil niemand geantwortet hat, verbraucht das Kontingent ihres Anrufs", async (ctx) => {
  const { srv, abgelaufen } = await startWithExpiredConsult();
  let zweite = null;
  try {
    await pruefeAblaufOhneAntwort(ctx, abgelaufen);

    zweite = await pruefeKontingentVerbraucht(ctx, srv);
  } finally {
    await srv.stop();
    if (zweite) await zweite;
  }
});

test("EL-NEUSTART 8 (Positiv-Kontrolle): eine BEANTWORTETE Rueckfrage verbraucht das Kontingent ihres Anrufs", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  let zweite = null;
  try {
    const angenommen = await sendAnswer(srv, EVENT_ID);
    const beantwortet = await webhook;

    await ctx.test("Vorbedingung: die erste Rueckfrage wurde beantwortet", async () => {
      assert.equal(angenommen.status, HTTP_OK, await angenommen.clone().text());
      assert.equal(
        beantwortet.status,
        HTTP_OK,
        `angenommen erwartet, war ${beantwortet.fehler ?? beantwortet.status}`,
      );
      assert.equal(beantwortet.body.status, "answered");
      assert.equal(persistedCall(srv).consults[0].status, CONSULT_STATUS.ANSWERED);
    });

    zweite = await pruefeKontingentVerbraucht(ctx, srv);
  } finally {
    await srv.stop();
    if (zweite) await zweite;
  }
});

test("EL-NEUSTART 9: nach einem GEORDNETEN Herunterfahren darf DERSELBE Anruf wieder rueckfragen - die beim Drain geschlossene Rueckfrage verbrennt sein Kontingent nicht", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  let neu = null;
  let zweite = null;
  try {
    const { exited } = shutdown(srv);
    const abgesagt = await webhook;
    const ende = await exited;

    await ctx.test("Vorbedingung: geordnet heruntergefahren, waehrend die Haltefrist lief", () => {
      assert.equal(
        ende.code,
        0,
        "geordnet beendet, NICHT vom Signal getoetet - sonst maesse der Fall das Netz beim " +
          "Boot statt den Drain-Pfad",
      );
      assert.equal(
        abgesagt.status,
        HTTP_OK,
        `beantwortet erwartet, war ${abgesagt.fehler ?? abgesagt.status} - eine gekappte ` +
          "Verbindung hiesse, der Drain ist gar nicht gelaufen",
      );
      assert.equal(abgesagt.body.status, "timeout", "abgelaufen, NICHT beantwortet");
      assert.ok(
        abgesagt.ms < OPEN_MS,
        `erst nach ${abgesagt.ms} ms zurueck - die Haltefrist ist ${OPEN_MS} ms. Nur eine ` +
          "Rueckfrage, deren Frist beim Schliessen noch LIEF, hat keine Gespraechszeit " +
          "gekostet; haette sie die volle Frist ausgesessen, waere sie bezahlt und ihr " +
          "Platz zu Recht verbraucht.",
      );
    });

    neu = await startServer({ env: CONSULT_ON_ENV, dataDir: srv.dataDir });

    await ctx.test("Vorbedingung: der Anruf laeuft weiter, die Rueckfrage ist tot", () => {
      assert.equal(
        persistedCall(neu).status,
        "active",
        "das Gespraech laeuft beim Anbieter weiter - genau deshalb braucht dieser Anruf " +
          "seine Rueckfrage-Moeglichkeit noch",
      );
      const consult = persistedCall(neu).consults[0];
      assert.notEqual(consult.status, CONSULT_STATUS.OPEN, "auf sie wartet niemand mehr");
      assert.notEqual(
        consult.status,
        CONSULT_STATUS.ANSWERED,
        "sie hat nie eine Antwort bekommen - waere sie beantwortet, waere ihr Platz zu " +
          "Recht verbraucht (Fall 8)",
      );
    });

    zweite = raiseConsult(neu);
    const datensatz = await warteAufRueckfrage(neu, ZWEITES_EVENT_ID);
    const absage = datensatz
      ? null
      : await Promise.race([zweite, sleep(ABLEHNUNG_MAX_MS).then(() => HAELT_OFFEN)]);

    await ctx.test("derselbe Anruf bekommt eine zweite Rueckfrage angelegt", () => {
      assert.ok(
        datensatz,
        `abgewiesen mit ${absage?.status} ${JSON.stringify(absage?.body ?? absage?.fehler)} - ` +
          "die beim Drain geschlossene Rueckfrage zaehlt weiter aufs Kontingent, obwohl ihr " +
          "Wartender mit dem Herunterfahren gestorben ist und sie keine Gespraechszeit " +
          "gekostet hat. Nach JEDEM Deploy kann dieser Anruf nie wieder rueckfragen.",
      );
    });

    const angenommen = await sendAnswer(neu, ZWEITES_EVENT_ID);

    await ctx.test("die zweite Rueckfrage ist normal beantwortbar", async () => {
      assert.equal(angenommen.status, HTTP_OK, await angenommen.clone().text());
    });

    const result = await zweite;

    await ctx.test("der wartende Anbieter-Aufruf bekommt genau diese Antwort", () => {
      assert.equal(
        result.status,
        HTTP_OK,
        `angenommen erwartet, war ${result.fehler ?? result.status}`,
      );
      assert.equal(result.body.status, "answered");
      assert.equal(result.body.answer, ANSWER_FACT);
    });
  } finally {
    await srv.stop();
    if (neu) await neu.stop();
    if (zweite) await zweite;
  }
});

test("EL-NEUSTART 10 (Positiv-Kontrolle): eine Rueckfrage, die VOR dem geordneten Herunterfahren ABLIEF, bleibt auch nach dem Neustart verbraucht", async (ctx) => {
  const { srv, abgelaufen } = await startWithExpiredConsult();
  let neu = null;
  let zweite = null;
  try {
    await pruefeAblaufOhneAntwort(ctx, abgelaufen);

    await srv.stop();
    neu = await startServer({ env: KURZE_FRIST_ENV, dataDir: srv.dataDir });

    await ctx.test("Vorbedingung: der Anruf laeuft nach dem Neustart weiter", () => {
      assert.equal(
        persistedCall(neu).status,
        "active",
        "waere der Anruf terminal, kaeme die Ablehnung unten aus der Bindung statt aus dem " +
          "Kontingent - gruen aus dem falschen Grund",
      );
    });

    zweite = await pruefeKontingentVerbraucht(ctx, neu);
  } finally {
    await srv.stop();
    if (neu) await neu.stop();
    if (zweite) await zweite;
  }
});
