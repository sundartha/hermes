import crypto from "node:crypto";

const TOKEN_BYTES = 32;

export function createTtsStore({ ttlMs }) {
  const entries = new Map();

  function put(audio, { bisFreigabe = false, ttlMs: eigeneTtlMs = ttlMs } = {}) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const timer = setTimeout(() => entries.delete(token), eigeneTtlMs);
    if (typeof timer.unref === "function") timer.unref();
    entries.set(token, { audio, timer, bisFreigabe });
    return token;
  }

  function release(token) {
    const eintrag = entries.get(token);
    if (!eintrag) return;
    entries.delete(token);
    clearTimeout(eintrag.timer);
  }

  async function takeOnce(token) {
    const e = entries.get(token);
    if (!e) return null;
    if (!e.bisFreigabe) release(token);
    return { bytes: await e.audio.bytes, contentType: e.audio.contentType };
  }

  return { put, takeOnce, release };
}
