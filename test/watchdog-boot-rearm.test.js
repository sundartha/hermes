// Boot-Re-Arm des Gespraechs-Wachhunds (makeConversationWatchdog,
// src/telnyx-conversation-watchdog.js) - die Frage, die max-duration-rearm.test.js fuer den
// Max-Dauer-Cap beantwortet, gestellt fuer die Dead-Air-Achse.
//
// ABSICHTLICH ROT: dieser Test nagelt eine am Code gemessene Luecke fest, er beschreibt
// keinen erledigten Fix.
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
// Zwei Faelle, bewusst als Paar:
//   (1) POSITIV-KONTROLLE im laufenden Prozess (ohne Neustart): der Wachhund greift - das
//       Armieren allein beendet nichts, erst die abgelaufene Frist terminiert. Ohne diese
//       Kontrolle koennte ein Fix, der beim Boot pauschal terminiert, Fall (2) gruen faerben.
//       Gruen, auch heute.
//   (2) DIE LUECKE, am ECHTEN Boot (Kindprozess): ein Gespraech, das den Deploy ueberlebt hat,
//       muss weiter gedeckt sein - ohne Lebenszeichen terminiert die Dead-Air-Achse, statt bis
//       zum Max-Dauer-Cap weiterzulaufen. Rot bis zum Fix (heute faellt nie eine dead_air-Zeile).
//       Bewusst am beobachtbaren Ergebnis festgemacht, NICHT an einer Funktionssignatur: welche
//       Naht den Re-Arm traegt, entscheidet der Fix.
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
// Config-Minimum von TELNYX_DEAD_AIR_TIMEOUT_S (numEnv min 5, src/config.js) - die kuerzeste
// Frist, die der Dienst ueberhaupt annimmt, damit der Fall am echten Boot kurz bleibt.
const DEAD_AIR_S = 5;
// = MAX_CALL_DURATION_CAP_S: die Deckung, die nach einem Deploy als EINZIGE bleibt. Der
// Kontrast zu DEAD_AIR_S ist der ganze Befund.
const CAP_DURATION_S = 1800;
// Puffer fuer Boot-/Timer-Jitter im Kindprozess, oben auf die Dead-Air-Frist.
const DEAD_AIR_WAIT_BUFFER_MS = 4000;
const DEAD_AIR_WAIT_MS = DEAD_AIR_S * MS_PER_SECOND + DEAD_AIR_WAIT_BUFFER_MS;

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
    await waitForLog(
      srv,
      new RegExp(`\\[telnyx-watchdog\\][^\\n]*dead_air[^\\n]*${SURVIVOR_CALL_ID}`),
      DEAD_AIR_WAIT_MS,
    );
  } finally {
    await srv.stop();
  }
});
