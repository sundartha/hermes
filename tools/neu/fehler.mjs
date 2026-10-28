export const EXIT_VORHANDEN = 1;
export const EXIT_AUFRUF = 2;
export const EXIT_KARTE_FORMAT = 3;
export const EXIT_UNERWARTET = 4;

export class NeuFehler extends Error {
  constructor(exitCode, meldung) {
    super(meldung);
    this.exitCode = exitCode;
  }
}
