import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attemptCancellationMailConfirm,
  buildCancellationMailText,
} from "../../src/billing/cancellation-mail.ts";
import { attemptContractEndCleanup } from "../../src/billing/contract-end-cleanup.ts";

const TENANT = "t_h4a";

function sammler() {
  const lines = [];
  return { lines, warn: (m) => lines.push(String(m)), log: () => {} };
}

function mailStore() {
  return {
    cancellationMailPending: () => ({ pending: true, receivedAt: "2026-08-12T10:15:00.000Z" }),
    tenantSubscription: () => ({ planSlug: "starter", currentPeriodEnd: 1896134400 }),
    setCancellationMailPending: () => null,
  };
}

async function sendeMitFehler(fehler) {
  const logger = sammler();
  await attemptCancellationMailConfirm({
    store: mailStore(),
    mailer: {
      sendMail: () => {
        throw fehler;
      },
    },
    accounts: { accountByTenant: async () => ({ email: "k@kunde.de" }) },
    config: { server: { publicUrl: "https://sundartha.example" } },
    auditStore: { record: async () => {} },
    logger,
    tenantId: TENANT,
  });
  return logger.lines.join("\n");
}

test("h4a: Mail ohne Tarif nennt 'Ihr Tarif' als gekündigten Vertrag", () => {
  const { text } = buildCancellationMailText({
    planSlug: null,
    currentPeriodEnd: null,
    receivedAt: "2026-08-12T10:15:00.000Z",
    publicUrl: "https://sundartha.example",
  });
  assert.match(text, /Gekündigter Vertrag: Ihr Tarif\n/);
  assert.match(text, /dem Ende des laufenden Abrechnungszeitraums/);
});

test("h4a: Versandfehler mit Code loggt den Code, ohne Code den Namen, sonst 'error'", async () => {
  const mitCode = Object.assign(new Error("x"), { code: "EAUTH" });
  assert.match(await sendeMitFehler(mitCode), /Versand fehlgeschlagen tenant=t_h4a: EAUTH$/);
  assert.match(await sendeMitFehler(new TypeError("x")), /: TypeError$/);
  assert.match(await sendeMitFehler(Object.assign(new Error("x"), { code: "" })), /: Error$/);
  assert.match(await sendeMitFehler("nur Text"), /: error$/);
  assert.match(await sendeMitFehler(null), /: error$/);
  assert.match(await sendeMitFehler(Object.assign(new Error("x"), { code: 535 })), /: 535$/);
});

test("h4a: Aufräumfehler der Mail nennt die Meldung, bei geworfenem Text den Text", async () => {
  const logger = sammler();
  const store = {
    cancellationMailPending: () => {
      throw "kaputt";
    },
  };
  const ergebnis = await attemptCancellationMailConfirm({
    store,
    mailer: null,
    accounts: {},
    config: {},
    logger,
    tenantId: TENANT,
  });
  assert.equal(ergebnis, true);
  assert.match(logger.lines.join("\n"), /Aufraeumen fehlgeschlagen tenant=t_h4a: kaputt$/);
});

test("h4a: WorkOS-Löschfehler und Nummernfehler im Vertragsende nennen Meldung bzw. Text", async () => {
  const logger = sammler();
  const store = {
    tenantIdpSubject: () => {
      throw new Error("idp weg");
    },
    setContractEndCleanupPending: () => null,
  };
  const ergebnis = await attemptContractEndCleanup({ store, workos: null, logger, tenantId: TENANT });
  assert.deepEqual(ergebnis, { numberReleasePending: true, workosDeletePending: true });
  assert.match(logger.lines.join("\n"), /WorkOS-Schritt fehlgeschlagen tenant=t_h4a: idp weg$/);

  const logger2 = sammler();
  const store2 = {
    tenantIdpSubject: () => "sub_1",
    setContractEndCleanupPending: () => null,
  };
  await attemptContractEndCleanup({
    store: store2,
    workos: {
      deleteUser: () => {
        throw "workos kaputt";
      },
    },
    auditStore: { record: async () => {} },
    logger: logger2,
    tenantId: TENANT,
  });
  assert.match(logger2.lines.join("\n"), /WorkOS-Loeschung fehlgeschlagen tenant=t_h4a: workos kaputt$/);
});
