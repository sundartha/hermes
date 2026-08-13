// ---- Offene Rueckfrage gegen einen Neustart des Dienstes ---------------------------
// GEMESSEN, nicht vermutet (Spawn ueber die ECHTEN HTTP-Routen, Muster
// test/elevenlabs-consult-webhook-guards.test.js). Das Kriterium ist die KLEINE Version
// der Eigentuemer-Entscheidung: eine offene Rueckfrage ueberlebt einen Neustart ODER sie
// scheitert SAUBER - stumm haengen darf sie nicht. Das Gespraech selbst laeuft beim
// Anbieter und ueberlebt einen Hermes-Neustart ohnehin; verloren geht nur die Rueckfrage,
// die in diesem Moment unterwegs war.
//
// AN DER OFFENEN RUECKFRAGE HAENGEN DREI, JEDER MUSS SAUBER ENDEN:
//   1) der ANBIETER: POST /webhooks/elevenlabs/consult haelt seine Verbindung bis
//      CONSULT_OPEN_MS offen (conversation/consult-raised.js) und legt die Antwort dem
//      Modell als Werkzeug-Ergebnis vor.
//   2) der AUFTRAGGEBER: der Long-Poll GET /api/calls/:id/consult (consult/delivery.js,
//      waitForEvent) - der Weg, ueber den await_call_event die Frage abholt.
//   3) der DATENSATZ: call.consults im Store. Er ist der einzige der drei, der einen
//      Neustart ueberhaupt ueberlebt - und damit der einzige, der DAUERHAFT haengen kann.
//
// MESSERGEBNIS (Stand dieser Datei, am laufenden Dienst gemessen):
//   1 Normalfall ohne Neustart     -> Rueckfrage kommt durch, wird beantwortet  (GRUEN)
//   2 Anbieter beim Shutdown       -> 200 mit klarer Absage nach ~0,3 s         (GRUEN)
//   3 Auftraggeber beim Shutdown   -> 200 event=none nach ~0,3 s                (GRUEN)
//   4 Datensatz nach dem Drain     -> geschlossen, kein zweites Vorlegen        (GRUEN)
//   5 Datensatz nach HARTEM Abbruch-> geschlossen, der Anruf laeuft weiter      (GRUEN)
// Faelle 1-3 sind Regressionsschutz (die Drain-Freigabe, delivery.releaseOpenPolls +
// consult-raised.isDraining, laeuft vor httpServer.close und loest beide Halter auf).
// Fall 4 war der echte Defekt, den diese Datei gefunden hat: kein Pfad schloss den
// Datensatz. expireOpenConsults laeuft nur, wenn der ANRUF terminal wird
// (state-ops.setCallEndedAt), advanceInCallConsult nur in der Turn-Schleife der
// Budget-Engine - die beim Anbieter-Gespraech gar nicht laeuft. Die Rueckfrage blieb also
// fuer den Rest des Gespraechs offen; der neu gestartete Dienst legte sie dem Auftraggeber
// erneut als unbeantwortete Frage vor, obwohl niemand mehr auf die Antwort wartete. Seit
// ca212e1 schliesst der DRAIN sie selbst, unmittelbar vor der Absage (consult-raised.js).
// Fall 5 misst das Netz DARUNTER: ein harter Abbruch (Absturz, SIGKILL) laesst den Drain
// gar nicht erst laufen - dann schliesst der BOOT die verwaisten Rueckfragen
// (expireOrphanedConsults, src/boot.js, vor app.listen). Ohne diesen Fall waere dieses
// Netz nur einmal von Hand belegt und beim naechsten Umbau still weg.
//
// WARUM DER TIMING-RIEGEL IN 2/3 UND NICHT NUR "200": ohne ihn waere auch die natuerliche
// Frist (CONSULT_OPEN_MS bzw. CONSULT_POLL_HOLD_MS) eine bestandene Messung - dann misst
// der Fall die Drain-Freigabe nicht mehr, sondern nur noch das Ablaufen einer Uhr.
// SHUTDOWN_DRAIN_TIMEOUT_MS steht bewusst weit unter beiden Fristen: faellt die Freigabe
// aus, kappt der Watchdog den Prozess, die Verbindung stirbt unbeantwortet - und der Fall
// wird schnell rot statt langsam gruen.
//
// ELEVENLABS_TOOL_TOKEN steht NICHT in BASE_ENV (test/helpers.js) - Begruendung s.
// test/elevenlabs-consult-webhook-guards.test.js. Deshalb setzt JEDER startServer-Aufruf
// dieser Datei den Token explizit; dotenv fuellt nur UNgesetzte Variablen, eine lokale
// .env kann diese Faelle damit nicht faerben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { CONSULT_POLL_HOLD_MS } from "../src/consult/delivery.js";
import { CONSULT_STATUS } from "../src/store/defaults.js";

