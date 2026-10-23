import { pitchPfad, vorgabenAusPitch } from "./annahmen.mjs";
import { absichtAusPitch } from "./planung/absicht.mjs";
import { gitAusgabe } from "./pruefer-auswahl.mjs";

const PAKET_BRANCH = /^paket\//;
const PHASENDATEI = /^plaene\/[^/]+\/phase\.json$/;
const ABSICHT_FEHLT = "Absicht fehlt";
const AUS_FORK = "keine Angabe; der Pull Request kommt aus einem Fork";
const OHNE_ABSICHT = "keine Angabe; das verknüpfte Issue hat keinen Abschnitt „## Absicht“, und der Pull Request ist kein Paket und bringt keine Phase mit Absicht";
const LEERE_ABSICHT = "der Abschnitt „## Absicht“ ist leer";
const PFLICHT_OHNE_ABSICHT = "Paket-PR und Phase mit Absicht brauchen im Issue den Abschnitt „## Absicht“";
const OHNE_VORGABEN = "keine Angabe; der Pull Request bringt keine Phase aus einem Pitch mit den Abschnitten „## Fallen“ oder „## Nicht-Ziele“";

function dateiAmKopf(pfad, { head, root }) {
  try {
    return gitAusgabe(["show", `${head}:${pfad}`], root);
  } catch {
    return null;
  }
}

function geaendertePhasen({ basis, head, root }) {
  const geaendert = gitAusgabe(["diff", "--name-only", "--no-renames", basis, head], root).split("\n");
  return geaendert.filter((pfad) => PHASENDATEI.test(pfad)).flatMap((pfad) => {
    try {
      const phase = JSON.parse(dateiAmKopf(pfad, { head, root }));
      return phase === null || typeof phase !== "object" ? [] : [{ pfad, phase }];
    } catch {
      return [];
    }
  });
}

function phasenAbsichten(stand) {
  return geaendertePhasen(stand).flatMap(({ pfad, phase }) => (Object.hasOwn(phase, "absicht") ? [{ pfad, absicht: phase.absicht }] : []));
}

function vorgabenDer({ phase }, stand) {
  const pitch = pitchPfad(phase);
  const text = pitch === null ? null : dateiAmKopf(pitch, stand);
  const vorgaben = text === null ? "" : vorgabenAusPitch(text);
  return vorgaben === "" ? [] : [{ pitch, vorgaben }];
}

function issueStelle(issue) {
  if (!issue) return "kein verknüpftes Issue";
  return issue.body === null ? `Issue #${issue.nummer} nicht lesbar` : `Issue #${issue.nummer}`;
}

function abgleich(text, { basis, head, root }) {
  const phasen = basis && head ? phasenAbsichten({ basis, head, root }) : [];
  const abweichend = text === undefined ? undefined : phasen.find(({ absicht }) => absicht !== text);
  return { phasen, abweichend };
}

function ohneText(wo, pflicht) {
  return pflicht ? { fehlt: `${wo}: ${PFLICHT_OHNE_ABSICHT}` } : { keine: OHNE_ABSICHT };
}

export function absichtFuerPr({ branch, issue, fork = false, ...stand }) {
  if (fork) return { keine: AUS_FORK };
  const wo = issueStelle(issue);
  const text = absichtAusPitch(issue?.body ?? "");
  if (text === "") return { fehlt: `${wo}: ${LEERE_ABSICHT}` };
  const { phasen, abweichend } = abgleich(text, stand);
  if (abweichend) return { fehlt: `${wo}: der Abschnitt „## Absicht“ weicht von absicht in ${abweichend.pfad} ab` };
  if (text !== undefined) return { text, quelle: `Abschnitt „## Absicht“ in ${wo}` };
  return ohneText(wo, PAKET_BRANCH.test(branch) || phasen.length > 0);
}

export function vorgabenFuerPr({ fork = false, ...stand }) {
  if (fork) return { keine: AUS_FORK };
  const gefunden = stand.basis && stand.head ? geaendertePhasen(stand).flatMap((eintrag) => vorgabenDer(eintrag, stand)) : [];
  if (gefunden.length === 0) return { keine: OHNE_VORGABEN };
  return {
    text: gefunden.map(({ vorgaben }) => vorgaben).join("\n\n"),
    quelle: `${gefunden.map(({ pitch }) => pitch).join(", ")} am Stand des Pull Requests`,
  };
}

export function abbruchOhneAbsicht(absicht) {
  return absicht?.fehlt ? `${ABSICHT_FEHLT}: ${absicht.fehlt}` : "";
}
