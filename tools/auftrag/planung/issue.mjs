import { ganzeZahl, zahlZeile } from "./kopfzeile.mjs";

const ISSUE_ZEILE = "Issue: <Nummer>";
const OHNE_ISSUE = "Issue: offen";

function issueAusPitch(pitch) {
  const gefunden = zahlZeile(pitch, { name: "Issue", nurKopf: true });
  if (gefunden === undefined) return {};
  if (gefunden.zeile.trim() === OHNE_ISSUE) return { fehler: `pitch.md: „${OHNE_ISSUE}“; ein Teil plant erst mit eigenem Issue: leg das Teil-Issue mit wörtlich gleicher „## Absicht“ an und trag seine Nummer ein` };
  return gefunden.zahl === undefined ? { fehler: `pitch.md: die Zeile „${gefunden.zeile.trim()}“ braucht die Form „${ISSUE_ZEILE}“ mit einer ganzen Zahl über 0` } : { issue: gefunden.zahl };
}

export function issueAus(angabe, pitch) {
  if (angabe === undefined) return issueAusPitch(pitch);
  const issue = ganzeZahl(angabe);
  return issue === undefined ? { fehler: `--issue braucht die Nummer eines Issues als ganze Zahl über 0, nicht ${angabe}` } : { issue };
}
