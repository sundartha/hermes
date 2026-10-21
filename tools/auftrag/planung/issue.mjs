import { ganzeZahl, zahlZeile } from "./kopfzeile.mjs";

const ISSUE_ZEILE = "Issue: <Nummer>";

function issueAusPitch(pitch) {
  const gefunden = zahlZeile(pitch, { name: "Issue", nurKopf: true });
  if (gefunden === undefined) return {};
  return gefunden.zahl === undefined ? { fehler: `pitch.md: die Zeile „${gefunden.zeile.trim()}“ braucht die Form „${ISSUE_ZEILE}“ mit einer ganzen Zahl über 0` } : { issue: gefunden.zahl };
}

export function issueAus(angabe, pitch) {
  if (angabe === undefined) return issueAusPitch(pitch);
  const issue = ganzeZahl(angabe);
  return issue === undefined ? { fehler: `--issue braucht die Nummer eines Issues als ganze Zahl über 0, nicht ${angabe}` } : { issue };
}
