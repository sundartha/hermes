import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { startServer, seedState, seedCall, waitForLog } from "../helpers.js";
import { starteAnbieterServer } from "./anbieter-attrappe.mjs";
import { ANTWORTFRIST_MS, abrufMitFrist, fristSignal, mitAntwortfrist } from "./antwortfrist.mjs";

const STATUS_OK = 200;
const STOPP_FRIST_MS = 2000;
const LANGE_GESAMTFRIST_MS = 10000;
const AGENT_SATZ = "Guten Tag, ich rufe im Auftrag von Jonas an.";
const LOG_SIGNAL = /\[shutdown\] Signal SIGTERM/;
const LOG_TEILFRIST = "[shutdown] Teilfrist abgelaufen - 1 offene Anfragen abgebrochen";
const LOG_FLUSH = "[shutdown] Finaler Store-Flush abgeschlossen";

const modellAntwort = JSON.stringify({
  id: "msg_attrappe",
  type: "message",
  role: "assistant",
  model: "claude-haiku-4-5",
  content: [{ type: "text", text: AGENT_SATZ }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 16 },
});

async function starteHaltendesModell() {
  const gehalten = [];
  let meldeAngekommen;
  const angekommen = new Promise((fertig) => (meldeAngekommen = fertig));
  const anbieter = await starteAnbieterServer(({ res }) => {
    gehalten.push(res);
    meldeAngekommen();
  });
  return {
    url: anbieter.url,
    angekommen,
    close: anbieter.close,
    antwortenJetzt() {
      for (const res of gehalten) {
        res.writeHead(STATUS_OK, { "content-type": "application/json" });
        res.end(modellAntwort);
      }
    },
  };
}

async function starteMitAktivemAnruf(anruf, modell, gesamtfristMs) {
  const env = { ANTHROPIC_BASE_URL: modell.url };
  if (gesamtfristMs) env.SHUTDOWN_DRAIN_TIMEOUT_MS = String(gesamtfristMs);
  return startServer({
    env,
    seed: seedState({
      calls: [
        seedCall({
          id: anruf,
          status: "active",
          direction: "outbound",
          answeredAt: new Date().toISOString(),
        }),
      ],
    }),
  });
}

function sprachzug(srv, anruf, signal) {
  return abrufMitFrist(`${srv.localUrl}/voice/turn?callId=${anruf}`, {
    method: "POST",
    body: new URLSearchParams({ SpeechResult: "Hallo, worum geht es?" }),
    signal,
  });
}

function sprachzugMitAbbruch(srv, anruf) {
  const anfrage = mitAntwortfrist(http.request(`${srv.localUrl}/voice/turn?callId=${anruf}`, {
    method: "POST",
    agent: false,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  }));
  anfrage.on("error", () => {});
  anfrage.end("SpeechResult=Hallo");
  return anfrage;
}

function sendeSigterm(srv) {
  const prozessEnde = new Promise((fertig, scheitert) => {
    srv.child.once("close", (code) => fertig(code));
    fristSignal().addEventListener(
      "abort",
      () => scheitert(new Error(`Prozess endete nicht innerhalb von ${ANTWORTFRIST_MS} ms`)),
      { once: true },
    );
  });
  const gesendetUm = Date.now();
  srv.child.kill("SIGTERM");
  return { prozessEnde, dauerMs: () => Date.now() - gesendetUm };
}

function raeumeAuf(t, srv, modell) {
  t.after(async () => {
    if (srv.child.exitCode === null) srv.child.kill("SIGKILL");
    await modell.close();
  });
}

