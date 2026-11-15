import crypto from "node:crypto";

const TOKEN_BYTES = 32;

interface TtsAudio {
  bytes: PromiseLike<Uint8Array> | Uint8Array;
  contentType: string;
}

interface TtsAblage {
  ablegen: (token: string, audio: TtsAudio) => Promise<unknown>;
  holen: (token: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

interface TtsStoreOptionen {
  ttlMs: number;
  ablage?: TtsAblage | null;
}

interface TtsEintrag {
  audio: TtsAudio;
  timer: NodeJS.Timeout;
  bisFreigabe: boolean;
}

interface TtsPutOptionen {
  bisFreigabe?: boolean;
  ttlMs?: number;
}

interface TtsStore {
  put: (audio: TtsAudio, optionen?: TtsPutOptionen) => string | Promise<string>;
  takeOnce: (token: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
  release: (token: string) => void;
}

export function createTtsStore({ ttlMs, ablage = null }: TtsStoreOptionen): TtsStore {
  const entries = new Map<string, TtsEintrag>();

  function put(audio: TtsAudio, { bisFreigabe = false, ttlMs: eigeneTtlMs = ttlMs }: TtsPutOptionen = {}): string | Promise<string> {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    if (ablage && !bisFreigabe) return ablage.ablegen(token, audio).then(() => token);
    const timer = setTimeout(() => entries.delete(token), eigeneTtlMs);
    if (typeof timer.unref === "function") timer.unref();
    entries.set(token, { audio, timer, bisFreigabe });
    return token;
  }

  function release(token: string): void {
    const eintrag = entries.get(token);
    if (!eintrag) return;
    entries.delete(token);
    clearTimeout(eintrag.timer);
  }

  async function takeOnce(token: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const e = entries.get(token);
    if (!e) return ablage ? ablage.holen(token) : null;
    if (!e.bisFreigabe) release(token);
    return { bytes: await e.audio.bytes, contentType: e.audio.contentType };
  }

  return { put, takeOnce, release };
}
