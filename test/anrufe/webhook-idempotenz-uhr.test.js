import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const START = 1_000_000;
const TAKT_MS = 200;
const HARDCUT_MS = 15_000;
const FREMDE_ANTWORT = "<Response>vom-anderen-Prozess</Response>";

function stubAblage(alterMs, eigen = true) {
  const zeiten = { lesungen: [], uebernahme: undefined };
  const ablage = {
    annehmen: async () => ({ eigen: false, kennung: "k1", alterMs }),
    lies: async () => {
      zeiten.lesungen.push(Date.now());
      return { offen: true };
    },
    uebernehmen: async () => {
      zeiten.uebernahme = Date.now();
      return { eigen, kennung: "k1", antwort: { status: 200, contentType: "text/xml", body: FREMDE_ANTWORT } };
    },
    freigeben: async () => undefined,
    beantworten: async () => undefined,
  };
  return { ablage, zeiten };
}

function appMit(ablage) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store: { webhookZustellung: ablage, getCall: () => null },
      config: withConfigNamespaces({
        skipTwilioSignatureCheck: true,
        machineDetection: { enabled: false, timeoutS: 25 },
        publicUrl: "https://hermes.test",
        elevenLabsInbound: { sipUser: "u", sipPassword: "p".repeat(32), begruessungslautEnabled: false },
      }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: { reattachActiveCall: async () => ({ call: null, logUnknown: false }) },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
      inboundBridges: { armBindingDeadline: () => {} },
      vorspannAblauf: { behandle: async () => {} },
    }),
  );
  return app;
}

const naechsteRunde = () => new Promise((weiter) => setImmediate(weiter));

const WARTERUNDEN = 50;
const MAX_LESUNGEN = 60;

async function bisLesungen(zeiten, anzahl) {
  for (let runde = 0; runde < WARTERUNDEN && zeiten.lesungen.length < anzahl && zeiten.uebernahme === undefined; runde += 1) await naechsteRunde();
  await naechsteRunde();
}

async function zweiteZustellung(t, alterMs, eigen = true) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: START });
  const { ablage, zeiten } = stubAblage(alterMs, eigen);
  const zeilen = [];
  const log = t.mock.method(console, "log", (...teile) => zeilen.push(teile.join(" ")));
  const server = await new Promise((fertig) => {
    const srv = appMit(ablage).listen(0, "127.0.0.1", () => fertig(srv));
  });
  try {
    const antwort = abrufMitFrist(`http://127.0.0.1:${server.address().port}/voice/incoming`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA_uhr_1" }).toString(),
    });
    const geantwortet = antwort.catch(() => null);
    for (let nr = 1; nr <= MAX_LESUNGEN && zeiten.uebernahme === undefined; nr += 1) {
      await bisLesungen(zeiten, nr);
      if (zeiten.uebernahme === undefined) t.mock.timers.tick(TAKT_MS);
    }
    if (zeiten.uebernahme === undefined) return { zeiten, zeilen, status: null, text: null };
    const antwortKopf = await geantwortet;
    return { zeiten, zeilen, status: antwortKopf.status, text: await antwortKopf.text() };
  } finally {
    log.mock.restore();
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}

test("webhook-idempotenz-uhr: die zweite Zustellung liest im Takt von 200 ms und uebernimmt nach HARDCUT - alterMs", async (t) => {
  const alterMs = 5_000;
  const ergebnis = await zweiteZustellung(t, alterMs);

  const erwartet = Array.from({ length: (HARDCUT_MS - alterMs) / TAKT_MS }, (_, nr) => START + nr * TAKT_MS);
  assert.deepEqual(ergebnis.zeiten.lesungen, erwartet);
  assert.equal(ergebnis.zeiten.uebernahme, START + HARDCUT_MS - alterMs - TAKT_MS);
  assert.equal(ergebnis.status, 200);
  assert.equal(ergebnis.text, FREMDE_ANTWORT);
  assert.ok(ergebnis.zeilen.some((zeile) => zeile.includes(`warte_ms=${String(HARDCUT_MS - alterMs - TAKT_MS)}`)));
});

test("webhook-idempotenz-uhr: bleibt weniger als ein Takt bis zur Frist, uebernimmt die zweite Zustellung nach einer Lesung ohne zu warten", async (t) => {
  const ergebnis = await zweiteZustellung(t, HARDCUT_MS - TAKT_MS + 1);

  assert.deepEqual(ergebnis.zeiten.lesungen, [START]);
  assert.equal(ergebnis.zeiten.uebernahme, START);
  assert.equal(ergebnis.text, FREMDE_ANTWORT);
  assert.ok(ergebnis.zeilen.some((zeile) => zeile.includes("warte_ms=0")));
});

test("webhook-idempotenz-uhr: gewinnt ein anderer Prozess die Uebernahme, steht keine Uebernommen-Zeile im Log", async (t) => {
  const ergebnis = await zweiteZustellung(t, HARDCUT_MS - TAKT_MS + 1, false);

  assert.equal(ergebnis.zeiten.uebernahme, START);
  assert.equal(ergebnis.text, FREMDE_ANTWORT);
  assert.equal(ergebnis.zeilen.some((zeile) => zeile.includes("warte_ms=")), false);
});
