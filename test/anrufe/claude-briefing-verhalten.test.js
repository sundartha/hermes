import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog, waitUntil } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { runOutbound } from "../_outbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const WARTEZEIT_MS = 5000;
const ZIEL = "+4915112345678";

let skript = [];
let anfragen = [];

const nachricht = (content, stop = "end_turn") => ({
  id: "msg_7b",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 11, output_tokens: 7 },
});
const text = (t) => ({ status: HTTP_OK, body: nachricht([{ type: "text", text: t }]) });
const hintergrund = (input) => ({
  status: HTTP_OK,
  body: nachricht([{ type: "tool_use", id: "tu_h", name: "hintergrund", input }], "tool_use"),
});
const ausfall = () => ({
  status: HTTP_UNAVAILABLE,
  body: { type: "error", error: { type: "api_error", message: "voruebergehend" } },
});

const attrappe = await starteAttrappe((req, res) => {
  let raw = "";
  req.on("data", (teil) => (raw += teil));
  req.on("end", () => {
    anfragen.push(JSON.parse(raw));
    const antwort = skript.shift() ?? ausfall();
    res.writeHead(antwort.status, { "content-type": "application/json" });
    res.end(JSON.stringify(antwort.body));
  });
});
after(() => attrappe.close());

function neuerLauf(antworten) {
  skript = [...antworten];
  anfragen = [];
}

const BRIEFING_ENV = {
  FAKE_ORIGINATE: "true",
  ALLOWED_COUNTRY_CODES: "*",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  PRECALL_BRIEFING_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  LLM_MAX_RETRIES: "2",
  LLM_BACKOFF_MS: "1",
};

async function mitServer({ env = {}, settings = {}, calls = [] }, ablauf) {
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: attrappe.url, ...env },
    seed: seedState({
      settings,
      calls,
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Jonas Beispiel" }],
    }),
  });
  try {
    await ablauf(srv);
  } finally {
    await srv.stop();
  }
}

const anruf = (srv, koerper) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Tisch reservieren", ...koerper }),
  });

const gespeicherterAnruf = (srv) => srv.readStore().calls.at(-1);

test("R7b-1: Anruf-Vorspann - eine Anfrage mit Deckel, erzwungenem Werkzeug und Auftrag; Hintergrund landet am Anruf", async () => {
  neuerLauf([
    hintergrund({
      summary: "Tischreservierung.",
      recipient_relationship: "Stammlokal",
      key_facts: ["Name Mueller"],
      mandate: { decide_freely: "Uhrzeit ab 19 Uhr", fallback_order: "erst 19, dann 20 Uhr" },
    }),
  ]);
  await mitServer({ env: BRIEFING_ENV }, async (srv) => {
    const res = await anruf(srv, { briefing: "zu zweit", constraints: "nicht rauchen" });
    assert.equal(res.status, HTTP_OK);
    assert.equal(anfragen.length, 1);
    const [a] = anfragen;
    assert.equal(a.model, "claude-sonnet-5");
    assert.equal(a.max_tokens, 700);
    assert.deepEqual(a.tool_choice, { type: "tool", name: "hintergrund" });
    assert.equal(a.tools.length, 1);
    assert.deepEqual(a.tools[0].input_schema.required, ["summary"]);
    assert.deepEqual(a.tools[0].input_schema.properties.mandate.properties.on_out_of_scope.enum, [
      "take_message",
      "decline",
    ]);
    assert.equal(
      a.messages[0].content,
      `AUFTRAG DES NUTZERS: Tisch reservieren\nZUSATZANGABEN DES NUTZERS: zu zweit\nANGERUFENER: ${ZIEL}\nHARTE GRENZEN DES NUTZERS: nicht rauchen`,
    );
    assert.match(a.system, /Der Assistent hat NUR diese Werkzeuge: end_call, take_message\./);
    assert.doesNotMatch(a.system, /im Internet suchen/);
    const gespeichert = gespeicherterAnruf(srv);
    assert.equal(gespeichert.context.summary, "Tischreservierung.");
    assert.equal(gespeichert.context.recipient_relationship, "Stammlokal");
    assert.deepEqual(gespeichert.context.key_facts, ["Name Mueller"]);
    assert.equal(gespeichert.mandate.decide_freely, "Uhrzeit ab 19 Uhr");
    assert.equal(gespeichert.mandate.fallback_order, "erst 19, dann 20 Uhr");
  });
});

test("R7b-2: ohne Zusatzangaben und Grenzen fehlen die Zeilen; ohne Angabe steht die Zusatzzeile leer", async () => {
  neuerLauf([hintergrund({ summary: "Kurz." })]);
  await mitServer({ env: BRIEFING_ENV }, async (srv) => {
    await anruf(srv, {});
    assert.equal(
      anfragen[0].messages[0].content,
      `AUFTRAG DES NUTZERS: Tisch reservieren\nZUSATZANGABEN DES NUTZERS: \nANGERUFENER: ${ZIEL}`,
    );
  });
});

