import crypto from "node:crypto";

const TOKEN_BYTES = 32;

export function createTtsStore({ ttlMs }) {
  const entries = new Map();

  function put(audio) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const timer = setTimeout(() => entries.delete(token), ttlMs);
    if (typeof timer.unref === "function") timer.unref();
    entries.set(token, { audio, timer });
    return token;
  }

  async function takeOnce(token) {
    const e = entries.get(token);
    if (!e) return null;
    entries.delete(token);
    clearTimeout(e.timer);
    return { bytes: await e.audio.bytes, contentType: e.audio.contentType };
  }

  return { put, takeOnce };
}
