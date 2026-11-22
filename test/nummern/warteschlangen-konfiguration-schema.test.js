import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../../src/queue/registry.js";
import { config } from "../../src/config.ts";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

function zodFehler(lauf) {
  try {
    lauf();
  } catch (fehler) {
    return fehler;
  }
  return assert.fail("createQueue hat nicht geworfen");
}

test("Warteschlange: nicht-textliche QUEUE_BACKEND-Konfiguration bricht mit Schemafehler zum Feld ab", () => {
  for (const ungueltig of [42, null, undefined]) {
    withConfigOverrides({ queueBackend: ungueltig }, () => {
      const fehler = zodFehler(() => createQueue());
      assert.equal(fehler.name, "ZodError");
      assert.match(fehler.message, /queueBackend/);
      assert.doesNotMatch(fehler.message, /Unbekanntes QUEUE_BACKEND/);
    });
  }
});

test("Warteschlange: nicht-textliche DATABASE_URL-Konfiguration bricht mit Schemafehler zum Feld ab", () => {
  for (const ungueltig of [42, null, undefined]) {
    withConfigOverrides({ queueBackend: "memory", databaseUrl: ungueltig }, () => {
      const fehler = zodFehler(() => createQueue());
      assert.equal(fehler.name, "ZodError");
      assert.match(fehler.message, /databaseUrl/);
    });
  }
});

test("Warteschlange: pgboss nimmt die DATABASE_URL aus der Konfiguration, ausdrückliche Optionen gehen vor", () => {
  withConfigOverrides(
    { queueBackend: "pgboss", databaseUrl: "postgres://hermes@127.0.0.1:1/hermes" },
    () => {
      assert.doesNotThrow(() => createQueue());
      assert.throws(() => createQueue({ connectionString: "" }), /DATABASE_URL/);
    },
  );
  withConfigOverrides({ queueBackend: "pgboss", databaseUrl: "" }, () => {
    assert.throws(() => createQueue(), /DATABASE_URL/);
  });
});

test("Warteschlange: unbekanntes QUEUE_BACKEND nennt den Wert und die erlaubten Werte", () => {
  withConfigOverrides({ queueBackend: "was-anderes" }, () => {
    assert.throws(() => createQueue(), {
      message: 'Unbekanntes QUEUE_BACKEND "was-anderes" (erlaubt: memory, pgboss)',
    });
  });
});
