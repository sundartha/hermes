import { testPrompt } from "./agenten.mjs";
import { abnahmeBefehl, hatSkript } from "./befehle.mjs";
import { aenderungenSeit, git } from "./git.mjs";

const SKRIPT = "test:mutation";
const EXIT_UEBERLEBT = 1;
const UEBERLEBT = /^Verstoß: Mutant überlebt: (.+)$/gm;
const GLEICHWERTIG = "Gleichwertig: ";

function treffer(text, muster) {
  return [...text.matchAll(muster)].map(([, wert]) => wert.trim());
}

function liste(mutanten) {
  return mutanten.map((mutant) => `- ${mutant}`).join("\n");
}

function gleichwertige(lauf) {
  return lauf.berichtszeilen.filter((zeile) => zeile.startsWith(GLEICHWERTIG)).map((zeile) => zeile.slice(GLEICHWERTIG.length));
}

function mutanten(lauf, name, argumente) {
  const gemeldet = gleichwertige(lauf).flatMap((mutant) => ["--gleichwertig", mutant]);
  const befehl = ["npm", "--silent", "run", SKRIPT, "--", ...argumente, ...gemeldet];
  const { exitCode, ausgabe } = lauf.pruefung(name, befehl);
  if (exitCode === 0) return { ende: true };
  if (exitCode !== EXIT_UEBERLEBT) return { ende: lauf.scheitert(`${name} ist mit Exit ${exitCode} abgebrochen.`) };
  return { ueberlebende: treffer(ausgabe, UEBERLEBT) };
}

function bauNachrunde(ueberlebende) {
  return [
    "## Überlebende Mutanten",
    "",
    "Diese Mutanten in deinen neuen Zeilen überleben, kein Test verlangt die Zeilen:",
    "",
    liste(ueberlebende),
    "",
    "Streiche oder vereinfache den Code, den kein Test verlangt. Tests änderst du nicht.",
    "",
  ].join("\n");
}

function testNachrunde({ phase, auftrag }, ueberlebende, stand) {
  const aufgabe = `Diese Mutanten ${stand} überleben. Ergänze in ${auftrag.abnahme} Fälle, die sie töten; Produktcode änderst du nicht.`;
  return [testPrompt(phase, auftrag), "## Überlebende Mutanten", "", aufgabe, "", liste(ueberlebende), ""].join("\n");
}

function bauKorrigiert(lauf, ueberlebende) {
  const { sitzung } = lauf.agenten.findLast(({ rolle }) => rolle === "bau");
  if (!lauf.agent("bau", bauNachrunde(ueberlebende), sitzung)) return false;
  const gemeldet = treffer(lauf.agenten.at(-1).antwort, /^Gleichwertig: (.+)$/gm);
  for (const mutant of gemeldet.filter((eintrag) => ueberlebende.includes(eintrag))) {
    lauf.berichtszeilen.push(`${GLEICHWERTIG}${mutant}`);
  }
  return lauf.bauSchritte().slice(1).every((schritt) => schritt());
}

function testErgaenzt(lauf, ueberlebende, stand) {
  if (!lauf.agent("test", testNachrunde(lauf.kontext, ueberlebende, stand))) return false;
  return lauf.grenzen("test", lauf.basisBau);
}

function testNachgeholt(lauf, ueberlebende) {
  return (
    lauf.zwischenstand() &&
    testErgaenzt(lauf, ueberlebende, "in den neuen Zeilen") &&
    lauf.allesVormerken() &&
    lauf.gruen("abnahme", abnahmeBefehl(lauf.kontext.auftrag))
  );
}

function neueZeilen(lauf) {
  const pruefen = (name) => mutanten(lauf, name, ["--basis", lauf.basis]);
  let stand = pruefen("mutation");
  if (stand.ende !== undefined) return stand.ende;
  if (!bauKorrigiert(lauf, stand.ueberlebende)) return false;
  stand = pruefen("mutation nach Bau");
  if (stand.ende !== undefined) return stand.ende;
  if (!testNachgeholt(lauf, stand.ueberlebende)) return false;
  stand = pruefen("mutation nach Test");
  return stand.ende ?? lauf.scheitert(`Mutant überlebt: ${stand.ueberlebende[0]}`);
}

function verwerfen(lauf, grund) {
  git(["reset", "-q", "--hard", lauf.basisBau], { cwd: lauf.kontext.root });
  git(["clean", "-q", "-fd"], { cwd: lauf.kontext.root });
  lauf.hinweise.push(grund);
}

function umbauNeu(lauf, ueberlebende, grund) {
  if (!testErgaenzt(lauf, ueberlebende, "auf dem alten Stand")) return false;
  if (aenderungenSeit(lauf.basisBau, lauf.kontext.root).length === 0) return lauf.scheitert(grund);
  const schritte = [() => lauf.vorherGruen(), () => lauf.zwischenstand(), ...lauf.bauSchritte()];
  return [...schritte, () => alterStand(lauf, true)].every((schritt) => schritt());
}

function alterStand(lauf, wiederholt = false) {
  if (lauf.kontext.auftrag.art !== "umbau") return true;
  const stand = mutanten(lauf, "mutation alter Stand", ["--basis", lauf.basisBau, "--alter-stand"]);
  if (stand.ende !== undefined) return stand.ende;
  const grund = `Umbau verworfen: auf dem alten Stand überlebt ${stand.ueberlebende[0]}`;
  verwerfen(lauf, grund);
  return wiederholt ? lauf.scheitert(grund) : umbauNeu(lauf, stand.ueberlebende, grund);
}

export function mutationsSchritte(lauf) {
  if (hatSkript(lauf.kontext.root, SKRIPT)) return [() => alterStand(lauf), () => neueZeilen(lauf)];
  lauf.hinweise.push(`Mutationsprüfung: package.json hat kein Skript ${SKRIPT}.`);
  return [];
}
