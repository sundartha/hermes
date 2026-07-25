// WEB-01 (i18n-Testkatalog, tasks/i18n-tests/08-web-dashboard-onboarding.md:110) -
// tenant.html liefert kein sprachabhaengiges html-lang-Attribut.
//
// SOLL (rot, D14 Leit-Test): public/tenant.html soll das `lang`-Attribut sprachabhaengig
// setzen (z.B. per document.documentElement.lang oder ein Templating-Mechanismus), NICHT
// hart "de". Die Ist-Zustand-Pruefung selbst (`<html lang="de">` == 1 Treffer) waere gruen
// und bestaetigt nur die Luecke (siehe Spezifikation, "Heute erwartbar"-Absatz) - genau DAS
// ist per R1/R2 NICHT die Fassung, die in die Suite wandert. Stattdessen die Ziel-Assertion:
// es MUSS irgendeinen dynamischen lang-Mechanismus geben. Heute gibt es keinen -> rot.
//
// Statische Datei-Pruefung (kein Server-Spawn noetig), Modus "offline" laut Katalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

test("WEB-01 (SOLL rot): tenant.html muss lang sprachabhaengig setzen (heute: hart lang=\"de\")", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/tenant.html"), "utf8");
  const hardcodedDeCount = (html.match(/<html lang="de">/g) || []).length;
  const dynamicLangCount = (html.match(/document\.documentElement\.lang|data-i18n/g) || []).length;

  // Beleg des Ist-Zustands (nur zur Einordnung im Fehlschlag-Diff, keine eigene Assertion):
  // genau 1 hartkodierter Treffer, 0 dynamische Mechanismen.
  assert.ok(
    dynamicLangCount > 0,
    `SOLL: tenant.html braucht einen sprachabhaengigen lang-Mechanismus ` +
      `(document.documentElement.lang / data-i18n) - heute 0 Treffer, ` +
      `stattdessen ${hardcodedDeCount}x hart <html lang="de">`,
  );
});
