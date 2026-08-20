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
//   6 Kontingent nach HARTEM Abbruch-> der Platz wird frei, er kann wieder fragen(GRUEN)
//   7 Kontingent nach Ablauf ohne Antwort -> bleibt verbraucht                  (GRUEN)
//   8 Kontingent nach Antwort      -> bleibt verbraucht                         (GRUEN)
//   9 KONTINGENT nach dem DRAIN    -> der Anruf kann NIE WIEDER rueckfragen     (ROT)
//  10 Kontingent nach Ablauf VOR dem Drain -> bleibt verbraucht                 (GRUEN)
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
// Fall 9 misst denselben Kontingent-Platz am HAEUFIGEREN Weg: der harte Abbruch ist die
// Ausnahme, ein Deploy die Regel - und dort schliesst der Drain seine Rueckfrage SELBST
// (Fall 4), ohne Verwaisungs-Marker. Das Boot-Netz sieht sie damit beim naechsten Start
// gar nicht mehr (expireOrphanedConsults sucht ueber pendingConsult, also nur ueber OFFENE
// Datensaetze), und der Platz bleibt verbraucht: nach jedem Deploy stuende ein laufender
// Anruf mit offener Rueckfrage dauerhaft stumm.
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

// Angenommen ist in dieser Datei IMMER 200. Die Gate-Ablehnungen des Endpunkts (403/402
// und das 404 aus Token-/Bindungs-/Slot-Gruenden) sind in
// test/elevenlabs-consult-webhook-guards.test.js gepinnt und werden hier NICHT wiederholt -
// mit EINER Ausnahme: in den Faellen 7/8 ist die Faehigkeits-Ablehnung selbst der
// Messgegenstand (das verbrauchte Kontingent), deshalb steht sie dort samt Grund-Token.
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
// Der Grund-Token, mit dem der Webhook die Faehigkeits-Ablehnung meldet
// (routes/webhooks-elevenlabs.js). Nur er unterscheidet "das Kontingent ist verbraucht" von
// irgendeiner anderen Ablehnung - ein blosses "nicht 200" waere in den Faellen 7/8 auch
// dann gruen, wenn der Aufruf am Token oder an der Bindung gescheitert waere.
const GATE_ABGELEHNT = "kanal_nicht_freigegeben";

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
// Die ZWEITE Rueckfrage desselben Anrufs (Fall 6). Die Kennung ist der Kettenindex, nicht
// geraten: emitConsult vergibt "c<Laenge der Kette>" - nach der verwaisten c0 ist das c1.
const ZWEITES_EVENT_ID = "c1";
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

