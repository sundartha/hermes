import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { env } from "node:process";

import { block, startDirectory, withoutGitVariables } from "./lib.mjs";
import { TESTDATEI, rolle, schreibziel } from "./rolle.mjs";

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NUL = "\0";

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

function imRepo(relativ) {
  return !relativ.startsWith("../") && !isAbsolute(relativ);
}

function gitAusgabe(args, cwd) {
  const lauf = spawnSync("git", args, { cwd, encoding: "utf8", env: withoutGitVariables(env) });
  return lauf.status === 0 ? lauf.stdout : null;
}

function verwechselbar(pfad, anderer) {
  const [eins, zwei] = [pfad.normalize("NFC"), anderer.normalize("NFC")];
  return eins.toLowerCase() === zwei.toLowerCase() || eins.toUpperCase() === zwei.toUpperCase();
}

function inhaltAnDerAuftragsbasis({ input, absolut, relativ }) {
  const basis = env.HERMES_AUFTRAGSBASIS ?? "";
  if (!COMMIT.test(basis) || !imRepo(relativ)) return null;
  const cwd = startDirectory(input);
  const dateien = gitAusgabe(["ls-tree", "-r", "-z", "--full-tree", "--name-only", basis], cwd);
  if (dateien === null) return null;
  const aehnliche = dateien.split(NUL).filter((datei) => verwechselbar(datei, relativ));
  if (aehnliche.length === 0) return statSync(absolut).nlink > 1 ? null : "";
  return aehnliche.length === 1 && aehnliche[0] === relativ ? gitAusgabe(["cat-file", "blob", `${basis}:${relativ}`], cwd) : null;
}

function haengtNurAn(ziel) {
  const vorher = readFileSync(ziel.absolut, "utf8");
  const nachher = inhaltNachher(vorher, ziel.input);
  const bisher = inhaltAnDerAuftragsbasis(ziel) ?? vorher;
  return typeof nachher === "string" && nachher.startsWith(bisher);
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
  return imRepo(relativ) && geplanteTests().includes(relativ);
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
  if (geschuetzt && !haengtNurAn(ziel)) {
    block("hooks/nur-anhaengen", [
      `An bestehende Testdateien wird nur angehängt: ${ziel.relativ}`,
      "Der bisherige Inhalt bleibt unverändert am Anfang stehen.",
      "Bisher heißt: Stand an der Auftragsbasis; Zeilen, die derselbe Auftrag danach angehängt hat, darf der Test-Agent ändern. Ohne bestimmbare Basis gilt der Arbeitsstand.",
      "Bestehende Zeilen ändert der Test-Agent nur in den Testdateien, die der Auftrag in erwarteteDateien nennt.",
    ]);
  }
}

main();
