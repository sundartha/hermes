const { AssertionError } = process.getBuiltinModule("assert");
const KLASSEN = new Set(["AssertionError", "CallTracker", "Assert"]);
const attrappen = new Map();

function nachgebildet(echt) {
  const { name, length } = echt;
  const attrappe = {
    [name]: function () {
      throw new AssertionError({ message: `Testwirkung: ${name} wird absichtlich verfehlt` });
    },
  }[name];
  Object.defineProperty(attrappe, "length", { value: length });
  return attrappe;
}

function attrappeFuer(echt) {
  if (typeof echt !== "function") return echt;
  if (attrappen.has(echt)) return attrappen.get(echt);
  const attrappe = nachgebildet(echt);
  attrappen.set(echt, attrappe);
  for (const [name, wert] of Object.entries(echt)) attrappe[name] = KLASSEN.has(name) ? wert : attrappeFuer(wert);
  return attrappe;
}

export function attrappeVon(modul) {
  return attrappeFuer(process.getBuiltinModule(modul));
}
