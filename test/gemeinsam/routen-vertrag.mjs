import test from "node:test";
import assert from "node:assert/strict";
import { startRouterApp } from "../operator-route-app.js";
import { abrufMitFrist } from "./antwortfrist.mjs";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const OWNER_TENANT = "owner";

const erlaubterMandant = { requireTenant: () => OWNER_TENANT };
const abgelehnterMandant = {
  requireTenant: (req, res) => {
    res.status(HTTP_FORBIDDEN).json({ error: "tenant" });
    return null;
  },
};

async function mitRoute({ baueRouter, pfad, tenant }, pruefung) {
  const audits = [];
  const router = baueRouter({ audit: (...args) => audits.push(args), tenant });
  const srv = await startRouterApp(router);
  try {
    const antwort = await abrufMitFrist(`${srv.base}${pfad}`, { method: "POST" });
    await pruefung(antwort, audits);
  } finally {
    await srv.close();
  }
}

export function pruefeRoutenVertrag(route) {
  test("Routenvertrag: der eigene Mandant bekommt eine Antwort und einen Audit-Eintrag", () =>
    mitRoute({ ...route, tenant: erlaubterMandant }, (antwort, audits) => {
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(audits.length, 1);
    }));

  test("Routenvertrag: ohne Mandanten bleibt die Antwort abgelehnt und ohne Audit-Eintrag", () =>
    mitRoute({ ...route, tenant: abgelehnterMandant }, (antwort, audits) => {
      assert.equal(antwort.status, HTTP_FORBIDDEN);
      assert.equal(audits.length, 0);
    }));
}
