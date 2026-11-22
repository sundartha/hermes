import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const store = await import("../../src/store.js");
const { BOOTSTRAP_TENANT_ID, makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
await store.oeffneSpeicher();

const JETZT = "2026-11-19T10:00:00.000Z";
const ABLAUF = "2026-11-20T10:00:00.000Z";

test("JSON-Speicher über die Fassade: unbekannter Token und unbekannte Adresse liefern null und false statt zu werfen", async () => {
  const newsletter = store.speicherBereiche(store).newsletter;

  assert.equal(await newsletter.confirmNewsletterRecipientByToken("unbekannt", JETZT), null);
  assert.equal(await newsletter.unsubscribeNewsletterRecipientByToken("unbekannt"), null);
  assert.equal(await newsletter.removeNewsletterRecipient(BOOTSTRAP_TENANT_ID, "niemand@example.com"), false);
});

test("pg-Speicher: nach Fehlschlag der eigenen Kopie gleicht die Fassade mit der Zeile ab und bestätigt den Token der anderen Instanz", async () => {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = { withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }) };
  await makePgStoreMitSperre(runner).init();
  await db.query("INSERT INTO tenant (id, status, country) VALUES ('t_fassade_1', 'active', 'DE')");
  const a = makePgStoreMitSperre(runner);
  await a.init();
  const b = makePgStoreMitSperre(runner);
  await b.init();
  a.addNewsletterRecipient("t_fassade_1", { email: "x@example.com", tokenHash: "hash-x", tokenExpiresAt: ABLAUF, unsubToken: "unsub-x", now: JETZT });
  await a.drainFlushes();

  const ergebnis = await store.speicherBereiche(b).newsletter.confirmNewsletterRecipientByToken("hash-x", JETZT);

  assert.deepEqual(ergebnis, { tenantId: "t_fassade_1", email: "x@example.com" });
});