test("S3: haengende Anfrage -> nach der Teilfrist abgebrochen, Flush, Exit 0", async (t) => {
  const modell = await starteHaltendesModell();
  const anruf = "call_stopp_teilfrist";
  const srv = await starteMitAktivemAnruf(anruf, modell, STOPP_FRIST_MS);
  raeumeAuf(t, srv, modell);

  const aufruf = sprachzug(srv, anruf).then(
    () => "beantwortet",
    () => "abgebrochen",
  );
  await modell.angekommen;
  const stopp = sendeSigterm(srv);
  const exitCode = await stopp.prozessEnde;
  const ausgabe = srv.stdout;

  const teilfristPosition = ausgabe.indexOf(LOG_TEILFRIST);
  assert.ok(teilfristPosition >= 0, `${LOG_TEILFRIST} fehlt in der Ausgabe:\n${ausgabe}`);
  const flushPosition = ausgabe.indexOf(LOG_FLUSH);
  assert.ok(flushPosition > teilfristPosition, `${LOG_FLUSH} muss nach der Teilfrist stehen:\n${ausgabe}`);
  assert.equal(exitCode, 0, "abgebrochene Anfragen allein machen kein Exit 1");
  assert.ok(stopp.dauerMs() <= STOPP_FRIST_MS, `Stopp dauerte ${stopp.dauerMs()} ms`);
  assert.equal(await aufruf, "abgebrochen", "der haengende Aufrufer sieht ein abgebrochenes Verbindungsende");
});

test("B1: Anfrage, die erst nach SIGTERM antwortet, wird fertig beantwortet und gespeichert", async (t) => {
  const modell = await starteHaltendesModell();
  const anruf = "call_stopp_wartet";
  const srv = await starteMitAktivemAnruf(anruf, modell);
  raeumeAuf(t, srv, modell);

  const aufruf = sprachzug(srv, anruf);
  await modell.angekommen;
  const stopp = sendeSigterm(srv);
  await waitForLog(srv, LOG_SIGNAL);
  modell.antwortenJetzt();

  const antwort = await aufruf;
  const text = await antwort.text();
  const exitCode = await stopp.prozessEnde;

  assert.equal(antwort.status, STATUS_OK);
  assert.ok(text.includes("</Response>"), `TwiML unvollstaendig: ${text}`);
  const gespeichert = srv.readStore().calls.find((eintrag) => eintrag.id === anruf);
  assert.ok(
    gespeichert.transcript.some((zeile) => zeile.role === "agent" && zeile.text === AGENT_SATZ),
    `Agent-Turn fehlt in der Speicherdatei: ${JSON.stringify(gespeichert.transcript)}`,
  );
  assert.equal(exitCode, 0);
});

test("B2: ohne offene Anfrage endet der Prozess sofort mit Exit 0", async (t) => {
  const modell = await starteHaltendesModell();
  const srv = await startServer({ env: { ANTHROPIC_BASE_URL: modell.url } });
  raeumeAuf(t, srv, modell);

  const stopp = sendeSigterm(srv);
  const exitCode = await stopp.prozessEnde;

  assert.equal(exitCode, 0);
  assert.ok(stopp.dauerMs() <= STOPP_FRIST_MS, `Stopp dauerte ${stopp.dauerMs()} ms`);
});

test("B3: vom Client abgebrochene Anfrage haelt den Stopp nicht auf", async (t) => {
  const modell = await starteHaltendesModell();
  const anruf = "call_stopp_abgebrochen";
  const srv = await starteMitAktivemAnruf(anruf, modell, LANGE_GESAMTFRIST_MS);
  raeumeAuf(t, srv, modell);

  const anfrage = sprachzugMitAbbruch(srv, anruf);
  await modell.angekommen;
  anfrage.destroy();
  const stopp = sendeSigterm(srv);
  await waitForLog(srv, LOG_SIGNAL);
  modell.antwortenJetzt();
  const exitCode = await stopp.prozessEnde;

  assert.equal(exitCode, 0);
  assert.ok(stopp.dauerMs() <= STOPP_FRIST_MS, `Stopp dauerte ${stopp.dauerMs()} ms:\n${srv.stdout}`);
  assert.ok(!srv.stdout.includes("[shutdown] Teilfrist abgelaufen"), srv.stdout);
});
