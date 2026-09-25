// IP4 Scope 3: der Kontingent-Riegel des Play-TTS-Pfads ist ein KOSTEN-Gate auf einem
// Plattform-Konto ohne per-Tenant-Metering. Er existiert seit GAP-09 - neu ist der
// BEWEIS, dass er bei erschoepftem Kontingent keinen Provider-Aufruf macht und fail-safe
// auf Azure-<Say> faellt (nie den Anruf toetet).
// Zwei Riegel, zwei Faelle, plus je ein Negativfall (T5/G3):
//   VOR-Riegel  (store.platformTtsUsageView + ttsQuotaExhausted): KEIN fetch, KEIN put.
//   NACH-Riegel (recordTtsCharacters -> warning.exhausted): fetch JA (die Zeichen sind
//               bezahlt), aber Direktive unveraendert und KEIN put.
//
// Der Bestands-Fall GAP-09 (test/tts-quota-counter.test.js) laesst "Sperre ODER
// Degradation" zu und laeuft in der Gates-Bank; hier steht das UND, in der
// Regressionsbank (kein Katalog-Praefix am Namen).
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeDirectiveSynth } from "../src/tts/directive-synth.js";
import { say } from "../src/telephony/directives.js";
import { captureConsole } from "./helpers.js";
import { playTtsSynthConfig, PROBE_API_KEY } from "./helpers/play-tts-stimm-probe.mjs";
// IE7: die gestreamte Antwort-Attrappe liegt geteilt in test/helpers/fake-tts-stream.mjs.
import { recordingStreamFetch } from "./helpers/fake-tts-stream.mjs";

const PROVIDER = "telnyx";
const CYCLE_KEY = "2026-08";
const QUOTA = 10;
// Ein Zaehlerstand, der das Kontingent unstrittig ueberschreitet (Nach-Buchungs-Fall).
const CHARACTERS_OVER_QUOTA = 20;
// Der Zaehlerstand des Grenzfalls "Kontingent abgeschaltet" (quota=0): beliebig hoch, er
// darf trotzdem nicht sperren.
const CHARACTERS_WITHOUT_QUOTA = 999;
const ERWARTETE_WARNZEILE = new RegExp(
  `^\\[play-tts\\] Kontingent erschoepft \\(${QUOTA}/${QUOTA}, Zyklus ${CYCLE_KEY}\\) -> Azure-Fallback$`,
);

function fakeTtsStore() {
  const putCalls = [];
  return {
    putCalls,
    // IE7: EIN Argument - die Audio-Zusage {contentType, bytes:Promise}.
    put(audio) {
      putCalls.push(audio);
      return "ip4-token";
    },
  };
}


function werfendesFetch() {
  throw new Error("fetch haette nie aufgerufen werden duerfen (Kosten-Gate)");
}

// Ein Lauf des Play-TTS-Pfads gegen den uebergebenen Zaehl-/Projektions-Store: liefert die
// Direktiven-Liste, die put-Aufrufe, die fetch-Aufrufe und die Konsolen-Zeilen.
async function laufMit({ store, fetchImpl, onQuotaWarning = () => {} }) {
  const ttsStore = fakeTtsStore();
  const { synthesizeDirectiveAudio } = makeDirectiveSynth({
    config: playTtsSynthConfig(),
    ttsStore,
    store,
    onQuotaWarning,
  });
  const directives = [say("Guten Tag")];
  let out;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const lines = await captureConsole(async () => {
    try {
      out = await synthesizeDirectiveAudio({ provider: PROVIDER }, directives);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  return { directives, out, putCalls: ttsStore.putCalls, lines };
}

test("Vor-Riegel: erschoepftes Kontingent -> KEIN Provider-Aufruf, Direktive unveraendert", async () => {
  const { directives, out, putCalls, lines } = await laufMit({
    store: {
      platformTtsUsageView: () => ({ characters: QUOTA, quota: QUOTA, cycleKey: CYCLE_KEY }),
      recordTtsCharacters: () => assert.fail("erschoepft heisst NICHT bezahlen - keine Buchung"),
    },
    fetchImpl: werfendesFetch,
  });

  assert.equal(out[0], directives[0], "referenz-identisch -> Azure-<Say>");
  assert.equal(putCalls.length, 0, "kein Audio im ttsStore");
  assert.ok(
    lines.some((line) => ERWARTETE_WARNZEILE.test(line)),
    `Warnzeile fehlt, gesehen:\n${lines.join("\n")}`,
  );
  assert.ok(
    !lines.join("\n").includes(PROBE_API_KEY),
    "keine Warnzeile darf den Anbieter-Schluessel tragen (Absolute Regel 4)",
  );
});

// Positiv-Kontrolle (Lehre pruefkommando-ohne-positiv-kontrolle): ein Gate, das alles
// ablehnt, besteht jeden Negativ-Test.
test("Vor-Riegel Negativfall: Kontingent frei -> genau EIN Provider-Aufruf, Audio eingewoben", async () => {
  const { calls, fetchImpl } = recordingStreamFetch();
  const { out, putCalls } = await laufMit({
    store: {
      platformTtsUsageView: () => ({ characters: 0, quota: QUOTA, cycleKey: CYCLE_KEY }),
      recordTtsCharacters: () => null,
    },
    fetchImpl,
  });

  assert.equal(calls.length, 1, "genau ein Synth-Aufruf");
  assert.equal(putCalls.length, 1);
  assert.ok(out[0].audioUrl, "die Direktive traegt die Serve-URL");
});

test("Vor-Riegel fehlt (Bestands-Attrappe ohne Projektion) -> der Nach-Riegel faengt", async () => {
  const { calls, fetchImpl } = recordingStreamFetch();
  const { directives, out, putCalls, lines } = await laufMit({
    store: {
      // platformTtsUsageView bewusst NICHT gesetzt (optional chaining im Produktionscode)
      recordTtsCharacters: () => ({
        characters: CHARACTERS_OVER_QUOTA,
        quota: QUOTA,
        cycleKey: CYCLE_KEY,
        exhausted: true,
      }),
    },
    fetchImpl,
    onQuotaWarning: () => assert.fail("der Riegel ist nicht der Alarm - keine SMS je Turn"),
  });

  assert.equal(calls.length, 1, "die Zeichen sind bezahlt - der Aufruf lief");
  assert.equal(out[0], directives[0], "das Audio wird verworfen -> Azure-<Say>");
  assert.equal(putCalls.length, 0, "verworfenes Audio landet nicht im ttsStore");
  assert.ok(
    lines.some((line) => /^\[play-tts\] Kontingent erschoepft \(/.test(line)),
    `Warnzeile fehlt, gesehen:\n${lines.join("\n")}`,
  );
});

// Grenzfall (T5): quota=0 heisst "Kontingent abgeschaltet", nicht "sofort erschoepft" -
// das pinnt das quota > 0 in ttsQuotaExhausted (state-ops.js).
test("Kontingent 0 (abgeschaltet) -> kein Riegel, die Synthese laeuft", async () => {
  const { calls, fetchImpl } = recordingStreamFetch();
  const { out, putCalls } = await laufMit({
    store: {
      platformTtsUsageView: () => ({
        characters: CHARACTERS_WITHOUT_QUOTA,
        quota: 0,
        cycleKey: CYCLE_KEY,
      }),
      recordTtsCharacters: () => null,
    },
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(putCalls.length, 1);
  assert.ok(out[0].audioUrl);
});
