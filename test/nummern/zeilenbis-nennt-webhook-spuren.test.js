import assert from "node:assert/strict";
import test from "node:test";

import { zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { laufendeAusgaben } from "../gemeinsam/instanz-ausgabe.js";
import { startServer } from "../helpers.js";

const KURZE_FRIST_MS = 50;
const NIE_ERREICHT = [async () => ({ nummern: 0, auftraege: 0 }), () => false, KURZE_FRIST_MS];
const ZUSTAND = /^Zustand per SQL nach \d+ ms nicht erreicht: \{"nummern":0,"auftraege":0\}\n/;
const SPUR_A = "stripe_webhook_activate tenant=t_spur_a profile=skip:no_plan provision=none";
const SPUR_B = "stripe_webhook_ignored action=activate tenant=t_spur_b unknown_plan";

async function fehlermeldung() {
  const fehler = await zeilenBis(...NIE_ERREICHT).then(
    () => null,
    (grund) => grund,
  );
  assert.ok(fehler, "zeilenBis muss nach der Frist fehlschlagen");
  return fehler.message;
}

test("Frist von zeilenBis abgelaufen: Meldung nennt die Webhook-Spuren der laufenden Server", async (t) => {
  const a = { text: `start\n${SPUR_A}\nanderes\n` };
  const b = { text: `start\n${SPUR_B}\n` };
  laufendeAusgaben.add(a);
  laufendeAusgaben.add(b);
  t.after(() => {
    laufendeAusgaben.delete(a);
    laufendeAusgaben.delete(b);
  });
  const beide = await fehlermeldung();
  assert.match(beide, ZUSTAND);
  assert.ok(beide.endsWith(`\n${SPUR_A}\n${SPUR_B}`), beide);
  assert.doesNotMatch(beide, /anderes/);
  laufendeAusgaben.delete(a);
  assert.ok((await fehlermeldung()).endsWith(`\n${SPUR_B}`));
  laufendeAusgaben.delete(b);
  assert.ok((await fehlermeldung()).endsWith("\n(keine)"));
});

test("startServer führt die Ausgabe des Prozesses, solange er läuft", async () => {
  const server = await startServer();
  const marke = `laeuft auf http://localhost:${server.port}`;
  const fuehrt = () => [...laufendeAusgaben].some((ausgabe) => ausgabe.text.includes(marke));
  assert.equal(fuehrt(), true);
  await server.stop();
  assert.equal(fuehrt(), false);
});
