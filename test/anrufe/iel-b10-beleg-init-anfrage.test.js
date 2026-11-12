import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { runCli, standardAbhaengigkeiten } from "../../scripts/iel-geheimnisse.mjs";

const INIT_PFAD = "/webhooks/elevenlabs/init";
const INIT_HEADER = "x-hermes-init-token";
const TOKEN = "gelesenes-init-token-0123456789abcdef";

function antwort(status, koerper) {
  const text = JSON.stringify(koerper);
  return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text, headers: { get: () => null } };
}

function renderAntwort(adresse) {
  const rest = adresse.slice(adresse.indexOf("/services/")).replace(/^\/services\/[^/]+/, "");
  if (rest.startsWith("/env-vars/")) {
    const schluessel = decodeURIComponent(rest.slice("/env-vars/".length));
    const werte = { ELEVENLABS_INIT_WEBHOOK_TOKEN: TOKEN, PUBLIC_URL: "https://app.sundartha.com" };
    return werte[schluessel] === undefined ? antwort(404, {}) : antwort(200, { key: schluessel, value: werte[schluessel] });
  }
  if (rest.startsWith("/custom-domains")) {
    return antwort(200, [{ customDomain: { name: "app.sundartha.com", verificationStatus: "verified" } }]);
  }
  return antwort(200, { serviceDetails: { url: "https://vodafone-agent.onrender.com" } });
}

describe("beleg-init ueber den echten anfrage-Eingang", () => {
  it("meldet GRUEN, wenn der Init-Webhook 403 ohne und 404 mit Token antwortet", async () => {
    const proben = [];
    const echtesFetch = globalThis.fetch;
    globalThis.fetch = async (adresse, optionen = {}) => {
      if (!String(adresse).endsWith(INIT_PFAD)) return renderAntwort(String(adresse));
      proben.push(optionen);
      return antwort(optionen.headers[INIT_HEADER] ? 404 : 403, {});
    };
    const zeilen = [];
    const kanal = { write: (text) => zeilen.push(text) };
    try {
      const code = await runCli({
        argv: ["beleg-init"],
        abh: {
          ...standardAbhaengigkeiten(),
          stdout: kanal,
          stderr: kanal,
          renderApiKey: "render-test-schluessel",
        },
      });
      assert.equal(code, 0, zeilen.join(""));
    } finally {
      globalThis.fetch = echtesFetch;
    }
    assert.equal(proben.length, 2);
  });
});
