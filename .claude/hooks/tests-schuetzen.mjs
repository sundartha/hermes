import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { env } from "node:process";

import { block } from "./lib.mjs";
import { TESTDATEI, rolle, schreibziel } from "./rolle.mjs";

function ersetzt(text, { old_string: alt, new_string: neu, replace_all: alle }) {
  if (typeof alt !== "string" || typeof neu !== "string") return null;
  return alle ? text.split(alt).join(neu) : text.replace(alt, () => neu);
}

function inhaltNachher(vorher, { tool_name: werkzeug, tool_input: eingabe }) {
  if (werkzeug === "Write") return typeof eingabe.content === "string" ? eingabe.content : null;
  const aenderungen = werkzeug === "MultiEdit" ? eingabe.edits : [eingabe];
  if (!Array.isArray(aenderungen)) return null;
  return aenderungen.reduce(
    (text, aenderung) => (text === null ? null : ersetzt(text, aenderung)),
    vorher,
  );
}

function haengtNurAn(absolut, input) {
  const vorher = readFileSync(absolut, "utf8");
  const nachher = inhaltNachher(vorher, input);
  return typeof nachher === "string" && nachher.startsWith(vorher);
}

function geplanteTests() {
  try {
    const liste = JSON.parse(env.HERMES_ERWARTET ?? "");
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

function istGeplant(relativ) {
  return !relativ.startsWith("../") && !isAbsolute(relativ) && geplanteTests().includes(relativ);
}

function main() {
  const ziel = schreibziel();
  if (ziel === null) return;
  const name = rolle();
  const istTest = TESTDATEI.test(ziel.relativ);
  if (name === "bau" && istTest) {
    block("hooks/bau-aendert-keine-tests", [
      `Bau-Agenten ändern keine Tests: ${ziel.relativ}`,
      "Hältst du den Test für falsch, brich ab und nenne den Grund.",
    ]);
  }
  if (name === "test" && !istTest) block("hooks/test-aendert-keinen-produktcode", [`Test-Agenten ändern keinen Produktcode: ${ziel.relativ}`]);
  const geschuetzt = name === "test" && existsSync(ziel.absolut) && !istGeplant(ziel.relativ);
  if (geschuetzt && !haengtNurAn(ziel.absolut, ziel.input)) {
    block("hooks/nur-anhaengen", [
      `An bestehende Testdateien wird nur angehängt: ${ziel.relativ}`,
      "Der bisherige Inhalt bleibt unverändert am Anfang stehen.",
      "Bestehende Zeilen ändert der Test-Agent nur in den Testdateien, die der Auftrag in erwarteteDateien nennt.",
    ]);
  }
}

main();
