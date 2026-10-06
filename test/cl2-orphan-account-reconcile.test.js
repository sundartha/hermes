import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileOrphanAccounts } from "../src/orphan-account-reconcile.js";

function fakeAccounts(rows) {
  const calls = { dropped: [], anchors: [] };
  return {
    calls,
    accountsForOrphanReconcile: async () => rows,
    dropAccount: async (sub) => {
      calls.dropped.push(sub);
      return true;
    },
    setIdpSubject: async (tenantId, sub) => {
      calls.anchors.push({ tenantId, sub });
      return true;
    },
  };
}

function fakeWorkos(livingSubs, failFor = null) {
  return {
    userExists: async (sub) => {
      if (sub === failFor) throw new Error("workos_management userExists HTTP 500");
      return livingSubs.includes(sub);
    },
  };
}

const quiet = { warn: () => {}, log: () => {} };

const EMAIL = "kunde@x";
const row = (tenantId, idpSubject, sub) => ({ tenantId, idpSubject, sub, email: EMAIL });

test("CL2: tote Zeile wird entfernt und der Anker auf die lebende Identitaet gezogen", async () => {
  const accounts = fakeAccounts([
    row("t_1", "alt", "alt"),
    row("t_1", "alt", "mittel"),
    row("t_1", "alt", "neu"),
  ]);
  const report = await reconcileOrphanAccounts({
    accounts,
    workos: fakeWorkos(["neu"]),
    apply: true,
    logger: quiet,
  });

  assert.deepEqual(accounts.calls.dropped.sort(), ["alt", "mittel"]);
  assert.deepEqual(accounts.calls.anchors, [{ tenantId: "t_1", sub: "neu" }]);
  assert.equal(report.alive.length, 1);
  assert.equal(report.keptLast.length, 0);
});

test("CL2: zwei LEBENDE Identitaeten derselben Adresse bleiben beide stehen", async () => {
  const accounts = fakeAccounts([row("t_1", "u1", "u1"), row("t_1", "u1", "u2")]);
  const report = await reconcileOrphanAccounts({
    accounts,
    workos: fakeWorkos(["u1", "u2"]),
    apply: true,
    logger: quiet,
  });

  assert.deepEqual(accounts.calls.dropped, [], "keine Loeschung");
  assert.deepEqual(accounts.calls.anchors, [], "der Anker zeigt auf eine lebende Zeile - kein Nachzug");
  assert.deepEqual(
    report.alive.map((entry) => entry.sub).sort(),
    ["u1", "u2"],
    "beide als lebend gemeldet",
  );
});

test("CL2: sind ALLE Identitaeten tot, bleibt die aelteste Zeile stehen (Tenant bleibt auffindbar)", async () => {
  const accounts = fakeAccounts([row("t_1", "alt", "alt"), row("t_1", "alt", "neu")]);
  const report = await reconcileOrphanAccounts({
    accounts,
    workos: fakeWorkos([]),
    apply: true,
    logger: quiet,
  });

  assert.deepEqual(accounts.calls.dropped, ["neu"], "nur die juengere tote Zeile faellt");
  assert.deepEqual(report.keptLast, [{ tenantId: "t_1", sub: "alt" }]);
  assert.deepEqual(accounts.calls.anchors, [], "der Anker zeigt auf die behaltene Zeile");
});

test("CL2: eine fehlgeschlagene Abfrage laesst den GANZEN Tenant unveraendert", async () => {
  const accounts = fakeAccounts([row("t_1", "alt", "alt"), row("t_1", "alt", "neu")]);
  const report = await reconcileOrphanAccounts({
    accounts,
    workos: fakeWorkos(["neu"], "alt"),
    apply: true,
    logger: quiet,
  });

  assert.deepEqual(accounts.calls.dropped, []);
  assert.deepEqual(accounts.calls.anchors, []);
  assert.deepEqual(report.errors, [{ tenantId: "t_1", reason: "lookup_failed" }]);
});

test("CL2: der Trockenlauf berichtet dasselbe, schreibt aber nichts", async () => {
  const accounts = fakeAccounts([row("t_1", "alt", "alt"), row("t_1", "alt", "neu")]);
  const report = await reconcileOrphanAccounts({
    accounts,
    workos: fakeWorkos(["neu"]),
    apply: false,
    logger: quiet,
  });

  assert.deepEqual(report.dropped, [{ tenantId: "t_1", sub: "alt" }], "der Befund steht im Report");
  assert.equal(report.anchors.length, 1);
  assert.deepEqual(accounts.calls.dropped, [], "aber keine Schreibung");
  assert.deepEqual(accounts.calls.anchors, []);
});

test("CL2: mehrere Tenants werden unabhaengig behandelt - ein Fehler reisst den Lauf nicht", async () => {
  const accounts = fakeAccounts([
    row("t_1", "a1", "a1"),
    row("t_1", "a1", "a2"),
    row("t_2", "b1", "b1"),
    row("t_2", "b1", "b2"),
  ]);
  const report = await reconcileOrphanAccounts({
    accounts,
    workos: fakeWorkos(["a2", "b2"], "b1"),
    apply: true,
    logger: quiet,
  });

  assert.deepEqual(accounts.calls.dropped, ["a1"], "t_1 wird geheilt");
  assert.deepEqual(accounts.calls.anchors, [{ tenantId: "t_1", sub: "a2" }]);
  assert.deepEqual(report.errors, [{ tenantId: "t_2", reason: "lookup_failed" }], "t_2 bleibt unangetastet");
});
