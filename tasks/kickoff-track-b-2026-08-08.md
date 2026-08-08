# Kickoff: Track B als Lean Lead durchziehen — B2 bis B5 (2026-08-08)

Prompt fuer die naechste Session. Autor: Lead-Session 43d58a93 (B1-Abschluss).
**Regel dieser Datei: GEMESSEN traegt ein Kommando. Alles andere ist Vermutung.**

---

## 1. Der Auftrag

Fuehre Track B zu Ende: **B2 (Vertrag) -> B3 (Werkzeug-Schleife) -> B4 (Preisquelle + Gate)
-> B5 (erster Fremdadapter)**. Der Owner hat B2 ausdruecklich freigegeben; B3-B5 laufen
danach als normale Phasenkette weiter, **mit einer Ausnahme, die eine Owner-Entscheidung
braucht** (Modellwahl, s. Abschnitt 5).

`tasks/b2-spec.md` ist die autoritative Spezifikation von B2 (598 Zeilen, Doku-verifiziert).
Nichts davon neu erfinden. Wo Spec und Wirklichkeit kollidieren, gilt die Messung — und die
Abweichung kommt in den Report.

**Du bist Lean Lead:** du orchestrierst, liest Specs/Reports/Diff-Stats, aber **keinen
Implementierungs-Code**. Arbeit machen Subagenten. Vor jedem Merge siehst du
`git log master..<branch>` und `git diff --stat` selbst an.

---

## 2. Stand (GEMESSEN am 2026-08-08)

| Behauptung | Kommando |
|---|---|
| master = origin = upstream = `f939169`, Tree sauber | `git fetch --all && git log --oneline -1` |
| **Live laeuft `6aec118`** — NICHT `27c8579`, das stand falsch im alten Kickoff | `curl -s https://vodafone-agent.onrender.com/healthz` |
| Live-Stand und master unterscheiden sich in **null** Produktionsdateien | `git diff --stat 6aec118..master -- src/ apps/ package.json render.yaml` -> leer |
| Suite gruen | `npm test` -> 4007/4007, Exit 0 |
| Genau 1 Worktree, 25 Branches (24 ungemergt + master) | `git worktree list`, `git branch \| wc -l` |
| `DEEPSEEK_API_KEY` liegt lokal in der `.env` | `node -e "import('dotenv').then(d=>{d.config();console.log(!!process.env.DEEPSEEK_API_KEY)})"` |
| DeepSeek-Guthaben ~1,11 USD | `bash scripts/set-deepseek-key.sh` zeigt es an, oder direkt `GET /user/balance` |

**Erster Handgriff:** `git fetch --all && git log --oneline -1` und `npm test`. Stimmt eines
nicht mit der Tabelle, halte an und klaere es, bevor du eine Phase startest.

---

## 3. Zuerst lesen (Reihenfolge)

1. `CLAUDE.md` — Absolute Regeln. **Regel 1 (Safety-Gates) ist in Track B direkt beruehrt:**
   die Token-Zahl geht auf ZWEI Achsen (Budget-Gate UND Stripe-Kundenbeleg).
2. `.claude/refs/workflow.md` + `.claude/refs/clean-code.md` — Pflicht
3. **`tasks/b2-spec.md`** — die Spec dieser Phase, vollstaendig
4. **`tasks/b1-report.md`** — die Faktenbasis. Jede Zahl darin ist gemessen.
5. **`tasks/b3-vorher-werte.md`** — die Pflicht-Vorher-Werte. **Ohne sie faengt B3 nicht an**,
   und sie sind bereits erhoben — nicht neu messen, nur vergleichen.
6. `tasks/todo.md`, Abschnitt "OWNER-ENTSCHEIDUNG 2026-08-08" — bindend
7. `PLAN-ANBIETER-PORT.md` Teil 2 — Umbrella. **ACHTUNG:** Abschnitt 1.2 traegt noch die
   Preistabellen-Praemisse, der der Owner widersprochen hat. Es gilt die Owner-Korrektur.
