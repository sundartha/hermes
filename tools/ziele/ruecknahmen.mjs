import { commitNachricht, geaenderteDateien, gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";

const RUECKNAHME = /^Revert ".+"\n\nThis reverts commit ([0-9a-f]{40})\.$/m;
const SORTE_ZEILE = /^Sorte: (\S+)$/m;
const AUFTRAG_ZEILE = /^Auftrag: (\S+)$/m;
const SATZ_ENDE = "\u001e";
const FELD_ENDE = "\0";
const SUCHE = "^This reverts commit [0-9a-f]{40}\\.$";

function eintraege(root) {
  const ausgabe = gitAusgabe(
    ["log", "-E", `--grep=${SUCHE}`, "--format=%H%x00%B%x1e", "HEAD"],
    root,
  );
  const saetze = ausgabe.split(SATZ_ENDE).map((satz) => satz.trim());
  return saetze.filter(Boolean).map((satz) => satz.split(FELD_ENDE));
}

function original(sha, root) {
  try {
    return commitNachricht(sha, root);
  } catch {
    return "";
  }
}

function ersteDatei(sha, root) {
  try {
    return geaenderteDateien(sha, root)[0] ?? "";
  } catch {
    return "";
  }
}

export function ruecknahmen(root) {
  const jeAuftrag = new Map();
  for (const [ruecknahme, nachricht] of eintraege(root)) {
    const sha = RUECKNAHME.exec(nachricht)?.[1];
    if (sha === undefined) continue;
    const text = original(sha, root);
    const sorte = SORTE_ZEILE.exec(text)?.[1];
    if (sorte === undefined) continue;
    const auftrag = AUFTRAG_ZEILE.exec(text)?.[1] ?? sha;
    if (jeAuftrag.has(auftrag)) continue;
    jeAuftrag.set(auftrag, { sorte, auftrag, original: sha, ruecknahme, datei: ersteDatei(sha, root) });
  }
  return [...jeAuftrag.values()];
}
