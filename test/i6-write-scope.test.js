import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const TENANT_B = "B";
const SUB_B = "sub-b";
const SUB_UNKNOWN = "sub-unbekannt";

const postJson = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const getJson = (url, headers = {}) => fetch(url, { headers });
const asTenant = (sub) => ({ "X-Internal-Identity": sub });
const tenantB = () => ({ id: TENANT_B, status: "active", idpSubject: SUB_B });

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
