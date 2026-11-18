export interface Ablehnung {
  status: number;
  body: { error: string };
  audit: { event: string; grund: string; detail: string };
}

export interface Tor<K> {
  name: string;
  run: (ctx: K) => Promise<Ablehnung | null | undefined> | Ablehnung | null | undefined;
}

export type BeiTorFehler<K> = (tor: Tor<K>, ctx: K, fehler: unknown) => Ablehnung;

const SCHLUESSEL: unique symbol = Symbol("gates-bestanden");

let ausstellen: () => GatesBestanden;

export class GatesBestanden {
  readonly #nachweis: boolean;

  private constructor(schluessel: typeof SCHLUESSEL) {
    if (schluessel !== SCHLUESSEL) throw new TypeError("GatesBestanden wird nur von fuehreToreAus ausgestellt");
    this.#nachweis = true;
  }

  static {
    ausstellen = () => new GatesBestanden(SCHLUESSEL);
  }

  get gilt(): boolean {
    return this.#nachweis;
  }
}

export async function fuehreToreAus<K>(
  tore: readonly Tor<K>[],
  ctx: K,
  beiTorFehler: BeiTorFehler<K>,
): Promise<Ablehnung | GatesBestanden> {
  for (const tor of tore) {
    let ablehnung: Ablehnung | null | undefined;
    try {
      ablehnung = await tor.run(ctx);
    } catch (fehler) {
      return beiTorFehler(tor, ctx, fehler);
    }
    if (ablehnung) return ablehnung;
  }
  return ausstellen();
}
