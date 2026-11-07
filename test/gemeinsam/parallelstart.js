import { startServer } from "../helpers.js";
import { gemeinsameUmgebung } from "./zwei-prozesse.js";

export async function parallelStarten(t, adresse, umgebungen) {
  const gestartet = [];
  t.after(() => Promise.all(gestartet.map((prozess) => prozess.stop())));
  const versuche = umgebungen.map((env) =>
    startServer({ env: gemeinsameUmgebung(adresse, env) }).then((prozess) => {
      gestartet.push(prozess);
      return prozess;
    }),
  );
  const ergebnisse = await Promise.allSettled(versuche);
  return ergebnisse.map((ergebnis) =>
    ergebnis.status === "fulfilled"
      ? { prozess: ergebnis.value, lief: true, ausgabe: () => ergebnis.value.stdout }
      : { prozess: null, lief: false, ausgabe: () => ergebnis.reason.message },
  );
}
