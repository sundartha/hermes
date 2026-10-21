const NUMMER = /^[1-9]\d*$/;
const ISSUE_ZEILE = "Issue: <Nummer>";
const ISSUE = /^Issue:(.*)$/m;
const ISSUE_WERT = /^ ([1-9]\d*)\s*$/;
const ERSTER_ABSCHNITT = /^## /m;

function kopf(pitch) {
  const ende = pitch.search(ERSTER_ABSCHNITT);
  return ende === -1 ? pitch : pitch.slice(0, ende);
}

function issueAusPitch(pitch) {
  const zeile = ISSUE.exec(kopf(pitch));
  if (zeile === null) return {};
  const wert = ISSUE_WERT.exec(zeile[1]);
  return wert === null ? { fehler: `pitch.md: die Zeile „${zeile[0].trim()}“ braucht die Form „${ISSUE_ZEILE}“ mit einer ganzen Zahl über 0` } : { issue: Number(wert[1]) };
}

export function issueAus(angabe, pitch) {
  if (angabe === undefined) return issueAusPitch(pitch);
  return NUMMER.test(angabe) ? { issue: Number(angabe) } : { fehler: `--issue braucht die Nummer eines Issues als ganze Zahl über 0, nicht ${angabe}` };
}
