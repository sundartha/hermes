// ---- P10b: HTTP-Oberflaeche des Hauptservers (Randpunkte II) ---------------------
// Drei Themen, EINE Datei (Muster: kleine, zusammengehoerende Spawn-/In-Process-Tests
// wie test/openai-e7-challenge.test.js):
// 1. GET /api/admin/deploy-info - der authentifizierte Ersatz fuer die aus /healthz
//    entfernte configHash-Preisgabe (Preimage-Befund).
// 2. GET /healthz - traegt keinen configHash mehr, Status/Pfad/commit unveraendert.
// 3. GET /.well-known/security.txt - RFC-9116-Sicherheitskontakt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { startServer, externalIp, ROOT } from "./helpers.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { makeDeployInfoRoutes, DEPLOY_INFO_PATH } from "../src/routes/api-deploy-info.js";
import { SECURITY_TXT_PATH, SECURITY_CONTACT } from "../src/app.js";
import { configFingerprint } from "../src/config-fingerprint.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const EXTERNAL_IP = externalIp();
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

// Die sieben configFingerprint-Achsen (src/config-fingerprint.js) MUESSEN gesetzt sein -
// withConfigNamespaces haengt nur Getter an, die auf DIESE flachen Schluessel zeigen; ein
// fehlender Wert liesse configFingerprint() mit TypeError abbrechen (z.B. .join() auf
// undefined). Werte beliebig, aber vollstaendig - Muster test/api-cost-drift.test.js.
const DEPLOY_INFO_CONFIG = withConfigNamespaces({
  deployedCommit: "p10b-test-commit",
  allowedCountryCodes: ["+49"],
  maxCallsPerHour: 20,
  budgetMonthEnabled: false,
  multiTenant: true,
  paymentCurrency: "eur",
  platformSpendCapCents: 3000,
  defaultTenantBudgetCents: 1500,
});

async function startDeployInfoApp() {
  const app = express();
  app.use(makeDeployInfoRoutes({ config: DEPLOY_INFO_CONFIG, operatorAuth: operatorAuthPassThrough() }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ---- 1a: deploy-info liefert genau {commit, configHash} hinter einer Admin-Sitzung -
test("P10b: deploy-info liefert genau {commit, configHash} hinter Admin-Sitzung", async () => {
  const app = await startDeployInfoApp();
  try {
    const res = await fetch(`${app.base}${DEPLOY_INFO_PATH}`);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["commit", "configHash"]);
    assert.equal(body.commit, "p10b-test-commit");
    assert.match(body.configHash, /^[a-f0-9]{64}$/);
    assert.equal(body.configHash, configFingerprint(DEPLOY_INFO_CONFIG));
  } finally {
    await app.close();
  }
});

// ---- 1b: ohne Admin-Sitzungs-Infra ist die Route gar nicht gemountet (404, Fail-Closed) -
test(
  "P10b: ohne Admin-Sitzungs-Infra ist deploy-info nicht gemountet (404)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      const res = await fetch(`${srv.externalUrl}${DEPLOY_INFO_PATH}`);
      assert.equal(res.status, HTTP_NOT_FOUND);
      const raw = await res.text();
      assert.ok(!raw.includes("configHash"), "configHash darf ohne Admin-Sitzung nicht auftauchen");
    } finally {
      await srv.stop();
    }
  },
);

// ---- 2: /healthz bleibt 200 und gibt keinen configHash mehr preis -----------------
test("P10b: /healthz bleibt 200 und gibt keinen configHash mehr preis", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.commit, "string");
    assert.equal("configHash" in body, false);
  } finally {
    await srv.stop();
  }
});

// ---- 3a: security.txt liefert 200 text/plain mit Contact und Expires --------------
test("P10b: security.txt liefert 200 text/plain mit Contact und Expires", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}${SECURITY_TXT_PATH}`);
    assert.equal(res.status, HTTP_OK);
    const contentType = res.headers.get("content-type");
    assert.ok(contentType.startsWith("text/plain"));
    assert.ok(contentType.includes("charset=utf-8"));
    const body = await res.text();
    assert.match(body, new RegExp(`^Contact: ${SECURITY_CONTACT}$`, "m"));
    const expiresMatch = body.match(/^Expires: (.+)$/m);
    assert.ok(expiresMatch, "Expires-Zeile fehlt");
    assert.ok(!Number.isNaN(Date.parse(expiresMatch[1])), "Expires ist kein gueltiges Datum");
    assert.match(expiresMatch[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "Expires ist nicht ISO-8601 mit Z");
    // Security-Header greifen auch auf der neuen Route (globale Middleware, s.
    // src/middleware.js securityHeaders, gemountet vor jeder Route).
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await srv.stop();
  }
});

// ---- 3b: der Kontakt ist die im Impressum veroeffentlichte Adresse (Drift-Waechter) -
test("P10b: security.txt-Kontakt ist die im Impressum veroeffentlichte Adresse", () => {
  const imprintPath = path.join(ROOT, "apps/web/src/data/legal/imprint.de.json");
  const imprint = fs.readFileSync(imprintPath, "utf8");
  const bareAddress = SECURITY_CONTACT.replace(/^mailto:/, "");
  assert.ok(
    imprint.includes(bareAddress),
    `Kontaktadresse '${bareAddress}' steht nicht (mehr) im Impressum - security.txt zeigt ` +
      "sonst auf eine tote Adresse.",
  );
});

// ---- 3c: POST auf security.txt wird nicht bedient (gemessener Bestandswert) -------
test("P10b: POST auf security.txt wird nicht bedient", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}${SECURITY_TXT_PATH}`, { method: "POST" });
    assert.notEqual(res.status, HTTP_OK);
  } finally {
    await srv.stop();
  }
});

