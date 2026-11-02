import assert from "node:assert/strict";
import { test } from "node:test";

import { EXIT_ROT, werkzeug } from "./mutationspruefung-probe.js";
import { probeRepository } from "./probe-repo.js";
import { ALLGEMEIN, NEUE_SEITE, OFFSET, OHNE_WIRKUNG, TENANT, geaendert, quelle } from "./schutzwirkung-probe.js";

const EXIT_ABBRUCH = 2;
const VERSTOSS_WIRKUNGSLOS = "Verstoß: Schutztest wirkungslos: [NIE1] offset 1.5 liefert keine Seite";

function wirkungsloserSchutztest(context) {
  return geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, OHNE_WIRKUNG);
}

test("der lokale Gesamtlauf ist bei einem wirkungslosen Schutztest rot und nennt den Zweck der Schutzwirkung", (context) => {
  const lauf = werkzeug(wirkungsloserSchutztest(context), "HEAD");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(VERSTOSS_WIRKUNGSLOS), lauf.stdout);
  assert.match(lauf.stdout, /^Wozu: Ein Schutztest hält seinen Satz/m);
});

test("mit --schutz-gesondert zeigt der lokale Gesamtlauf denselben Verstoß, lässt den Exit-Code aber an den Mutanten", (context) => {
  const lauf = werkzeug(wirkungsloserSchutztest(context), "HEAD", "--schutz-gesondert");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stdout.split("\n").includes(VERSTOSS_WIRKUNGSLOS), lauf.stdout);
  assert.match(lauf.stdout, /^rot: 1 Schutztests, 1 ohne nachgewiesene Wirkung\.$/m);
});

test("mit --schutz-gesondert bleibt ein überlebender Mutant im lokalen Gesamtlauf rot", (context) => {
  const lauf = werkzeug(geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), OHNE_WIRKUNG), "HEAD", "--schutz-gesondert");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Mutant überlebt: /m);
});

const UNGUELTIGE_VERBINDUNGEN = [
  ["--urteil", "ordner"],
  ["--plan", "plan.json"],
  ["--teil", "1", "--teile", "1", "--ergebnis", "teil.json"],
  ["--alter-stand"],
  ["--testumbau"],
  ["--schutzwirkung"],
];

test("--schutz-gesondert gilt nur für ein Urteil in einem Aufruf, nicht für Plan, Teil, Urteil, alten Stand, Testumbau und die Schutzwirkung allein", (context) => {
  const repo = probeRepository(context, { "package.json": '{ "type": "module" }\n' });
  for (const verbindung of UNGUELTIGE_VERBINDUNGEN) {
    const lauf = werkzeug(repo, "HEAD", "--schutz-gesondert", ...verbindung);
    assert.equal(lauf.status, EXIT_ABBRUCH, `${verbindung.join(" ")}: ${lauf.stdout}${lauf.stderr}`);
    assert.match(lauf.stderr, /^Aufruf: /m, verbindung.join(" "));
  }
});
