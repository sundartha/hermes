import { once } from "node:events";
import http from "node:http";

export async function starteAufzeichnendeAttrappe(antwortFuer) {
  const anfragen = [];
  const server = http.createServer(async (anfrage, antwort) => {
    let rumpf = "";
    for await (const stueck of anfrage) rumpf += stueck;
    anfragen.push({ pfad: anfrage.url, rumpf });
    const { status, koerper } = antwortFuer(anfrage.url);
    antwort.writeHead(status, { "content-type": "application/json" });
    antwort.end(JSON.stringify(koerper));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    anfragen,
    schliesse: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
