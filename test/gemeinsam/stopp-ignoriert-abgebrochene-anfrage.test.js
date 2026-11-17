import assert from "node:assert/strict";
import test from "node:test";
import { startServer, waitForLog } from "../helpers.js";
import { ANTWORTFRIST_MS, abrufMitFrist, fristSignal } from "./antwortfrist.mjs";
import { haengendeAnfrage } from "./haengende-anfrage.mjs";

const STOPP_FRIST_MS = 2000;
const TEILFRIST_MS = 10000;

test("B3: eine vom Client abgebrochene Anfrage haelt den Stopp nicht bis zur Teilfrist auf", async (t) => {
  const srv = await startServer({ env: { SHUTDOWN_DRAIN_TIMEOUT_MS: String(TEILFRIST_MS) } });
  t.after(() => {
    if (srv.child.exitCode === null) srv.child.kill("SIGKILL");
  });

  const anfrage = haengendeAnfrage(srv);
  await abrufMitFrist(`${srv.localUrl}/healthz`);
  anfrage.abbrechen();
  assert.equal(await anfrage.ausgang, "abgebrochen");

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
  await waitForLog(srv, /\[shutdown\] Signal SIGTERM/);
  const exitCode = await prozessEnde;
  const dauerMs = Date.now() - gesendetUm;

  assert.equal(exitCode, 0);
  assert.ok(dauerMs <= STOPP_FRIST_MS, `Stopp dauerte ${dauerMs} ms`);
  assert.ok(!srv.stdout.includes("[shutdown] Teilfrist abgelaufen"), srv.stdout);
});
