import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importNachKonfiguration, importNachUmgebung } from "./umgebung-import.js";

test("importNachUmgebung wirft, wenn src/config.js schon auf ein anderes DATA_DIR zeigt", async (t) => {
  await import("../config-namespaces-helper.js");
  const gewollt = fs.mkdtempSync(path.join(os.tmpdir(), "umgebung-import-"));
  t.after(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(gewollt, { recursive: true, force: true });
  });
  await assert.rejects(importNachUmgebung({ DATA_DIR: gewollt }), (fehler) => {
    assert.match(fehler.message, /nicht gebunden/);
    assert.ok(fehler.message.includes(gewollt), "die Meldung nennt das gewollte Verzeichnis");
    return true;
  });
});

test("importNachUmgebung setzt die Umgebung, bevor die Lader in Reihenfolge laufen", async (t) => {
  t.after(() => {
    delete process.env.UMGEBUNG_IMPORT_NEU;
    delete process.env.UMGEBUNG_IMPORT_ALT;
  });
  process.env.UMGEBUNG_IMPORT_ALT = "alt";
  const reihenfolge = [];
  const geladen = await importNachUmgebung(
    { UMGEBUNG_IMPORT_NEU: "neu", UMGEBUNG_IMPORT_ALT: undefined },
    async () => {
      await new Promise((weiter) => setImmediate(weiter));
      reihenfolge.push("erster");
      return process.env.UMGEBUNG_IMPORT_NEU;
    },
    () => {
      assert.deepEqual(reihenfolge, ["erster"], "der zweite Lader startet erst, wenn der erste fertig ist");
      reihenfolge.push("zweiter");
      return process.env.UMGEBUNG_IMPORT_ALT;
    },
  );
  assert.deepEqual(geladen, ["neu", undefined]);
  assert.deepEqual(reihenfolge, ["erster", "zweiter"]);
});

test("importNachKonfiguration wirft bei unbekanntem Schlüssel oder Namensraum und lädt dann nichts", async () => {
  let geladen = false;
  const lader = () => {
    geladen = true;
  };
  await assert.rejects(importNachKonfiguration({}, { server: { gibtEsNicht: 1 } }, lader), /server\.gibtEsNicht/);
  await assert.rejects(importNachKonfiguration({}, { gibtEsNicht: { port: 1 } }, lader), /config\.gibtEsNicht existiert nicht/);
  assert.equal(geladen, false);
});
