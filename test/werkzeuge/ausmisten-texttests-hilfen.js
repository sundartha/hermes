import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imBranch } from "../../tools/tests-ausmisten/ausnehmen.mjs";
import { EINGANG_QUELLE, ausmistenRepo } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, messePaket, plane } from "./ausmisten/messung.mjs";
import { MIT_TEXT, TEXTFALL, TEXTTEST } from "./ausmisten/texttest.mjs";

export function erwarteSichtbarOhneSperre(ergebnis, stand) {
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
  assert.ok(
    ergebnis.melden.ausgabe.includes(
      `Ausgenommen: ${TEXTTEST}: ${TEXTFALL} (umgebaute Datei ${EINGANG_QUELLE}, im Branch ${stand})`,
    ),
    ergebnis.melden.ausgabe,
  );
  assert.doesNotMatch(ergebnis.melden.ausgabe, /Freigabe/);
  assert.equal(ergebnis.status.state, "success");
}

export function artefakt(artefakte, name) {
  return JSON.parse(readFileSync(join(artefakte, name, `${name}.json`), "utf8"));
}

export async function basisMit(context, { master, branch }) {
  const stand = await plane(
    context,
    { weg: [], neu: { [TEXTTEST]: branch } },
    { [TEXTTEST]: master },
  );
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  return { stand, basis: await messePaket(stand, { art: "basis", paket: 0 }) };
}

const HILFE = "test/hilfe/text.js";
export const TIEF = "test/hilfe/tief.js";
const GRAPH = {
  importe: new Map([
    [TEXTTEST, [HILFE, EINGANG_QUELLE]],
    [HILFE, [TIEF]],
  ]),
};

export function hilfsRepo(context) {
  return ausmistenRepo(context, {
    [TEXTTEST]: MIT_TEXT,
    [HILFE]: 'export { TIEF } from "./tief.js";\n',
    [TIEF]: "export const TIEF = 1;\n",
  });
}

export function standDes(repo, kopf) {
  const lauf = { master: repo.master, kopf, verzeichnis: repo.ordner };
  return imBranch({ test: TEXTTEST, name: TEXTFALL }, lauf, [GRAPH]);
}

export function erwarteGeaendert(ergebnis, stand) {
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  const [ausgenommen] = ergebnis.gelesen.ausgenommen;
  assert.equal(ausgenommen.imBranch, stand);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  erwarteSichtbarOhneSperre(ergebnis, stand);
}