8. `tasks/lessons.md`, letzte Abschnitte — besonders "Ein Messwerkzeug braucht eine Attrappe"

---

## 4. Die bindenden Entscheidungen (nicht neu aufrollen)

**Owner, 2026-08-08, woertlich:** *"ich will dass die echten kosten abgebucht werden keine
[...] annahmen"*

1. **Raten je Token-Sorte** statt einer pauschalen Eingabe-Rate. Gemessen liegt die heutige
   Faltung um Faktor **5,1x** (flash) bzw. **6,0x** (pro) daneben; Cache-Treffer sind der
   **Normalfall** (11 von 13), nicht die Ausnahme.
2. **Taegliche Perioden-Gegenprobe** gegen `GET /user/balance`. Je Anruf ausgeschlossen
   (Aufloesung 0,01 USD, Verzug ~2 min — beides gemessen).
3. **Modellwahl flash vs. pro VERTAGT bis B5.** Der Vertrag legt sich nicht fest.

**"Echte Kosten" heisst NICHT ein Kostenfeld des Anbieters** — das existiert nicht (alle 90
Antworten rekursiv geprueft, nur Token-Zaehler). Es heisst: anbieter-gemeldete Token-Zahlen
je Sorte (0 Verletzungen beider Summengleichungen ueber 88 Aufrufe) mal veroeffentlichte
Rate = **Arithmetik**, plus die Gegenprobe als Beleg, dass die Rate stimmt. Wenn du das in
einem Report anders formulierst, verlierst du genau die Unterscheidung, um die es dem Owner
ging.

---

## 5. Die Phasen — und wo der Owner nochmal ran muss

### B2 — Vertrag `src/llm/ports.js`. **FREIGEGEBEN, kann sofort starten.**
Spec: `tasks/b2-spec.md`. Reine Vertrags-/Dokumentphase, keine Verhaltensaenderung.
Abnahme laut Spec Abschnitt E (u.a. `node --check`, null Laufzeit-Logik, jede Faehigkeit mit
`datei.js:zeile`, zwei Papier-Durchlaeufe).

### B3 — Werkzeug-Schleife neutralisieren. **Das ist die eigentliche Arbeit.**
Erste Frage laut Plan: ist `telnyx-llm-shim.js` fuer die AUSGANGS-Seite wiederverwendbar?
**Bereits belegt: nein-offen** — `grep -c tool_calls src/telnyx-llm-shim.js` = **0**. Der Shim
uebersetzt nur die Eingangsseite. Das ist ein Befund, kein Hindernis.
Vorher-Werte stehen in `tasks/b3-vorher-werte.md` — **Nachher MUSS auf demselben Treiber
(`shim`) und derselben Konfiguration gemessen werden**, sonst vergleicht man zwei Messungen.

### B4 — Preisquelle und Gate.
Hier landen beide Owner-Entscheidungen. **Zwei Dinge, die die Spec eigens markiert:**
- **Der live gebuchte Betrag SINKT**, sobald Anthropic vier Raten bekommt (`cache_read` nicht
  mehr zur vollen Eingabe-Rate). Auf dem Beleg richtiger, auf dem **Gate spaeter greifend,
  also weniger schuetzend**. Eigener gemessener Schritt mit Vorher/Nachher an echtem Verkehr —
  **kein Seiteneffekt von "wir haben DeepSeek dazugebaut"**.
- **`priceForModel`-Boot-Abbruch gehoert hierher**, und das Argument dafuer ist neu:
  `mostExpensivePrice` ist nur **innerhalb einer Preiswelt** eine Obergrenze. Heute sind beide
  Eintraege Anthropic und liegen zufaellig ueber jeder DeepSeek-Rate. Mit gemischten Anbietern
  kann der fail-closed-Zweig **zu wenig** buchen — dann ist die Gate-Achse blind. Beachte den
  Gegen-Praezedenzfall `boot.js:121-124` (*"NUR WARN, kein exit(1)"*), den das umkehrt.