test("R7b-3: ein selbst zugesprochenes accept_best wird verworfen; ohne weiteren Spielraum bleibt kein Mandat", async () => {
  neuerLauf([
    hintergrund({ summary: "A.", mandate: { decide_freely: "bis 50 Euro", on_out_of_scope: "accept_best" } }),
  ]);
  await mitServer({ env: BRIEFING_ENV }, async (srv) => {
    await anruf(srv, {});
    const m = gespeicherterAnruf(srv).mandate;
    assert.equal(m.decide_freely, "bis 50 Euro");
    assert.equal(m.on_out_of_scope, undefined);
  });
  neuerLauf([hintergrund({ summary: "B.", mandate: { on_out_of_scope: "accept_best" } })]);
  await mitServer({ env: BRIEFING_ENV }, async (srv) => {
    await anruf(srv, {});
    assert.equal(gespeicherterAnruf(srv).mandate ?? null, null);
  });
  neuerLauf([hintergrund({ summary: "C.", mandate: { decide_freely: "x", on_out_of_scope: "decline" } })]);
  await mitServer({ env: BRIEFING_ENV }, async (srv) => {
    await anruf(srv, {});
    assert.equal(gespeicherterAnruf(srv).mandate.on_out_of_scope, "decline");
  });
});

test("R7b-4: ungueltige oder fehlende Hintergrund-Antwort - der Anruf geht ohne Hintergrund raus", async () => {
  const faelle = [
    text("nur Text"),
    hintergrund({}),
    hintergrund({ summary: "S.", mandate: { on_out_of_scope: "unbekannt" } }),
    hintergrund([1, 2]),
  ];
  for (const antwort of faelle) {
    neuerLauf([antwort]);
    await mitServer({ env: BRIEFING_ENV }, async (srv) => {
      const res = await anruf(srv, {});
      assert.equal(res.status, HTTP_OK);
      assert.equal(anfragen.length, 1);
      assert.equal(gespeicherterAnruf(srv).context ?? null, null, JSON.stringify(antwort.body));
    });
  }
});

test("R7b-5: Anbieterausfall - genau ein Versuch, der Anruf geht raus, die Ueberspringen-Meldung nennt den Grund", async () => {
  neuerLauf([]);
  await mitServer({ env: BRIEFING_ENV }, async (srv) => {
    const res = await anruf(srv, {});
    assert.equal(res.status, HTTP_OK);
    assert.equal(anfragen.length, 1);
    await waitForLog(srv, /\[precall-briefing\] uebersprungen: \S/);
    assert.doesNotMatch(srv.stdout, /\[precall-briefing\] uebersprungen: (undefined|Error)/);
    assert.equal(gespeicherterAnruf(srv).context ?? null, null);
  });
});

test("R7b-6: Vorspann nur bei beiden Schaltern - sonst keine Anfrage", async () => {
  for (const env of [
    { PRECALL_BRIEFING_ENABLED: "false" },
    { ASSISTANT_CONTEXT_ENABLED: "false" },
  ]) {
    neuerLauf([hintergrund({ summary: "X." })]);
    await mitServer({ env: { ...BRIEFING_ENV, ...env } }, async (srv) => {
      const res = await anruf(srv, {});
      assert.equal(res.status, HTTP_OK);
      assert.equal(anfragen.length, 0, JSON.stringify(env));
    });
  }
});

const ENDE_ZUSTAND = (zusatz = {}) =>
  seedCall({
    id: "ende_7b",
    status: "completed",
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:05:00.000Z",
    goal: "Tisch reservieren",
    transcript: [
      { role: "agent", text: "Guten Tag", at: "2026-01-01T00:00:01.000Z" },
      { role: "caller", text: "Ja bitte", at: "2026-01-01T00:00:02.000Z" },
    ],
    ...zusatz,
  });

const meldeEnde = (srv) =>
  abrufMitFrist(`${srv.localUrl}/voice/status?callId=ende_7b`, {
    method: "POST",
    body: new URLSearchParams({ CallStatus: "completed" }),
  });
const anrufVon = (srv) => srv.readStore().calls.find((c) => c.id === "ende_7b");
const hinweise = (srv) => srv.readStore().notifications.filter((n) => n.title === "Neue Call Summary");

async function beendeUndWarte(srv) {
  await meldeEnde(srv);
  await waitUntil(() => anrufVon(srv).billedAt, { timeoutMs: WARTEZEIT_MS });
}

