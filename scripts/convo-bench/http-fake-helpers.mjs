// Geteiltes Muster fuer die lokalen node:http-Fakes der Conversation-Bench
// (telnyx-fake.mjs, exa-fake.mjs): Request-Body einsammeln und tolerant als JSON
// parsen. G5/S2: eine Quelle statt Byte-fuer-Byte-Kopie in jedem Fake.

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

// Liest den Body und parst ihn tolerant als JSON - leerer/kaputter Body wird zu {},
// nie zu einem geworfenen Fehler (beide Fakes wollen bei jedem Request antworten
// koennen, auch bei leerem oder nicht-JSON-Body).
export async function readJsonBody(req) {
  const raw = await readBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
