import assert from "node:assert/strict";
import { test, mock } from "node:test";
import express from "express";
import { makeVoiceRoutes } from "../../src/routes/voice.ts";
import { webhookEvents } from "../../src/telephony/registry.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { OHNE_EL_ZUGANG } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { EL_INBOUND_ACCESS_BOOT_ENV, normalizeIncomingTexml, postTelnyxIncoming } from "../helpers.js";
import { seedCall, seedWithTelnyxNumber, startServer, TELNYX_TEST_PEER_NUMBER, TELNYX_TEST_SIGNATURE_HEADERS, TELNYX_TEST_TENANT_NUMBER, waitForStoreState } from "../helpers.js";

const CALL_ID = "s3403_voice";
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;
const FORMULAR = { "content-type": "application/x-www-form-urlencoded" };

function baueApp({ store, lifecycle, optionen = {} }) {
  const app = express();
  if (!optionen.ohneParser) app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({ skipTwilioSignatureCheck: optionen.pruefeSignatur !== true, machineDetection: { enabled: false, timeoutS: 25 } }),
      audit: optionen.audit ?? (() => {}),
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, direktiven) => direktiven },
      ttsStore: { takeOnce: optionen.entnimm ?? (async () => null) },
      lifecycle,
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: optionen.providerFromHeaders ?? (() => null),
      inboundSignatureVerifier: () => ({ verifyInboundSignature: optionen.verifiziere ?? (() => false) }),
      terminateAndBillCall: optionen.beende ?? (async () => {}),
      billThunk: () => () => {},
      startInboundNachlauf: optionen.nachlauf ?? (() => {}),
    }),
  );
  return app;
}

