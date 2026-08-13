// Boot-Re-Arm des Gespraechs-Wachhunds (makeConversationWatchdog,
// src/telnyx-conversation-watchdog.js) - die Frage, die max-duration-rearm.test.js fuer den
// Max-Dauer-Cap beantwortet, gestellt fuer die Dead-Air-Achse.
//
// ABSICHTLICH ROT ist heute NUR Fall (3) unten. Der Boot-Re-Arm selbst ist gelandet
// (rearmActiveCalls, telnyx-conversation-watchdog.js) - Fall (1) und (2) pinnen ihn und sind
// gruen; die Herleitung darunter ist seine Begruendung, nicht mehr der offene Befund.
//   - Die Dead-Air-Timer des Wachhunds liegen in einer per-callId-Map IM CLOSURE der Factory
//     (states, telnyx-conversation-watchdog.js). Ein Prozess-Neustart nimmt sie mit.
//   - Der EINZIGE Aufrufer von watchdog.arm() ist der Call-Control-Ingest beim
//     ai_assistant_start (telnyx-call-control-ingest.js, onSpeakEnded) - ein per-Call-Webhook
//     also, das fuer ein bereits laufendes Gespraech nach einem Deploy NIE wieder kommt.
//   - Die Boot-Sequenz (src/boot.js) re-armiert NUR den Max-Dauer-Cap
//     (lifecycle.rearmActiveCallTimers, telephony/call-lifecycle.js). Fuer den Wachhund gibt
//     es kein Gegenstueck.
// Folge: nach einem Deploy ist ein laufendes Gespraech nur noch durch den Max-Dauer-Cap
// gedeckt (Groessenordnung MAX_CALL_DURATION_CAP_S = 1800 s) statt durch die Dead-Air-Frist
// (Default 45 s). Bei minutengenauer Abrechnung ist das der Unterschied zwischen Cent und Euro.
//
// Drei Faelle, bewusst als Bund:
//   (1) POSITIV-KONTROLLE im laufenden Prozess (ohne Neustart): der Wachhund greift - das
//       Armieren allein beendet nichts, erst die abgelaufene Frist terminiert. Ohne diese
//       Kontrolle koennte ein Fix, der beim Boot pauschal terminiert, Fall (2) gruen faerben.
//       Gruen, auch heute.
//   (2) DIE DECKUNG, am ECHTEN Boot (Kindprozess): ein Gespraech, das den Deploy ueberlebt hat,
//       bleibt gedeckt - ohne Lebenszeichen terminiert die Dead-Air-Achse, statt bis zum
//       Max-Dauer-Cap weiterzulaufen. Gruen seit dem Re-Arm. Bewusst am beobachtbaren Ergebnis
//       festgemacht, NICHT an einer Funktionssignatur: welche Naht den Re-Arm traegt, entscheidet
//       der Fix.
//   (3) DIE HEUTIGE LUECKE, DIESELBE ACHSE, ANDERE RICHTUNG - der Re-Arm armiert zu BREIT:
//       isRunningAssistantLeg verlangt status "active" + assistantId + callControlId, und alle
//       drei stehen schon am Call, BEVOR abgehoben wurde (status ab createCall, store/
//       state-ops.js; assistantId/callControlId ab dem Waehlen). Telnyx laesst bis
//       TELNYX_DIAL_TIMEOUT_SECS (60) klingeln, die Dead-Air-Frist ist 45 s - ein Neustart
//       waehrend des Klingelns armiert also gegen ein Leg, das noch niemand abgenommen hat, und
//       kappt es (beobachtet: dead_air {"callId":"klingelt","turnSeq":0}). Das verletzt die
//       Zusicherung "KONSERVATIV PER KONSTRUKTION": im ungestoerten Prozess faellt arm() erst
//       NACH startAssistant, also nach dem Abheben - der Boot-Re-Arm startet die Uhr frueher,
//       als der Prozess es je getan haette. Rot bis zum Fix.
//
// Netzfrei: TELNYX_API_KEY ist in BASE_ENV leer -> endCallViaCallControl wirft SYNCHRON vor
// jedem Netzzugriff (adapters/telnyx/voice.js), der Terminator loggt das secret-frei weg. Die
// dead_air-Zeile schreibt der Wachhund VOR dem Hangup (onBeforeTerminate) und haengt deshalb
// nicht am Ausgang des Provider-Aufrufs.
//
// Der Seed traegt assistantId UND callControlId: das sind die Merkmale AM CALL, an denen ein
// laufendes Assistant-Leg erkennbar bleibt, auch wenn TELNYX_AI_ASSISTANT_ENABLED beim
// Neustart aus steht. Genau dieser Fall (ein Deploy legt das Flag um, das Leg laeuft weiter)
// darf die Deckung nicht verlieren - der Test haengt deshalb bewusst NICHT am Flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCHDOG_LOG_PREFIX } from "../src/telnyx-conversation-watchdog.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import {
  fakeStore,
  fakeTimers,
  makeCall,
  makeTestWatchdog,
  voiceControlSpy,
} from "./telnyx-shim-harness.js";
import { captureConsole, seedCall, seedState, startServer, waitForLog } from "./helpers.js";

