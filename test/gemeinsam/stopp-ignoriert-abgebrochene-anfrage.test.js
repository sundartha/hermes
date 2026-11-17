import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { startServer, waitForLog } from "../helpers.js";
import { ANTWORTFRIST_MS, abrufMitFrist, fristSignal, mitAntwortfrist } from "./antwortfrist.mjs";

const STOPP_FRIST_MS = 2000;
const TEILFRIST_MS = 10000;

function abbrechbareAnfrage(srv) {
  const anfrage = mitAntwortfrist(
    http.request(`${srv.localUrl}/voice/turn?callId=call_haengend`, {
      method: "POST",
      agent: false,
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "18" },
    }),
  );
  const ausgang = new Promise((fertig) => {
    anfrage.on("response", () => fertig("beantwortet"));
    anfrage.on("error", () => fertig("abgebrochen"));
  });
  anfrage.write("Speec");
  return { ausgang, abbrechen: () => anfrage.destroy() };
}

test("B3: eine vom Client abgebrochene Anfrage haelt den Stopp nicht bis zur Teilfrist auf", async (t) => {
  const srv = await startServer({ env: { SHUTDOWN_DRAIN_TIMEOUT_MS: String(TEILFRIST_MS) } });
  t.after(() => {
    if (srv.child.exitCode === null) srv.child.kill("SIGKILL");
  });

  const anfrage = abbrechbareAnfrage(srv);
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
