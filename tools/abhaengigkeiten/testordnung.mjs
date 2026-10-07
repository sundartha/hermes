import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const BEREICHE_DATEI = "tools/bereiche.json";
const TEST_ORDNER = "test/";
const PFAD_TRENNER = "/";
const DATEI_TRENNER = "\0";
const TOKEN_TRENNER = /[-_.]/;
const TOKEN_VERBINDER = "-";
const BEREICH_UND_DATEI = 2;
const MAX_GIT_AUSGABE = 268_435_456;
const ZUSAMMENFASSUNG =
  "neue Dateien unter test/ seit der Basis, alle unter test/<bereich>/ und ohne Ticket-Namen";

const TICKET_TOKEN =
  /^(?!(?:v\d+|p(?:50|75|90|95|99)|mp[34]|md5|pg\d+|([a-z])2\1)$)(?:[a-z]{1,2}\d{1,2}[ab]?|0\d|al|ks|gq|gp|cq|iel|iex|iep|oc|ww|afix|prolif|kostenv\d+)$/;
const TICKET_PAAR =
  /(?:^|[-_.])(?:gap|sg|web|did|pay|fmt|orig|e2e|lang|prov|phase|stufe|runde|welle|sprint|spike|fix|paket|task|ticket|aufgabe)[-_.]?\d{1,3}(?=[-_.]|$)/;
const ENDUNG = /\.(?:test\.)?(?:js|mjs|cjs|json|jsonl|xml|md)$/;

function bereiche() {
  if (!existsSync(BEREICHE_DATEI)) return [];
  return JSON.parse(readFileSync(BEREICHE_DATEI, "utf8")).map(({ bereich }) => bereich);
}

function tokens(pfadteil) {
  const kleinOhneEndung = pfadteil.replace(ENDUNG, "").toLowerCase();
  return kleinOhneEndung.split(TOKEN_TRENNER).filter(Boolean);
}

function istTicketName(pfadteil) {
  const teile = tokens(pfadteil);
  const einzeln = teile.some((token) => TICKET_TOKEN.test(token));
  return einzeln || TICKET_PAAR.test(teile.join(TOKEN_VERBINDER));
}

function liegtGeordnet(pfad, erlaubt) {
  const teile = pfad.slice(TEST_ORDNER.length).split(PFAD_TRENNER);
  const [bereich] = teile;
  const imBereich = teile.length >= BEREICH_UND_DATEI && erlaubt.includes(bereich);
  return imBereich && !teile.some(istTicketName);
}

function neueDateien(basis) {
  const args = ["diff", "--no-renames", "--diff-filter=A", "--name-only", "-z", basis, "HEAD"];
  const lauf = spawnSync("git", [...args, "--", TEST_ORDNER], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_AUSGABE,
  });
  if (lauf.status !== 0) throw new Error(`git diff ist gescheitert: ${lauf.stderr.trim()}`);
  return lauf.stdout.split(DATEI_TRENNER).filter(Boolean);
}

function meldung(pfad, erlaubt) {
  return `${pfad}: neue Testdateien liegen unter test/<bereich>/ (Bereiche: ${erlaubt.join(", ")}) und heißen nach Verhalten, z. B. test/anrufe/anruf-starten.test.js. Ticket-Nummern gehören in Commit-Text und Testtitel. Ist ein Teil des Namens ein Fachbegriff, ist das eine Änderung an einer Prüfung und braucht eine Freigabe von Antonio oder Jonas; im Zweifel den Namen nach Verhalten wählen.`;
}

export function testordnung(basis) {
  const erlaubt = bereiche();
  const neu = neueDateien(basis);
  const befunde = neu
    .filter((pfad) => !liegtGeordnet(pfad, erlaubt))
    .map((pfad) => meldung(pfad, erlaubt));
  const zusammenfassung = `${neu.length} ${ZUSAMMENFASSUNG}`;
  return { befunde, zusammenfassung };
}
