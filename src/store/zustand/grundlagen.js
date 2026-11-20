const ID_RADIX = 36;
const ID_RANDOM_START = 2;
const ID_RANDOM_END = 6;

let letzteMillisekunde = 0;
let vergebeneIds = new Set();

export function newId(prefix) {
  const jetzt = Date.now();
  if (jetzt !== letzteMillisekunde) {
    letzteMillisekunde = jetzt;
    vergebeneIds = new Set();
  }
  const basis =
    prefix +
    "_" +
    jetzt.toString(ID_RADIX) +
    Math.random().toString(ID_RADIX).slice(ID_RANDOM_START, ID_RANDOM_END);
  let id = basis;
  for (let zaehler = 0; vergebeneIds.has(id); zaehler++) id = basis + zaehler.toString(ID_RADIX);
  vergebeneIds.add(id);
  return id;
}

export { tenantsOf, getCall } from "./grundzugriffe.ts";
