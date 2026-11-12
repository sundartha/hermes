import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";
import { EXA_SCHLUESSEL_BEISPIEL } from "../gemeinsam/erfundene-geheimnisse.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_UNAVAILABLE = 503;
const VERSUCHE_BEI_ZWEI_WIEDERHOLUNGEN = 3;
const ANTWORT_TEXT = "Gerne, ich notiere das.";
const EXA_ANTWORT = { results: [{ title: "Oeffnungszeiten", highlights: ["Mo bis Fr 9 bis 17 Uhr"] }] };

let skript = [];
let anfragen = [];

const nachricht = (content) => ({
  id: "msg_llm",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content,
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 11, output_tokens: 7 },
});
const ok = (text = ANTWORT_TEXT) => ({ status: HTTP_OK, body: nachricht([{ type: "text", text }]) });
const fehler = (status, type = "api_error", message = "fehler") => ({
  status,
  body: { type: "error", error: { type, message } },
});

const exaAnfragen = [];
const exa = await starteAttrappe((req, res) => {
  let raw = "";
  req.on("data", (teil) => (raw += teil));
  req.on("end", () => {
    exaAnfragen.push({ headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(EXA_ANTWORT));
  });
});
after(() => exa.close());

const attrappe = await starteAttrappe((req, res) => {
  let raw = "";
  req.on("data", (teil) => (raw += teil));
  req.on("end", () => {
    anfragen.push(JSON.parse(raw));
    const antwort = skript.shift() ?? fehler(HTTP_UNAVAILABLE);
    res.writeHead(antwort.status, { "content-type": "application/json" });
    res.end(JSON.stringify(antwort.body));
  });
});
after(() => attrappe.close());

const de = {
  llmDegradedSpeech:
    "Entschuldigung, ich kann Ihr Anliegen gerade nicht bearbeiten. Ich melde mich, sobald es wieder möglich ist. Auf Wiederhören.",
  turnErrorSpeech:
    "Entschuldigung, da ist ein technisches Problem aufgetreten. Bitte versuchen Sie es später erneut.",
};

async function mitZuegen(env, anzahl, ablauf) {
  const ids = Array.from({ length: anzahl }, (_, i) => `call_llm_${i}`);
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: attrappe.url, ...env },
    seed: seedState({ calls: ids.map((id) => seedCall({ id, direction: "outbound" })) }),
  });
  const zug = async (i, gesprochen = "Guten Tag") => {
    const res = await abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${ids[i]}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: gesprochen }),
    });
    assert.equal(res.status, HTTP_OK);
    return res.text();
  };
  try {
    await ablauf({ zug, srv });
  } finally {
    await srv.stop();
  }
}

function neuerLauf(antworten) {
  skript = [...antworten];
  anfragen = [];
}

test("R7-1: dauerhaft voruebergehender Anbieterfehler - drei Versuche, dann die Ausfall-Ansage statt der Fehler-Ansage", async () => {
  neuerLauf([]);
  await mitZuegen({ LLM_MAX_RETRIES: "2" }, 1, async ({ zug }) => {
    const xml = await zug(0);
    assert.equal(anfragen.length, VERSUCHE_BEI_ZWEI_WIEDERHOLUNGEN);
    assert.ok(xml.includes(de.llmDegradedSpeech), xml);
    assert.ok(!xml.includes(de.turnErrorSpeech));
    assert.match(xml, /<Hangup\/>/);
  });
});

test("R7-2: dauerhafter Anbieterfehler ohne voruebergehendes - genau ein Versuch, die allgemeine Fehler-Ansage", async () => {
  neuerLauf([fehler(HTTP_BAD_REQUEST, "invalid_request_error")]);
  await mitZuegen({ LLM_MAX_RETRIES: "2" }, 1, async ({ zug }) => {
    const xml = await zug(0);
    assert.equal(anfragen.length, 1);
    assert.ok(xml.includes(de.turnErrorSpeech), xml);
    assert.ok(!xml.includes(de.llmDegradedSpeech));
  });
});

