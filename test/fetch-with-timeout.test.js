// P16 Review-Fix (PROV-01/F3): fetchWithTimeout kappt einen haengenden fetch() nach
// timeoutMs statt ihn nie settlen zu lassen. Rein offline: global.fetch gestubbt, ein
// Stub simuliert das reale AbortController-Verhalten (rejected bei signal 'abort'), der
// andere ignoriert das Signal absichtlich NICHT (haengt sonst den Test selbst auf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout } from "../src/fetch-with-timeout.js";

const TIMEOUT_MS = 20; // kurz + deterministisch (kein echtes Netz, kein Sleep-Loop noetig)

// Simuliert eine haengende Provider-Verbindung: das Promise settlet NIE von selbst,
// reagiert aber (wie das echte fetch/undici) auf ein AbortSignal mit einer Ablehnung.
function hangingFetchStub() {
  return (url, opts) =>
    new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
}

test("fetchWithTimeout: haengender Request wird nach timeoutMs abgebrochen (kein ewiges Haengen)", async () => {
  const originalFetch = global.fetch;
  global.fetch = hangingFetchStub();
  try {
    await assert.rejects(
      () => fetchWithTimeout("https://provider.test/x", {}, { timeoutMs: TIMEOUT_MS, label: "Test" }),
      (err) => {
        assert.match(err.message, /Test/);
        assert.match(err.message, new RegExp(`${TIMEOUT_MS}ms`));
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchWithTimeout: normale Antwort VOR dem Timeout wird durchgereicht", async () => {
  const originalFetch = global.fetch;
  const fakeResponse = { ok: true, status: 200 };
  global.fetch = async () => fakeResponse;
  try {
    const res = await fetchWithTimeout(
      "https://provider.test/x",
      {},
      { timeoutMs: TIMEOUT_MS, label: "Test" },
    );
    assert.equal(res, fakeResponse);
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchWithTimeout: Nicht-Abort-Fehler (z.B. DNS) werden unveraendert durchgereicht", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND provider.test");
  };
  try {
    await assert.rejects(
      () => fetchWithTimeout("https://provider.test/x", {}, { timeoutMs: TIMEOUT_MS, label: "Test" }),
      /ENOTFOUND/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