- **Weisser Fleck W3:** Anthropics Raten je Token-Sorte stehen im Repo **nirgends**. Nur die
  Faustformel "rund ein Zehntel" in `PLAN-ANBIETER-PORT.md` 1.2 — und eine Faustformel ist
  kein Preis. **Frisch abrufen, nicht ableiten.**

### B5 — Erster Fremdadapter. **HIER BRAUCHT ES DEN OWNER.**
Die Modellwahl **flash vs. pro** ist bis hierher vertagt. Entscheidungsgrundlage:
- Preis: flash ist ~3x guenstiger als pro; gegen `claude-haiku-4-5` (1,00/5,00 USD je MTok)
  ist flash **7x** guenstiger bei Eingabe-Fehltreffern, **18x** bei Ausgabe — und **357x** bei
  Cache-Treffern (0,0028 gegen 1,00).
- Latenz gemessen: flash Median 1548 ms, pro Median 2011 ms mit **Max 3183 ms** — neun Prozent
  Luft zum heutigen 3500-ms-Seam-Timeout, **ohne Last gemessen**.
- **Qualitaet auf Deutsch ist UNGEMESSEN.** B1 konnte das nicht (max_tokens war 64, Antworten
  abgeschnitten). Praezedenzfall B-7: dokumentierte Deutsch-Unterstuetzung, gemessene 97 %
  Wortfehlerrate. **Der Preisvorteil ist erst etwas wert, wenn die Qualitaet steht.**
Abnahme laut Plan mit **echtem Anruf** — Tests allein nehmen den Live-Sprechpfad nicht ab.
Der Adapter kommt hinter ein Flag, das per Env zurueckfaellt.

---

## 6. Arbeitsweise (so hat die Kette funktioniert — beibehalten)

- **Modell-Politik:** Opus fuer Plan/Spec/Safety-Review, Sonnet fuer Impl/Audit/Fix/Report.
  Pins **explizit pro `agent()`**, nie erben lassen.
- **Ein Impl-Agent, dann dualer Review** (Safety/Verhalten + Clean-Code). Bei Unsicherheit die
  volle Vorlage `.claude/workflows/runs/c-p6.js` kopieren — sie traegt den REPO-Hart-Pin gegen
  die Symlink-Falle.
- **PASS ist keine Freigabe.** Vor jedem Merge `git log master..<branch>` UND
  `git diff --stat` selbst ansehen (Lehre C-P2: leerer Branch trotz PASS; C-P4: toter
  Impl-Agent, 59 Dateien uncommittet im Worktree).
- **EINE Test-Bahn zur Zeit.** Zwei parallele `npm test` = Load 32 auf 15 Kernen.
- **Workflows sichtbar ankuendigen** (Start/Umfang/Modelle vorher, Verbrauch nachher).
- **Nicht auf Workflows blockieren** — die Benachrichtigung kommt von selbst.
- **Pre-Mortem vor jeder nicht-trivialen Entscheidung** (CLAUDE.md).
- Nach dem Merge einer Phase: **Prozessmuell im selben Zug raeumen** (erst committen, dann
  loeschen), Memory nachziehen (`anbieter-port-plan`).

### Die Lehre dieser Session, die am meisten gespart hat

**Ein Messwerkzeug gegen eine fremde API braucht eine Offline-Attrappe** (lokaler HTTP-Server
+ Skript-Kopie mit Basis-URL aus Env — zwei geaenderte Zeilen). Beim B1-Skript waren
`node --check`, 22 Selftest-Zusicherungen, Trockenlauf und ein scharfer Lauf mit
Falsch-Schluessel **alle gruen**; der Review fand danach **fuenf S1**, und **alle fuenf lagen
im Fehlerfall** — Endpunkt 500, Verbindungsabbruch, wechselndes Zahlenformat, Bremse feuert
mittendrin. Der teuerste war ein **Exit 0**: eine Messung, die nie stattfand, waere als
Ergebnis dem Owner vorgelegt worden.

