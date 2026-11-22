import crypto from "node:crypto";

const TOKEN_BYTES = 32;

interface TtsAudio {
  bytes: PromiseLike<Uint8Array> | Uint8Array;
  contentType: string;
}

interface TtsAbruf {
  bytes: Uint8Array;
  contentType: string;
}

interface TtsAblage {
  ablegen: (token: string, audio: TtsAudio) => Promise<unknown>;
  holen: (token: string) => Promise<TtsAbruf | null>;
}

interface TtsAblageBisFreigabe {
  ablegen: (token: string, audio: TtsAudio, optionen: { ttlMs: number }) => Promise<unknown>;
  lesen: (token: string) => Promise<TtsAbruf | null>;
  freigeben: (token: string) => Promise<unknown>;
}

interface TtsStoreOptionen {
  ttlMs: number;
  ablage?: TtsAblage | null;
  bisFreigabeAblage?: TtsAblageBisFreigabe | null;
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
  takeOnce: (token: string) => Promise<TtsAbruf | null>;
  release: (token: string) => void;
}

function meldeAblageFehler(fehler: unknown): void {
  console.error("[tts-store] Vorspann-Audio nicht in der Ablage:", fehler instanceof Error ? fehler.message : fehler);
}

export function createTtsStore({ ttlMs, ablage = null, bisFreigabeAblage = null }: TtsStoreOptionen): TtsStore {
  const entries = new Map<string, TtsEintrag>();

  function put(audio: TtsAudio, { bisFreigabe = false, ttlMs: eigeneTtlMs = ttlMs }: TtsPutOptionen = {}): string | Promise<string> {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    if (ablage && !bisFreigabe) return ablage.ablegen(token, audio).then(() => token);
    const timer = setTimeout(() => entries.delete(token), eigeneTtlMs);
    if (typeof timer.unref === "function") timer.unref();
    entries.set(token, { audio, timer, bisFreigabe });
    if (!bisFreigabeAblage || !bisFreigabe) return token;
    return bisFreigabeAblage.ablegen(token, audio, { ttlMs: eigeneTtlMs }).then(
      () => token,
      (fehler: unknown) => {
        meldeAblageFehler(fehler);
        return token;
      },
    );
  }

  function release(token: string): void {
    bisFreigabeAblage?.freigeben(token).catch(meldeAblageFehler);
    const eintrag = entries.get(token);
    if (!eintrag) return;
    entries.delete(token);
    clearTimeout(eintrag.timer);
  }

  async function takeOnce(token: string): Promise<TtsAbruf | null> {
    const e = entries.get(token);
    if (!e) return (ablage ? await ablage.holen(token) : null) ?? (bisFreigabeAblage ? await bisFreigabeAblage.lesen(token) : null);
    if (!e.bisFreigabe) release(token);
    return { bytes: await e.audio.bytes, contentType: e.audio.contentType };
  }

  return { put, takeOnce, release };
}
