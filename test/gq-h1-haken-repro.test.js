// GQ-H1 - die OFFLINE-REPRODUKTION des Live-Befunds aus call_msgf3r21x0w0. Kein Telefon,
// kein Netz, kein Spawn: drei POSTs an den Shim, jeder verlaengert den Text des vorigen,
// und jeder Turn ist FERTIG, bevor der naechste POST eintrifft. Genau das war live der Fall
// - Modell-Latenz 1107/1325/1972 ms gegen eine Fortsetzung des Anrufers nach 2077/2691 ms.
//
// ABNAHME KORRIGIERT (H1-c). Die urspruengliche Fassung mass "gesprochene Antworten: 3 -> 1".
// Diese Praemisse traegt NICHT: Telnyx verwirft die ueberzaehligen Antworten selbst, bevor
// sie gesprochen werden - der Anrufer hat nie drei Antworten gehoert. Belegt an Telnyx'
// eigenem Gespraechsprotokoll (12 Nachrichten, davon 5 vom Assistenten bei 8 substanziellen
// Turns) und an unserem Log: messagesCount 6 -> 6 (turnSeq 4/5) und 10 -> 10 -> 10
// (turnSeq 7/8/9).
//
// Der echte Defekt liegt in UNSEREM Code: claude.js schreibt die Antwort am Turn-Ende
// unbedingt ins Transkript, auch die nie gesprochene. Damit wandert sie als "bereits
// gesagt" in den Kontext des naechsten Turns, in die Zusammenfassung und in die Nachricht
// an den Owner. Gemessen wird deshalb das TRANSKRIPT:
//
//   agent-Zeilen im Transkript je wachsender Aeusserung : live 3 -> Ziel 1
//
// Warum eine eigene Datei neben gq-p1-turn-supersede.test.js: dort steht derselbe Ablauf
// als GQ-P1-8 mit der Erwartung "beide Turns sprechen (Bestand)". Das bleibt richtig - der
// Shim spricht weiterhin, das Verwerfen ist Telnyx' Sache. Hier steht, was danach im
// Transkript stehen darf.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fakeRes,
  fakeStore,
  makeCall,
  makeHandler,
  validReq,
  sseContent,
} from "./telnyx-shim-harness.js";
import { fakeTelnyxShimConfig } from "./config-namespaces-helper.js";
import { captureConsole, noopWatchdog } from "./helpers.js";

// Die Zwischenstaende EINER einzigen Aeusserung, wie die Spracherkennung sie live
// fortgeschrieben hat (dort 25 -> 51 Zeichen; hier kuerzer, gemessen wird das
// Praefix-Verhaeltnis, nicht die Laenge). Jeder Eintrag ist ein echtes Praefix des naechsten.
const WACHSENDE_AEUSSERUNG = [
  "Ja, also",
  "Ja, also ich wollte fragen",
  "Ja, also ich wollte fragen ob der Wagen fertig ist",
];

const VOLLSTAENDIGE_AEUSSERUNG = WACHSENDE_AEUSSERUNG[WACHSENDE_AEUSSERUNG.length - 1];

// Antwort-Text, der seine Frage traegt - nur so ist pruefbar, dass die EINE verbliebene
// Transkript-Zeile die auf die VOLLSTAENDIGE Aeusserung ist und nicht die auf ein Fragment.
function antwortAuf(callerText) {
  return `Antwort auf: ${callerText}`;
}

