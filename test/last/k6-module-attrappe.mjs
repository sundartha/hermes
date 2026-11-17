const MODULE = {
  "k6/http": "export default { request: (m, u, k, o) => globalThis.__k6.antwort(m, u, k, o), expectedStatuses: () => undefined };",
  "k6/execution": "export default globalThis.__k6.exec;",
  k6: "export const sleep = () => undefined;",
  "k6/metrics":
    "export class Counter { constructor(n) { this.n = n; } add(w) { globalThis.__k6.zaehler.push([this.n, w]); } } export class Trend { add() {} }",
};

export async function resolve(spezifizierer, kontext, weiter) {
  if (Object.hasOwn(MODULE, spezifizierer)) {
    return { url: `data:text/javascript,${encodeURIComponent(MODULE[spezifizierer])}`, shortCircuit: true };
  }
  return weiter(spezifizierer, kontext);
}
