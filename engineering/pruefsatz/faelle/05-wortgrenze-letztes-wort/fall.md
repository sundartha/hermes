# 05 Wortgrenze, letztes Wort
Fehler: clampAtWordBoundary sucht das Leerzeichen nur im abgeschnittenen Text (cut statt text mit Index maxChars); steht das Leerzeichen genau an der Grenze, wird das letzte ganze Wort mitgekürzt.
Herkunft: PR #2151 (Paket P-010), Commit d69c30a.
Fand ihn damals: unbekannt.
Erwartet rot: test/anrufe/wortgrenze-letztes-wort.test.js.
