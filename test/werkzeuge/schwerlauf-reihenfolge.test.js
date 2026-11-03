import assert from "node:assert/strict";
import { test } from "node:test";

import { FRIST, halter, stand, starteArbeit, umgebung, zeitenVon } from "./schwerlauf-lauf.js";

function erstesVon(laeufe) {
  return Promise.race(Object.entries(laeufe).map(([name, ereignis]) => ereignis.then(() => name)));
}

async function beenden(lauf) {
  lauf.kind.stdin.end();
  await lauf.ende;
}

test("wird der Platz frei, bekommen ihn gewöhnliche Wartende in der Reihenfolge ihres Wartebeginns", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const a = starteArbeit(context, "A", { env });
  await a.wartend;
  const b = starteArbeit(context, "B", { env });
  await b.wartend;

  const wartende = (await stand(env)).split("\n").filter((zeile) => zeile.startsWith("Wartet: "));
  gehalten.kind.kill("SIGKILL");
  assert.equal(await erstesVon({ a: a.begonnen, b: b.begonnen }), "a");
  await beenden(a);
  await b.begonnen;
  await beenden(b);

  assert.deepEqual([a, b].map(({ kind }) => kind.exitCode), [0, 0]);
  assert.ok(zeitenVon(a).ende <= zeitenVon(b).beginn, JSON.stringify([zeitenVon(a), zeitenVon(b)]));
  assert.equal(wartende.length, 2, wartende.join("\n"));
  assert.match(wartende[0], new RegExp(`^Wartet: PID ${a.kind.pid}, `));
  assert.match(wartende[1], new RegExp(`^Wartet: PID ${b.kind.pid}, `));
});