test("R7b-7: Anrufende - Zusammenfassung wird mit Auftrag und Transkript angefragt und samt Aktionspunkten gespeichert", async () => {
  neuerLauf([
    text(
      JSON.stringify({
        summary: "Tisch ist reserviert.",
        actionItems: ["Bestaetigung abwarten"],
        objective_achieved: "yes",
      }),
    ),
  ]);
  await mitServer({ env: { ANTHROPIC_BASE_URL: attrappe.url }, calls: [ENDE_ZUSTAND()] }, async (srv) => {
    await meldeEnde(srv);
    await waitUntil(() => hinweise(srv).length === 1, { timeoutMs: WARTEZEIT_MS });
    assert.equal(anfragen.length, 1);
    const [a] = anfragen;
    assert.equal(a.max_tokens, 800);
    assert.equal(a.model, "claude-haiku-4-5");
    assert.equal(
      a.messages[0].content,
      "Richtung: outbound\nAuftrag: Tisch reservieren\n\nTRANSKRIPT:\nAGENT: Guten Tag\nANRUFER: Ja bitte",
    );
    const call = anrufVon(srv);
    assert.equal(call.summary, "Tisch ist reserviert.");
    assert.equal(call.objectiveAchieved, "yes");
    assert.equal(hinweise(srv)[0].body, `Anruf bei +4915112345678: Tisch ist reserviert.`);
    const punkte = srv.readStore().actionItems.filter((i) => i.callId === "ende_7b");
    assert.deepEqual(punkte.map((i) => i.text), ["Bestaetigung abwarten"]);
  });
});

test("R7b-8: ohne Auftrag fehlt die Auftragszeile; ohne Angabe der Modellantwort gilt 'unclear' und es gibt keine Aktionspunkte", async () => {
  neuerLauf([text(JSON.stringify({ summary: "Gespraech gefuehrt." }))]);
  await mitServer({ env: { ANTHROPIC_BASE_URL: attrappe.url }, calls: [ENDE_ZUSTAND({ goal: "" })] }, async (srv) => {
    await meldeEnde(srv);
    await waitUntil(() => hinweise(srv).length === 1, { timeoutMs: WARTEZEIT_MS });
    assert.ok(anfragen[0].messages[0].content.startsWith("Richtung: outbound\n\nTRANSKRIPT:\n"));
    assert.equal(anrufVon(srv).objectiveAchieved, "unclear");
    assert.equal(srv.readStore().actionItems.length, 0);
  });
});

test("R7b-9: keine JSON-Antwort - der Text des Modells wird zur Zusammenfassung", async () => {
  neuerLauf([text("Der Tisch ist reserviert.")]);
  await mitServer({ env: { ANTHROPIC_BASE_URL: attrappe.url }, calls: [ENDE_ZUSTAND()] }, async (srv) => {
    await meldeEnde(srv);
    await waitUntil(() => hinweise(srv).length === 1, { timeoutMs: WARTEZEIT_MS });
    assert.equal(anrufVon(srv).summary, "Der Tisch ist reserviert.");
    assert.equal(anrufVon(srv).objectiveAchieved, "unclear");
    assert.equal(hinweise(srv)[0].body, "Anruf bei +4915112345678: Der Tisch ist reserviert.");
  });
});

test("R7b-10: Zusammenfassungen ausgeschaltet - keine Anfrage und kein Hinweis; ein Fehlversuch wird einmal wiederholt", async () => {
  neuerLauf([text(JSON.stringify({ summary: "x" }))]);
  await mitServer(
    { env: { ANTHROPIC_BASE_URL: attrappe.url }, settings: { allowSummaries: false }, calls: [ENDE_ZUSTAND()] },
    async (srv) => {
      await beendeUndWarte(srv);
      assert.equal(anfragen.length, 0);
      assert.equal(hinweise(srv).length, 0);
    },
  );
  neuerLauf([ausfall(), text(JSON.stringify({ summary: "Nach Wiederholung." }))]);
  await mitServer({ env: { ANTHROPIC_BASE_URL: attrappe.url, LLM_BACKOFF_MS: "1" }, calls: [ENDE_ZUSTAND()] }, async (srv) => {
    await meldeEnde(srv);
    await waitUntil(() => hinweise(srv).length === 1, { timeoutMs: WARTEZEIT_MS });
    assert.equal(anfragen.length, 2);
    assert.equal(anrufVon(srv).summary, "Nach Wiederholung.");
  });
});

test("R7b-11: Eroeffnung - ein Ziel als Frage wird nicht vorgelesen, ein Aussagesatz mit Leerraeumen und Punkt schon", async () => {
  const frage = await runOutbound({ call: { goal: "Haben Sie morgen geöffnet?" } });
  assert.match(frage.body, /Hallo, ich rufe an, um ein kurzes Anliegen zu klären – ich bin Hermes/);
  assert.doesNotMatch(frage.body, /Haben Sie morgen/);
  const satz = await runOutbound({ call: { goal: "Termin  verschieben." } });
  assert.match(satz.body, /Hallo, es geht um Folgendes: Termin verschieben – ich bin Hermes/);
});
