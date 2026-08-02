// I6 — Tenant-Scope auf Schreib-/Steuer-Pfade (L5/L6 dicht; L2 war POST /api/settings
// und ist mit AUTH-P4 gegenstandslos geworden, s.u.). Reiner Spawn-
// node:test (KEIN pglite in derselben Datei - Lehre p6a-Stall). Zweiter
// synthetischer Tenant B (seedState-Vorarbeit aus I1) + zwei Identitaeten:
//   - Owner  = Request OHNE X-Internal-Identity (fehlende Identitaet -> Owner)
//   - Tenant = Request MIT X-Internal-Identity=<idpSubject> (localhost -> vertraut,
//              requestTenant -> resolveTenant(sub) -> Tenant)
// Alle /api/*-Requests gehen an srv.localUrl (127.0.0.1): nur dort vertraut der
// Server den X-Internal-Identity-Header (internalIdentity) - es gibt seit AUTH-P7
// keine Basic-Auth mehr, die dem noch im Weg stehen koennte. Flag AN = MULTI_TENANT=true; Flag AUS
// (BASE_ENV-Default) haelt den Owner-Pfad byte-identisch.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT_B = "B";
const SUB_B = "sub-b";
const SUB_UNKNOWN = "sub-unbekannt"; // VORHANDENE, aber unaufloesbare Identitaet -> REJECT

const postJson = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const getJson = (url, headers = {}) => fetch(url, { headers });
const asTenant = (sub) => ({ "X-Internal-Identity": sub });
const tenantB = () => ({ id: TENANT_B, status: "active", idpSubject: SUB_B });

// AUTH-P4: "I6/L2 Flag AN: POST /api/settings ist tenant-gescopt" ist entfallen - die
// HTTP-Naht (POST /api/settings), an der Cross-Tenant-Scoping hier fehlschlagen konnte,
// ist geloescht. Die Zusage wird gegenstandslos, nicht ungeprueft: der verbleibende
// Settings-Schreibpfad (/api/self-service/settings) nimmt den Tenant strukturell aus der
// Session (webAuthMw), ein fremder Tenant ist dort nicht adressierbar.

test("I6/L5 Flag AN: Cancel ist tenant-gescopt (fremd -> 404) + requestedBy im Audit", async (t) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({
      tenants: [tenantB()],
      calls: [
        seedCall({ id: "call_owner", tenantId: BOOTSTRAP_TENANT_ID, status: "active" }),
        seedCall({ id: "call_b", tenantId: TENANT_B, status: "active" }),
      ],
    }),
  });
  try {
    // Negativ zuerst (404 mutiert nichts), dann die Positiv-Cancels.
    await t.test("Owner cancelt B's Call -> 404 (kein Existenz-Leck)", async () => {
      assert.equal((await postJson(`${srv.localUrl}/api/calls/call_b/cancel`, {})).status, 404);
    });

    await t.test("B cancelt Owner's Call -> 404", async () => {
      assert.equal(
        (await postJson(`${srv.localUrl}/api/calls/call_owner/cancel`, {}, asTenant(SUB_B))).status,
        404,
      );
    });

    await t.test("Owner cancelt eigenen Call -> 200 + Audit requestedBy=owner", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls/call_owner/cancel`, {});
      assert.equal(res.status, 200);
      assert.equal((await res.json()).status, "cancelled");
      await waitForLog(srv, /cancel_call ip=\S+ call=call_owner requestedBy=owner/);
    });

    await t.test("B cancelt eigenen Call -> 200 + Audit requestedBy=sub-b", async () => {
      const res = await postJson(`${srv.localUrl}/api/calls/call_b/cancel`, {}, asTenant(SUB_B));
      assert.equal(res.status, 200);
      await waitForLog(srv, /cancel_call ip=\S+ call=call_b requestedBy=sub-b/);
    });
  } finally {
    await srv.stop();
  }
});

test("I6/L6 Flag AN: Export ist tenant-gescopt (nur eigene Calls, kein streamToken); REJECT -> 403", async (t) => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({
      tenants: [tenantB()],
      calls: [
        seedCall({
          id: "call_owner",
          tenantId: BOOTSTRAP_TENANT_ID,
          streamToken: "owner-geheim",
          summary: "Owner-Sum",
        }),
        seedCall({ id: "call_b", tenantId: TENANT_B, streamToken: "b-geheim", summary: "B-Sum" }),
      ],
    }),
  });
  try {
    await t.test("B exportiert NUR B's Call, ohne streamToken", async () => {
      const res = await getJson(`${srv.localUrl}/api/tenant-data/export`, asTenant(SUB_B));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.tenantId, TENANT_B);
      assert.equal(body.calls.length, 1, "nur B's Call");
      assert.equal(body.calls[0].id, "call_b");
      assert.equal("streamToken" in body.calls[0], false, "streamToken NIE geleakt (publicCall)");
      assert.equal(body.calls[0].summary, "B-Sum");
    });

    await t.test("Owner exportiert NUR Owner's Call", async () => {
      const body = await (await getJson(`${srv.localUrl}/api/tenant-data/export`)).json();
      assert.equal(body.tenantId, BOOTSTRAP_TENANT_ID);
      assert.equal(body.calls.length, 1);
      assert.equal(body.calls[0].id, "call_owner");
    });

    await t.test("unbekannte Identitaet -> 403", async () => {
      assert.equal(
        (await getJson(`${srv.localUrl}/api/tenant-data/export`, asTenant(SUB_UNKNOWN))).status,
        403,
      );
    });
  } finally {
    await srv.stop();
  }
});

// AUTH-P4: "I6 Flag AN: POST /api/calendar booked in den Tenant-Bucket" ist entfallen -
// die zweite HTTP-Schreib-Naht (POST /api/calendar) ist geloescht, gleiches Argument
// wie bei /api/settings oben.

// AUTH-P4: "I6 Flag AUS: X-Internal-Identity wird ignoriert" hatte GENAU einen
// Sub-Test (Settings-Write mit B-Header) - der faellt mit POST /api/settings, damit
// die ganze Huelle. Die uebrigen I6-Tests (Cancel, Export) oben bleiben unberuehrt.