async function mitApp(app, lauf) {
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  try {
    return await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const statusStore = (call) => ({
  getCall: (id) => (id === call.id ? call : null),
  anrufHierBewacht: () => false,
  save: () => {},
  markAnswered: async () => {},
  recordWebhookAnchors: () => {},
});

const postStatus = (basis, abfrage, koerper) =>
  abrufMitFrist(`${basis}/voice/status${abfrage}`, { method: "POST", headers: FORMULAR, body: new URLSearchParams(koerper).toString() });

const abwarten = () => new Promise((resolve) => setImmediate(resolve));

test("3403 Wiederanbindung abgelehnt mit Text als Fehler: der Text steht im Log statt undefined", async () => {
  const call = seedCall({ id: CALL_ID, status: "active", provider: "telnyx" });
  const lifecycle = { reattachActiveCall: () => Promise.reject("Pool kaputt") };
  const fehler = mock.method(console, "error", () => {});
  try {
    await mitApp(baueApp({ store: statusStore(call), lifecycle }), async (basis) => {
      await (await postStatus(basis, `?callId=${CALL_ID}`, { CallStatus: "in-progress" })).text();
      await abwarten();
    });
    const zeilen = fehler.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
    assert.deepEqual(zeilen, [`[voice/status] Wiederanbindung abgelehnt (callId=${CALL_ID}): Pool kaputt`]);
  } finally {
    fehler.mock.restore();
  }
});

test("3403 Statusereignis mit doppelter callId im Abfragetext: keine Wiederanbindung mit einer Liste als Kennung", async () => {
  const aufrufe = [];
  const lifecycle = { reattachActiveCall: async (id) => aufrufe.push(id) && { call: null } };
  await mitApp(baueApp({ store: statusStore(seedCall({ id: CALL_ID })), lifecycle }), async (basis) => {
    await (await postStatus(basis, "?callId=a&callId=b", { CallStatus: "completed" })).text();
    await abwarten();
  });
  assert.deepEqual(aufrufe, []);
});

test("3403 Statusereignis mit callId im Abfragetext und unbekanntem Anruf: Wiederanbindung mit genau dieser Kennung", async () => {
  const aufrufe = [];
  const lifecycle = { reattachActiveCall: async (id) => aufrufe.push(id) && { call: null } };
  await mitApp(baueApp({ store: statusStore(seedCall({ id: CALL_ID })), lifecycle }), async (basis) => {
    await (await postStatus(basis, "?callId=unbekannt_3403", { CallStatus: "completed" })).text();
    await abwarten();
  });
  assert.deepEqual(aufrufe, ["unbekannt_3403"]);
});

test("3403 Statusereignis fuer gebundenen Anruf: Nachlauf startet, Beenden und Abrechnen laufen nicht", async () => {
  const call = seedCall({ id: CALL_ID, status: "active", provider: "telnyx", costProfile: "telnyx_inbound_el_convai", elevenlabsConversationId: "conv_3403" });
  const nachlaeufe = [];
  const beendet = [];
  const optionen = { nachlauf: async (id) => nachlaeufe.push(id), beende: async () => beendet.push("beendet") };
  const store = { ...statusStore(call), anrufHierBewacht: () => true };
  await mitApp(baueApp({ store, lifecycle: { reattachActiveCall: async () => ({ call }) }, optionen }), async (basis) => {
    await (await postStatus(basis, `?callId=${CALL_ID}`, { CallStatus: "completed" })).text();
    await abwarten();
  });
  assert.deepEqual(nachlaeufe, [CALL_ID]);
  assert.deepEqual(beendet, []);
});

test("3403 Statusereignis ohne Anruf angenommen: markAnswered mit der Anrufkennung, kein Beenden", async () => {
  const call = seedCall({ id: CALL_ID, status: "active", provider: "telnyx" });
  const angenommen = [];
  const beendet = [];
  const store = { ...statusStore(call), anrufHierBewacht: () => true, markAnswered: async (id) => angenommen.push(id) };
  await mitApp(baueApp({ store, lifecycle: { reattachActiveCall: async () => ({ call }) }, optionen: { beende: async () => beendet.push(1) } }), async (basis) => {
    await (await postStatus(basis, `?callId=${CALL_ID}`, { CallStatus: "in-progress" })).text();
    await abwarten();
  });
  assert.deepEqual(angenommen, [CALL_ID]);
  assert.deepEqual(beendet, []);
});

test("3403 Ungueltige Signatur ohne erkannten Anbieter: 403 und Log mit provider=unknown", async () => {
  const warnungen = mock.method(console, "warn", () => {});
  try {
    await mitApp(baueApp({ store: statusStore(seedCall()), lifecycle: {}, optionen: { pruefeSignatur: true } }), async (basis) => {
      const antwort = await postStatus(basis, "", { CallStatus: "completed" });
      assert.equal(antwort.status, HTTP_FORBIDDEN);
      assert.equal(await antwort.text(), "invalid inbound signature");
    });
    assert.deepEqual(
      warnungen.mock.calls.map((aufruf) => aufruf.arguments.join(" ")),
      ["[voice-signature] ungueltige Inbound-Signatur -> 403 (path=/voice/status provider=unknown)"],
    );
  } finally {
    warnungen.mock.restore();
  }
});

test("3403 Ungueltige Signatur mit erkanntem Anbieter: Log nennt den Anbieter", async () => {
  const warnungen = mock.method(console, "warn", () => {});
  try {
    const optionen = { pruefeSignatur: true, providerFromHeaders: () => "telnyx" };
    await mitApp(baueApp({ store: statusStore(seedCall()), lifecycle: {}, optionen }), async (basis) => {
      assert.equal((await postStatus(basis, "", { CallStatus: "completed" })).status, HTTP_FORBIDDEN);
    });
    const [zeile] = warnungen.mock.calls.map((aufruf) => aufruf.arguments[0]);
    assert.match(zeile, /provider=telnyx\)$/);
  } finally {
    warnungen.mock.restore();
  }
});

test("3403 Signaturpruefung bekommt den Formularkoerper, ohne Koerper eine leere Liste", async () => {
  const gesehen = [];
  const verifiziere = ({ params }) => gesehen.push({ ...params }) && false;
  const mitKoerper = { store: statusStore(seedCall()), lifecycle: {}, optionen: { pruefeSignatur: true, verifiziere } };
  await mitApp(baueApp(mitKoerper), async (basis) => {
    await postStatus(basis, "", { CallStatus: "completed" });
  });
  const ohneKoerper = { ...mitKoerper, optionen: { ...mitKoerper.optionen, ohneParser: true } };
  await mitApp(baueApp(ohneKoerper), async (basis) => {
    await abrufMitFrist(`${basis}/voice/status`, { method: "POST" });
  });
  assert.deepEqual(gesehen, [{ CallStatus: "completed" }, {}]);
});

async function eingehend(felder) {
  const srv = await startServer({ seed: seedWithTelnyxNumber({ language: "de" }) });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams([["To", TELNYX_TEST_TENANT_NUMBER], ...felder]),
    });
    await antwort.text();
    const store = await waitForStoreState(srv, (zustand) => zustand.calls.some((anruf) => anruf.direction === "inbound"));
    return store.calls.find((anruf) => anruf.direction === "inbound");
  } finally {
    await srv.stop();
  }
}