test("R7-3: ein Fehlversuch, dann Erfolg - der Anrufer hoert die Antwort; Anfrage traegt Cache-Markierung und Textbloecke werden verbunden", async () => {
  neuerLauf([
    fehler(HTTP_UNAVAILABLE),
    {
      status: HTTP_OK,
      body: nachricht([
        { type: "text", text: "Erster Satz." },
        { type: "text", text: "Zweiter Satz." },
      ]),
    },
  ]);
  await mitZuegen({ LLM_MAX_RETRIES: "2" }, 1, async ({ zug }) => {
    const xml = await zug(0);
    assert.equal(anfragen.length, 2);
    assert.ok(xml.includes("Erster Satz. Zweiter Satz."), xml);
    const anfrage = anfragen[1];
    assert.equal(anfrage.model, "claude-haiku-4-5");
    assert.equal(anfrage.max_tokens, 300);
    assert.deepEqual(anfrage.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(anfrage.tools.at(-1).cache_control, { type: "ephemeral" });
    assert.equal(anfrage.tools[0].cache_control, undefined);
    assert.ok(anfrage.tools.every((t) => t.input_schema && !t.parameters));
    assert.equal("tool_choice" in anfrage, false);
  });
});

test("R7-4: Sicherung oeffnet nach der Schwelle und sperrt den Anbieter; ein dauerhafter Fehler zaehlt nicht mit", async () => {
  neuerLauf([
    fehler(HTTP_BAD_REQUEST, "invalid_request_error"),
    fehler(HTTP_UNAVAILABLE),
    fehler(HTTP_UNAVAILABLE),
  ]);
  const env = {
    LLM_MAX_RETRIES: "0",
    LLM_BREAKER_THRESHOLD: "2",
    LLM_BREAKER_COOLDOWN_MS: "600000",
  };
  await mitZuegen(env, 4, async ({ zug }) => {
    await zug(0);
    await zug(1);
    assert.equal(anfragen.length, 2, "nach 400 und einem 503 ist die Sicherung noch zu");
    await zug(2);
    assert.equal(anfragen.length, 3);
    const gesperrt = await zug(3);
    assert.equal(anfragen.length, 3, "offene Sicherung: kein Anbieter-Aufruf mehr");
    assert.ok(gesperrt.includes(de.llmDegradedSpeech), gesperrt);
  });
});

test("R7-5: ein Erfolg setzt die Fehlerzaehlung zurueck, alte Fehler ausserhalb des Fensters zaehlen nicht", async () => {
  neuerLauf([fehler(HTTP_UNAVAILABLE), ok(), fehler(HTTP_UNAVAILABLE), fehler(HTTP_UNAVAILABLE)]);
  const env = {
    LLM_MAX_RETRIES: "0",
    LLM_BREAKER_THRESHOLD: "2",
    LLM_BREAKER_COOLDOWN_MS: "600000",
  };
  await mitZuegen(env, 5, async ({ zug }) => {
    for (let i = 0; i < 4; i++) await zug(i);
    assert.equal(anfragen.length, 4, "Erfolg dazwischen: die Sicherung blieb zu");
    await zug(4);
    assert.equal(anfragen.length, 4, "zwei Fehler in Folge oeffnen sie");
  });
  neuerLauf([]);
  await mitZuegen({ ...env, LLM_BREAKER_WINDOW_MS: "1" }, 4, async ({ zug }) => {
    for (let i = 0; i < 4; i++) await zug(i);
    assert.equal(anfragen.length, 4, "Fehler ausserhalb des Fensters oeffnen die Sicherung nicht");
  });
});

test("R7-6: nach der Abkuehlzeit prueft die Sicherung wieder; ein Erfolg schliesst sie", async () => {
  neuerLauf([fehler(HTTP_UNAVAILABLE), fehler(HTTP_UNAVAILABLE), ok(), fehler(HTTP_UNAVAILABLE)]);
  const env = { LLM_MAX_RETRIES: "0", LLM_BREAKER_THRESHOLD: "2", LLM_BREAKER_COOLDOWN_MS: "1" };
  await mitZuegen(env, 4, async ({ zug }) => {
    await zug(0);
    await zug(1);
    const wieder = await zug(2);
    assert.ok(wieder.includes(ANTWORT_TEXT), wieder);
    await zug(3);
    assert.equal(anfragen.length, 4, "geschlossen: der naechste Fehler erreicht den Anbieter");
  });
});

test("R7-7: Abrechnungsfehler des Anbieters loesen den Guthaben-Alarm aus, andere Fehler nicht", async () => {
  const faelle = [
    [fehler(HTTP_PAYMENT_REQUIRED, "api_error"), true],
    [fehler(HTTP_BAD_REQUEST, "billing_error"), true],
    [fehler(HTTP_BAD_REQUEST, "invalid_request_error", "Your Credit Balance is too low"), true],
    [fehler(HTTP_BAD_REQUEST, "invalid_request_error", "anderer Fehler"), false],
  ];
  for (const [antwort, alarm] of faelle) {
    neuerLauf([antwort]);
    await mitZuegen({ LLM_MAX_RETRIES: "0" }, 1, async ({ zug, srv }) => {
      const xml = await zug(0);
      assert.ok(xml.includes(de.turnErrorSpeech), xml);
      if (alarm) await waitForLog(srv, /ALARM_LLM_BILLING/);
      else assert.doesNotMatch(srv.stdout, /ALARM_LLM_BILLING/, JSON.stringify(antwort.body));
    });
  }
});

const nutzeSuche = (query) => ({
  status: HTTP_OK,
  body: {
    ...nachricht([{ type: "tool_use", id: "tu_suche", name: "look_up", input: { query } }]),
    stop_reason: "tool_use",
  },
});
const lookupEnv = {
  LLM_MAX_RETRIES: "0",
  LOOKUP_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  EXA_API_BASE: exa.url,
  EXA_API_KEY: EXA_SCHLUESSEL_BEISPIEL,
};
const werkzeugErgebnis = (i) => {
  const letzte = anfragen[i].messages.at(-1);
  return letzte.content[0].content;
};
const tc = {
  lookUpResult: "Der HINTERGRUND ist um die gefundenen Fakten ergänzt.",
  lookUpDeclined: "Nachschlagen jetzt nicht möglich.",
};

test("R7-8: Zwischensuche im Gespraech - Exa bekommt die bereinigte Frage, das Modell das Ergebnis, nach zwei Suchen entfaellt das Werkzeug", async () => {
  exaAnfragen.length = 0;
  neuerLauf([
    nutzeSuche("Oeffnungszeiten   Baeckerei"),
    ok(),
    nutzeSuche("Preis Brot"),
    ok(),
    ok(),
  ]);
  await mitZuegen(lookupEnv, 1, async ({ zug }) => {
    await zug(0);
    assert.ok(anfragen[0].tools.some((t) => t.name === "look_up"));
    assert.equal(exaAnfragen.length, 1);
    assert.equal(exaAnfragen[0].headers["x-api-key"], EXA_SCHLUESSEL_BEISPIEL);
    assert.deepEqual(exaAnfragen[0].body, {
      query: "Oeffnungszeiten Baeckerei",
      type: "auto",
      numResults: 3,
      contents: { highlights: true },
    });
    assert.ok(werkzeugErgebnis(1).startsWith(tc.lookUpResult), werkzeugErgebnis(1));
    await zug(0);
    assert.equal(exaAnfragen.length, 2);
    await zug(0);
    assert.equal(
      anfragen.at(-1).tools.some((t) => t.name === "look_up"),
      false,
      "Kontingent von zwei Suchen je Anruf ausgeschoepft",
    );
  });
});

test("R7-9: Frage mit fuenfstelliger Ziffernfolge wird nicht gesucht, das Modell bekommt die Absage", async () => {
  exaAnfragen.length = 0;
  neuerLauf([nutzeSuche("Kundennummer 12345 pruefen"), ok()]);
  await mitZuegen(lookupEnv, 1, async ({ zug }) => {
    await zug(0);
    assert.equal(exaAnfragen.length, 0);
    assert.ok(werkzeugErgebnis(1).startsWith(tc.lookUpDeclined), werkzeugErgebnis(1));
  });
});
