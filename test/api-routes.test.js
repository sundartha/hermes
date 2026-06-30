// P4 / AC7 + T-P4-08: Behavior-Paritaet der extrahierten Route-Gruppe.
//
// AC7 extrahiert EINE kohaerente /api-Route-Gruppe in ein eigenes Modul
// (makeProfileRoutes, DI-Muster wie makeWebAuthRoutes) - behavior-preserving,
// reine Verschiebung. Diese Tests pinnen das beobachtbare Verhalten der
// Rechteprofile-Routen (GET/POST/DELETE /api/profiles) gegen den gespawnten
// Server: gleiche Pfade, gleiche Status-Codes, gleiche Response-Shapes VOR und
// NACH der Extraktion. Gate-Treffer (gueltige Identity -> 200) UND Gate-Ablehnung
// (malformte Identity -> 400, unbekanntes Profil -> 404) explizit asserten.
//
// T-P4-09 (Originate-Leak) ist NICHT hier: die Response-Haertung + ihr dynamischer
// Test (test/place-call-error.test.js, T-P2-11) sind bereits in master (Delta 1) -
// nicht doppeln.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("T-P4-08: /api/profiles Route-Gruppe - Paritaet (Treffer + Ablehnung)", async (t) => {
  const srv = await startServer();
  try {
    await t.test("GET /api/profiles -> 200, JSON-Objekt (leer initial)", async () => {
      const res = await fetch(`${srv.localUrl}/api/profiles`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body, "object");
      assert.ok(!Array.isArray(body), "listProfiles liefert ein Objekt (Map), kein Array");
    });

    await t.test(
      "POST /api/profiles ohne gueltige tenantId -> 400 (Gate-Ablehnung)",
      async () => {
        // validIdentity-Gate: leer, mit Whitespace, > Maxlen werden abgewiesen.
        for (const tenantId of ["", "mit leer", "x".repeat(255)]) {
          const res = await postJson(`${srv.localUrl}/api/profiles`, { tenantId });
          assert.equal(res.status, 400, `tenantId='${tenantId.slice(0, 12)}...' muss 400 sein`);
          assert.match((await res.json()).error, /tenantId/);
        }
      },
    );

    await t.test(
      "POST /api/profiles mit gueltiger tenantId -> 200, { tenantId, profile } (Gate-Treffer)",
      async () => {
        const res = await postJson(`${srv.localUrl}/api/profiles`, {
          tenantId: "t_kunde",
          allowCalendar: false,
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.tenantId, "t_kunde");
        assert.equal(typeof body.profile, "object");
        // Persistenz-Beleg: das Profil taucht in listProfiles auf
        const list = await (await fetch(`${srv.localUrl}/api/profiles`)).json();
        assert.ok("t_kunde" in list, "neues Profil in der Liste");
      },
    );

    await t.test(
      "DELETE /api/profiles/:tenantId - unbekannt -> 404, bekannt -> 200 {ok:true}",
      async () => {
        const miss = await fetch(`${srv.localUrl}/api/profiles/t_nicht_da`, {
          method: "DELETE",
        });
        assert.equal(miss.status, 404);
        const hit = await fetch(`${srv.localUrl}/api/profiles/t_kunde`, {
          method: "DELETE",
        });
        assert.equal(hit.status, 200);
        assert.deepEqual(await hit.json(), { ok: true });
      },
    );
  } finally {
    await srv.stop();
  }
});
