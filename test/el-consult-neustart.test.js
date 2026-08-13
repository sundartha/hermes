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
//   1 Normalfall ohne Neustart  -> Rueckfrage kommt durch, wird beantwortet   (GRUEN)
//   2 Anbieter beim Shutdown    -> 200 mit klarer Absage nach ~0,3 s          (GRUEN)
//   3 Auftraggeber beim Shutdown-> 200 event=none nach ~0,3 s                 (GRUEN)
//   4 Datensatz nach Neustart   -> steht WEITER auf "open"                    (ROT)
// Faelle 1-3 sind Regressionsschutz (die Drain-Freigabe, delivery.releaseOpenPolls +
// consult-raised.isDraining, laeuft vor httpServer.close und loest beide Halter auf).
// Fall 4 ist der echte Defekt: kein Pfad schliesst den Datensatz. expireOpenConsults
// laeuft nur, wenn der ANRUF terminal wird (state-ops.setCallEndedAt), advanceInCallConsult
// nur in der Turn-Schleife der Budget-Engine - die beim Anbieter-Gespraech gar nicht
// laeuft. Die Rueckfrage bleibt also fuer den Rest des Gespraechs offen; der neu
// gestartete Dienst legt sie dem Auftraggeber erneut als unbeantwortete Frage vor,
// obwohl niemand mehr auf die Antwort wartet.
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
const seed = () =>
  seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        status: "active",
        direction: "outbound",
        maxDurationS: 600,
        answeredAt: new Date().toISOString(),
        elevenlabsConversationId: CONVERSATION_ID,
      }),
    ],
  });

// Der Werkzeug-Aufruf des Anbieters. Bewusst OHNE await: er bleibt offen, bis geantwortet
// wird, die Frist ablaeuft oder der Dienst herunterfaehrt - das ist der Messgegenstand.
// Ein abgerissener Aufruf wird zu einem lesbaren Ergebnis statt zu einem rohen
// fetch-Fehler, damit die Zusicherung den Grund nennen kann.
function raiseConsult(srv) {
  const started = Date.now();
  return fetch(`${srv.localUrl}${CONSULT_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOOL_TOKEN_HEADER]: TOOL_TOKEN },
    body: JSON.stringify({ conversation_id: CONVERSATION_ID, question: QUESTION }),
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

// Server + eine nachweislich OFFENE Rueckfrage. Die Log-Zeile ist der Beleg, dass der
// Warter steht - ohne sie koennte das SIGTERM vor der Emission landen und der Fall haette
// nichts gemessen.
async function startWithOpenConsult(extra = {}) {
  const srv = await startServer({ env: { ...CONSULT_ON_ENV, ...extra }, seed: seed() });
  const webhook = raiseConsult(srv);
  await waitForLog(srv, CONSULT_RAISED_LOG, LOG_WARTE_MS);
  return { srv, webhook };
}

// Der Anruf so, wie er WIRKLICH auf Platte steht - der einzige der drei Warteplaetze, der
// einen Neustart ueberhaupt sieht.
function persistedCall(srv) {
  return srv.readStore().calls.find((call) => call.id === CALL_ID);
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

// GRUEN erwartet (Regressionsschutz). Ohne diesen Fall bestuende ein "Fix", der JEDE
// Rueckfrage sofort absagt, saemtliche Faelle dieser Datei - die Absage ist nur dann
// richtig, wenn der Normalfall weiter durchkommt.
test("EL-NEUSTART 1 (Positiv-Kontrolle): ohne Neustart kommt die Rueckfrage durch und wird beantwortet", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  try {
    const angenommen = await fetch(`${srv.localUrl}/api/calls/${CALL_ID}/consult/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: EVENT_ID, answers: [ANSWER_FACT] }),
    });

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

// ROT erwartet (echter Defekt): beide Verbindungen enden sauber, der DATENSATZ nicht.
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
      const res = await fetch(`${neu.localUrl}/api/calls/${CALL_ID}/consult`);
      assert.equal(res.status, HTTP_OK);
      const event = await res.json();
      assert.notEqual(
        event.event,
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