test("3403 Eingehender Anruf mit Absender und Anbieterkennung: beides landet unveraendert im Anruf", async () => {
  const anruf = await eingehend([["From", TELNYX_TEST_PEER_NUMBER], ["CallSid", "CA3403ok"]]);
  assert.equal(anruf.from, TELNYX_TEST_PEER_NUMBER);
  assert.equal(anruf.twilioSid, "CA3403ok");
});

test("3403 Eingehender Anruf mit leerem Absender: Absender ist unbekannt", async () => {
  const anruf = await eingehend([["From", ""], ["CallSid", "CA3403leer"]]);
  assert.equal(anruf.from, "unbekannt");
});

test("3403 Eingehender Anruf ohne Absender: Absender ist unbekannt", async () => {
  const anruf = await eingehend([["CallSid", "CA3403fehlt"]]);
  assert.equal(anruf.from, "unbekannt");
});

test("3403 Eingehender Anruf mit doppeltem Absender und doppelter Kennung: unbekannt und keine Kennung statt Listen", async () => {
  const anruf = await eingehend([["From", "+491"], ["From", "+492"], ["CallSid", "CA1"], ["CallSid", "CA2"]]);
  assert.equal(anruf.from, "unbekannt");
  assert.equal(anruf.twilioSid ?? null, null);
});

test("3403 Sprachausgabe-Abruf scheitert mit Text als Fehler: 404 und der Text steht im Log", async () => {
  const fehler = mock.method(console, "error", () => {});
  try {
    const optionen = { entnimm: () => Promise.reject("Ablage kaputt") };
    await mitApp(baueApp({ store: statusStore(seedCall()), lifecycle: {}, optionen }), async (basis) => {
      const antwort = await abrufMitFrist(`${basis}/voice/tts/abc`);
      assert.equal(antwort.status, HTTP_NOT_FOUND);
    });
    assert.deepEqual(
      fehler.mock.calls.map((aufruf) => aufruf.arguments.join(" ")),
      ["[voice/tts] Ablage kaputt"],
    );
  } finally {
    fehler.mock.restore();
  }
});

test("3403 Sprachausgabe-Abruf ohne Ablage-Eintrag: 404 ohne Fehlerlog", async () => {
  const fehler = mock.method(console, "error", () => {});
  try {
    await mitApp(baueApp({ store: statusStore(seedCall()), lifecycle: {} }), async (basis) => {
      const antwort = await abrufMitFrist(`${basis}/voice/tts/abc`);
      assert.equal(antwort.status, HTTP_NOT_FOUND);
      assert.equal(await antwort.text(), "");
    });
    assert.equal(fehler.mock.calls.length, 0);
  } finally {
    fehler.mock.restore();
  }
});