Daraus die Regeln fuer B3-B5:
1. **Die leere Menge ist immer ein eigener Fall.** `0 Treffer` nur bei erfolgreichen Aufrufen,
   `0 Abweichungen` nur bei nicht-leerer Vergleichsmenge. Die Meldung nennt die
   Grundgesamtheit mit.
2. **Geld als Ganzzahl fuehrt seine Skala mit, ueberall.** Eine Ganzzahl ohne Skala ist keine
   Geldangabe.
3. **Zu jeder Zusicherung die Sabotage benennen, die sie rot machen soll — und sie ausfuehren.**
4. Die wiederkehrende Fehlerklasse ist **nicht die Rechnung, sondern die Meldung**. Pruefe den
   Datenpfad von der Rohantwort bis ins Ergebnisfeld, nicht die Formel.

---

## 7. Betriebswissen, das sonst Zeit kostet

- **`convo-bench` braucht `node --env-file=.env scripts/convo-bench.mjs ...`** — es laedt kein
  `dotenv` und bricht sonst mit "ANTHROPIC_API_KEY fehlt" ab, obwohl der Key in der `.env`
  steht.
- **Nie `--all`**: ein kaputtes Szenario beendet den GESAMTEN Lauf (nach 20 von 85
  Gespraechen erlebt). Szenarienweise aufrufen, alle in EIN `--out`.
- `--scenario` nimmt genau **eine** ID, keine Liste.
- **`inbound-nachricht` meldet `shim: true` und stuerzt darauf ab** — nur mit
  `--driver texml` lauffaehig. Es ist das einzige inbound-Szenario.
- Kosten gemessen: **0,023 USD je Gespraech**, also ~1,88 USD fuer 16 Szenarien x 5.
- Werkzeug-Nutzung steht strukturiert in `metrics.turns[].tools` — **nicht** ins Transkript
  grepen, das faende auch die blosse Erwaehnung im Prompt.
- **`timeout` gibt es auf macOS nicht**, und **`xargs -a` auch nicht** (beides in dieser
  Session gestolpert; das zweite meldete "0 geloescht, 0 Fehler" und sah erfolgreich aus).
- Deploy: **Render deployt `upstream` (jonas986)**, `origin` (Antonio20045) loest nichts aus.
  Live-Stand IMMER per `/healthz` pruefen, nie aus einer Notiz lesen.

---

## 8. Offene Punkte ausserhalb Track B (nicht vorziehen)

- **AL-D3 hat sich verschoben** (`tasks/b3-vorher-werte.md`): `get_consult` feuert jetzt 5/5,
  aber `take_message` feuert **zusaetzlich** 4/5 — der Agent waehlt nicht mehr falsch, sondern
  **doppelt**. Andere Wurzel, eigene Diagnose noetig. Gehoert zur GQ-Kette, nicht zu Track B.
- **`turn_count_within_budget` scheitert in 7 von 16 Szenarien** — der breiteste offene
  Qualitaetsbefund.
- **`no_invented_promise` scheitert 4/5 in `spaeter-nochmal`** — der Agent erfindet Zusagen.
  Vertrauensfrage.
- Drei Bestandsdefekte im `convo-bench` (Abschnitt 7) sind dokumentiert, aber nicht behoben.
- WER-Nachmessung Track A: vom Owner zurueckgestellt.
- Der alte Kickoff `tasks/kickoff-b1-messung-2026-08-08.md` ist **verbraucht** — nach dem
  ersten Merge dieser Kette loeschen (CLAUDE.md-Aufraeumregel), zusammen mit
  `tasks/b1-spec.md`, sobald B2 gemergt ist. `tasks/b1-report.md` und
  `tasks/b3-vorher-werte.md` **bleiben** — das sind Befunde, kein Prozessmuell.
