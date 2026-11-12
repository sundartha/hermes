import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";
import { TELNYX_TEST_OWNER_NUMBER, seedState, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_ERROR = 500;
const AGENT_ID = "agent_r5_test";
const PHONE_ID = "phnum_r5_test";
const FR_ZIEL = "+33612345678";
const CONVERSATION_ID = "conv_r5_test";

async function startElevenLabsAttrappe() {
  const starts = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (req.url.startsWith("/v1/convai/sip-trunk/outbound-call")) {
        starts.push(JSON.parse(raw || "{}"));
        return res.end(JSON.stringify({ success: true, conversation_id: CONVERSATION_ID }));
      }
      return res.end(JSON.stringify({ status: "processing" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    starts,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const EL_ENV = {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: AGENT_ID,
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: PHONE_ID,
  ELEVENLABS_API_KEY: "el-r5-geheim",
  ELEVENLABS_RESULT_POLL_MS: "150",
  ELEVENLABS_OPENING_LINE_LLM_ENABLED: "false",
  FAKE_ORIGINATE: "false",
};

async function mitElevenLabs({ sprache = "de", env = {} }, lauf) {
  const el = await startElevenLabsAttrappe();
  const srv = await startServer({
    env: { ...EL_ENV, ELEVENLABS_API_BASE: el.url, ...env },
    seed: seedState({
      settings: { language: sprache },
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active" }],
      profiles: { [BOOTSTRAP_TENANT_ID]: { maxCallsPerHour: null } },
    }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    return await lauf({ srv, el });
  } finally {
    await srv.stop();
    await el.close();
  }
}

let zielZaehler = 0;
const naechstesZiel = () => `+49151123${String(40000 + zielZaehler++)}`;

async function rufe(srv, koerper) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: naechstesZiel(), ...koerper }),
  });
  return { status: res.status, body: await res.json() };
}

async function einAnruf(optionen, koerper) {
  return mitElevenLabs(optionen, async ({ srv, el }) => {
    const antwort = await rufe(srv, koerper);
    assert.equal(antwort.status, HTTP_OK, JSON.stringify(antwort.body));
    return { start: el.starts[0], call: srv.readStore().calls.at(-1) };
  });
}

const kopfVon = (start) => start.conversation_initiation_client_data;
const variablenVon = (start) => kopfVon(start).dynamic_variables;
const ueberVon = (start) => kopfVon(start).conversation_config_override;
const letzterAnruf = (srv) => srv.readStore().calls.at(-1);

const eroeffnungsKoerper = (el, n = 0) => el.starts[n].conversation_initiation_client_data;
const variablen = (el, n = 0) => eroeffnungsKoerper(el, n).dynamic_variables;
const ueberschreibung = (el, n = 0) => eroeffnungsKoerper(el, n).conversation_config_override;

const DE_PFLICHT = "ich bin Hermes, der KI-Assistent von Jonas Beispiel, und ich fasse das Gespräch für Jonas zusammen.";
const FR_PFLICHT =
  "Bonjour, ceci est un assistant IA mandaté par Jonas Beispiel. Cette conversation sera résumée pour mon mandant.";
const DE_RUECKFALL = "Ich rufe an, um ein kurzes Anliegen zu klären.";

test("3395-R5: Fremdziel gleicher Sprache - Eroeffnung, Offenlegung und Anrufbeantworter-Text exakt, keine first_message", async () => {
  await mitElevenLabs({}, async ({ srv, el }) => {
    const antwort = await rufe(srv, { objective: "Termin zur Bremsenprüfung vereinbaren" });
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(el.starts.length, 1);
    assert.equal(el.starts[0].agent_id, AGENT_ID);
    assert.match(el.starts[0].to_number, /^\+49151123\d{5}$/);
    const v = variablen(el);
    assert.equal(v.opening_line, "es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren.");
    assert.equal(
      v.eroeffnung,
      `Hallo, es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren – ${DE_PFLICHT}`,
    );
    assert.equal(
      v.voicemail_line,
      "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst. " +
        "Ich hinterlasse diese Nachricht, weil niemand abgehoben hat. Es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren. " +
        "Wie sieht es damit aus? Ich versuche es später noch einmal. Auf Wiederhören.",
    );
    assert.equal(v.callee_relation, "");
    assert.deepEqual(ueberschreibung(el).agent, { language: "de" });
    assert.equal(ueberschreibung(el).tts.voice_id, "cqPdIo76zSHFDcSZpFov");
  });
});

test("3395-R5: franzoesisches Ziel bei deutschem Mandanten - Pflichtsatz franzoesisch vorn, Gespraech deutsch", async () => {
  await mitElevenLabs({}, async ({ srv, el }) => {
    await rufe(srv, { to: FR_ZIEL, objective: "Ist der Tisch frei?" });
    const gesprochen = `${FR_PFLICHT} ${DE_RUECKFALL}`;
    assert.equal(ueberschreibung(el).agent.language, "de");
    assert.equal(ueberschreibung(el).agent.first_message, gesprochen);
    assert.equal(variablen(el).eroeffnung, gesprochen);
    assert.equal(variablen(el).opening_line, "ich rufe an, um ein kurzes Anliegen zu klären.");
    assert.match(variablen(el).callee_timezone, /Europe\/Paris/);
    assert.equal(
      variablen(el).voicemail_line,
      `${FR_PFLICHT} Je laisse ce message parce que personne n'a décroché. ${DE_RUECKFALL} Wie sieht es damit aus? Je réessaierai plus tard. Au revoir.`,
    );
  });
});

test("3395-R5: Sprachwunsch und Mandantensprache bestimmen Gespraechssprache und Stimme getrennt vom Ziel", async () => {
  const mandant = await einAnruf({ sprache: "fr" }, { objective: "Réserver une table" });
  const wunsch = await einAnruf({ sprache: "fr" }, { objective: "Book a table", language: "en" });
  assert.equal(ueberVon(mandant.start).agent.language, "fr");
  assert.equal(ueberVon(wunsch.start).agent.language, "en");
  const { first_message: eroeffnung } = ueberVon(mandant.start).agent;
  assert.ok(eroeffnung.startsWith("Guten Tag"));
  assert.notEqual(ueberVon(mandant.start).tts.voice_id, ueberVon(wunsch.start).tts.voice_id);
  assert.equal(variablenVon(mandant.start).opening_line, "voici l'objet de mon appel : Réserver une table.");
  assert.equal(variablenVon(wunsch.start).opening_line, "here's what I'm calling about: Book a table.");
  assert.equal(mandant.call.language, "fr");
  assert.equal(wunsch.call.language, "en");
});

const BRUECKE = "Es geht um Folgendes: ";
const AUFTRAEGE = [
  ["Auftrag mit Frage am Ende", "Wann haben Sie Zeit?", DE_RUECKFALL],
  ["Ich-Satz ohne Bruecke", "Ich möchte einen Haarschnitt buchen", "Ich möchte einen Haarschnitt buchen."],
  ["Satzende und Leerraum werden normalisiert", "  Tisch   reservieren!! ", `${BRUECKE}Tisch reservieren.`],
  ["Klammern im Auftrag", "Tisch [laut] reservieren", DE_RUECKFALL],
  ["Preisangabe im Auftrag", "Tisch für 49 Euro reservieren", DE_RUECKFALL],
  ["Zeilenumbruch im Auftrag", "Tisch\nreservieren", `${BRUECKE}Tisch reservieren.`],
  ["Auftrag nur aus Satzzeichen", "...", DE_RUECKFALL],
  ["genau 120 Zeichen", "a".repeat(120 - BRUECKE.length - 1), `${BRUECKE}${"a".repeat(120 - BRUECKE.length - 1)}.`],
  ["121 Zeichen", "a".repeat(120 - BRUECKE.length), DE_RUECKFALL],
  ["Offenlegungsfloskel im Auftrag", "Hier spricht ein KI-Assistent im Auftrag von Jonas", DE_RUECKFALL],
];

test("3395-R5: Eroeffnungszeile aus dem Auftrag - Tabelle der Grenz- und Rueckfallfaelle", async () => {
  for (const [name, objective, erwartet] of AUFTRAEGE) {
    const { start } = await einAnruf({}, { objective });
    assert.equal(variablenVon(start).opening_line, erwartet.charAt(0).toLowerCase() + erwartet.slice(1), name);
  }
});

function starteAnthropic(zeile) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      anfragen.push(JSON.parse(raw));
      const reason = zeile();
      if (reason === null) {
        res.writeHead(HTTP_ERROR, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }));
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_r5",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "tool_use", id: "tu_r5", name: "eroeffnungszeile", input: { reason } }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 60, output_tokens: 25 },
        }),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        anfragen,
        close: () => new Promise((fertig) => server.close(fertig)),
      }),
    ),
  );
}

