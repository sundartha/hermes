import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function assertRouteEntfernt(res) {
  assert.equal(res.status, 404, "Route muss weg sein");
  assert.ok(
    !(res.headers.get("content-type") || "").includes("application/json"),
    "404 mit JSON-Koerper = die Route ist noch gemountet und hat selbst geantwortet",
  );
}

test("AUTH-P4-1: POST /api/settings ist entfernt - 404 ohne Handler-Antwort, kein Schreibzugriff", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/settings`, { agentName: "Gekapert" });
    assertRouteEntfernt(res);
    assert.equal(
      srv.readStore().settings[BOOTSTRAP_TENANT_ID].agentName,
      "Hermes",
      "kein Schreibzugriff - der Owner-Bucket bleibt beim Default",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-2: POST /api/action-items/:id/toggle ist entfernt - vorhandenes Item bleibt ungetoggelt", async () => {
  const srv = await startServer({
    seed: seedState({
      actionItems: [
        {
          id: "ai_p4",
          callId: "call_p4",
          text: "AUTH-P4-Probe",
          type: "todo",
          done: false,
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  });
  try {
    const res = await postJson(`${srv.localUrl}/api/action-items/ai_p4/toggle`, {});
    assertRouteEntfernt(res);
    const item = srv.readStore().actionItems.find((a) => a.id === "ai_p4");
    assert.equal(item.done, false, "kein Toggle - das Item bleibt unangetastet");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-3: POST /api/calendar ist entfernt - kein Termin landet im Store", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/calendar`, {
      title: "AUTH-P4-Probe",
      start: "2026-07-01T10:00:00Z",
      end: "2026-07-01T11:00:00Z",
    });
    assertRouteEntfernt(res);
    const events = srv.readStore().calendar[BOOTSTRAP_TENANT_ID] ?? [];
    assert.equal(
      events.some((e) => e.title === "AUTH-P4-Probe"),
      false,
      "kein Termin entstanden",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-4: GET /api/profiles ist entfernt", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/api/profiles`);
    assertRouteEntfernt(res);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-5: POST /api/profiles kann kein unrestricted-Profil mehr anlegen (der geschlossene Vektor)", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/profiles`, {
      tenantId: "t_p4_angreifer",
      unrestricted: true,
    });
    assertRouteEntfernt(res);
    assert.equal(
      "t_p4_angreifer" in srv.readStore().profiles,
      false,
      "kein Profil angelegt - der Vektor ist geschlossen",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-6: DELETE /api/profiles/:tenantId ist entfernt - vorhandenes Profil bleibt bestehen", async () => {
  const srv = await startServer({
    seed: seedState({ profiles: { t_p4_bestand: { unrestricted: false } } }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/profiles/t_p4_bestand`, { method: "DELETE" });
    assertRouteEntfernt(res);
    assert.equal(
      "t_p4_bestand" in srv.readStore().profiles,
      true,
      "das vorhandene Profil bleibt bestehen",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-7: der Server bootet nach dem Umzug von validIdentity (kein SyntaxError beim Laden von api-onboard.js)", async () => {
  const srv = await startServer();
  try {
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    await srv.stop();
  }
});
