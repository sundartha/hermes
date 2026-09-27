// ---- makeDeployInfoRoutes (OpenAI-P10b, Ersatz-Haelfte fuer die /healthz-Kuerzung) -
// GET /api/admin/deploy-info ist der authentifizierte Nachfolger fuer den Teil der
// GAP-36-Deploy-Wahrheit, der NICHT mehr oeffentlich sein darf: configHash. Grund
// (Preimage-Befund): der Hash liegt ueber sieben niedrig-entropischen Betriebsachsen und
// wurde live aus 9216 Kandidaten eindeutig zurueckgerechnet (PLAN-SECURITY.md, Abschnitt
// "OpenAI-P10b", Punkt 1) - er ist damit KEIN Einweg-Schutz fuer diese Achsen, sondern
// gibt sie effektiv im Klartext preis. Deshalb
// verlaesst er /healthz (src/app.js) und lebt nur noch hier, hinter einer echten
// Admin-Sitzung, plus im Boot-Log (src/boot.js) als zweite, bereits bestehende Quelle.
//
// AUTH-P6-Muster: Registrierung ausschliesslich ueber operatorRoutes (DI wie
// makeOnboardRoutes/makeBillingRoutes) - fail-closed by construction: ohne
// operatorAuth (webAuthMw+adminMw, entsteht nur im Web-Login-Block,
// src/wiring/web-login.js) wird die Route GAR NICHT gemountet (404 statt offen).
// KEINE Wrapper-Arrow um die Middlewares (Invariante src/route-policy.js:31-35) - sonst
// waere die Auth-Kette im Express-Stack "<anonymous>" und fuer
// test/route-auth-inventory.test.js unsichtbar.
//
// Cache-Control: no-store kommt automatisch aus src/middleware.js (Praefix /api/) -
// hier nichts zusaetzlich setzen (G5, eine Quelle statt einer zweiten Kopie).
//
// KEIN Eintrag in src/route-policy.js PUBLIC_ROUTES: die Route ist Klasse AUTH (webAuth+
// adminOnly in der Handler-Kette), kein oeffentlicher Pfad. Sie steht stattdessen im
// ROUTE_FINGERPRINT und in OPERATOR_ROUTE_KEYS von test/route-auth-inventory.test.js
// sowie in der Erwartungstabelle von scripts/probe-auth.sh (Zuordnung, kein zweites Gate).
import { Router } from "express";
import { configFingerprint } from "../config-fingerprint.js";
import { operatorRoutes } from "../wiring/operator-routes.js";

// Benannte Konstante (G25): Test und Doku nutzen denselben Pfad statt ihn zu wiederholen.
export const DEPLOY_INFO_PATH = "/api/admin/deploy-info";

// deps: { config, operatorAuth }. config ist das globale Config-Objekt (deployedCommit
// + die sieben configFingerprint-Achsen). operatorAuth traegt { webAuthMw, adminMw } -
// null, wenn die Admin-Sitzungs-Infra nicht verfuegbar ist (dann NICHT gemountet).
export function makeDeployInfoRoutes({ config, operatorAuth }) {
  const router = Router();
  const operator = operatorRoutes({ router, operatorAuth });

  operator.get(DEPLOY_INFO_PATH, (_req, res) => {
    res.json({ commit: config.server.deployedCommit, configHash: configFingerprint(config) });
  });

  return router;
}
