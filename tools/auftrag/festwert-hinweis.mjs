import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { bereichSchluessel } from "./format.mjs";

const MIGRATIONEN = "src/db/migrations/";
const TEST_ORDNER = "test";
const WERKZEUG_TESTS = "test/werkzeuge/";
const TESTENDUNGEN = new Set([".js", ".mjs", ".cjs", ".ts"]);
const POLICY_TEXT = "tenant_isolation";
const HINWEIS = "Festwert-Test: prüfen, ob er mit der neuen Migration angepasst werden muss; sonst im Entwurf „bleibt unverändert grün“ vermerken";

function migrationsnamen(root) {
  const ordner = join(root, MIGRATIONEN);
  return existsSync(ordner) ? readdirSync(ordner).map((datei) => basename(datei, extname(datei))) : [];
}

function testdateien(root) {
  const ordner = join(root, TEST_ORDNER);
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner, { recursive: true })
    .map((pfad) => `${TEST_ORDNER}/${pfad.split("\\").join("/")}`)
    .filter((pfad) => TESTENDUNGEN.has(extname(pfad)) && !pfad.startsWith(WERKZEUG_TESTS));
}

function legtMigrationAn(auftrag, root) {
  return auftrag.erwarteteDateien.some((pfad) => pfad.startsWith(MIGRATIONEN) && !existsSync(join(root, pfad)));
}

function nenntFestwert(text, suchtexte) {
  return suchtexte.some((suchtext) => text.includes(suchtext));
}

function istGenannt(pfad, auftrag, entwurf) {
  const text = entwurf?.[bereichSchluessel(auftrag.bereich)];
  return auftrag.erwarteteDateien.includes(pfad) || (typeof text === "string" && text.includes(basename(pfad)));
}

export function festwertTestBefunde(phase, root) {
  const betroffen = phase.auftraege.filter((auftrag) => legtMigrationAn(auftrag, root));
  if (betroffen.length === 0) return { befunde: [], hinweise: [] };
  const suchtexte = [...migrationsnamen(root), POLICY_TEXT];
  const treffer = testdateien(root).filter((pfad) => nenntFestwert(readFileSync(join(root, pfad), "utf8"), suchtexte));
  const hinweise = betroffen.flatMap((auftrag) =>
    treffer.filter((pfad) => !istGenannt(pfad, auftrag, phase.entwurf)).map((pfad) => `Hinweis: ${auftrag.id}: ${pfad}: ${HINWEIS}`),
  );
  return { befunde: [], hinweise };
}
