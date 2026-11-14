import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import {
  attemptCancellationMailConfirm,
  runCancellationMailSweep,
} from "../../src/billing/cancellation-mail.ts";
import {
  attemptContractEndCleanup,
  runContractEndCleanupSweep,
} from "../../src/billing/contract-end-cleanup.ts";
import { setSubscriptionCancellation } from "../../src/billing/subscription-cancellation.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const KUENDIGUNG = [
  ["cancellationMailPending", ["t_a"], { pending: true, receivedAt: "x" }],
  ["setCancellationMailPending", ["t_a", { pending: false }], { id: "t_a" }],
  ["tenantsPendingCancellationMail", [], [{ id: "t_a" }]],
  ["tenantIdpSubject", ["t_a"], "sub_a"],
  ["setContractEndCleanupPending", ["t_a", { numberReleasePending: false, workosDeletePending: true }], { id: "t_a" }],
  ["tenantsPendingContractEndCleanup", [], [{ id: "t_a" }]],
  ["setTenantSubscription", ["t_a", { cancelAtPeriodEnd: true }], { id: "t_a" }],
];

function attrappe(tabelle) {
  const aufrufe = [];
  const speicher = {};
  for (const [name, , ergebnis] of tabelle) {
    speicher[name] = (...args) => {
      aufrufe.push([name, ...args]);
      return ergebnis;
    };
  }
  return { speicher, aufrufe };
}

test("kuendigung: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(KUENDIGUNG);
  const funktionen = speicherBereiche(speicher).kuendigung;
  assert.deepEqual(Object.keys(funktionen), KUENDIGUNG.map(([name]) => name));
  for (const [name, args, ergebnis] of KUENDIGUNG) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, KUENDIGUNG.map(([name, args]) => [name, ...args]));
});

test("kuendigung: Speicherfunktionen werden erst beim Aufruf gelesen und ein Wurf wird zur Ablehnung", async () => {
  const { speicher } = attrappe(KUENDIGUNG);
  const funktionen = speicherBereiche(speicher).kuendigung;
  speicher.tenantIdpSubject = () => "spaet";
  assert.equal(await funktionen.tenantIdpSubject("t_a"), "spaet");
  speicher.tenantIdpSubject = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.tenantIdpSubject("t_a"), /kaputt/);
});

function asynchronerSpeicher(zustand) {
  const aufrufe = [];
  const lesen = (name, wert) => async (...args) => {
    aufrufe.push([name, ...args]);
    return typeof wert === "function" ? wert(...args) : wert;
  };
  return {
    aufrufe,
    cancellationMailPending: lesen("cancellationMailPending", { pending: true, receivedAt: "2026-08-12T10:15:00.000Z" }),
    setCancellationMailPending: lesen("setCancellationMailPending", null),
    tenantsPendingCancellationMail: lesen("tenantsPendingCancellationMail", [{ id: "t_a" }, { id: "t_b" }]),
    tenantSubscription: lesen("tenantSubscription", zustand.abo),
    tenantIdpSubject: lesen("tenantIdpSubject", "sub_a"),
    setContractEndCleanupPending: lesen("setContractEndCleanupPending", null),
    tenantsPendingContractEndCleanup: lesen("tenantsPendingContractEndCleanup", [{ id: "t_a" }]),
    setTenantSubscription: lesen("setTenantSubscription", null),
  };
}

const ABO = { planSlug: "starter", currentPeriodEnd: 1896134400, cancelAtPeriodEnd: true, subscriptionId: "sub_1" };

test("Kuendigungsmail: Lesen und Quittieren laufen ueber den Bereich, die Mail geht mit den gelesenen Werten hinaus", async () => {
  const store = asynchronerSpeicher({ abo: ABO });
  const mails = [];
  const mailer = { sendMail: async (m) => void mails.push(m) };
  const accounts = { accountByTenant: async () => ({ email: "kunde@example.test" }) };
  const config = withConfigNamespaces({ publicUrl: "https://sundartha.example" });
  const offen = await attemptCancellationMailConfirm({ store, mailer, accounts, config, tenantId: "t_a" });
  assert.equal(offen, false);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "kunde@example.test");
  assert.deepEqual(store.aufrufe, [
    ["cancellationMailPending", "t_a"],
    ["tenantSubscription", "t_a"],
    ["setCancellationMailPending", "t_a", { pending: false }],
  ]);
});

