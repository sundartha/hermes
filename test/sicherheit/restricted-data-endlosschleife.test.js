import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { RESTRICTED_TOKEN_ZWISCHEN } from "../gemeinsam/erfundene-geheimnisse.js";

const QUELLE = new URL("../../src/restricted-data.js", import.meta.url).href;
const KIND_FRIST_MS = 5000;
const KARTE = "4111 1111 1111 1111";
const KIND = `import { findRestrictedData } from ${JSON.stringify(QUELLE)};
const text = process.argv[1];
process.stdout.write(JSON.stringify(findRestrictedData(text).map((hit) => [hit.category, text.slice(hit.start, hit.end)])));`;

const FAELLE = [
  [
    "Token am genauen Textende",
    RESTRICTED_TOKEN_ZWISCHEN,
    [["credential_secret", RESTRICTED_TOKEN_ZWISCHEN]],
  ],
  [
    "Token vor weiterem Text",
    `${RESTRICTED_TOKEN_ZWISCHEN} danach`,
    [["credential_secret", RESTRICTED_TOKEN_ZWISCHEN]],
  ],
  [
    "akzeptierte Karte endet vor dem Token",
    `${KARTE} ${RESTRICTED_TOKEN_ZWISCHEN}`,
    [
      ["payment_card", KARTE],
      ["credential_secret", RESTRICTED_TOKEN_ZWISCHEN],
    ],
  ],
];

for (const [name, text, erwartet] of FAELLE) {
  test(`restricted-data-endlosschleife: ${name} endet in der Frist`, () => {
    const lauf = spawnSync(process.execPath, ["--input-type=module", "-e", KIND, text], {
      encoding: "utf8",
      timeout: KIND_FRIST_MS,
      killSignal: "SIGKILL",
    });
    assert.equal(lauf.error, undefined, "die Erkennung endet nicht von selbst");
    assert.equal(lauf.status, 0, lauf.stderr);
    assert.deepEqual(JSON.parse(lauf.stdout), erwartet);
  });
}