const CONSULT_PATH = "/webhooks/elevenlabs/consult";
const TOOL_TOKEN_HEADER = "x-hermes-tool-token";
const TOOL_TOKEN = "el-tool-token-testgeheim";

// Angenommen ist in dieser Datei IMMER 200 - jede Ablehnung des Endpunkts (403/404/402)
// haengt an den Gates und ist in test/elevenlabs-consult-webhook-guards.test.js gepinnt.
const HTTP_OK = 200;

// Der Beleg des Servers, dass die Rueckfrage steht und der Warter haelt (consult-raised.js,
// PII-frei). EINE Quelle fuer alle Faelle.
const CONSULT_RAISED_LOG = /\[consult-raised\] gestellt/;
const LOG_WARTE_MS = 5000;

const CALL_ID = "call_el_neustart";
const CONVERSATION_ID = "conv_el_neustart_1";
// Zweiter laufender Anruf, NUR fuer Fall 5: MAX_IN_CALL_CONSULTS_PER_CALL ist 1
// (consult/in-call.js) und inCallConsults zaehlt jede Rueckfrage, unabhaengig von ihrem
// Status - die verwaiste verbraucht das Kontingent IHRES Anrufs dauerhaft. Die frische
// Rueckfrage der Positiv-Kontrolle kann deshalb nur an einem anderen Anruf entstehen; das
// belegt zugleich, dass das Netz fremde Anrufe unberuehrt laesst.
const CALL_ID_ZWEI = "call_el_neustart_2";
const CONVERSATION_ID_ZWEI = "conv_el_neustart_2";
const EVENT_ID = "c0"; // erste Rueckfrage der Kette (state-ops.consultIdOf)
const QUESTION = "Darf ich den Termin am Donnerstag zusagen?";
const ANSWER_FACT = "Donnerstag ab 15 Uhr passt.";

// Die Haltefrist des Anbieter-Aufrufs. Gross genug, dass der Warter beim SIGTERM
// nachweislich NOCH haelt (sonst misst kein Fall den Shutdown), klein genug, dass ein
// stumm haengender Fall nicht ewig laeuft.
const OPEN_MS = 20000;
// Watchdog des Shutdowns: weit unter OPEN_MS und unter CONSULT_POLL_HOLD_MS - s. Kopf.
const DRAIN_TIMEOUT_MS = 4000;
// Obergrenze fuer "wurde freigegeben, nicht ausgesessen". Zwischen Watchdog und der
// kleineren der beiden natuerlichen Fristen; die Drain-Freigabe braucht real einen Tick
// (CONSULT_POLL_TICK_MS = 250 ms).
const DRAIN_ANTWORT_MAX_MS = 8000;
// Nachlauf, bevor in Fall 3 das SIGTERM faellt - Begruendung dort.
const POLL_ANKUNFT_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: String(OPEN_MS),
  SHUTDOWN_DRAIN_TIMEOUT_MS: String(DRAIN_TIMEOUT_MS),
});

// Ein laufender Outbound-Anruf mit Anbieter-Kennung. maxDurationS grosszuegig, damit der
// Boot-Re-Arm (rearmActiveCallTimers) das Leg beim NEUSTART nicht als Zombie
// terminalisiert - genau das wuerde den Datensatz ueber setCallEndedAt schliessen und
// Fall 4 aus dem falschen Grund gruen faerben (Fall 4 prueft es zusaetzlich explizit).
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

// Fall 5: derselbe Anruf plus ein zweiter, unbeteiligter - Begruendung bei CALL_ID_ZWEI.
const seedMitZweitemAnruf = () =>
  seedState({
    calls: [
      laufenderAnruf(CALL_ID, CONVERSATION_ID),
      laufenderAnruf(CALL_ID_ZWEI, CONVERSATION_ID_ZWEI),
    ],
  });

// Der Werkzeug-Aufruf des Anbieters. Bewusst OHNE await: er bleibt offen, bis geantwortet
// wird, die Frist ablaeuft oder der Dienst herunterfaehrt - das ist der Messgegenstand.
// Ein abgerissener Aufruf wird zu einem lesbaren Ergebnis statt zu einem rohen
// fetch-Fehler, damit die Zusicherung den Grund nennen kann.
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