// ---- Fristen der Kontingent-Faelle 6-8 ---------------------------------------------
// Die KURZE Haltefrist fuer Fall 7: dort MUSS die Rueckfrage im laufenden Prozess wirklich
// ablaufen, weil niemand antwortet - mit OPEN_MS wuerde der Fall 20 s stillstehen. Sie ist
// zugleich die Gespraechszeit, die diese Rueckfrage gekostet hat, und wird als solche
// zugesichert; deshalb deutlich ueber CONSULT_POLL_TICK_MS (250 ms), damit die Messung
// nicht auf einem einzigen Tick steht.
const KURZ_OFFEN_MS = 1500;
// Obergrenze fuer eine ABLEHNUNG: sie faellt vor jeder Wirkung und kommt in Millisekunden
// zurueck. Wuerde der Versuch stattdessen ANGENOMMEN, hielte er die Verbindung bis
// CONSULT_OPEN_MS offen - darauf wartet kein Fall, er meldet nach dieser Frist genau das.
const ABLEHNUNG_MAX_MS = 3000;
// Wie lange auf den Datensatz einer ANGENOMMENEN Rueckfrage gewartet wird (Fall 6), und im
// welchem Takt. Grosszuegig gegen Last, klein gegen einen stumm haengenden Fall.
const RUECKFRAGE_WARTE_MS = 4000;
const RUECKFRAGE_TAKT_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// EIGENER, GROSSER EL-Ergebnisabholtakt (Owner-Auftrag 15.08.2026, Fortsetzung Aufgabe 2):
// jeder Boot dieser Datei re-armiert elevenlabs/outbound.js#pollConversationResult fuer
// JEDEN aktiven Anruf mit elevenlabsConversationId (src/boot.js, UNABHAENGIG vom
// Feature-Schalter ELEVENLABS_OUTBOUND_ENABLED) - die seedenden Anrufe hier tragen eine
// erfundene Kennung, und ein GET dagegen trifft NICHT auf ein Mock, sondern auf das ECHTE
// api.elevenlabs.io (dieser Server laeuft als echter Kindprozess). Mit leerem Test-Schluessel
// antwortet der Anbieter dort mit einem echten 401 - DAUERHAFT, s. outbound.js
// PERMANENT_FETCH_STATUS. Seit die Wiederholung vor dem Aufgeben steht (outbound.js
// PERMANENT_ERROR_STREAK_LIMIT), wuerde der PRODUKTIONS-Takt (Vorgabe 5000ms) den Anruf
// nach wenigen Sekunden dennoch auf "failed" umschalten - lange VOR den bis zu 22 s
// (CONSULT_POLL_HOLD_MS), die die laengeren Faelle dieser Datei fuer die RUECKFRAGE-Zustellung
// brauchen, das eigentliche Pruefziel hier. Diese Datei prueft die Rueckfrage-Zustellung
// ueber einen Neustart, nicht den EL-Poll (der hat seine eigene Deckung in
// test/el-beende-versuch.test.js) - der Takt wird deshalb bewusst so gross gesetzt, dass
// der ZWEITE Versuch innerhalb keines Falls dieser Datei mehr faellt (60 s liegt bequem
// ueber jeder Wartezeit hier); der ERSTE Versuch (sofort beim Boot) bleibt unveraendert und
// zeigt weiterhin, dass ein einzelner 401 den Anruf NICHT sofort beendet.
const EL_RESULT_POLL_MS_OHNE_INTERFERENZ = "60000";

const CONSULT_ON_ENV = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: TOOL_TOKEN,
  CONSULT_WAIT_MS: "200",
  CONSULT_OPEN_MS: String(OPEN_MS),
  SHUTDOWN_DRAIN_TIMEOUT_MS: String(DRAIN_TIMEOUT_MS),
  ELEVENLABS_RESULT_POLL_MS: EL_RESULT_POLL_MS_OHNE_INTERFERENZ,
});

