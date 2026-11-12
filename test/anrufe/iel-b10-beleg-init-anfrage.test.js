import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { HERMES_RENDER_SERVICE_ID, initWebhookUrl } from "../../src/elevenlabs/init-webhook-ziel.js";
import { RENDER_API_BASE } from "../../src/render-api.js";
import { anfrage } from "../../src/utils/anfrage.js";
import { runCli } from "../../scripts/iel-geheimnisse.mjs";

const RENDER_DIENST = `${RENDER_API_BASE}/services/${HERMES_RENDER_SERVICE_ID}`;
const INIT_HEADER = "x-hermes-init-token";
const TOKEN = "gelesenes-init-token-0123456789abcdef";
const RENDER_FRIST_MS = 5000;

function antwort(status, koerper) {
  const text = JSON.stringify(koerper);
  return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text, headers: { get: () => null } };
}

function renderAntwort(adresse) {
  const rest = adresse.slice(RENDER_DIENST.length);
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
      if (String(adresse) !== initWebhookUrl()) return renderAntwort(String(adresse));
      proben.push(optionen);
      return antwort(optionen.headers[INIT_HEADER] ? 404 : 403, {});
    };
    const zeilen = [];
    const kanal = { write: (text) => zeilen.push(text) };
    const render = (adresse, optionen = {}) => anfrage(adresse, { fristMs: RENDER_FRIST_MS, ...optionen });
    try {
      const code = await runCli({
        argv: ["beleg-init"],
        abh: {
          fetchImpl: (adresse, optionen) => (adresse === initWebhookUrl() ? anfrage(adresse, optionen) : render(adresse, optionen)),
          zufall: () => Buffer.alloc(1),
          stdout: kanal,
          stderr: kanal,
          renderApiKey: "render-test-schluessel",
          elKonto: { apiKey: "el-test", apiBase: "http://el.test", agentId: "agent_test" },
          ttsAusgabeformat: "mp3_44100_128",
        },
      });
      assert.equal(code, 0, zeilen.join(""));
    } finally {
      globalThis.fetch = echtesFetch;
    }
    assert.equal(proben.length, 2);
  });
});
