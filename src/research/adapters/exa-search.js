import { config } from "../../config.js";
import { LOOKUP_MAX_FACTS } from "../lookup-guard.js";
import { anfrage } from "../../utils/anfrage.js";

const SEARCH_PATH = "/search";

const SEARCH_TYPE = "auto";
const ABBRUCH_NAMEN = new Set(["AbortError", "TimeoutError"]);

function factLineOf(result) {
  return [result?.title, result?.highlights?.[0]].filter(Boolean).join(": ");
}

export const exaSearch = {
  async searchFacts({ query, timeoutMs }) {
    try {
      const res = await anfrage(`${config.research.exaApiBase}${SEARCH_PATH}`, {
        method: "POST",
        headers: {
          "x-api-key": config.research.exaApiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          query,
          type: SEARCH_TYPE,
          numResults: LOOKUP_MAX_FACTS,
          contents: { highlights: true },
        }),
        fristMs: timeoutMs,
      });
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      const body = await res.json();
      return { ok: true, facts: (body?.results ?? []).map(factLineOf).filter(Boolean) };
    } catch (err) {
      return { ok: false, reason: err && ABBRUCH_NAMEN.has(err.name) ? "timeout" : "error" };
    }
  },
};
