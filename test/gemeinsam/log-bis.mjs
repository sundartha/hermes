import { fristSignal } from "./antwortfrist.mjs";

export function logBis(instanz, text, { ab = 0, signal = fristSignal() } = {}) {
  const strome = [instanz.child.stdout, instanz.child.stderr];
  return new Promise((resolve, reject) => {
    const lies = () => instanz.stdout.slice(ab);
    const aufraeumen = () => {
      for (const strom of strome) strom.off("data", pruefe);
      signal.removeEventListener("abort", beiFrist);
    };
    function pruefe() {
      if (!lies().includes(text)) return;
      aufraeumen();
      resolve();
    }
    function beiFrist() {
      aufraeumen();
      reject(new Error(`Logzeile nicht erschienen: ${text}\n${lies()}`));
    }
    for (const strom of strome) strom.on("data", pruefe);
    signal.addEventListener("abort", beiFrist);
    if (signal.aborted) return beiFrist();
    pruefe();
  });
}