// Der wartende Auftraggeber: after=c0 laesst den Long-Poll jede Rueckfrage bis
// einschliesslich c0 UEBERSPRINGEN - er wartet damit wirklich, statt sofort mit der
// gestellten Frage zurueckzukehren. Das gilt auch, bevor c0 ueberhaupt existiert
// (pendingConsult sucht seq > 0), weshalb dieser Poll VOR der Rueckfrage abgesetzt werden
// darf - s. Fall 3.
function pollAfterOpenConsult(srv) {
  const started = Date.now();
  return fetch(`${srv.localUrl}/api/calls/${CALL_ID}/consult?after=${EVENT_ID}`).then(
    async (res) => ({ status: res.status, body: await res.json(), ms: Date.now() - started }),
    (err) => ({ status: null, fehler: String(err), ms: Date.now() - started }),
  );
}

// Derselbe Long-Poll OHNE after-Filter: er bekommt die AELTESTE offene Rueckfrage dieses
// Anrufs vorgelegt - genau der frische Auftraggeber, den ein verwaister Datensatz
// faelschlich bedienen wuerde. Er kann sie nicht verpassen: pendingConsult liest den Store,
// nicht ein Ereignis, und liefert den aeltesten offenen Datensatz, egal wann der Poll
// ankommt. Ohne offene Rueckfrage haelt er bis CONSULT_POLL_HOLD_MS und meldet dann "none".
function pollNextConsult(srv, callId = CALL_ID) {
  return fetch(`${srv.localUrl}/api/calls/${callId}/consult`).then(
    async (res) => ({ status: res.status, body: await res.json() }),
    (err) => ({ status: null, fehler: String(err) }),
  );
}