test("3403 Sprachausgabe-Abruf mit Eintrag: Audio mit Inhaltstyp und Bytes", async () => {
  const optionen = { entnimm: async (token) => ({ contentType: "audio/wav", bytes: Buffer.from(`ton-${token}`) }) };
  await mitApp(baueApp({ store: statusStore(seedCall()), lifecycle: {}, optionen }), async (basis) => {
    const antwort = await abrufMitFrist(`${basis}/voice/tts/xyz`);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(antwort.headers.get("content-type"), "audio/wav");
    assert.equal(await antwort.text(), "ton-xyz");
  });
});

const postEingang = (basis, koerper) =>
  abrufMitFrist(`${basis}/voice/incoming`, { method: "POST", headers: FORMULAR, body: new URLSearchParams(koerper).toString() });

test("3403 Eingehender Anruf ohne gewaehlte Nummer: Audit nennt to=- und die Antwort legt auf", async () => {
  const audits = [];
  const store = { ...statusStore(seedCall()), numberRecordByE164: async () => null };
  const optionen = { audit: (...args) => audits.push(args.filter((teil) => typeof teil === "string")) };
  await mitApp(baueApp({ store, lifecycle: {}, optionen }), async (basis) => {
    const antwort = await postEingang(basis, { From: "+491" });
    assert.equal(antwort.status, HTTP_OK);
    assert.match(antwort.headers.get("content-type"), /^text\/xml/);
  });
  assert.deepEqual(audits, [["inbound_unrouted", "to=-"]]);
});

test("3403 Eingehender Anruf mit Fehler in der Verarbeitung: Log beginnt mit [incoming] und nennt den Fehlertext", async () => {
  const fehler = mock.method(console, "error", () => {});
  try {
    const store = {
      ...statusStore(seedCall()),
      numberRecordByE164: async () => {
        throw new Error("Nummernliste kaputt");
      },
    };
    await mitApp(baueApp({ store, lifecycle: {} }), async (basis) => {
      await postEingang(basis, { To: "+491", From: "+492" });
    });
    assert.deepEqual(
      fehler.mock.calls.map((aufruf) => aufruf.arguments.join(" ")),
      ["[incoming] Nummernliste kaputt"],
    );
  } finally {
    fehler.mock.restore();
  }
});

function mitFehlerweg(inneresApp) {
  const fehler = [];
  const app = express();
  app.use((req, res, next) =>
    inneresApp(req, res, (err) => {
      if (!err) return next();
      fehler.push(err.message);
      if (!res.headersSent) res.status(HTTP_SERVER_ERROR).end();
    }),
  );
  return { app, fehler };
}

const HTTP_SERVER_ERROR = 500;
const postPfad = (basis, pfad, abfrage = "") =>
  abrufMitFrist(`${basis}${pfad}${abfrage}`, { method: "POST", headers: FORMULAR, body: new URLSearchParams({ CallStatus: "in-progress" }).toString() });
const kaputterSpeicher = () => ({
  ...statusStore(seedCall()),
  getCall: () => {
    throw new Error("Speicher kaputt");
  },
});

async function fehlerAmWeg(store, abruf, optionen = {}) {
  const { app, fehler } = mitFehlerweg(baueApp({ store, lifecycle: {}, optionen }));
  await mitApp(app, async (basis) => {
    await (await abruf(basis)).text();
    await abwarten();
  });
  return fehler;
}

test("3403 Statusmeldung mit kaputtem Speicher: Fehler geht an den Fehlerweg statt als unbehandelte Ablehnung", async () => {
  const fehler = await fehlerAmWeg(kaputterSpeicher(), (basis) => postPfad(basis, "/voice/status", `?callId=${CALL_ID}`));
  assert.deepEqual(fehler, ["Speicher kaputt"]);
});

test("3403 Beinmeldung von ElevenLabs mit kaputtem Speicher: Fehler geht an den Fehlerweg", async () => {
  const fehler = await fehlerAmWeg(kaputterSpeicher(), (basis) => postPfad(basis, "/voice/el-bein", `?callId=${CALL_ID}`));
  assert.deepEqual(fehler, ["Speicher kaputt"]);
});

