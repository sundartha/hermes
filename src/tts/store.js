import crypto from "node:crypto";

// PII-Audio-Serve-Seam (In-Memory, Port). Haelt vorab synthetisierte Agent-Saetze
// (Namen/Termine) unter einem kryptografisch unratbaren Token, kurz und EINMALIG:
// takeOnce loescht sofort, ein TTL-Timer loescht bei Nichtabruf. unref() haelt den
// Prozess nicht am Leben (sauberer Shutdown). Multi-Replica ist bewusst akzeptiertes
// Restrisiko (PLAN-SECURITY.md) - der Port ist spaeter gegen Objekt-Store/CDN
// tauschbar. Node ist single-threaded: Map-Zugriffe zwischen await-Punkten atomar (P16).
//
// IE7: eine Ablage haelt ein VERSPRECHEN auf die Bytes, nicht die Bytes selbst - fertige
// Bytes sind nur der schon aufgeloeste Sonderfall. So kennt takeOnce genau EINE
// Entry-Form, und die Webhook-Antwort haengt nicht mehr an der fertigen Datei.
const TOKEN_BYTES = 32; // 256 bit Entropie, base64url = URL-sicher (kein Escaping noetig)

export function createTtsStore({ ttlMs }) {
  const entries = new Map();

  /**
   * Legt eine Audio-Ausgabe unter einem frischen Token ab.
   * @param {{contentType: string, bytes: Promise<Buffer>}} audio `bytes` darf noch
   *   laufen (IE7: der Webhook antwortet, bevor die Synthese fertig ist) und MUSS
   *   aufloesen - eine Ablehnung oder ein leerer Puffer waere ein <Play> ins Leere,
   *   also Stille. src/tts/synth.js#synthesizeSpeechStream garantiert beides.
   * @returns {string} Token
   */
  function put(audio) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const timer = setTimeout(() => entries.delete(token), ttlMs);
    if (typeof timer.unref === "function") timer.unref();
    entries.set(token, { audio, timer });
    return token;
  }

  /**
   * Holt die Ausgabe GENAU EINMAL - und wartet dabei ab, was noch laeuft. Das Warten
   * liegt seit IE7 HIER (beim Provider-Abruf) statt im Webhook; begrenzt ist es durch
   * die Gesamtfrist der Synthese, nicht durch diesen Store.
   * @param {string} token
   * @returns {Promise<{bytes: Buffer, contentType: string}|null>}
   */
  async function takeOnce(token) {
    const e = entries.get(token);
    if (!e) return null;
    entries.delete(token);
    clearTimeout(e.timer);
    return { bytes: await e.audio.bytes, contentType: e.audio.contentType };
  }

  return { put, takeOnce };
}
