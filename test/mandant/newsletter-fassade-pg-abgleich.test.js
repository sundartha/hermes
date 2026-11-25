import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";

Object.assign(process.env, BASE_ENV, {
  DATA_DIR: tempDataDir(),
  STORE_BACKEND: "pg",
  DATABASE_URL: "postgres://fassade-pg-attrappe.invalid/hermes",
});

const { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } = await import("../pg-helpers.js");
const db = await pgliteAlsRolleOhneSuperuser();
const runner = { withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }) };
await makePgStoreMitSperre(runner).init();
await db.query("INSERT INTO tenant (id, status, country) VALUES ('t_fassade_pg', 'active', 'DE')");
poolAufPglite(db);
const store = await import("../../src/store.js");
await store.oeffneSpeicher();

const JETZT = "2026-11-19T10:00:00.000Z";
const ABLAUF = "2026-11-20T10:00:00.000Z";

test("pg-Speicher über die Fassade: nach Fehlschlag der eigenen Kopie bestätigt der Abgleich den Token, den eine andere Instanz eingetragen hat", async () => {
  const zweite = makePgStoreMitSperre(runner);
  await zweite.init();
  zweite.addNewsletterRecipient("t_fassade_pg", { email: "x@example.com", tokenHash: "hash-x", tokenExpiresAt: ABLAUF, unsubToken: "unsub-x", now: JETZT });
  await zweite.drainFlushes();

  const ergebnis = await store.speicherBereiche(store).newsletter.confirmNewsletterRecipientByToken("hash-x", JETZT);

  assert.deepEqual(ergebnis, { tenantId: "t_fassade_pg", email: "x@example.com" });
});

test("pg-Speicher: ein Eintrag, den die Mandanten-Anlage schon mitgeschrieben hat, steht danach nicht doppelt in Liste und Tageslimit", async () => {
  const { makePgStore } = await import("../../src/store/pg.js");
  const ops = await import("../../src/store/state-ops.js");
  const neu = makePgStore(runner);
  await neu.init();
  ops.registerTenant(neu.load(), "t_fassade_neu", { firstName: "Neu" });
  neu.addNewsletterRecipient("t_fassade_neu", { email: "n@example.com", tokenHash: "hash-n", tokenExpiresAt: ABLAUF, unsubToken: "unsub-n", now: JETZT });
  await neu.drainFlushes();

  const geladen = makePgStore(runner);
  await geladen.init();

  assert.equal(geladen.tenantNewsletterRecipients("t_fassade_neu").length, 1);
  assert.equal(geladen.dailyNewsletterConfirmMailCount("t_fassade_neu", "2026-11-19T00:00:00.000Z"), 1);
});
