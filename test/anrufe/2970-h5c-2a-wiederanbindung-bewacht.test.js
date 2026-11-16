import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeVoiceRoutes } from "../../src/routes/voice.js";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { seedCall } from "../helpers.js";

const BEWACHT = "h5c2a_hier";
const FREMD = "h5c2a_instanz_b";
const BEENDET = "h5c2a_beendet";
const OHNE_SPIEGEL = "h5c2a_ohne_spiegel";
const UNBEKANNT = "h5c2a_unbekannt";

function routenMitMenge(bewachte, protokoll, anbinden = async () => ({ call: null, logUnknown: false })) {
  const anrufe = new Map(
    [BEWACHT, FREMD, BEENDET].map((id) => [
      id,
      seedCall({ id, twilioSid: `CA_${id}`, status: id === BEENDET ? "completed" : "active", provider: "telnyx" }),
    ]),
  );
  const store = {
    getCall: (id) => anrufe.get(id) || [...anrufe.values()].find((anruf) => anruf.twilioSid === id) || null,
    anrufHierBewacht: (id) => bewachte.has(id),
    save: () => {},
    addTranscript: async () => {},
    markAnswered: async (id) => protokoll.angenommen.push(id),
    recordWebhookAnchors: () => {},
    countNoSpeechTurn: () => 1,
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({ skipTwilioSignatureCheck: true, machineDetection: { enabled: false, timeoutS: 25 } }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, directives) => directives },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {
        reattachActiveCall: async (callId) => {
          protokoll.wiederaufnahmen.push(callId);
          return anbinden(callId);
        },
      },
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => false }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
    }),
  );
  return app;
}

