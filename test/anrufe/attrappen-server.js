import http from "node:http";

const HTTP_OK = 200;

export function starteAttrappe(behandeln) {
  const server = http.createServer(behandeln);
  return new Promise((bereit) => {
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const { port } = server.address();
      bereit({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((geschlossen) => server.close(geschlossen)),
      });
    });
  });
}

export function starteJsonAttrappe(antwort, status = HTTP_OK) {
  return starteAttrappe((anfrage, antwortStrom) => {
    anfrage.resume();
    anfrage.on("end", () => {
      antwortStrom.writeHead(status, { "content-type": "application/json" });
      antwortStrom.end(JSON.stringify(typeof antwort === "function" ? antwort() : antwort));
    });
  });
}