const mitKaputtemLog = async (lauf) => {
  const log = mock.method(console, "error", () => {
    throw new Error("Log kaputt");
  });
  try {
    return await lauf();
  } finally {
    log.mock.restore();
  }
};

test("3403 Rueckfall von ElevenLabs, dessen Fehlerlog selbst scheitert: Fehler geht an den Fehlerweg", async () => {
  const fehler = await mitKaputtemLog(() => fehlerAmWeg(kaputterSpeicher(), (basis) => postPfad(basis, "/voice/el-rueckfall", `?callId=${CALL_ID}`)));
  assert.deepEqual(fehler, ["Log kaputt"]);
});

test("3403 Vorspann-Ereignis mit kaputtem Speicher und scheiterndem Log: Fehler geht an den Fehlerweg", async () => {
  const fehler = await mitKaputtemLog(() => fehlerAmWeg(kaputterSpeicher(), (basis) => postPfad(basis, "/voice/vorspann", `?callId=${CALL_ID}`)));
  assert.deepEqual(fehler, ["Log kaputt"]);
});

test("3403 Sprachausgabe-Abruf, dessen Fehlerlog selbst scheitert: Fehler geht an den Fehlerweg", async () => {
  const optionen = { entnimm: () => Promise.reject(new Error("Ablage kaputt")) };
  const fehler = await mitKaputtemLog(() => fehlerAmWeg(statusStore(seedCall()), (basis) => abrufMitFrist(`${basis}/voice/tts/abc`), optionen));
  assert.deepEqual(fehler, ["Log kaputt"]);
});

test("3403 Eingehender Anruf, dessen Fehlerlog selbst scheitert: Fehler geht an den Fehlerweg", async () => {
  const store = {
    ...statusStore(seedCall()),
    numberRecordByE164: async () => {
      throw new Error("Nummernliste kaputt");
    },
  };
  const fehler = await mitKaputtemLog(() => fehlerAmWeg(store, (basis) => postEingang(basis, { To: "+491", From: "+492" })));
  assert.deepEqual(fehler, ["Log kaputt"]);
});

test("3403 Wache bei eingehendem Anruf: ein Fehler ausserhalb der Ablage-Aufrufe geht an den Fehlerweg", async () => {
  const annahme = {
    eigen: false,
    kennung: "k",
    alterMs: 0,
    get antwort() {
      throw new Error("Annahme kaputt");
    },
  };
  const store = { ...statusStore(seedCall()), webhookZustellung: { annehmen: async () => annahme } };
  const fehler = await fehlerAmWeg(store, (basis) => postEingang(basis, { CallSid: "CA3403wache", To: "+491", From: "+492" }));
  assert.deepEqual(fehler, ["Annahme kaputt"]);
});

test("3403 Wache bei Statusmeldung mit Zeitstempel-Header: Umschlag-Anker mit Praefix se wird angenommen", async () => {
  const aufrufe = [];
  const ablage = {
    annehmen: async (bindung) => {
      aufrufe.push(bindung.anker);
      return { eigen: true, kennung: "k" };
    },
    beantworten: async () => {},
    freigeben: async () => {},
  };
  const app = express();
  app.use(express.urlencoded({ extended: false, verify: (req, _res, puffer) => Object.assign(req, { rawBody: puffer }) }));
  app.use(baueApp({ store: { ...statusStore(seedCall()), webhookZustellung: ablage }, lifecycle: {}, optionen: { ohneParser: true } }));
  await mitApp(app, async (basis) => {
    const antwort = await abrufMitFrist(`${basis}/voice/status?callId=${CALL_ID}`, { method: "POST", headers: { ...FORMULAR, "telnyx-timestamp": "1" }, body: "CallStatus=ringing" });
    await antwort.text();
  });
  assert.equal(aufrufe.length, 1);
  assert.match(aufrufe[0][0], /^se:[0-9a-f]{64}$/);
});