// agentTurn-Double mit dem echten Vertrag - inklusive des Nebeneffekts, um den es hier
// geht: ein fertiger Turn schreibt caller- UND agent-Zeile ins Transkript (claude.js:860
// bzw. :1196). Bewusst OHNE kuenstliche Wartezeit: der Defekt lebt genau dann, wenn das
// Modell SCHNELLER ist als die Fortsetzung des Anrufers.
function antwortenderAgentTurn(call) {
  const calls = [];
  async function agentTurn(_call, callerText, opts = {}) {
    calls.push({ callerText, opts });
    const verdraengt = opts.abortSignal?.aborted === true;
    call.transcript.push({ role: "caller", text: callerText, at: new Date().toISOString() });
    if (!verdraengt)
      call.transcript.push({
        role: "agent",
        text: antwortAuf(callerText),
        at: new Date().toISOString(),
      });
    return {
      speech: verdraengt ? "" : antwortAuf(callerText),
      speechStreamed: false,
      endCall: false,
      superseded: verdraengt,
      roundtrips: 1,
      toolNames: [],
      offeredToolNames: [],
      streamArmedRounds: 0,
      stopReason: verdraengt ? "superseded" : null,
    };
  }
  return { agentTurn, calls };
}

// Telnyx' gespiegelte Nachrichtenliste. Wird eine Antwort verworfen, ERSETZT Telnyx die
// user-Nachricht, statt eine neue anzuhaengen - die Liste waechst dann NICHT. Genau das
// bildet dieser Aufbau nach: alle drei Requests tragen dieselbe Nachrichtenzahl.
function anbieterSicht(text) {
  return { messages: [{ role: "system", content: "-" }, { role: "user", content: text }] };
}

// Fahrt die wachsende Aeusserung als Folge einzelner, VOLLSTAENDIG abgeschlossener
// Shim-Requests durch den echten Handler (Build-Operate, P13).
async function spielWachsendeAeusserung() {
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });
  const { agentTurn, calls } = antwortenderAgentTurn(call);
  const handler = makeHandler({ store, config, agentTurn, watchdog: noopWatchdog() });

  const responses = [];
  const lines = await captureConsole(async () => {
    for (const text of WACHSENDE_AEUSSERUNG) {
      const res = fakeRes();
      responses.push(res);
      // await = der Turn ist fertig, bevor der naechste POST eintrifft (der Live-Fall).
      await handler(validReq(call, anbieterSicht(text)), res);
    }
  });

  return { gesprochen: responses.map(sseContent), lines, turnCalls: calls, call };
}

function agentZeilen(call) {
  return call.transcript.filter((t) => t.role === "agent").map((t) => t.text);
}

test("GQ-H1-1: eine wachsende Aeusserung hinterlaesst GENAU EINE agent-Zeile im Transkript", async () => {
  const { call } = await spielWachsendeAeusserung();
  assert.equal(
    agentZeilen(call).length,
    1,
    `live standen 3 Antworten auf EINE Aeusserung im Transkript, 2 davon nie gesprochen; ` +
      `Transkript: ${JSON.stringify(agentZeilen(call))}`,
  );
});

test("GQ-H1-2: die verbliebene agent-Zeile gilt der VOLLSTAENDIGEN Aeusserung, nicht einem Fragment", async () => {
  const { call } = await spielWachsendeAeusserung();
  assert.deepEqual(
    agentZeilen(call),
    [antwortAuf(VOLLSTAENDIGE_AEUSSERUNG)],
    "die Antwort auf ein Fragment zu behalten und die auf die vollstaendige Aeusserung zu " +
      "verwerfen waere kein Fix",
  );
});

test("GQ-H1-3: je verworfener Antwort genau eine discarded_answer-Zeile", async () => {
  const { lines } = await spielWachsendeAeusserung();
  const verworfen = lines.filter((l) => l.includes("discarded_answer"));
  assert.equal(
    verworfen.length,
    2,
    `drei Turns auf eine Aeusserung = zwei verworfene Antworten; das Messinstrument der ` +
      `Abnahme muss beide zeigen (${verworfen.length} Zeilen)`,
  );
});

