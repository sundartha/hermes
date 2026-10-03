import http from "node:http";

const ATTRAPPE_STATUS = 503;
const ATTRAPPE_KOERPER = JSON.stringify({
  type: "error",
  error: { type: "authentication_error", message: "invalid x-api-key" },
  request_id: "req_attrappe",
});

export async function starteAnthropicAttrappe() {
  const zaehler = { anfragen: 0 };
  const server = http.createServer((anfrage, antwort) => {
    zaehler.anfragen += 1;
    anfrage.resume();
    antwort.writeHead(ATTRAPPE_STATUS, { "content-type": "application/json" });
    antwort.end(ATTRAPPE_KOERPER);
  });
  server.on("connection", (verbindung) => verbindung.unref());
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  server.unref();
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, anfragen: () => zaehler.anfragen };
}