test("3395-R5: erzeugte Eroeffnungszeile - gueltige Ich-Form gewinnt, unpassende faellt auf den Rueckfall, LLM-Fehler auf den Auftrag, Schalter aus fragt nicht", async () => {
  let zeile = "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.";
  const llm = await starteAnthropic(() => zeile);
  const env = { ELEVENLABS_OPENING_LINE_LLM_ENABLED: "true", ANTHROPIC_BASE_URL: llm.url };
  const zeileVon = async (optionen) =>
    variablenVon((await einAnruf(optionen, { objective: "Zahnreinigung" })).start).opening_line;
  try {
    assert.equal(await zeileVon({ env }), "ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.");
    assert.equal(llm.anfragen.length, 1);
    const [erste] = llm.anfragen;
    assert.ok(!JSON.stringify(erste.system).includes("Zahnreinigung"));
    assert.ok(JSON.stringify(erste.messages).includes("AUFTRAG: Zahnreinigung"));
    zeile = "Wir rufen an, um einen Termin zu vereinbaren.";
    assert.equal(await zeileVon({ env }), "ich rufe an, um ein kurzes Anliegen zu klären.");
    zeile = "Ich rufe an, um einen Termin zu vereinbaren. Danke!";
    assert.equal(await zeileVon({ env }), "ich rufe an, um ein kurzes Anliegen zu klären.");
    zeile = null;
    assert.equal(await zeileVon({ env }), "es geht um Folgendes: Zahnreinigung.");
    assert.equal(llm.anfragen.length, 4);
    assert.equal(await zeileVon({ env: { ...env, ELEVENLABS_OPENING_LINE_LLM_ENABLED: "false" } }), "es geht um Folgendes: Zahnreinigung.");
    assert.equal(llm.anfragen.length, 4);
  } finally {
    await llm.close();
  }
});

test("3395-R5: Outbound-Weg - ElevenLabs aus bucht Budget-Profil ohne ElevenLabs-Start, ein aus bucht SIP-Profil", async () => {
  await mitElevenLabs({ env: { ELEVENLABS_OUTBOUND_ENABLED: "false", FAKE_ORIGINATE: "true" } }, async ({ srv, el }) => {
    await rufe(srv, { objective: "Termin" });
    assert.equal(el.starts.length, 0);
    assert.equal(letzterAnruf(srv).costProfile, "telnyx_budget");
  });
  await mitElevenLabs({}, async ({ srv }) => {
    await rufe(srv, { objective: "Termin" });
    assert.equal(letzterAnruf(srv).costProfile, "el_convai_sip");
  });
  await mitElevenLabs({ env: { ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true" } }, async ({ srv, el }) => {
    await rufe(srv, { objective: "Termin" });
    assert.equal(el.starts.length, 1);
    assert.equal(letzterAnruf(srv).costProfile, "el_convai_sip");
  });
});
