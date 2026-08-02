// AL-D3: lokaler Exa-Fake fuer die Conversation-Bench (Messapparat, KEIN Fix). KEIN Netz
// nach draussen, KEINE Kosten, deterministische Treffer: EXA_API_BASE des gespawnten
// Servers zeigt hierher. Antwortform nach der dokumentierten Exa-Suche
// (results[].title/url/highlights[]) - dieselbe Fixture-Form wie
// test/al-p10b-lookup.test.js#exaBody, damit Bench und Test nicht auseinanderlaufen.
// Muster telnyx-fake.mjs (lokaler node:http-Fake, Body lesen, Actions/Requests sammeln);
// readBody/JSON-Parsing kommt aus http-fake-helpers.mjs (G5: EINE Quelle statt Kopie).
import http from "node:http";
import { readJsonBody } from "./http-fake-helpers.mjs";

// Wegwerf-Key, NIE ein echtes Secret (Regel 4) - nur zur Kopplung Server<->Fake, das
// Szenario traegt ihn als eigenes EXA_API_KEY (statisch, sichtbar).
export const BENCH_EXA_API_KEY = "bench-exa-dummy-key";

const SEARCH_PATH = "/search";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

// {title, highlight} -> EIN Exa-Treffer (Muster test/al-p10b-lookup.test.js#exaBody).
// highlight optional: ohne Auszug bleibt highlights leer (deckt den filter(Boolean)-Zweig
// von factLineOf in src/research/adapters/exa-search.js, ohne ihn hier zu duplizieren).
function exaResultOf(fact, index) {
  return {
    id: `bench_res_${index}`,
    title: fact.title,
    url: "https://bench.example",
    highlights: fact.highlight ? [fact.highlight] : [],
  };
}

/**
 * Startet den Fake. Antwortet IMMER 200 mit den geseedeten facts - der Bench misst das
 * Werkzeug-VERHALTEN (R2/R3/R4), nicht die Fehlerpfade des Anbieters (die deckt bereits
 * test/al-p10b-lookup.test.js ab).
 *
 * @param {{facts: Array<{title: string, highlight?: string}>}} args
 * @returns {Promise<{url: string, requests: () => Array<{at: number, body: object}>,
 *   close: () => Promise<void>}>}
 */
export async function startExaFake({ facts }) {
  // NIE geloggt (die Query waere Modelltext) - nur fuer die Diagnose im Report.
  const requests = [];

  const server = http.createServer(async (req, res) => {
    if (req.url !== SEARCH_PATH) {
      res.writeHead(HTTP_NOT_FOUND, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown path" }));
      return;
    }
    const body = await readJsonBody(req);
    requests.push({ at: Date.now(), body });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify({ requestId: "bench_req", results: facts.map(exaResultOf) }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    requests: () => requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
