// IEL-B9: Kindprozess fuer "das Init-Ziel haengt nicht an PUBLIC_URL". Der Test startet
// diesen Harness mit einer eigenen Prozess-Env (PUBLIC_URL gesetzt) und einem Render-Szenario;
// das Kommando laeuft mit dieser Env, aber ohne Netz: fetch ist ein Router aus dem Speicher.
//
// Szenario (JSON in IEL_B9_RENDER_SZENARIO): { publicUrlStatus, publicUrl, serviceUrl, domains,
// settings }. Argumente fuer push-elevenlabs.mjs kommen als argv. Letzte stdout-Zeile:
// "IEL-B9-ERGEBNIS <json {code, aufrufe}>".
const SZENARIO_ENV = "IEL_B9_RENDER_SZENARIO";
export const ERGEBNIS_MARKE = "IEL-B9-ERGEBNIS";
const RENDER_BASIS = "https://api.render.com/v1/services/";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_OK_MAX = 299;
const ARG_START = 2;

const szenario = JSON.parse(process.env[SZENARIO_ENV] || "{}");
const aufrufe = [];

function renderAntwort(adresse) {
  if (adresse.includes("/env-vars/")) {
    return { status: szenario.publicUrlStatus, koerper: { key: "PUBLIC_URL", value: szenario.publicUrl } };
  }
  if (adresse.includes("/custom-domains")) return { status: HTTP_OK, koerper: szenario.domains };
  return { status: HTTP_OK, koerper: { serviceDetails: { url: szenario.serviceUrl } } };
}

function antworte(adresse) {
  if (adresse.startsWith(RENDER_BASIS)) return renderAntwort(adresse);
  if (adresse.includes("/v1/convai/settings")) return { status: HTTP_OK, koerper: szenario.settings };
  return { status: HTTP_NOT_FOUND, koerper: {} };
}

globalThis.fetch = async (adresse, optionen = {}) => {
  const text = String(adresse);
  aufrufe.push({ adresse: text, methode: optionen.method || "GET", koerper: optionen.body ?? null });
  const { status, koerper } = antworte(text);
  return {
    ok: status >= HTTP_OK && status <= HTTP_OK_MAX,
    status,
    text: async () => JSON.stringify(koerper),
    json: async () => structuredClone(koerper),
  };
};

const { runCli } = await import("../scripts/push-elevenlabs.mjs");
const code = await runCli(["node", "push-elevenlabs.mjs", ...process.argv.slice(ARG_START)]);
process.stdout.write(`${ERGEBNIS_MARKE} ${JSON.stringify({ code, aufrufe })}\n`);
