import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeInboxRoutes, INBOX_MAX_ENTRIES } from "../../src/routes/api-inbox.js";
import { startServer, seedState, seedCall } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const OWNER_TENANT = "owner";
const A5_POLL_COUNT = 3;
const CALLER = "+4915112345678";
const NOW = "2026-08-21T10:00:00.000Z";
const STARTED = "2026-08-21T09:00:00.000Z";

function makeMockStore(result) {
  const saves = [];
  const pollCalls = [];
  return {
    saves,
    pollCalls,
    save: () => saves.push(1),
    takeInboxEntries: (tenantId, options) => {
      pollCalls.push({ tenantId, options });
      return result;
    },
  };
}

function makeAllowTenant() {
  return { requireTenant: () => OWNER_TENANT };
}

function makeRejectTenant() {
  return {
    requireTenant: (req, res) => {
      res.status(HTTP_FORBIDDEN).json({ error: "tenant" });
      return null;
    },
  };
}

async function mount(store, tenant) {
  const audits = [];
  const app = express();
  app.use(express.json());
  app.use(makeInboxRoutes({ store, audit: (...args) => audits.push(args), tenant }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, audits, stop: () => new Promise((resolve) => server.close(resolve)) };
}

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

const SUB_OWNER = "sub-owner";
const SUB_B = "sub-b";
const TENANT_B = "tenant_b_inbox";
const OWNER_NUM = "+4915200000001";
const B_NUM = "+4915200000002";

function seedTwoTenantsQualified() {
  const ownerCall = seedCall({
    id: "call_owner_inbox",
    tenantId: OWNER_TENANT,
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
      { id: OWNER_TENANT, status: "active", idpSubject: SUB_OWNER },
      { id: TENANT_B, status: "active", idpSubject: SUB_B, ownerName: "Maria" },
    ],
    numbers: [
      {
        id: "num_owner",
        e164: OWNER_NUM,
        tenantId: OWNER_TENANT,
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

async function assertPollDoesNotSave(pollResult) {
  const store = makeMockStore(pollResult);
  const srv = await mount(store, makeAllowTenant());
  try {
    const res = await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(res.status, HTTP_OK);
    assert.equal(store.saves.length, 0);
  } finally {
    await srv.stop();
  }
}

test("INBOX-P2 A1: Leer-Poll ruft store.save() nicht auf", async () => {
  await assertPollDoesNotSave({ entries: [], remaining: 0, marked: 0 });
});

test("INBOX-P2 A2: Poll mit Eintrag (marked:1) ruft store.save() TROTZDEM nicht auf (kein Doppel-Flush)", async () => {
  await assertPollDoesNotSave({
    entries: [{ call_id: "call_x" }],
    remaining: 0,
    marked: 1,
  });
});

test("INBOX-P2 A3: Audit-Form ist ausschliesslich Zaehler", async () => {
  const store = makeMockStore({ entries: [{ call_id: "call_x" }], remaining: 2, marked: 1 });
  const srv = await mount(store, makeAllowTenant());
  try {
    await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(srv.audits.length, 1);
    const [action, , detail] = srv.audits[0];
    assert.equal(action, "inbox_poll");
    assert.match(detail, /^neu=\d+ rest=\d+$/);
    assert.ok(!/\d{6,}/.test(detail), "Audit-Detail darf keine E.164-artige Ziffernfolge tragen");
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 A4: requireTenant-Ablehnung -> 403, takeInboxEntries wird NIE gerufen", async () => {
  const store = makeMockStore({ entries: [], remaining: 0, marked: 0 });
  const srv = await mount(store, makeRejectTenant());
  try {
    const res = await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal(store.pollCalls.length, 0);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 A5: include_seen wird fail-closed durchgereicht", async () => {
  const store = makeMockStore({ entries: [], remaining: 0, marked: 0 });
  const srv = await mount(store, makeAllowTenant());
  try {
    await fetch(`${srv.base}/api/inbox/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ include_seen: true }),
    });
    await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    await fetch(`${srv.base}/api/inbox/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ include_seen: "true" }),
    });
    assert.equal(store.pollCalls.length, A5_POLL_COUNT);
    assert.deepEqual(store.pollCalls[0].options, { limit: INBOX_MAX_ENTRIES, includeSeen: true });
    assert.deepEqual(store.pollCalls[1].options, { limit: INBOX_MAX_ENTRIES, includeSeen: false });
    assert.deepEqual(store.pollCalls[2].options, { limit: INBOX_MAX_ENTRIES, includeSeen: false });
  } finally {
    await srv.stop();
  }
});

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
