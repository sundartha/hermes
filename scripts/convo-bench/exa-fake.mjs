import http from "node:http";
import { readJsonBody } from "./http-fake-helpers.mjs";

export const BENCH_EXA_API_KEY = "bench-exa-dummy-key";

const SEARCH_PATH = "/search";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function exaResultOf(fact, index) {
  return {
    id: `bench_res_${index}`,
    title: fact.title,
    url: "https://bench.example",
    highlights: fact.highlight ? [fact.highlight] : [],
  };
}

export async function startExaFake({ facts }) {
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
