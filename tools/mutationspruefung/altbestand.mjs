import { altbestandListe } from "../auftrag/altbestand.mjs";
import { gleichwertigGemeldet } from "../auftrag/gleichwertig.mjs";
import { prNummerAus } from "../warteschlange/gleicher-stand.mjs";
import { pullRequestNummer } from "./vorlauf-pr.mjs";

const MERGE_GRUPPE = "merge_group";

export const ALTBESTAND_MELDUNGEN = new Map();

export function altbestandZeile(mutant) {
  const quelle = ALTBESTAND_MELDUNGEN.get(mutant);
  return quelle === undefined ? null : `Altbestand: Gleichwertig-Meldung ohne Zeile „Auftrag:“ aus PR ${quelle}: ${mutant}`;
}

function nummerAus(umgebung) {
  return umgebung.GITHUB_EVENT_NAME === MERGE_GRUPPE ? prNummerAus(umgebung.GITHUB_REF) : pullRequestNummer(umgebung);
}

export function altbestandGemeldet({ nachrichten, basis, root, umgebung }) {
  const nummer = nummerAus(umgebung);
  const eintrag = nummer === null ? undefined : altbestandListe(basis, "HEAD", root).wirksam.get(String(nummer));
  if (eintrag === undefined) return [];
  const mutanten = nachrichten.flatMap((nachricht) => gleichwertigGemeldet(nachricht));
  for (const mutant of mutanten) ALTBESTAND_MELDUNGEN.set(mutant, `${nummer} (${eintrag.kuerzel})`);
  return mutanten;
}