// Dieselbe Konfiguration mit der KURZEN Haltefrist - die Umgebung der beiden Ablauf-Faelle
// (7 und 10). EINE Stelle statt zweier Literale: Fall 10 startet zweimal (vor und nach dem
// Herunterfahren) und MUSS dieselbe Frist fahren wie Fall 7. Faehrt ein Neustart eine
// ANDERE Frist, misst das Boot-Netz die Rueckfrage an einer Frist, unter der sie nie lief
// (der VORBEHALT in src/boot.js) - der Fall waere dann rot aus einem Konfigurations-Grund
// statt aus dem gemessenen Verhalten.
const KURZE_FRIST_ENV = Object.freeze({
  ...CONSULT_ON_ENV,
  CONSULT_OPEN_MS: String(KURZ_OFFEN_MS),
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
// Nutzlast in der FLACHEN Form des Anbieters (gemessen am Datensatz tool_details.body eines
// echten Anrufs vom 18.08.2026) - question UND conversation_id liegen auf oberster Ebene,
// es gibt keinen "parameters"-Umschlag. Gepinnt in
// test/elevenlabs-consult-webhook-envelope.test.js.
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

// Das Gegenstueck fuer die beiden Ablauf-Faelle (7 und 10): Server mit KURZER Haltefrist
// plus eine Rueckfrage, die darin wirklich ABGELAUFEN ist, weil niemand geantwortet hat.
// Der Aufruf wird hier bereits ausgewartet - das Ablaufen IST die Vorbedingung, und was er
// zurueckgibt, prueft pruefeAblaufOhneAntwort. Gewartet wird hoechstens KURZ_OFFEN_MS.
async function startWithExpiredConsult() {
  const srv = await startServer({ env: KURZE_FRIST_ENV, seed: seed() });
  const webhook = raiseConsult(srv);
  await waitForLog(srv, CONSULT_RAISED_LOG, LOG_WARTE_MS);
  return { srv, abgelaufen: await webhook };
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

// Der Ausgang "der Aufruf haelt weiter offen" - in den Faellen 6-8 die einzige Lage, die
// weder Annahme noch Ablehnung ist und die deshalb einen eigenen, lesbaren Namen braucht
// (sonst stuende in der Fehlermeldung nur eine abgelaufene Uhr).
const HAELT_OFFEN = Object.freeze({ status: null, fehler: "haelt offen statt abzulehnen" });

// Ein Rueckfrage-Versuch, dessen ERGEBNIS gedeckelt ist: eine Ablehnung faellt vor jeder
// Wirkung und kommt sofort, eine Annahme haelt bis CONSULT_OPEN_MS. Zurueck kommt BEIDES -
// das gedeckelte Ergebnis fuer die Zusicherung und der Aufruf selbst, damit der Fall ihn im
// finally abraeumen kann (nach srv.stop() loest die Drain-Freigabe ihn auf, s. Fall 2).
function gedeckelterVersuch(srv) {
  const versuch = raiseConsult(srv);
  const ergebnis = Promise.race([versuch, sleep(ABLEHNUNG_MAX_MS).then(() => HAELT_OFFEN)]);
  return { versuch, ergebnis };
}

// Die Zusicherung, die sich die beiden Positiv-Kontrollen TEILEN: das Kontingent dieses
// Anrufs ist verbraucht, ein zweiter Versuch prallt am Faehigkeits-Gate ab. EINE
// Formulierung fuer beide Faelle - zwei Kopien koennten auseinanderlaufen, und dann
// bewiese eine der beiden Kontrollen etwas anderes als die andere.
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

// Die Vorbedingung, die sich die beiden Ablauf-Faelle TEILEN (7 und 10): diese Rueckfrage
// ist ABGELAUFEN, weil niemand geantwortet hat - der Anruf lief die volle Haltefrist
// weiter und hat dafuer echte Gespraechszeit bezahlt. Genau das unterscheidet sie von
// einer verwaisten. EINE Formulierung fuer beide Faelle (Muster
// pruefeKontingentVerbraucht): zwei Kopien koennten auseinanderlaufen, und dann bewiese
// eine der beiden Kontrollen etwas anderes als die andere.
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

// Wartet, bis GENAU DIESE Rueckfrage auf Platte steht - der Beleg, dass sie ANGENOMMEN
// wurde: emitConsult schreibt den Datensatz synchron, bevor der Webhook zu warten beginnt.
// Ein Log-Warter waere hier untauglich: im abgelehnten Fall gibt es keine Zeile, auf die
// man warten koennte, und waitForLog meldete nur "Pattern nicht gefunden", statt den Grund
// der Ablehnung zu zeigen. null = kein Datensatz innerhalb der Frist.
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

// ---- Das KONTINGENT nach dem harten Abbruch (Faelle 6-8) ----------------------------
// Fall 5 hat belegt, dass das Boot-Netz die verwaiste Rueckfrage schliesst. Es setzt sie
// dabei nur auf expired - GEZAEHLT wird sie weiter: MAX_IN_CALL_CONSULTS_PER_CALL ist 1 und
// inCallConsults zaehlt STATUSUNABHAENGIG (consult/in-call.js und
// routes/webhooks-elevenlabs.js lesen dieselbe Zahl). Das Kontingent haengt damit an
// "registriert", nicht an "beantwortet": stirbt der Wartende, ist der Platz DAUERHAFT weg.
// Im Betrieb heisst das bei ElevenLabs nicht "ein Anruf weniger": das Gespraech laeuft beim
// Anbieter weiter, der Anruf existiert also noch - er kann ab da nur nie wieder rueckfragen
// und steht stumm, sobald er eine Auskunft braucht.
//
// DIE UNTERSCHEIDUNG, die diese drei Faelle ZUSAMMEN erzwingen:
//   verwaist durch NEUSTART           -> hat KEINE Gespraechszeit gekostet, ihr Wartender
//                                        starb -> der Platz muss frei werden   (Fall 6)
//   abgelaufen, weil NIEMAND antwortete-> hat die volle Haltefrist Gespraechszeit gekostet
//                                        -> der Platz bleibt verbraucht        (Fall 7)
//   BEANTWORTET                       -> der Grundfall, Platz verbraucht       (Fall 8)
// Ohne 7 und 8 bestuende ein "Fix", der den Kosten-Riegel schlicht abschaltet, jeden Test
// dieser Datei - man koennte dann beliebig viele Rueckfragen stellen, indem man sie ablaufen
// laesst. Beide Kontrollen laufen OHNE Neustart: sie messen die Zaehlregel selbst, nicht das
// Boot-Netz.

// GRUEN erwartet: das Boot-Netz gibt den Kontingent-Platz der verwaisten Rueckfrage frei,
// statt sie nur als tot zu markieren (Marker orphanedAt, expireOrphanedConsults in
// store/state-ops.js; consultQuotaUsed ignoriert markierte Datensaetze). Bis zu diesem
// Netz war der Fall der gemessene Befund und absichtlich rot.
//
// DERSELBE Anruf, nicht ein zweiter: Fall 5 musste seine frische Rueckfrage an einem
// FREMDEN Anruf stellen, weil genau dieses Kontingent verbrannt ist - hier ist das der
// Messgegenstand. Die Vorbedingungen von Fall 5 (harter Abbruch, offener Datensatz,
// laufender Anruf) werden mitgefuehrt: ohne sie waere ein gruenes Ergebnis wertlos.
test("EL-NEUSTART 6: nach einem HARTEN Abbruch darf DERSELBE Anruf wieder rueckfragen - die verwaiste Rueckfrage verbrennt sein Kontingent nicht", async (ctx) => {
  const { srv, webhook } = await startWithOpenConsult();
  let neu = null;
  let zweite = null;
  try {
    const ende = await hardKill(srv);
    await webhook; // der Warter starb mit dem Prozess - das Ergebnis wird nur abgeraeumt

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
    // Nur im abgelehnten Fall gelesen - dort ist der Aufruf laengst zurueck. Der Deckel
    // faengt allein den Rest ab (kein Datensatz UND kein Ergebnis), damit die Zusicherung
    // nicht stumm bis CONSULT_OPEN_MS haengt.
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
    // KEIN srv.stop(): der Prozess ist hart gestorben (Muster Fall 5).
    if (neu) await neu.stop();
    if (zweite) await zweite;
  }
});

// GRUEN erwartet (Positiv-Kontrolle, Kosten-Riegel). Diese Rueckfrage ist NICHT verwaist:
// sie lief im laufenden Prozess ab, weil niemand geantwortet hat - der Anruf lief die volle
// Haltefrist weiter und hat dafuer echte Gespraechszeit bezahlt. Ihr Platz MUSS verbraucht
// bleiben. Der Code unterscheidet beide Lagen heute nicht: der Datensatz bleibt hier sogar
// OFFEN stehen (kein Pfad schreibt beim Fristablauf des Anbieter-Warters einen Status), er
// sieht also aus wie eine frisch verwaiste Rueckfrage.
test("EL-NEUSTART 7 (Positiv-Kontrolle): eine Rueckfrage, die ABLIEF, weil niemand geantwortet hat, verbraucht das Kontingent ihres Anrufs", async (ctx) => {
  // NIEMAND antwortet - die Haltefrist laeuft im laufenden Prozess aus.
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

// GRUEN erwartet (Positiv-Kontrolle, Grundfall): der Normalfall des Kosten-Riegels. Ohne
// ihn bestuende ein "Fix", der das Kontingent gar nicht mehr zaehlt, die Faelle 6 und 7
// gemeinsam - 7 allein deckt nur die abgelaufene, nicht die beantwortete Rueckfrage.
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

// ---- Das KONTINGENT nach dem GEORDNETEN Herunterfahren (Faelle 9-10) ----------------
// DIESELBE Unterscheidung wie in 6-8, am ANDEREN Weg - und am haeufigeren. Der harte
// Abbruch ist die Ausnahme, ein Deploy die Regel: dort faehrt der Dienst geordnet herunter,
// der Drain sagt dem wartenden Anbieter-Aufruf ab und schliesst den Datensatz (Fall 4),
// waehrend die Haltefrist noch laeuft. Der Wartende stirbt genauso wie beim harten
// Abbruch, Gespraechszeit hat diese Rueckfrage nicht gekostet - ihr Kontingent-Platz muss
// also genauso frei werden.
//
// DAS BOOT-NETZ ERREICHT DIESEN FALL NICHT: expireOrphanedConsults (src/boot.js) sucht
// ueber pendingConsult, also ueber OFFENE Datensaetze - der Drain hat den seinen bereits
// geschlossen. WO der Platz freigegeben wird, entscheidet der Fix; diese Faelle pinnen
// ausschliesslich das Ergebnis.

// ROT ERWARTET - der gemessene Befund, absichtlich offen. KEIN Abnahmekriterium (keine
// ABNAHME-Kennung): der Fall gehoert in den Regressionslauf und faellt dort auf, bis der
// Drain-Pfad den Platz seiner Rueckfrage freigibt.
//
// SIGTERM, NICHT SIGKILL: der harte Abbruch ist Fall 6 und laeuft ueber eine andere Naht.
// Ginge hier ein SIGKILL raus, maesse der Fall zum zweiten Mal das Boot-Netz, statt die
// Luecke im Drain-Pfad zu zeigen. Aufbau sonst identisch zu Fall 6 - DERSELBE Anruf,
// nicht ein zweiter: genau dessen Kontingent ist der Messgegenstand.
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
    // Nur im abgelehnten Fall gelesen, Muster Fall 6: dort ist der Aufruf laengst zurueck.
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
    // srv.stop() ist nach dem SIGTERM oben ein No-op (der Prozess ist beendet), bleibt aber
    // stehen: bricht der Fall vor dem Signal ab, ist es der einzige Aufraeumweg.
    await srv.stop();
    if (neu) await neu.stop();
    if (zweite) await zweite;
  }
});

// GRUEN erwartet (Positiv-Kontrolle, Kosten-Riegel ueber den Neustart hinweg). Fall 7 pinnt
// dieselbe Regel OHNE Neustart - hier faehrt der Dienst nach dem Ablauf zusaetzlich geordnet
// herunter und wieder hoch. Ohne diesen Fall bestuende ein "Fix", der beim Start pauschal
// jede geschlossene, nie beantwortete Rueckfrage als verwaist markiert, den Fall 9 muehelos:
// der Kosten-Riegel waere dann umgehbar, indem man eine Rueckfrage ablaufen laesst und neu
// startet. Die Rueckfrage ist beim Herunterfahren bereits geschlossen - der Drain findet
// nichts mehr vor, gemessen wird also der Zustand, den der Neustart erbt.
test("EL-NEUSTART 10 (Positiv-Kontrolle): eine Rueckfrage, die VOR dem geordneten Herunterfahren ABLIEF, bleibt auch nach dem Neustart verbraucht", async (ctx) => {
  const { srv, abgelaufen } = await startWithExpiredConsult();
  let neu = null;
  let zweite = null;
  try {
    await pruefeAblaufOhneAntwort(ctx, abgelaufen);

    await srv.stop(); // geordnet, mit Drain und finalem Store-Flush
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
