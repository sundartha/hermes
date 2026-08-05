// GQ-P8 (Gespraechsqualitaet): das Ankunfts-Signal der Rueckfrage-Antwort.
//
// Befund am Live-Anruf call_msfx9pruzjvc (2026-08-05): die Antwort ("VW Golf 7, Baujahr
// 2017, Diesel.") traf um 10:07:21 ein und stand ab da im HINTERGRUND-Block. GQ-P7 hat dem
// Agenten um 10:07:25 sein Zustellfenster geoeffnet - er hat es benutzt, um take_message zu
// rufen und der Gegenstelle zu sagen, er frage nach und rufe spaeter zurueck. Die Auskunft
// lag ihm da bereits vor.
//
// Ursache am Code: advanceInCallConsult suchte nur nach OFFENEN Rueckfragen. Nach dem
// Eintreffen steht der Consult auf "answered" -> keine offene Rueckfrage -> CONSULT_WAIT.NONE
// -> consultTurnMarker liefert "" -> der Turn trug GAR KEINEN Steuertext. Das Modell sah
// dieselbe Hintergrund-Liste wie in den Turns davor und hatte keinen Anlass, sie neu zu lesen.
//
// Testnamen tragen bewusst KEINE Katalog-ID am Namensanfang - sonst landen sie still im
// Gates-Lauf, wo Rot erlaubt ist (Lehre catalog-id-prefix-misroutes-tests).
//
// Naht wie test/gq-p2-consult-deadline.test.js: lokaler node:http-Anthropic-Mock,
// DATA_DIR + Flags VOR dem ersten config-Import. Kein Server-Spawn, kein Netz, kein Sleep.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tempDataDir, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

function textOnly(text) {
  return {
    id: "msg_gqp8",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

let server;
let queue = [];
let bodies = [];
let store, defaults, claude, LOCALES, SUPPORTED_LANGUAGES;
let callSeq = 0;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queue.shift() || textOnly("UNGEWOLLTER-ZUSATZ-ROUNDTRIP")));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = "test-gqp8-key";
  process.env.IN_CALL_CONSULT_ENABLED = "true";
  process.env.CONSULT_ENABLED = "true";
  process.env.ASSISTANT_CONTEXT_ENABLED = "true";
  const calls = [];
  for (let i = 1; i <= 12; i++)
    calls.push(seedCall({ id: `call_gqp8_${i}`, direction: "outbound", answeredAt: null }));
  process.env.DATA_DIR = tempDataDir(
    seedState({
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
      calls,
    }),
  );
  await import("../src/config.js");
  store = await import("../src/store.js");
  defaults = await import("../src/store/defaults.js");
  claude = await import("../src/claude.js");
  ({ LOCALES, SUPPORTED_LANGUAGES } = await import("../src/i18n/locales.js"));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

// Ein Call mit EINGETROFFENER, noch nicht ausgelieferter Rueckfrage-Antwort. askedAt liegt
// nach call.answeredAt - nur dann ist es ein In-Call-Consult (isInCallConsult), und nur
// In-Call-Consults tragen dieses Signal.
function callWithArrivedAnswer(consultOverrides = {}) {
  callSeq += 1;
  const call = store.getCall(`call_gqp8_${callSeq}`);
  call.answeredAt = new Date(Date.now() - 600_000).toISOString();
  call.consults = [
    {
      id: "c0",
      seq: 0,
      status: defaults.CONSULT_STATUS.ANSWERED,
      askedAt: new Date(Date.now() - 20_000).toISOString(),
      answeredAt: new Date(Date.now() - 4_000).toISOString(),
      answeredFacts: 1,
      held: true,
      pendingNoted: true,
      ...consultOverrides,
    },
  ];
  return call;
}

const arrivalMarker = () => LOCALES.de.prompt.turnControl.consultAnswered;

test("GQ-P8-1: eingetroffene Antwort -> advanceInCallConsult meldet ANSWERED (statt NONE)", () => {
  const call = callWithArrivedAnswer();
  const wait = store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: 1_000,
    openMs: 300_000,
  });
  assert.equal(wait, defaults.CONSULT_WAIT.ANSWERED);
  // Reiner Leser: die Meldung darf den Consult NICHT veraendern - der Einmal-Riegel ist
  // deliveredAt, das der Shim NACH dem Turn setzt (GQ-P7). Beide teilen EINEN Zustand.
  assert.equal(store.getCall(call.id).consults[0].deliveredAt, undefined);
});

test("GQ-P8-2: bereits ausgelieferte Antwort meldet KEIN ANSWERED mehr", () => {
  const call = callWithArrivedAnswer({ deliveredAt: new Date().toISOString() });
  const wait = store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: 1_000,
    openMs: 300_000,
  });
  assert.notEqual(wait, defaults.CONSULT_WAIT.ANSWERED);
});

test("GQ-P8-3: der Turn traegt den Ankunfts-Steuertext am letzten user-Turn", async () => {
  const call = callWithArrivedAnswer();
  bodies = [];
  queue = [textOnly("Es ist ein VW Golf 7, Baujahr 2017, Diesel.")];

  const turn = await claude.agentTurn(call, "Und, welches Modell ist es nun?");

  assert.equal(turn.speech, "Es ist ein VW Golf 7, Baujahr 2017, Diesel.");
  assert.equal(bodies.length, 1, "normaler Modell-Turn, das Signal blockiert nichts");
  const lastMessage = bodies[0].messages.at(-1).content;
  assert.ok(
    lastMessage.endsWith(arrivalMarker()),
    "ohne diesen Marker sah das Modell dieselbe Hintergrund-Liste wie zuvor",
  );
});

