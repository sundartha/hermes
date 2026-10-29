import { test } from "node:test";
import assert from "node:assert/strict";

import { echtWarten } from "../echt-warten.js";
import { withFetch } from "../helpers.js";

process.env.TELNYX_API_BASE = "https://telnyx.test";
process.env.TELNYX_API_KEY = "KEYtest-lesefrist";

const { providerConfigRead } = await import("../../src/telephony/registry.js");

const ANI = "+15739090177";
const TELNYX_LESEFRIST_MS = 4000;
const KURZE_WARTEZEIT_MS = 20;
const HTTP_OK = 200;

async function mitKurzerFrist(run) {
  const original = AbortSignal.timeout;
  const fristen = [];
  AbortSignal.timeout = (ms) => {
    fristen.push(ms);
    const abbruch = new AbortController();
    echtWarten(KURZE_WARTEZEIT_MS).then(() =>
      abbruch.abort(new DOMException("Die Frist ist abgelaufen", "TimeoutError")),
    );
    return abbruch.signal;
  };
  try {
    await run();
  } finally {
    AbortSignal.timeout = original;
  }
  return fristen;
}

function antwortetNie(_url, init = {}) {
  if (!init.signal) return Promise.reject(new Error("Anfrage ohne Antwortfrist hängt endlos"));
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
}

test("Telnyx-Lesezugriff: antwortet Telnyx nicht, bricht findPhoneNumber nach der Lesefrist von 4 Sekunden ab", async () => {
  const fristen = await mitKurzerFrist(() =>
    withFetch(antwortetNie, () =>
      assert.rejects(providerConfigRead().findPhoneNumber(ANI), { name: "TimeoutError" }),
    ),
  );
  assert.deepEqual(fristen, [TELNYX_LESEFRIST_MS]);
});

test("Telnyx-Lesezugriff: antwortet Telnyx innerhalb der Frist, liefert findPhoneNumber die Treffer", async () => {
  const antwort = {
    ok: true,
    status: HTTP_OK,
    text: async () => JSON.stringify({ data: [{ phone_number: ANI, status: "active" }] }),
  };
  const ergebnis = await withFetch(async () => antwort, () => providerConfigRead().findPhoneNumber(ANI));
  assert.deepEqual(ergebnis, { treffer: [{ e164: ANI, status: "active" }] });
});