// Die Antwort des Auftraggebers auf genau eine Rueckfrage. Rohe Response, damit der
// Aufrufer bei einer Ablehnung den Body in die Zusicherung schreiben kann.
function sendAnswer(srv, eventId, callId = CALL_ID) {
  return fetch(`${srv.localUrl}/api/calls/${callId}/consult/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId, answers: [ANSWER_FACT] }),
  });
}

// Server + eine nachweislich OFFENE Rueckfrage an CALL_ID. Die Log-Zeile ist der Beleg,
// dass der Warter steht - ohne sie koennte das Signal vor der Emission landen und der Fall
// haette nichts gemessen. Der Startzustand ist parametrisiert, weil Fall 5 einen zweiten,
// unbeteiligten Anruf braucht (s. CALL_ID_ZWEI).
async function startWithOpenConsult(state = seed()) {
  const srv = await startServer({ env: CONSULT_ON_ENV, seed: state });
  const webhook = raiseConsult(srv);
  await waitForLog(srv, CONSULT_RAISED_LOG, LOG_WARTE_MS);
  return { srv, webhook };
}

// Der Anruf so, wie er WIRKLICH auf Platte steht - der einzige der drei Warteplaetze, der
// einen Neustart ueberhaupt sieht.
function persistedCall(srv, callId = CALL_ID) {
  return srv.readStore().calls.find((call) => call.id === callId);
}

// SIGTERM + Wartezeit bis zum Prozessende, ab dem Signal gemessen.
function shutdown(srv) {
  const sentAt = Date.now();
  const exited = new Promise((resolve) =>
    srv.child.once("exit", (code) => resolve({ code, ms: Date.now() - sentAt })),
  );
  srv.child.kill("SIGTERM");
  return { sentAt, exited };
}

// Der HARTE Abbruch (Absturz, OOM-Kill, SIGKILL): NICHT abfangbar - kein Drain, kein
// finaler Store-Flush, kein Aufloesen der Warter. Ein SIGTERM waere hier die falsche
// Messung: er loest genau den Pfad aus, den dieser Fall NICHT meint (Faelle 2/3).
// Geliefert wird der Ausgang, damit die Haerte des Abbruchs zugesichert werden kann;
// srv.stop() darf danach NIE laufen (es warten auf ein exit, das schon gefallen ist).
function hardKill(srv) {
  const exited = new Promise((resolve) =>
    srv.child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  srv.child.kill("SIGKILL");
  return exited;
}

// GRUEN erwartet (Regressionsschutz). Ohne diesen Fall bestuende ein "Fix", der JEDE
// Rueckfrage sofort absagt, saemtliche Faelle dieser Datei - die Absage ist nur dann
// richtig, wenn der Normalfall weiter durchkommt.
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

// GRUEN erwartet (Regressionsschutz): die Drain-Freigabe loest den Anbieter-Warter auf.
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

    // KEINE Zusicherung ueber die Dauer bis zum Prozessende: der Watchdog beendet ihn in
    // JEDEM Fall mit 0, ein Zeitvergleich dort wuerde nichts unterscheiden.
    await ctx.test("der Dienst endet mit 0, nicht am Signal-Kill", () => {
      assert.equal(ende.code, 0);
    });
  } finally {
    await srv.stop();
  }
});

// GRUEN erwartet (Regressionsschutz): derselbe Drain gibt auch den Long-Poll frei.
//
// REIHENFOLGE IST MESSTECHNIK, KEIN GESCHMACK: der Poll geht ZUERST raus, die Rueckfrage
// danach. Fuer "der Long-Poll ist angekommen" gibt es kein Signal (noteConsultPoll ist
// ephemer und wird nie gespeichert) - die Log-Zeile der SPAETER abgesetzten Rueckfrage ist
// der Beleg, dass der Dienst bereits einen juengeren Request vollstaendig bearbeitet hat.
// Der kurze Nachlauf gibt dem Warter zusaetzlich einen vollen Tick. Ginge das SIGTERM
// vorher raus, waere der Poll gar nicht erst angekommen - der Fall waere rot, ohne je die
// Freigabe gemessen zu haben.
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

    await webhook; // der zweite Halter desselben Anrufs, sonst bleibt ein Handle offen
  } finally {
    await srv.stop();
  }
});

// GRUEN erwartet, seit ca212e1: beide Verbindungen enden sauber - und der DRAIN schliesst
// den Datensatz mit, bevor er dem Anbieter absagt (consult-raised.js).
test("EL-NEUSTART 4: nach dem Neustart steht die verwaiste Rueckfrage nicht mehr als offen im Store", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  let neu = null;
  try {
    const { exited } = shutdown(srv);
    await webhook;
    await exited;

    neu = await startServer({ env: CONSULT_ON_ENV, dataDir: srv.dataDir });

    // Vorbedingung, sonst misst der Fall nichts: waere der Anruf beim Neustart terminal
    // geworden, haette expireOpenConsults die Rueckfrage ohnehin geschlossen - gruen aus
    // dem falschen Grund. Der Anruf laeuft beim Anbieter weiter, genau wie im Kriterium.
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

// GRUEN erwartet: das Netz UNTER dem Drain (expireOrphanedConsults, src/boot.js). Fall 4
// misst den geordneten Weg; hier faellt der Dienst hart um, der Drain laeuft gar nicht -
// der Datensatz erreicht den Neustart unangetastet offen (Vorbedingung 2).
//
// DIE POSITIV-KONTROLLE STECKT IM SELBEN FALL, dreifach: ein "Netz", das beim Boot pauschal
// kappt, bestuende die Zusicherungen oben muehelos. Es scheitert an diesen: beide Anrufe
// laufen weiter, und eine im NEUEN Prozess frisch gestellte Rueckfrage wird normal
// vorgelegt UND beantwortet. Geschlossen werden darf NUR, was kein Warter mehr erreicht.
//
// DIE FRISCHE RUECKFRAGE GEHT AN DEN ZWEITEN ANRUF, nicht an den verwaisten: dessen
// Kontingent ist verbraucht (MAX_IN_CALL_CONSULTS_PER_CALL = 1, s. CALL_ID_ZWEI). Der
// verwaiste Anruf traegt dafuer die Gegenprobe - sein Poll laeuft PARALLEL und muss die
// Haltezeit aussitzen, statt die alte Frage vorzulegen.
test("EL-NEUSTART 5: nach einem HARTEN Abbruch schliesst der Neustart die verwaiste Rueckfrage, ohne den laufenden Anruf oder den Kanal zu beschaedigen", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult(seedMitZweitemAnruf());
  let neu = null;
  try {
    const ende = await hardKill(srv);
    await webhook; // der Warter starb mit dem Prozess - das Ergebnis wird nur abgeraeumt

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

    // Die Gegenprobe des verwaisten Anrufs laeuft ab hier mit: sie braucht die volle
    // Haltezeit, die Positiv-Kontrolle darunter nur Millisekunden. Waere die alte Frage
    // noch offen, kaeme dieser Poll binnen eines Ticks mit ihr zurueck.
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

    // Positiv-Kontrolle, zweite Haelfte: eine Rueckfrage DIESES Prozesses, am zweiten
    // Anruf. Erst stellen, dann pollen - der Poll liest den Store, er kann sie nicht
    // verpassen.
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
    // KEIN srv.stop(): der Prozess ist hart gestorben, stop() wartete auf ein exit, das
    // laengst gefallen ist.
    if (neu) await neu.stop();
  }
});
