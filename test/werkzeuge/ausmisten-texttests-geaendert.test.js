import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artefakt,
  basisMit,
  erwarteGeaendert,
  hilfsRepo,
  standDes,
  TIEF,
} from "./ausmisten-texttests-hilfen.js";
import { DOPPELT, EINGANG_QUELLE } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, messeUndMelde } from "./ausmisten/messung.mjs";
import {
  ANDERER,
  KUERZEN,
  LESEN,
  MIT_MUSTER,
  MIT_TEXT,
  TABULATOR,
  TEXTFALL,
  TEXTTEST,
  VERHALTEN,
  fall,
  texttest,
} from "./ausmisten/texttest.mjs";

test("ausmisten-texttests: eine geänderte Hilfsdatei unter test/, die ein ausgenommener Fall über eine andere erreicht, wird als geänderte Hilfsdatei gemeldet", (context) => {
  const repo = hilfsRepo(context);
  const kopf = repo.committe({ [TIEF]: "export const TIEF = 2;\n" });
  assert.equal(standDes(repo, kopf), `Hilfsdatei geändert: ${TIEF}`);
});

test("ausmisten-texttests: eine ganz gleiche Testdatei mit gleichen Hilfsdateien gilt als unverändert", (context) => {
  const repo = hilfsRepo(context);
  const kopf = repo.committe(
    { [EINGANG_QUELLE]: "export function eingang(text) {\n  return text;\n}\n" },
    [DOPPELT],
  );
  assert.equal(standDes(repo, kopf), "unverändert");
});

test("ausmisten-texttests: ein ausgenommener Fall in einer sonst geänderten Datei wird gemeldet, ohne zu sperren", async (context) => {
  const dateien = { [TEXTTEST]: MIT_TEXT };
  const neu = texttest(fall(TEXTFALL, LESEN), fall(VERHALTEN, KUERZEN), fall(ANDERER, TABULATOR));
  const ergebnis = await messeUndMelde(
    context,
    { weg: [DOPPELT], neu: { [TEXTTEST]: neu } },
    { dateien },
  );
  erwarteGeaendert(ergebnis, "Datei geändert");
});

test("ausmisten-texttests: ausgenommen-umfeld-geaendert: eine geänderte Konstante außerhalb des ausgenommenen Falls wird gemeldet, ohne zu sperren", async (context) => {
  const mitMuster = (muster) =>
    texttest(
      [`const MUSTER = ${JSON.stringify(muster)};`, ""],
      fall(TEXTFALL, MIT_MUSTER),
      fall(VERHALTEN, KUERZEN),
    );
  const dateien = { [TEXTTEST]: mitMuster("return text.trim();") };
  const ergebnis = await messeUndMelde(
    context,
    { weg: [DOPPELT], neu: { [TEXTTEST]: mitMuster("") } },
    { dateien },
  );
  erwarteGeaendert(ergebnis, "Datei geändert");
});

test("ausmisten-texttests: ein geänderter ausgenommener Fall wird als geändert festgehalten", async (context) => {
  const geaendert = [...LESEN.slice(0, 1), 'assert.ok(quelle.includes("trim"));'];
  const { stand, basis } = await basisMit(context, {
    master: MIT_TEXT,
    branch: texttest(fall(TEXTFALL, geaendert), fall(VERHALTEN, KUERZEN)),
  });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  const [ausgenommen] = artefakt(stand.artefakte, "basis-0").ausgenommen;
  assert.equal(ausgenommen.imBranch, "geändert");
});
