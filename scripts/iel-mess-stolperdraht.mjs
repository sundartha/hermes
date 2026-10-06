export const TROCKENLAUF_SCHALTER = "--dry-run";
export const istTrockenlauf = process.argv.includes(TROCKENLAUF_SCHALTER);

const zaehlstand = { netzaufrufe: 0 };

if (istTrockenlauf) {
  globalThis.fetch = () => {
    zaehlstand.netzaufrufe += 1;
    throw new Error("Trockenlauf: fetch ist gesperrt");
  };
}

export function netzaufrufeImTrockenlauf() {
  return zaehlstand.netzaufrufe;
}