test("GQ-P8-4: der Steuertext verbietet die drei live gemessenen Fehlreaktionen", () => {
  // Der Agent sagte live "ich frage mal und rufe spaeter an" UND rief take_message -
  // obwohl die Auskunft vorlag. Genau diese drei Ausweichwege muss der Text schliessen.
  const marker = arrivalMarker();
  assert.match(marker, /HINTERGRUND/, "verweist auf den Ort der Antwort");
  assert.match(marker, /NICHT erneut nach/, "kein zweites Nachfragen");
  assert.match(marker, /KEINEN\s+Rückruf/, "kein angekuendigter Rueckruf");
  assert.match(marker, /KEINE Nachricht/, "kein take_message darueber");
});

test("GQ-P8-5: das Signal steht VOR pending/timeout - die Ankunft ist der staerkere Zustand", () => {
  // Ein Consult, der beantwortet ist, waehrend ein zweiter noch offen waere: die Ankunft
  // gewinnt. Sonst haette der Agent einen "warte noch"-Text neben einer vorliegenden
  // Auskunft - genau der Widerspruch, der live zum Rueckruf-Versprechen fuehrte.
  const call = callWithArrivedAnswer();
  call.consults.push({
    id: "c1",
    seq: 1,
    status: defaults.CONSULT_STATUS.OPEN,
    askedAt: new Date().toISOString(),
    held: true,
  });
  const wait = store.advanceInCallConsult(call.id, {
    nowMs: Date.now(),
    waitMs: 1_000,
    openMs: 300_000,
  });
  assert.equal(wait, defaults.CONSULT_WAIT.ANSWERED);
});

test("GQ-P8-6: jede unterstuetzte Sprache traegt den Ankunfts-Steuertext", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const marker = LOCALES[language].prompt.turnControl.consultAnswered;
    assert.equal(typeof marker, "string", `${language}: consultAnswered fehlt`);
    assert.ok(marker.startsWith("["), `${language}: Steuertext muss eckig geklammert sein`);
    assert.ok(marker.endsWith("]"), `${language}: Steuertext muss eckig geklammert sein`);
  }
});

// ---------- GQ-P9: die Gegenstelle ist nicht die Auskunftsstelle ----------
//
// Zweimal live gemessen. call_msf0epenyv9g Segment 417: "Entschuldigung, ich habe keinen
// Zugriff auf Antonios Fahrzeugdaten - Können Sie mir sagen, welches Modell es ist?" Und am
// 2026-08-05 laut Owner erneut: er fragte nach dem Modell, der Agent gab die Frage zurueck.
// Aus Sicht des Angerufenen blanker Unsinn - er hat ja gerade DESHALB gefragt.
//
// Der Prompt hatte dagegen keine einzige Regel. Das ist ausdruecklich KEINE dritte
// Formulierungsrunde am selben Hebel (B-4/AL-D3, Owner-Entscheidung O-4): dort ging es um
// ein angebotenes Werkzeug, das nicht gewaehlt wird. Hier fehlte die Regel schlicht.

test("GQ-P9-1: der Systemprompt verbietet, die Gegenstelle nach Auftraggeber-Angaben zu fragen", async () => {
  const { systemPrompt } = claude;
  const call = callWithArrivedAnswer();
  const prompt = systemPrompt(call);
  const owner = LOCALES.de.prompt.boundaries.noAskingCounterpartAboutOwner("Jonas Beispiel");

  assert.ok(prompt.includes("fragst du NIEMALS dein Gegenüber danach"), "Regel fehlt im Prompt");
  assert.match(owner, /NIEMALS dein Gegenüber/);
});

test("GQ-P9-2: die Regel steht in JEDEM Turn - sie haengt an keinem Flag und keinem Werkzeug", async () => {
  // Der Defekt trat auf, WAEHREND get_consult im Werkzeugsatz lag. Eine Regel, die nur bei
  // fehlendem Werkzeug greift, haette ihn nicht verhindert.
  const withConsult = claude.systemPrompt(callWithArrivedAnswer());
  const plain = claude.systemPrompt(callWithArrivedAnswer({ status: "open", answeredAt: null }));
  for (const prompt of [withConsult, plain])
    assert.ok(prompt.includes("fragst du NIEMALS dein Gegenüber danach"));
});

test("GQ-P9-3: jede unterstuetzte Sprache traegt die Regel", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const rule = LOCALES[language].prompt.boundaries.noAskingCounterpartAboutOwner;
    assert.equal(typeof rule, "function", `${language}: noAskingCounterpartAboutOwner fehlt`);
    const rendered = rule("Jonas Beispiel");
    assert.ok(rendered.startsWith("-"), `${language}: Grenzen-Zeile beginnt mit Spiegelstrich`);
    assert.ok(rendered.includes("Jonas Beispiel"), `${language}: Auftraggeber-Name eingesetzt`);
  }
});
