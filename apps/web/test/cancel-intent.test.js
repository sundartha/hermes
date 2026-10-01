// Kuendigungs-Auftrag der App-Shell (lib/cancel-intent.js, § 312k BGB, Owner-
// Entscheidung 2026-10-01: gekuendigt wird NUR im Kundenbereich). Rein, ohne DOM:
// der Speicher ist eine Map-Attrappe mit der sessionStorage-Schnittstelle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AUTH_STATE } from "../src/lib/api.js";
import { CANCEL_URL } from "../src/lib/routes.js";
import {
  CANCEL_INTENT_HASH,
  CANCEL_INTENT_STEP,
  cancelIntentStep,
  clearCancelIntent,
  pendingCancelIntent,
  rememberCancelIntent,
} from "../src/lib/cancel-intent.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(WEB_ROOT, path), "utf8");
const NOW = 1_790_000_000_000;
const MINUTE_MS = 60_000;
const TTL_MINUTES = 15;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const lockedStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
  removeItem() {
    throw new Error("SecurityError");
  },
};

test("Kuendigungs-Auftrag: jeder Link der Website zeigt auf den Anker der App-Shell", () => {
  assert.ok(CANCEL_URL.endsWith(`/app${CANCEL_INTENT_HASH}`));
  for (const path of [
    "src/pages/index.astro",
    "src/layouts/Hermes.astro",
    "src/components/MobileHome.astro",
    "src/components/site/CancelInfo.astro",
  ]) {
    const source = read(path);
    assert.ok(source.includes("CANCEL_URL"), `${path} fuehrt nicht zur Kuendigung im Kundenbereich`);
    assert.ok(!source.includes('data-legal-open="cancel"'), `${path} oeffnet noch den Reiter`);
  }
});

test("Kuendigungs-Auftrag: eingeloggt -> Bestaetigung oeffnen", () => {
  const intent = pendingCancelIntent({ hash: CANCEL_INTENT_HASH, storage: memoryStorage(), now: NOW });
  assert.deepEqual(intent, { pending: true, viaLogin: false });
  assert.equal(cancelIntentStep(AUTH_STATE.AUTHENTICATED, intent), CANCEL_INTENT_STEP.OPEN);
});

test("Kuendigungs-Auftrag: anonym -> Login, danach (gemerkt) Bestaetigung oeffnen", () => {
  const storage = memoryStorage();
  const fromWebsite = pendingCancelIntent({ hash: CANCEL_INTENT_HASH, storage, now: NOW });
  assert.equal(cancelIntentStep(AUTH_STATE.ANONYMOUS, fromWebsite), CANCEL_INTENT_STEP.LOGIN);

  rememberCancelIntent(storage, NOW);
  const afterLogin = pendingCancelIntent({ hash: "", storage, now: NOW + MINUTE_MS });
  assert.deepEqual(afterLogin, { pending: true, viaLogin: true });
  assert.equal(cancelIntentStep(AUTH_STATE.AUTHENTICATED, afterLogin), CANCEL_INTENT_STEP.OPEN);
});

test("Kuendigungs-Auftrag: nach dem Login-Umweg immer noch anonym -> keine Login-Schleife", () => {
  const storage = memoryStorage();
  rememberCancelIntent(storage, NOW);
  const intent = pendingCancelIntent({ hash: "", storage, now: NOW + MINUTE_MS });
  assert.equal(cancelIntentStep(AUTH_STATE.ANONYMOUS, intent), CANCEL_INTENT_STEP.DROP);
});

test("Kuendigungs-Auftrag: wartet auf Freigabe -> verwerfen, Ladefehler -> stehen lassen", () => {
  const intent = { pending: true, viaLogin: false };
  assert.equal(cancelIntentStep(AUTH_STATE.PENDING, intent), CANCEL_INTENT_STEP.DROP);
  assert.equal(cancelIntentStep(AUTH_STATE.ERROR, intent), CANCEL_INTENT_STEP.NONE);
});

test("Kuendigungs-Auftrag: ohne Anker und ohne Merker passiert nichts", () => {
  const intent = pendingCancelIntent({ hash: "#abrechnung", storage: memoryStorage(), now: NOW });
  assert.deepEqual(intent, { pending: false, viaLogin: false });
  assert.equal(cancelIntentStep(AUTH_STATE.AUTHENTICATED, intent), CANCEL_INTENT_STEP.NONE);
});

test("Kuendigungs-Auftrag: ein alter oder geloeschter Merker zaehlt nicht", () => {
  const storage = memoryStorage();
  rememberCancelIntent(storage, NOW);
  const later = NOW + (TTL_MINUTES + 1) * MINUTE_MS;
  assert.equal(pendingCancelIntent({ hash: "", storage, now: later }).pending, false);

  rememberCancelIntent(storage, NOW);
  clearCancelIntent(storage);
  assert.equal(pendingCancelIntent({ hash: "", storage, now: NOW }).pending, false);
});

test("Kuendigungs-Auftrag: gesperrter Speicher wirft nie, der Anker wirkt trotzdem", () => {
  assert.doesNotThrow(() => rememberCancelIntent(lockedStorage, NOW));
  assert.doesNotThrow(() => clearCancelIntent(lockedStorage));
  assert.equal(pendingCancelIntent({ hash: "", storage: lockedStorage, now: NOW }).pending, false);
  const intent = pendingCancelIntent({ hash: CANCEL_INTENT_HASH, storage: lockedStorage, now: NOW });
  assert.equal(cancelIntentStep(AUTH_STATE.AUTHENTICATED, intent), CANCEL_INTENT_STEP.OPEN);
});
