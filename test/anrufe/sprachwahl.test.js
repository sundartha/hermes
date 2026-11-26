import assert from "node:assert/strict";
import { test } from "node:test";

import { TELNYX_TEST_OWNER_NUMBER, TELNYX_TEST_PEER_NUMBER, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

async function startsprachZeilen(language, status = HTTP_OK) {
  const srv = await startServer({
    env: { ELEVENLABS_OUTBOUND_ENABLED: "true", ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true", ELEVENLABS_OUTBOUND_VORSPANN: "true" },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: "Termin vereinbaren", language }),
    });
    assert.equal(res.status, status, await res.text());
    return srv.stdout.split("\n").filter((zeile) => zeile.includes("startsprache="));
  } finally {
    await srv.stop();
  }
}

test("POST /api/calls mit language pt loggt genau einmal startsprache=pt texte=en", async () => {
  const zeilen = await startsprachZeilen("pt");
  assert.equal(zeilen.length, 1, zeilen.join("\n"));
  assert.match(zeilen[0], /startsprache=pt texte=en$/);
});

test("POST /api/calls mit language fr loggt startsprache=fr texte=fr", async () => {
  const zeilen = await startsprachZeilen("fr");
  assert.equal(zeilen.length, 1, zeilen.join("\n"));
  assert.match(zeilen[0], /startsprache=fr texte=fr$/);
});

test("POST /api/calls mit language pt-BR loggt startsprache=pt-br texte=en", async () => {
  const zeilen = await startsprachZeilen("pt-BR");
  assert.equal(zeilen.length, 1, zeilen.join("\n"));
  assert.match(zeilen[0], /startsprache=pt-br texte=en$/);
});

test("POST /api/calls mit language de loggt startsprache=de texte=de", async () => {
  const zeilen = await startsprachZeilen("de");
  assert.match(zeilen.join("\n"), /startsprache=de texte=de$/);
});

for (const ungueltig of ["x", "deutsch"]) {
  test(`POST /api/calls mit language ${ungueltig} wird abgelehnt und loggt keine Startsprache`, async () => {
    const zeilen = await startsprachZeilen(ungueltig, HTTP_BAD_REQUEST);
    assert.equal(zeilen.length, 0);
  });
}