async function eingehendeDialAntwort(schalter) {
  const srv = await startServer({
    env: { ...EL_INBOUND_ACCESS_BOOT_ENV, ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID, ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED: schalter },
    seed: seedWithTelnyxNumber({ language: "de" }),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "CA3403laut" });
    assert.equal(res.status, HTTP_OK);
    return normalizeIncomingTexml(await res.text());
  } finally {
    await srv.stop();
  }
}

test("3403 Eingehender EL-Anruf ohne Begruessungslaut-Schalter: der Dial traegt keine audioUrl", async () => {
  const texml = await eingehendeDialAntwort("false");
  assert.match(texml, /sip\.rtc\.elevenlabs\.io/);
  assert.doesNotMatch(texml, /audioUrl/);
});

test("3403 Eingehender EL-Anruf mit Begruessungslaut-Schalter: der Dial traegt die audioUrl", async () => {
  const texml = await eingehendeDialAntwort("true");
  assert.match(texml, /audioUrl="[^"]+"/);
});

test("3403 Eingehender Anruf ohne EL-Zugang: die Notbremse-Frist folgt dem Minutentarif und dem Restguthaben", async () => {
  const angelegt = [];
  const store = {
    numberRecordByE164: async () => ({ tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" }),
    resolveCallLanguage: async () => "de",
    budgetExceeded: () => false,
    tenantBudgetSnapshot: () => ({ remainingCents: 60 }),
    createCall: (leg) => {
      angelegt.push(leg);
      throw new Error("Abbruch nach dem Anlegen");
    },
    getCall: () => null,
    tenantPrivateNumber: () => null,
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(
    makeVoiceRoutes({
      store,
      config: withConfigNamespaces({ ...OHNE_EL_ZUGANG, skipTwilioSignatureCheck: true }),
      audit: () => {},
      voiceRender: { render: () => "<Response/>", turnDirectives: () => [], sayInCallVoice: () => [], followupTurnDirectives: () => [] },
      directiveSynth: { synthesizeDirectiveAudio: async (_call, direktiven) => direktiven },
      ttsStore: { takeOnce: async () => null },
      lifecycle: {},
      finishCall: () => {},
      webhookEvents,
      providerFromHeaders: () => null,
      inboundSignatureVerifier: () => ({ verifyInboundSignature: () => true }),
      terminateAndBillCall: async () => {},
      billThunk: () => () => {},
      startInboundNachlauf: () => {},
    }),
  );
  const fehler = mock.method(console, "error", () => {});
  try {
    await mitApp(app, async (basis) => {
      await (await abrufMitFrist(`${basis}/voice/incoming`, { method: "POST", headers: FORMULAR, body: "From=%2B4915100000001&To=%2B4915100000002&CallSid=CA3403bremse" })).text();
    });
  } finally {
    fehler.mock.restore();
  }
  assert.deepEqual(fehler.mock.calls.map((a) => a.arguments.join(" ")), ["[incoming] Abbruch nach dem Anlegen"]);
  assert.equal(angelegt.length, 1);
  assert.equal(angelegt[0].maxDurationS, 660);
});

test("3403 Eingehender Anruf scheitert vor dem Anlegen: die Fehlerantwort kommt trotzdem als 200 mit Ansage", async () => {
  const store = { getCall: () => null, numberRecordByE164: async () => Promise.reject(new Error("Nummernsuche kaputt")) };
  const fehler = mock.method(console, "error", () => {});
  let antwort;
  try {
    await mitApp(baueApp({ store, lifecycle: {} }), async (basis) => {
      antwort = await abrufMitFrist(`${basis}/voice/incoming`, { method: "POST", headers: FORMULAR, body: "From=%2B4915100000001&To=%2B4915100000002&CallSid=CA3403fehler" });
    });
  } finally {
    fehler.mock.restore();
  }
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(await antwort.text(), "<Response/>");
});
