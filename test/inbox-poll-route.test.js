// INBOX-P2: POST /api/inbox/poll - Spawn-Server, echter Store (json-Backend), echte
// Auth-Kette (internalOnly + requireTenant). Jeder Fall bekommt seinen EIGENEN
// spawn/seed (keine geteilte, order-abhaengige Historie ueber die Faelle hinweg) und
// stoppt den Server im finally (Bestandsproblem "verwaiste Testserver").
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const CALLER = "+4915112345678"; // fiktiv, Bestandsstil (seedCall-Default)
const NOW = "2026-08-21T10:00:00.000Z";
const STARTED = "2026-08-21T09:00:00.000Z";

// Der Store filtert AUSSCHLIESSLICH auf inboxEntryAt - Richtung und Substanz hat
// INBOX-P1 im Anrufmoment entschieden. Ein realistischer Outbound-Call traegt deshalb
// KEINEN Marker (ein Outbound MIT Marker kann per Konstruktion nicht entstehen).
function seedThreeCalls() {
  const inboundQualified = seedCall({
    id: "call_inbox_ok",
    direction: "inbound",
    from: CALLER,
    to: "+15005550006",
    status: "completed",
    startedAt: STARTED,
    summary: "Testanliegen",
    result: {
      outcome: "Rueckruf zugesagt",
      commitments: [],
      counterpartyCommitments: [],
      openPoints: [],
      nextStep: null,
      facts: ["GEHEIM-FACT"],
    },
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const outboundNoMarker = seedCall({
    id: "call_outbound",
    direction: "outbound",
    status: "completed",
    inboxEntryAt: null,
    inboxSeenAt: null,
  });
  const inboundNoMarker = seedCall({
    id: "call_inbound_stumm",
    direction: "inbound",
    from: CALLER,
    status: "completed",
    inboxEntryAt: null,
    inboxSeenAt: null,
  });
  return seedState({ calls: [inboundQualified, outboundNoMarker, inboundNoMarker] });
}

function poll(srv, { headers = {}, body } = {}) {
  return fetch(`${srv.localUrl}/api/inbox/poll`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

test("INBOX-P2 R1: erster Poll liefert den qualifizierten Eintrag, zweiter Poll ist leer", async () => {
  const srv = await startServer({ seed: seedThreeCalls() });
  try {
    const first = await poll(srv);
    assert.equal(first.status, HTTP_OK);
    const firstBody = await first.json();
    assert.equal(firstBody.entries.length, 1);
    assert.equal(firstBody.entries[0].call_id, "call_inbox_ok");
    assert.equal(firstBody.remaining, 0);

    const second = await poll(srv);
    assert.equal(second.status, HTTP_OK);
    const secondBody = await second.json();
    assert.equal(secondBody.entries.length, 0);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 R2: der Wrapper persistiert die Als-gesehen-Markierung (save() lief)", async () => {
  const srv = await startServer({ seed: seedThreeCalls() });
  try {
    await poll(srv);
    const store = srv.readStore();
    const call = store.calls.find((item) => item.id === "call_inbox_ok");
    assert.notEqual(call.inboxSeenAt, null);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 R3: X-Forwarded-For wird als externer Aufrufer abgelehnt (403), kein Konsum", async () => {
  const srv = await startServer({ seed: seedThreeCalls() });
  try {
    const res = await poll(srv, { headers: { "x-forwarded-for": "1.2.3.4" } });
    assert.equal(res.status, HTTP_FORBIDDEN);
    const store = srv.readStore();
    const call = store.calls.find((item) => item.id === "call_inbox_ok");
    assert.equal(call.inboxSeenAt, null);
  } finally {
    await srv.stop();
  }
});

const SUB_OWNER = "sub-owner";
const SUB_B = "sub-b";
const TENANT_B = "tenant_b_inbox";
const OWNER_NUM = "+4915200000001";
const B_NUM = "+4915200000002";

function seedTwoTenantsQualified() {
  const ownerCall = seedCall({
    id: "call_owner_inbox",
    tenantId: BOOTSTRAP_TENANT_ID,
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: STARTED,
    summary: "Owner-Anliegen",
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  const bCall = seedCall({
    id: "call_b",
    tenantId: TENANT_B,
    direction: "inbound",
    from: CALLER,
    status: "completed",
    startedAt: STARTED,
    summary: "B-Anliegen",
    inboxEntryAt: NOW,
    inboxSeenAt: null,
  });
  return seedState({
    calls: [ownerCall, bCall],
    tenants: [
      { id: BOOTSTRAP_TENANT_ID, status: "active", idpSubject: SUB_OWNER },
      { id: TENANT_B, status: "active", idpSubject: SUB_B, ownerName: "Maria" },
    ],
    numbers: [
      {
        id: "num_owner",
        e164: OWNER_NUM,
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
      {
        id: "num_b",
        e164: B_NUM,
        tenantId: TENANT_B,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
  });
}

test("INBOX-P2 R4: Cross-Tenant - jede Identitaet bekommt und markiert NUR ihre eigene Inbox", async () => {
  const srv = await startServer({ env: { MULTI_TENANT: "true" }, seed: seedTwoTenantsQualified() });
  try {
    const ownerRes = await poll(srv, { headers: { "x-internal-identity": SUB_OWNER } });
    assert.equal(ownerRes.status, HTTP_OK);
    const ownerBody = await ownerRes.json();
    const ownerIds = ownerBody.entries.map((entry) => entry.call_id);
    assert.ok(ownerIds.includes("call_owner_inbox"));
    assert.ok(!ownerIds.includes("call_b"));

    const afterOwnerPoll = srv.readStore();
    const bCallAfterOwner = afterOwnerPoll.calls.find((item) => item.id === "call_b");
    assert.equal(bCallAfterOwner.inboxSeenAt, null, "Owner-Poll darf B's Marker nicht setzen");

    const bRes = await poll(srv, { headers: { "x-internal-identity": SUB_B } });
    assert.equal(bRes.status, HTTP_OK);
    const bBody = await bRes.json();
    const bIds = bBody.entries.map((entry) => entry.call_id);
    assert.ok(bIds.includes("call_b"));
    assert.ok(!bIds.includes("call_owner_inbox"));
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 R5: include_seen liest erneut, ohne einen Marker zu aendern", async () => {
  const srv = await startServer({ seed: seedThreeCalls() });
  try {
    await poll(srv);
    const afterFirstPoll = srv.readStore();
    const seenAtAfterFirst = afterFirstPoll.calls.find((item) => item.id === "call_inbox_ok").inboxSeenAt;

    const res = await poll(srv, { body: { include_seen: true } });
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].call_id, "call_inbox_ok");

    const afterIncludeSeen = srv.readStore();
    const seenAtAfter = afterIncludeSeen.calls.find((item) => item.id === "call_inbox_ok").inboxSeenAt;
    assert.equal(seenAtAfter, seenAtAfterFirst);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 R6: die Antwort traegt NUR die Whitelist - kein Transkript, keine Zitate, keine internen Marker", async () => {
  const srv = await startServer({ seed: seedThreeCalls() });
  try {
    const res = await poll(srv);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "transcript",
      "facts",
      "GEHEIM-FACT",
      "evidence",
      "streamToken",
      "inboxEntryAt",
      "inboxSeenAt",
    ]) {
      assert.ok(!serialized.includes(forbidden), `Antwort leakt "${forbidden}"`);
    }
    const entry = body.entries[0];
    assert.ok("outcome" in entry);
    assert.ok("commitments" in entry);
    assert.ok("counterparty_commitments" in entry);
    assert.ok("open_points" in entry);
    assert.ok("next_step" in entry);
    assert.ok("summary_unavailable" in entry);
    assert.ok("action_required" in entry);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 R7: die Audit-Zeile traegt NUR Zaehler, keine Rufnummer/Inhalte/Call-ID", async () => {
  const srv = await startServer({ seed: seedThreeCalls() });
  try {
    await poll(srv);
    assert.match(srv.stdout, /\[audit\] inbox_poll ip=\S+ neu=\d+ rest=\d+/);
    assert.ok(srv.stdout.includes("[audit] inbox_poll "));
    assert.ok(!srv.stdout.includes(CALLER), "Audit-Zeile darf die Rufnummer nicht enthalten");
    assert.ok(!srv.stdout.includes("Testanliegen"), "Audit-Zeile darf die Zusammenfassung nicht enthalten");
    assert.ok(!srv.stdout.includes("call_inbox_ok"), "Audit-Zeile darf die Call-ID nicht enthalten");
  } finally {
    await srv.stop();
  }
});
