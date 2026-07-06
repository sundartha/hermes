import crypto from "node:crypto";

// PII-Audio-Serve-Seam (In-Memory, Port). Haelt vorab synthetisierte Agent-Saetze
// (Namen/Termine) unter einem kryptografisch unratbaren Token, kurz und EINMALIG:
// takeOnce loescht sofort, ein TTL-Timer loescht bei Nichtabruf. unref() haelt den
// Prozess nicht am Leben (sauberer Shutdown). Multi-Replica ist bewusst akzeptiertes
// Restrisiko (PLAN-SECURITY.md) - der Port ist spaeter gegen Objekt-Store/CDN
// tauschbar. Node ist single-threaded: Map-Zugriffe zwischen await-Punkten atomar (P16).
const TOKEN_BYTES = 32; // 256 bit Entropie, base64url = URL-sicher (kein Escaping noetig)

export function createTtsStore({ ttlMs }) {
  const entries = new Map();
  function put(bytes, contentType) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const timer = setTimeout(() => entries.delete(token), ttlMs);
    if (typeof timer.unref === "function") timer.unref();
    entries.set(token, { bytes, contentType, timer });
    return token;
  }
  function takeOnce(token) {
    const e = entries.get(token);
    if (!e) return null;
    entries.delete(token);
    clearTimeout(e.timer);
    return { bytes: e.bytes, contentType: e.contentType };
  }
  return { put, takeOnce };
}