const SURVIVOR_CALL_ID = "deploy-ueberlebt";
// Fall (3): dieselbe ID wie in der beobachteten Live-Zeile (dead_air {"callId":"klingelt"}).
const RINGING_CALL_ID = "klingelt";
// Config-Minimum von TELNYX_DEAD_AIR_TIMEOUT_S (numEnv min 5, src/config.js) - die kuerzeste
// Frist, die der Dienst ueberhaupt annimmt, damit der Fall am echten Boot kurz bleibt.
const DEAD_AIR_S = 5;
// = MAX_CALL_DURATION_CAP_S: die Deckung, die nach einem Deploy als EINZIGE bleibt. Der
// Kontrast zu DEAD_AIR_S ist der ganze Befund.
const CAP_DURATION_S = 1800;
// Puffer fuer Boot-/Timer-Jitter im Kindprozess, oben auf die Dead-Air-Frist.
const DEAD_AIR_WAIT_BUFFER_MS = 4000;
const DEAD_AIR_WAIT_MS = DEAD_AIR_S * MS_PER_SECOND + DEAD_AIR_WAIT_BUFFER_MS;

// Die dead_air-Zeile GENAU eines Calls (Format: Prefix + kind + JSON-Payload mit callId,
// utils/log-line.js). EINE Quelle fuer die zwei Boot-Faelle (G5) - sie stellen dieselbe Frage
// mit umgekehrtem Vorzeichen: Fall (2) wartet auf die Zeile, Fall (3) verbietet sie.
const deadAirLineFor = (callId) =>
  new RegExp(`\\[telnyx-watchdog\\][^\\n]*dead_air[^\\n]*${callId}`);

test("Positiv-Kontrolle: ohne Neustart deckt der Wachhund das laufende Gespraech (Armieren beendet nichts, die abgelaufene Frist terminiert)", async () => {
  const call = makeCall();
  const store = fakeStore({ call });
  const voiceControl = voiceControlSpy();
  const timers = fakeTimers();
  const watchdog = makeTestWatchdog({ store, voiceControl, timers });

  watchdog.arm(call.id); // genau das, was der Ingest bei ai_assistant_start tut

  assert.equal(timers.pendingCount(), 1, "der Wachhund haelt eine Frist auf diesem Call");
  assert.equal(voiceControl.calls.length, 0, "das Armieren allein beendet keinen Call");

  const lines = await captureConsole(() => {
    timers.fireAll();
    return Promise.resolve();
  });

  assert.equal(voiceControl.calls.length, 1, "die abgelaufene Dead-Air-Frist beendet den Call");
  assert.equal(voiceControl.calls[0].callControlId, call.callControlId);
  assert.ok(
    lines.some(
      (line) =>
        line.startsWith(WATCHDOG_LOG_PREFIX) &&
        line.includes("dead_air") &&
        line.includes(call.id),
    ),
    "dead_air-Zeile fehlt - genau auf sie wartet Fall (2) am echten Boot",
  );
});

test("Ein Gespraech, das den Neustart ueberlebt, bleibt vom Wachhund gedeckt (Dead-Air terminiert, statt bis zum Max-Dauer-Cap weiterzulaufen)", async () => {
  const answeredAt = new Date().toISOString();
  const srv = await startServer({
    env: { TELNYX_DEAD_AIR_TIMEOUT_S: String(DEAD_AIR_S) },
    seed: seedState({
      calls: [
        seedCall({
          id: SURVIVOR_CALL_ID,
          provider: "telnyx",
          status: "active",
          startedAt: answeredAt,
          answeredAt,
          endedAt: null,
          maxDurationS: CAP_DURATION_S,
          // Merkmale eines laufenden Assistant-Legs (beide bei der Origination persistiert):
          // callControlId ist zugleich der Griff, ueber den der Wachhund terminiert.
          assistantId: "asst_x",
          callControlId: "cc_survivor",
        }),
      ],
    }),
  });
  try {
    // Anker: der Boot ist durch und der Max-Dauer-Cap hat SEINEN Re-Arm gemacht. Der Call ist
    // damit unbestritten "laeuft weiter" - kein Zombie, keine Restzeit-Frage.
    await waitForLog(srv, /\[rearm\] aktive Calls beim Boot: 1 re-armed, 0 terminalisiert/);
    const stored = srv.readStore().calls;
    const survivor = stored.find((entry) => entry.id === SURVIVOR_CALL_ID);
    assert.equal(
      survivor.status,
      "active",
      "der Boot selbst beendet das Gespraech nicht - ein pauschales Terminieren waere kein Fix",
    );

    // Der Beweis: kein Lebenszeichen mehr (kein Shim-Turn nach dem Neustart) -> die
    // Dead-Air-Achse muss greifen. Heute bleibt diese Zeile aus, weil beim Boot niemand
    // watchdog.arm() fuer den ueberlebenden Call ruft.
    await waitForLog(srv, deadAirLineFor(SURVIVOR_CALL_ID), DEAD_AIR_WAIT_MS);
  } finally {
    await srv.stop();
  }
});

