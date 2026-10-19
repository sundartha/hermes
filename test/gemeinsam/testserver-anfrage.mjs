import anfrageMitFrist from "./anfrage-mit-frist.mjs";

export default function request(method, url, { cookie, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const ziel = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const anfrage = anfrageMitFrist(
      { hostname: ziel.hostname, port: ziel.port, path: ziel.pathname + ziel.search, method, headers },
      (antwort) => {
        let text = "";
        antwort.on("data", (teil) => (text += teil));
        antwort.on("end", () =>
          resolve({
            status: antwort.statusCode,
            body: text,
            headers: antwort.headers,
            location: antwort.headers.location,
            cookies: antwort.headers["set-cookie"],
          }),
        );
      },
    );
    anfrage.on("error", reject);
    if (payload) anfrage.write(payload);
    anfrage.end();
  });
}
