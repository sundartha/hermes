import { once } from "node:events";
import http from "node:http";

const MODELL_HOST = "127.0.0.1";
const BELIEBIGER_PORT = 0;
const HTTP_OK = 200;
const ANTWORT_TEXT = "Guten Tag, hier ist der Assistent.";

const nachricht = () =>
  JSON.stringify({
    id: "msg_haltend",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: ANTWORT_TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  });

function antworte(res) {
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(nachricht());
}

export async function starteHaltendesModell() {
  let gesehen = 0;
  const festgehalten = [];
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      gesehen += 1;
      if (gesehen === 1) return festgehalten.push(res);
      return antworte(res);
    });
  });
  server.listen(BELIEBIGER_PORT, MODELL_HOST);
  await once(server, "listening");
  return {
    url: `http://${MODELL_HOST}:${server.address().port}`,
    count: () => gesehen,
    loslassen() {
      for (const res of festgehalten.splice(0)) antworte(res);
    },
    async close() {
      for (const res of festgehalten.splice(0)) antworte(res);
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
