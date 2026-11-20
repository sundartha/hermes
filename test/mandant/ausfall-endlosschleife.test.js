import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const HELFER = new URL("../pg-helpers.js", import.meta.url).href;
const QUELLE = new URL("../../src/store.js", import.meta.url).href;
const KIND_FRIST_MS = 60000;
const KIND = `import { pgliteAlsRolleOhneSuperuser, makePgStoreMitSperre } from ${JSON.stringify(HELFER)};
import { speicherBereiche } from ${JSON.stringify(QUELLE)};
const db = await pgliteAlsRolleOhneSuperuser();
const speicher = makePgStoreMitSperre({ withClient: (fn) => fn(db) });
await speicher.init();
const { ausfall } = speicherBereiche(speicher);
const code = "not-placed:endlosschleife";
const nowMs = Date.parse("2026-09-01T10:00:00.000Z");
await ausfall.notizClaimen({ code, nowMs });
const marker = await ausfall.offenerMarker({ code });
process.stdout.write(JSON.stringify({ code: marker.code, geschlossen: marker.closedAt }));
process.exit(0);`;

test("ausfall-endlosschleife: das Anlegen eines Markers endet in der Frist und liefert die offene Zeile", () => {
  const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", KIND], {
    encoding: "utf8",
    timeout: KIND_FRIST_MS,
    killSignal: "SIGKILL",
  });

  assert.equal(lauf.error, undefined, "das Anlegen endet nicht von selbst");
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual(JSON.parse(lauf.stdout), {
    code: "not-placed:endlosschleife",
    geschlossen: null,
  });
});
