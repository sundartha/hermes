// Review-Fix P10 Achse (B) - Wiring: beweist, dass der Onboard-Pfad tatsaechlich die
// von setWorldDefaultLanguageEnabled() gesetzte DEFAULT_LANGUAGE liest (unbekanntes
// Land -> DEFAULT_LANGUAGE, wie WORLD-01). AUSGELAGERT aus
// test/p10-world-default-language-switch.test.js (AUTH-P6-Migration): diese Datei
// MUSS src/config.js transitiv laden (In-Process-Mount von makeOnboardRoutes braucht
// withConfigNamespaces) - Achse (A) in der anderen Datei darf das NICHT (ihre Praemisse
// ist gerade, dass state-ops/locales config-frei importierbar bleiben, s. dortiger
// Kopfkommentar). Getrennte Dateien halten die zwei Praemissen auseinander (G5: keine
// gemeinsame Datei mit widerspruechlichen Importvoraussetzungen).
//
// AUTH-P6: /api/onboard ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet) - ein echter Spawn-Server (json/kein SESSION_SECRET) mountet
// sie darum gar nicht mehr. Migriert auf In-Process-Mount von makeOnboardRoutes (Muster
// f1-geo-onboard.test.js). Der vormalige Env-Schalter WORLD_DEFAULT_LANGUAGE_ENABLED
// wird direkt ueber setWorldDefaultLanguageEnabled gesetzt (dieselbe Funktion, die
// config.js beim Boot aufruft) statt ueber einen Spawn-Env.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
import { makeOnboardRoutes } from "../src/routes/api-onboard.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState } from "../src/store/state-ops.js";

async function startOnboardApp() {
  const state = makeDefaultState();
  const app = express();
  app.use(express.json());
  app.use(
    makeOnboardRoutes({
      store: {
        load: () => state,
        save: () => {},
        withStoreLock: (fn) => Promise.resolve().then(fn),
        resolveTenant: () => null,
      },
      config: withConfigNamespaces({
        maxNumbers: 5,
        maxNumbersPerTenant: 1,
        provisioningEnabled: false,
        provisioningCountry: "DE",
        forceNumberCountry: "",
        geoEnabled: false,
        defaultTenantBudgetCents: 0,
      }),
      audit: () => {},
      provisioning: {
        queueProvisioning: async () => ({ ok: true, jobId: "job_test1" }),
        runProvisioningDrainExclusive: async () => {},
      },
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const postJson = (app, body) =>
  fetch(`${app.base}/api/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Analog zu f1-geo-onboard.test.js (GB->en), aber mit einem Land OHNE eigenes Bundle
// (ES) - das ist genau der Weltdefault-Pfad (WORLD-01), den der Schalter steuert.
test("WORLD_DEFAULT_LANGUAGE_ENABLED=true (Default): Onboard mit country=ES -> language=en", async () => {
  setWorldDefaultLanguageEnabled(true);
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_es_on", country: "ES" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.language, "en");
  } finally {
    await app.close();
  }
});

test("WORLD_DEFAULT_LANGUAGE_ENABLED=false: Onboard mit country=ES -> language=de (Rueckflip ohne Deploy)", async () => {
  setWorldDefaultLanguageEnabled(false);
  const app = await startOnboardApp();
  try {
    const res = await postJson(app, { tenantId: "t_es_off", country: "ES" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.language, "de", "Schalter aus -> Vor-Flip-Verhalten, kein Deploy noetig");
  } finally {
    setWorldDefaultLanguageEnabled(true); // Byte-identisch fuer nachfolgende Tests (F.I.R.S.T.)
    await app.close();
  }
});
