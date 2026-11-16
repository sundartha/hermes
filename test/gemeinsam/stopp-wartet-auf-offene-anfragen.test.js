import assert from "node:assert/strict";
import test from "node:test";
import { startServer, waitForLog } from "../helpers.js";
import { ANTWORTFRIST_MS, abrufMitFrist, fristSignal } from "./antwortfrist.mjs";
import { haengendeAnfrage } from "./haengende-anfrage.mjs";

const STOPP_FRIST_MS = 2000;
const LOG_SIGNAL = /\[shutdown\] Signal SIGTERM/;
const LOG_TEILFRIST_START = "[shutdown] Teilfrist abgelaufen";
const LOG_TEILFRIST = `${LOG_TEILFRIST_START} - 1 offene Anfragen abgebrochen`;

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
    await modell?.close();
  });
}

test("B2: ohne offene Anfrage endet der Prozess sofort mit Exit 0", async (t) => {
  const srv = await startServer();
  raeumeAuf(t, srv, null);

  const stopp = sendeSigterm(srv);
  const exitCode = await stopp.prozessEnde;

  assert.equal(exitCode, 0);
  assert.ok(stopp.dauerMs() <= STOPP_FRIST_MS, `Stopp dauerte ${stopp.dauerMs()} ms`);
  assert.ok(!srv.stdout.includes(LOG_TEILFRIST_START), srv.stdout);
});

test("B4: endet die erste von zwei offenen Anfragen, wartet der Stopp weiter auf die zweite", async (t) => {
  const srv = await startServer({ env: { SHUTDOWN_DRAIN_TIMEOUT_MS: String(STOPP_FRIST_MS) } });
  raeumeAuf(t, srv, null);

  const erste = haengendeAnfrage(srv);
  const zweite = haengendeAnfrage(srv);
  await abrufMitFrist(`${srv.localUrl}/healthz`);
  const stopp = sendeSigterm(srv);
  await waitForLog(srv, LOG_SIGNAL);
  erste.vervollstaendige();
  await erste.ausgang;
  const exitCode = await stopp.prozessEnde;

  assert.ok(srv.stdout.includes(LOG_TEILFRIST), `${LOG_TEILFRIST} fehlt:\n${srv.stdout}`);
  assert.equal(exitCode, 0);
  assert.equal(await zweite.ausgang, "abgebrochen", "die zweite Anfrage wurde nach der Teilfrist abgebrochen");
});
