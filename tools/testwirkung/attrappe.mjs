const { AssertionError } = process.getBuiltinModule("assert");
const KLASSEN = new Set(["AssertionError", "CallTracker", "Assert"]);
const IMMER = () => true;

function nachgebildet(echt, scheitert) {
  const { name, length } = echt;
  const attrappe = {
    [name]: function (...argumente) {
      if (!scheitert()) return Reflect.apply(echt, this, argumente);
      throw new AssertionError({ message: `Testwirkung: ${name} wird absichtlich verfehlt` });
    },
  }[name];
  Object.defineProperty(attrappe, "length", { value: length });
  return attrappe;
}

export function nachbau(scheitert) {
  const attrappen = new Map();
  const attrappeFuer = (echt) => {
    if (typeof echt !== "function") return echt;
    if (attrappen.has(echt)) return attrappen.get(echt);
    const attrappe = nachgebildet(echt, scheitert);
    attrappen.set(echt, attrappe);
    for (const [name, wert] of Object.entries(echt)) attrappe[name] = KLASSEN.has(name) ? wert : attrappeFuer(wert);
    return attrappe;
  };
  return (modul) => attrappeFuer(process.getBuiltinModule(modul));
}

export const attrappeVon = nachbau(IMMER);
