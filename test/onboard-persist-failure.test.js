// OT-3 (P1) AC4: POST /api/onboard behandelt einen Save-I/O-Fehler als definierten
// 5xx (503), NICHT als unhandled async rejection. Server als Kindprozess (helpers);
// der Save wird zum Scheitern gebracht, indem das DATA_DIR nach dem Boot read-only
// gemacht wird -> der atomic save (tmp-File anlegen) wirft EACCES. KEIN Produktions-
// Test-Hook noetig (kein abgeschaltetes Gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { startServer } from "./helpers.js";

test("T-P1-05: Onboard-Save-Failure -> 503, Prozess lebt weiter, Fehler geloggt", async () => {
  // Dry-Run-Default (PROVISIONING_ENABLED=false): der Request-Pfad persistiert die
  // 'requested'-Nummer mit dem ersten save() - genau dieser soll fehlschlagen.
  const srv = await startServer();
  try {
    // Boot hat store.json bereits angelegt; jetzt das Verzeichnis schreibgeschuetzt
    // machen -> tmp-File-Anlage im atomic save scheitert (EACCES).
    fs.chmodSync(srv.dataDir, 0o500);

    // AbortController, damit ein (fehlerhaftes) Haengen im RED-Fall schnell scheitert
    // statt die Suite zu blockieren.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    let res;
    try {
      res = await fetch(`${srv.localUrl}/api/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "t-persist-fail" }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    assert.equal(res.status, 503, "Persistenz-Fehler -> definierter 503");
    const body = await res.json();
    assert.match(body.error, /Persistenz fehlgeschlagen/, "klare, secret-freie Fehlermeldung");
    assert.equal(srv.child.exitCode, null, "Prozess lebt weiter (keine unhandled rejection / kein Crash)");
    assert.match(srv.stdout, /\[onboard\] Persistenz fehlgeschlagen/, "Fehler ist geloggt (mem/disk-Divergenz sichtbar)");
  } finally {
    // Rechte zuruecksetzen, damit Temp-Aufraeumung nicht blockiert.
    try {
      fs.chmodSync(srv.dataDir, 0o700);
    } catch {
      /* best effort */
    }
    await srv.stop();
  }
});
