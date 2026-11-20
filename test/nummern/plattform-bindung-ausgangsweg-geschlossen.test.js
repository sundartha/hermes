import { test } from "node:test";
import assert from "node:assert/strict";

process.env.STORE_BACKEND = "pg";
process.env.DATABASE_URL = "postgres://attrappe.invalid/hermes";
const { makePgTestStore, schemaErneutAnwenden } = await import("../pg-helpers.js");
const { db } = await makePgTestStore();

const FRUEHER_GESCHLOSSEN = "2026-01-02T03:04:05.000Z";

async function binden({ id, e164, purpose, releasedAt = null }) {
  await db.query(
    `INSERT INTO platform_number_use (id, e164, purpose, provider, released_at)
     VALUES ($1, $2, $3, 'telnyx', $4)`,
    [id, e164, purpose, releasedAt],
  );
}

const zeile = async (id) =>
  (await db.query("SELECT released_at AS frei FROM platform_number_use WHERE id = $1", [id])).rows[0];

test("Beim Start wird die offene Absender-Bindung der gemeinsamen Rufnummer geschlossen, die Bindung der Ausfall-SMS bleibt offen", async () => {
  await binden({ id: "pnu_alt_offen", e164: "+15005550101", purpose: "outbound_ani" });
  await binden({ id: "pnu_alarm_offen", e164: "+15005550102", purpose: "alert_sms_sender" });

  await schemaErneutAnwenden(db);

  assert.notEqual((await zeile("pnu_alt_offen")).frei, null);
  assert.equal((await zeile("pnu_alarm_offen")).frei, null);
});

test("Eine schon geschlossene Absender-Bindung behaelt ihren Schliesszeitpunkt", async () => {
  await binden({ id: "pnu_alt_zu", e164: "+15005550103", purpose: "outbound_ani", releasedAt: FRUEHER_GESCHLOSSEN });

  await schemaErneutAnwenden(db);

  assert.equal((await zeile("pnu_alt_zu")).frei.toISOString(), FRUEHER_GESCHLOSSEN);
});
