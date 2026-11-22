interface TtsAudio {
  bytes: PromiseLike<Uint8Array> | Uint8Array;
  contentType: string;
}

interface TtsAbruf {
  bytes: Uint8Array;
  contentType: string;
}

interface RohAblage {
  ablegen: (schluessel: string, audio: TtsAudio, optionen: { ttlMs: number }) => Promise<unknown>;
  lesen: (schluessel: string) => Promise<TtsAbruf | null>;
  freigeben: (schluessel: string) => Promise<unknown>;
}

const SCHLUESSEL_VORSATZ = "bis-freigabe:";

const schluesselVon = (token: string): string => `${SCHLUESSEL_VORSATZ}${token}`;

export function makeAblageBisFreigabe(ablage: RohAblage): RohAblage {
  return {
    ablegen: (token, audio, optionen) => ablage.ablegen(schluesselVon(token), audio, optionen),
    lesen: (token) => ablage.lesen(schluesselVon(token)),
    freigeben: (token) => ablage.freigeben(schluesselVon(token)),
  };
}