test("GQ-H1-4: der Shim spricht weiterhin auf JEDEN Request - das Verwerfen ist Telnyx' Sache", async () => {
  // Gegenprobe (T5/G3): ohne sie koennte der Fix schlicht "sprich nie" lauten und die Tests
  // darueber trotzdem bestehen. Genau hier haengt die Latenz-Abnahme des Kickoffs: der Fix
  // greift NACH dem Turn auf dem naechsten Request, nie im Sprechpfad.
  const { gesprochen } = await spielWachsendeAeusserung();
  assert.deepEqual(gesprochen, WACHSENDE_AEUSSERUNG.map(antwortAuf));
});

test("GQ-H1-5: eine EINZELNE, nicht fortgeschriebene Aeusserung behaelt ihre agent-Zeile", async () => {
  // Die wichtigste Gegenprobe des Pre-Mortems: waere die Bedingung zu weit gefasst, loeschte
  // der Fix echte, gesprochene Antworten - das Gedaechtnis waere auf die andere Art vergiftet.
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });
  const { agentTurn } = antwortenderAgentTurn(call);
  const handler = makeHandler({ store, config, agentTurn, watchdog: noopWatchdog() });
  const res = fakeRes();

  await captureConsole(async () => {
    await handler(validReq(call, anbieterSicht(VOLLSTAENDIGE_AEUSSERUNG)), res);
  });

  assert.equal(sseContent(res), antwortAuf(VOLLSTAENDIGE_AEUSSERUNG));
  assert.deepEqual(agentZeilen(call), [antwortAuf(VOLLSTAENDIGE_AEUSSERUNG)]);
});

test("GQ-H1-7: die DOPPELTE ZUSTELLUNG desselben Requests loescht KEINE gesprochene Antwort", async () => {
  // Risiko 1 des Pre-Mortems, und kein hypothetisches: der Befund, fuer den die Sonde
  // gebaut wurde (turnSeq 1 und 2 desselben Anrufs eine Millisekunde auseinander). Bei
  // einer Doppelzustellung ist die Anbieter-Liste ebenfalls unveraendert - die Antwort des
  // Vorgaengers wurde aber gesprochen. prevRelation "same" trennt die beiden Faelle.
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });
  const { agentTurn } = antwortenderAgentTurn(call);
  const handler = makeHandler({ store, config, agentTurn, watchdog: noopWatchdog() });

  await captureConsole(async () => {
    // ZWEIMAL derselbe Request, unveraenderte Anbieter-Liste = Doppelzustellung.
    await handler(validReq(call, anbieterSicht("Guten Tag")), fakeRes());
    await handler(validReq(call, anbieterSicht("Guten Tag")), fakeRes());
  });

  assert.deepEqual(agentZeilen(call), [antwortAuf("Guten Tag"), antwortAuf("Guten Tag")]);
});

test("GQ-H1-6: waechst die Anbieter-Liste, bleibt jede Antwort stehen (zwei echte Aeusserungen)", async () => {
  // Der Normalfall: die Gegenstelle sagt zwei verschiedene Dinge, Telnyx behaelt beide
  // Antworten und haengt sie an. Nichts darf entfernt werden.
  const call = makeCall();
  const store = fakeStore({ call });
  const config = fakeTelnyxShimConfig({ telnyxShimTokenStreaming: true });
  const { agentTurn } = antwortenderAgentTurn(call);
  const handler = makeHandler({ store, config, agentTurn, watchdog: noopWatchdog() });

  await captureConsole(async () => {
    await handler(
      validReq(call, { messages: [{ role: "user", content: "Guten Tag" }] }),
      fakeRes(),
    );
    // gewachsene Liste = Telnyx hat die vorige Antwort behalten
    await handler(
      validReq(call, {
        messages: [
          { role: "user", content: "Guten Tag" },
          { role: "assistant", content: antwortAuf("Guten Tag") },
          { role: "user", content: "Wann haben Sie offen?" },
        ],
      }),
      fakeRes(),
    );
  });

  assert.deepEqual(agentZeilen(call), [
    antwortAuf("Guten Tag"),
    antwortAuf("Wann haben Sie offen?"),
  ]);
});