// Fall (3), am ECHTEN Boot: derselbe Aufbau wie Fall (2), aber mit ZWEI Legs im Store, die
// isRunningAssistantLeg heute nicht auseinanderhalten kann. Beide Beweise stecken bewusst in
// EINEM Lauf: die Positiv-Kontrolle ist zugleich die Schranke fuer den Negativ-Beweis.
test("Ein noch klingelndes Leg armiert der Boot-Re-Arm NICHT und es ueberlebt den Neustart, das abgenommene Leg daneben sehr wohl", async () => {
  const startedAt = new Date().toISOString();
  const srv = await startServer({
    env: { TELNYX_DEAD_AIR_TIMEOUT_S: String(DEAD_AIR_S) },
    seed: seedState({
      calls: [
        // Der Klingler steht BEWUSST ZUERST: rearmActiveCalls armiert in Store-Reihenfolge, im
        // selben Tick, mit derselben Frist. Waere er armiert, laege seine dead_air-Zeile also
        // VOR der des abgenommenen Legs - das Warten unten ist damit die Schranke, die den
        // Negativ-Beweis rennfrei macht (nie auf ein Ausbleiben warten muessen).
        seedCall({
          id: RINGING_CALL_ID,
          provider: "telnyx",
          // Alle drei Merkmale, an denen isRunningAssistantLeg ein laufendes Leg erkennt,
          // stehen schon waehrend des Klingelns am Call: status ab createCall (state-ops.js),
          // assistantId und callControlId ab dem Waehlen.
          status: "active",
          startedAt,
          // DER EINZIGE Unterschied zum Leg darunter: es hat nie jemand abgehoben (markAnswered
          // laeuft erst im call.answered-Ingest). Telnyx klingelt bis TELNYX_DIAL_TIMEOUT_SECS
          // (60 s) - laenger als die Dead-Air-Frist, das Klingeln ueberdauert sie also.
          answeredAt: null,
          endedAt: null,
          maxDurationS: CAP_DURATION_S,
          assistantId: "asst_x",
          callControlId: "cc_ringing",
        }),
        seedCall({
          id: SURVIVOR_CALL_ID,
          provider: "telnyx",
          status: "active",
          startedAt,
          answeredAt: startedAt, // abgenommen: das Gespraech laeuft wirklich
          endedAt: null,
          maxDurationS: CAP_DURATION_S,
          assistantId: "asst_x",
          callControlId: "cc_survivor",
        }),
      ],
    }),
  });
  try {
    // Anker wie in Fall (2), nur mit zwei Zeilen: der Boot ist durch, der Max-Dauer-Cap hat
    // SEINEN Re-Arm gemacht, und er terminalisiert weder das klingelnde noch das laufende Leg.
    await waitForLog(srv, /\[rearm\] aktive Calls beim Boot: 2 re-armed, 0 terminalisiert/);
    const byId = new Map(srv.readStore().calls.map((entry) => [entry.id, entry]));
    assert.equal(
      byId.get(RINGING_CALL_ID).status,
      "active",
      "der Boot selbst beendet das klingelnde Leg nicht - der Anruf laeuft, es hat nur noch niemand abgehoben",
    );
    assert.equal(byId.get(SURVIVOR_CALL_ID).status, "active", "das laufende Gespraech ueberlebt den Boot");

    // POSITIV-KONTROLLE, PFLICHT: das abgenommene Leg wird weiterhin armiert und faellt nach
    // der Frist. Ohne sie faerbte auch ein Fix gruen, der schlicht GAR NICHTS mehr armiert -
    // und damit den Zweck des ganzen Re-Arms (Fall 2) tilgt.
    await waitForLog(srv, deadAirLineFor(SURVIVOR_CALL_ID), DEAD_AIR_WAIT_MS);

    // DER BEFUND: heute steht die Zeile des Klinglers zu diesem Zeitpunkt laengst mit im Log
    // (er wurde als erster armiert und feuert als erster). Sie darf nie fallen - sonst kappt
    // ein Neustart waehrend des Klingelns einen Anruf, den noch niemand angenommen hat.
    assert.ok(
      !deadAirLineFor(RINGING_CALL_ID).test(srv.stdout),
      "das klingelnde Leg wurde vom Boot-Re-Arm armiert und nach der Dead-Air-Frist gekappt, obwohl noch niemand abgenommen hatte",
    );
  } finally {
    await srv.stop();
  }
});