test("Kuendigungsmail: nichts Offenes heisst keine Mail und kein Quittieren", async () => {
  const store = asynchronerSpeicher({ abo: ABO });
  store.cancellationMailPending = async () => ({ pending: false, receivedAt: null });
  const mails = [];
  const mailer = { sendMail: async (m) => void mails.push(m) };
  const accounts = { accountByTenant: async () => ({ email: "kunde@example.test" }) };
  const config = withConfigNamespaces({ publicUrl: "https://sundartha.example" });
  assert.equal(await attemptCancellationMailConfirm({ store, mailer, accounts, config, tenantId: "t_a" }), false);
  assert.deepEqual(mails, []);
  assert.deepEqual(store.aufrufe, []);
});

test("Kuendigungsmail-Lauf: jeder offene Mandant des Bereichs wird versucht", async () => {
  const store = asynchronerSpeicher({ abo: ABO });
  const versucht = [];
  const mailer = { sendMail: async (m) => void versucht.push(m.to) };
  const accounts = { accountByTenant: async (id) => ({ email: `${id}@example.test` }) };
  const config = withConfigNamespaces({ publicUrl: "https://sundartha.example" });
  const ergebnis = await runCancellationMailSweep({ store, mailer, accounts, config });
  assert.deepEqual(ergebnis, { attempted: 2 });
  assert.deepEqual(versucht, ["t_a@example.test", "t_b@example.test"]);
});

test("Vertragsende: Identitaet und Vermerk laufen ueber den Bereich", async () => {
  const store = asynchronerSpeicher({ abo: ABO });
  const geloescht = [];
  const workos = { deleteUser: async (subject) => void geloescht.push(subject) };
  const logger = { warn: () => {}, log: () => {} };
  const ergebnis = await attemptContractEndCleanup({
    store,
    numberProvisioner: null,
    workos,
    logger,
    tenantId: "t_a",
  });
  assert.deepEqual(ergebnis, { numberReleasePending: true, workosDeletePending: false });
  assert.deepEqual(geloescht, ["sub_a"]);
  assert.deepEqual(store.aufrufe, [
    ["tenantIdpSubject", "t_a"],
    ["setContractEndCleanupPending", "t_a", { numberReleasePending: true, workosDeletePending: false }],
  ]);
});

test("Vertragsende-Lauf: die offenen Mandanten kommen aus dem Bereich", async () => {
  const store = asynchronerSpeicher({ abo: ABO });
  const logger = { warn: () => {}, log: () => {} };
  const ergebnis = await runContractEndCleanupSweep({ store, numberProvisioner: null, workos: null, logger });
  assert.deepEqual(ergebnis, { attempted: 1 });
  assert.deepEqual(store.aufrufe.map(([name, tenant]) => [name, tenant]), [
    ["tenantsPendingContractEndCleanup", undefined],
    ["tenantIdpSubject", "t_a"],
    ["setContractEndCleanupPending", "t_a"],
  ]);
});

test("Kuendigung zum Periodenende: Abo wird ueber den Bereich gelesen und das Ergebnis des Anbieters ueber den Bereich geschrieben", async () => {
  const store = asynchronerSpeicher({ abo: { ...ABO, cancelAtPeriodEnd: false } });
  const billing = {
    scheduleCancellation: async ({ subscriptionId }) => {
      assert.equal(subscriptionId, "sub_1");
      return { cancelAtPeriodEnd: true, currentPeriodEnd: 1900000000 };
    },
    unscheduleCancellation: async () => assert.fail("falsche Richtung"),
  };
  const ergebnis = await setSubscriptionCancellation({ store, billing, tenant: "t_a", cancel: true });
  assert.deepEqual(ergebnis, {
    ok: true,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: 1900000000,
    alreadyApplied: false,
  });
  assert.deepEqual(store.aufrufe, [
    ["tenantSubscription", "t_a"],
    ["setTenantSubscription", "t_a", { cancelAtPeriodEnd: true, currentPeriodEnd: 1900000000 }],
  ]);
});

test("Kuendigung zum Periodenende: ein Abo im gewuenschten Zustand ruft den Anbieter nicht und schreibt nichts", async () => {
  const store = asynchronerSpeicher({ abo: ABO });
  const billing = {
    scheduleCancellation: async () => assert.fail("nicht noetig"),
    unscheduleCancellation: async () => assert.fail("nicht noetig"),
  };
  const ergebnis = await setSubscriptionCancellation({ store, billing, tenant: "t_a", cancel: true });
  assert.deepEqual(ergebnis, {
    ok: true,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: 1896134400,
    alreadyApplied: true,
  });
  assert.deepEqual(store.aufrufe, [["tenantSubscription", "t_a"]]);
});