async function mitServer(app, fn) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    const post = async (pfad, felder = {}) => {
      const antwort = await abrufMitFrist(`http://127.0.0.1:${server.address().port}${pfad}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(felder).toString(),
      });
      await antwort.text();
      return antwort;
    };
    await fn(post);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const ROUTEN = [
  ["/voice/turn", {}],
  ["/voice/outbound", {}],
  ["/voice/status", { CallStatus: "in-progress" }],
  ["/voice/el-rueckfall", {}],
];

for (const [pfad, felder] of ROUTEN) {
  test(`Wiederanbindung ${pfad}: Spiegeltreffer ohne Eintrag in der Menge loest Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
      await post(`${pfad}?callId=${FREMD}`, felder);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
  });

  test(`Wiederanbindung ${pfad}: Anruf in der Menge loest keine zweite Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
      await post(`${pfad}?callId=${BEWACHT}`, felder);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, []);
  });
}

test("Wiederanbindung /voice/status: Treffer ueber die Anruf-Kennung des Anbieters ohne Menge-Eintrag nimmt mit der Anfrage-Kennung wieder auf", async () => {
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  await mitServer(routenMitMenge(new Set(), protokoll), async (post) => {
    await post(`/voice/status`, { CallSid: `CA_${FREMD}`, CallStatus: "in-progress" });
  });
  assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
});

test("Wiederanbindung /voice/status: bewachter Anruf wird angenommen markiert", async () => {
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
    await post(`/voice/status?callId=${BEWACHT}`, { CallStatus: "in-progress" });
  });
  assert.deepEqual(protokoll.angenommen, [BEWACHT]);
});

for (const [pfad, felder] of ROUTEN) {
  test(`Wiederanbindung ${pfad}: unbekannter Anruf loest Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
      await post(`${pfad}?callId=${UNBEKANNT}`, felder);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [UNBEKANNT]);
  });

  test(`Wiederanbindung ${pfad}: bewachte Kennung ohne Spiegeltreffer loest Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([OHNE_SPIEGEL]), protokoll), async (post) => {
      await post(`${pfad}?callId=${OHNE_SPIEGEL}`, felder);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [OHNE_SPIEGEL]);
  });
}

for (const pfad of ["/voice/outbound", "/voice/status"]) {
  test(`Wiederanbindung ${pfad}: beendeter Anruf ausserhalb der Menge wird wie bisher ohne Wiederanbindung bearbeitet`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set(), protokoll), async (post) => {
      await post(`${pfad}?callId=${BEENDET}`, { CallStatus: "in-progress" });
    });
    assert.deepEqual(protokoll.wiederaufnahmen, []);
    assert.deepEqual(protokoll.angenommen, [BEENDET]);
  });
}

test("Wiederanbindung /voice/status: unbekannte Anbieter-Kennung ohne Anfrage-Kennung loest keine Wiederanbindung aus", async () => {
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  await mitServer(routenMitMenge(new Set([BEWACHT]), protokoll), async (post) => {
    const antwort = await post(`/voice/status`, { CallSid: "CA_unbekannt", CallStatus: "in-progress" });
    assert.equal(antwort.status, 200);
  });
  assert.deepEqual(protokoll.wiederaufnahmen, []);
});

for (const pfad of ["/voice/turn", "/voice/el-rueckfall"]) {
  test(`Wiederanbindung ${pfad}: im Spiegel beendeter Anruf, der noch in der Menge steht, loest Wiederanbindung aus`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set([BEENDET]), protokoll), async (post) => {
      await post(`${pfad}?callId=${BEENDET}`, {});
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [BEENDET]);
  });
}

test("Wiederanbindung /voice/status: Spiegeltreffer ohne Menge-Eintrag, Wiederanbindung ohne Anruf: Anruf wird mit dem Spiegeltreffer bearbeitet", async () => {
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  await mitServer(routenMitMenge(new Set(), protokoll), async (post) => {
    await post(`/voice/status?callId=${FREMD}`, { CallStatus: "in-progress" });
  });
  assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
  assert.deepEqual(protokoll.angenommen, [FREMD]);
});

const WIRD_NIE_FERTIG = () => new Promise(() => {});
const WIRD_ABGELEHNT = () => Promise.reject(new Error("Datenbank haengt"));

for (const [pfad, felder] of ROUTEN) {
  test(`Wiederanbindung ${pfad}: Spiegeltreffer ohne Menge-Eintrag wartet nicht auf eine haengende Wiederanbindung`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set(), protokoll, WIRD_NIE_FERTIG), async (post) => {
      const antwort = await post(`${pfad}?callId=${FREMD}`, felder);
      assert.equal(antwort.status, 200);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
  });

  test(`Wiederanbindung ${pfad}: Spiegeltreffer ohne Menge-Eintrag antwortet auch, wenn die Wiederanbindung abgelehnt wird`, async () => {
    const protokoll = { wiederaufnahmen: [], angenommen: [] };
    await mitServer(routenMitMenge(new Set(), protokoll, WIRD_ABGELEHNT), async (post) => {
      const antwort = await post(`${pfad}?callId=${FREMD}`, felder);
      assert.equal(antwort.status, 200);
    });
    assert.deepEqual(protokoll.wiederaufnahmen, [FREMD]);
  });
}

test("Wiederanbindung /voice/turn: unbekannter Anruf ohne Kennung wird mit Warnung und Bindestrich als Kennung abgewiesen", async (t) => {
  const warnungen = [];
  t.mock.method(console, "warn", (...teile) => warnungen.push(teile.join(" ")));
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  const app = routenMitMenge(new Set(), protokoll, async () => ({ call: null, logUnknown: true }));
  await mitServer(app, async (post) => {
    await post("/voice/turn", {});
  });
  assert.deepEqual(warnungen, ["[voice/turn] kein aktiver Call (callId=- unbekannt) -> Hangup"]);
});

test("Wiederanbindung /voice/turn: beendeter Anruf wird mit Kennung und Status in der Warnung abgewiesen", async (t) => {
  const warnungen = [];
  t.mock.method(console, "warn", (...teile) => warnungen.push(teile.join(" ")));
  const protokoll = { wiederaufnahmen: [], angenommen: [] };
  const app = routenMitMenge(new Set([BEENDET]), protokoll, async () => ({ call: null, logUnknown: true }));
  await mitServer(app, async (post) => {
    await post(`/voice/turn?callId=${BEENDET}`, {});
  });
  assert.deepEqual(warnungen, [`[voice/turn] kein aktiver Call (callId=${BEENDET} status=completed) -> Hangup`]);
});
