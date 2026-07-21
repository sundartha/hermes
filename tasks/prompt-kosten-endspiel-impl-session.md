# Prompt fuer die naechste Session — PLAN-KOSTEN-ENDSPIEL autonom umsetzen

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.

---

Setz `PLAN-KOSTEN-ENDSPIEL.md` um. **Alle Phasen, autonom, ohne Rueckfragen** — bis auf die
zwei ausdruecklich als Owner-Aktion markierten Stellen (Deploy, Live-Verifikation). Der Plan
ist von mir freigegeben und ist die Quelle der Wahrheit; er ist auf Messungen gebaut, nicht
auf Annahmen. **Lies ihn zuerst vollstaendig.**

## Ausgangslage (selbst pruefen, nicht glauben)

`master` sollte auf `d3cecd2` + dem Kosten-Endspiel-Commit stehen, Suite 2861/0, beide
Remotes (origin + upstream) synchron. **Pruef den echten Git-Stand selbst** (`git log
--oneline -3`, `git status`) — in diesem Repo sind schon Sessions auf einem angenommenen
Stand losgelaufen und haben leere Branches gemergt.

Live laeuft Commit `3516c31`. Am 2026-07-21 wurde per Render-Dashboard
`COST_TRUING_MAX_ATTEMPTS=20` gesetzt (Fristverlaengerung, damit der historische Bestand von
29 offenen Calls nicht abgeschrieben wird). **Dieser Wert muss nach dem Fix zurueck auf 5** —
das ist eine Deploy-Auflage, keine Code-Aenderung.

## Vorgehen: ein Workflow je Phase, sequenziell

Nutze je Phase die Skill **`phase-impl-lean`**. Nicht alle Phasen in einen Workflow:
Phase N+1 baut auf dem gemergten Code von Phase N auf, und das Gate ist pro Phase.

Reihenfolge (aus dem Plan, Kapitel 4):

| Lauf | Phase | Klammer |
| --- | --- | --- |
| 1 | Phase 0 — Fehlerpfad sichtbar machen (`catch {` bindet nichts) | Deploy-Klammer 1 |
| 2 | Phase 1 — S1: tote Sicherung ersetzen (250 -> `meta.total_pages`) | Deploy-Klammer 1 |
| 3 | Phase 2 — D1: Abruf aus der Kandidatenschleife ziehen | Klammer 2 |
| 4 | Phase 3 — D2: Paginierung ohne geratene Filternamen + `inference` nicht abrufen | Klammer 2 |
| 5 | Phase 4 — Drossel am gemessenen Minutenfenster | Klammer 2 |
| 6 | Phase 5 — `since` aus den Kandidaten ableiten | Klammer 2 |
| 7 | Phase 6 — Boot-Guard-Kopplung, ElevenLabs-Zeichen je Tenant, Sweep-Log | Klammer 2 |
| 8 | Phase 6b — Verzug 180->30 min, Kadenz 6 h -> 1 h (Intervall wird Env-Variable) | Klammer 2 |
| 9 | Phase 8 — Bruchpunkt-Waechter | Klammer 2 |

Phase 7 ist **Live-Verifikation durch mich** und wird nicht implementiert — bereite sie nur
vor (s. "Was ich am Ende bekomme").

Regeln fuer jeden Lauf:

- **Phase HART im per-run-Skript pinnen**, nicht ueber `args` uebergeben. Argument-Uebergabe
  hat in diesem Repo schon danebengegriffen und die falsche Phase gebaut.
- **Modelle explizit je `agent()` pinnen** — niemals erben lassen: **Opus** fuer Plan und
  Safety-Review, **Sonnet** fuer Implementierung, Audit, Fix, Report.
- Worktree-Isolation. **Waehrend ein Worktree-Workflow laeuft: NIE `git stash`** —
  `refs/stash` ist worktree-geteilt und wird geklobbert.
- Der Lead liest keinen Code. Er prueft Gate-Ergebnis, `git diff --stat` und merged.

## Das Gate — nicht verhandelbar

Eine Phase ist fertig, wenn ALLES zutrifft:

1. `node --check` auf jede geaenderte Datei.
2. `npm test` gruen. Referenz 2861/0; die Zahl darf nur **wachsen**.
   **Flake-Protokoll:** es gibt einen vorbestehenden Voll-Last-Flake (~12 %, Seed-vor-Boot-
   Race). Ein roter Test gilt erst als echt rot, wenn er **isoliert** ebenfalls rot ist.
   Nie einen Test "reparieren", der isoliert gruen ist.
3. **Rot-vor-Gruen ist dokumentiert.** Jede Phase hat mindestens einen Test, der VOR der
   Aenderung rot ist. Der rote Lauf gehoert mit Ausgabe in den Phasenbericht. Ein Test, der
   vor dem Fix schon gruen war, beweist nichts.
4. Clean-Code-Gate nach `.claude/refs/clean-code.md` — S1/S2 sind Blocker.
5. Das Abnahmekriterium der Phase aus dem Plan ("rot heute = X, gruen = Y") ist woertlich
   gepruefte Wirklichkeit, nicht sinngemaess abgehakt.

**`PASS` aus dem Workflow ist KEINE Merge-Freigabe.** Vor JEDEM Merge selbst
`git diff --stat` gegen master ansehen. Ein leerer oder absurd kleiner Diff bei `PASS`
bedeutet, dass der Impl-Agent gestorben ist — dann neu laufen lassen, nicht mergen.

## Fixture-Disziplin — hier ist die Kette zweimal gestorben

Die Gefahr ist nicht "kein Test", sondern "Test bestaetigt die eigene Annahme". Die alten
Fixtures erfanden die Feldnamen `leg_id`/`call_leg_id`, die Telnyx nie geliefert hat — die
Tests waren gruen, waehrend live 297 von 297 Belegen verworfen wurden.

Deshalb in jeder Phase:

- Fixtures spiegeln **gemessene** Antwortformen aus dem Plan (Kapitel 1): `meta =
  {total_results:212, total_pages:5, page_size:50}`, Zeitfelder je Typ (`started_at` /
  `start_time` / `created_at`), Zuordnungsfelder je Typ.
- Jede Fixture traegt mindestens ein **Koeder-Feld**, das der Code nicht verwenden darf
  (`telnyx_leg_id`, `call_leg_id`). Laeuft ein Test gruen, obwohl nur der Koeder passt, ist
  der Test falsch.
- **Der Null-Zwilling gehoert in jede Beleg-Fixture** (Plan F3/PM-11): je Anruf existieren
  ZWEI `sip-trunking`- und ZWEI `call-control`-Belege, davon je einer echt bei null
  (`cost=0.0`, `billed_sec=0`, `call_sec=0`). Wer je Typ nur den ersten Treffer nimmt,
  verliert 0,0401 USD und erstattet real ausgegebenes Geld zurueck.

## Inhaltliche Fallen, die schon gemessen sind (nicht neu herleiten)

- **Kein geratener Query-Parameter.** Ein falscher Filtername liefert `200` mit `0` Treffern
  statt eines Fehlers. `filter[created_at]` auf `sip-trunking` -> 0, obwohl das Feld dort
  nicht existiert. Phase 3 sendet deshalb **keinen** Zeitfilter, sondern paginiert.
  Wer trotzdem einen einbaut, liefert die Messung mit.
- **`filter[record_type]` ist Pflicht und nimmt genau einen Wert.** Kein Weglassen, keine
  Array-Syntax (beides 400). Eine Seitenrunde kostet zwingend eine Anfrage je Typ.
- **`page[size]` deckelt bei 50.** Die Truncation-Pruefung geht gegen `meta` aus der
  ANTWORT, nie gegen die eigene Konstante — genau dieser Fehler machte D3 zur Attrappe.
- **Rate-Limit: 40 Anfragen je FIXEM UTC-Minutenfenster** (`x-ratelimit-limit: 40, 40;w=60`,
  Reset immer auf `:00`, kein `Retry-After`). Die Drossel in Phase 4 rechnet mit 30.
- **Die Zuordnung wird verschoben, nicht veraendert.** Sie ist der einzige nachweislich
  funktionierende Teil (live 7/7/10, zusaetzlich unter Parallelitaet bestaetigt).
- **`call-control` traegt keinen Anker** — der Pflicht-Typ ist nur ueber den Session-Weg
  erreichbar. Jede Rueckerstattung haengt daran. Fass die `via_`-Zaehler im Log nicht an,
  ausser um sie zu ergaenzen.
- **Geldpfad bleibt fail-closed:** kein Anker = leere Liste. Ein FREMDER Beleg ist eine
  Fehlbuchung auf einen fremden Tenant; ein FEHLENDER Beleg ist nur `incomplete`. Diese
  Asymmetrie ist der Kern und wird nicht aufgeweicht.

## Repo-Auflagen

- **Neue Env-Variable? Dann an VIER Stellen**: `src/config.js` (Namespace), `.env.example`,
  `render.yaml` UND `BASE_ENV` in `test/helpers.js`. Fehlt die letzte, leckt die lokale
  `.env` in die Spawn-Tests und die Suite wird unerklaerlich instabil.
- Kommentare deutsch, **ohne Umlaute** (ue/oe/ae), wie im Bestand.
- **NIE `git add -A`** in diesem Repo. Dateien einzeln adden. Untrackte Dateien nie
  loeschen, ohne sie vorher zu sichern.
- Force-Push nur mit `--force-with-lease` (es pushen mehrere Sessions auf denselben Remote).
- Nach jeder gemergten Phase: `git push origin master` UND `git push upstream master` —
  sonst divergieren die Remotes. `autoDeploy` ist AUS (2026-07-21 nachgemessen), ein Push
  loest also KEINEN Deploy aus.

## Absolute Grenzen

- **NICHT deployen.** Kein `trigger_deploy`, keine Env-Aenderung auf Render, kein
  `scripts/sweep-jetzt.sh` (das loest bis zum Fix 224 Anfragen aus). Merge auf `master` ist
  kein Ausliefern und ist erlaubt.
- **Keine echten Anrufe.** Die Messungen sind erledigt, der Plan traegt die Zahlen.
- Telnyx-API hoechstens read-only und gedrosselt, und nur wenn eine Phase es wirklich
  braucht — im Regelfall braucht keine.
- Safety-Gates, Offenlegungssatz, Auth fail-closed bleiben unantastbar.
- **Nicht neu aufrollen:** der `ai-voice-assistant`-Pfad bleibt, keine Belegtabelle, kein
  Wasserstand, keine Sub-Accounts. Die Begruendungen stehen im Plan, Kapitel 2.

## Wenn du blockierst

Nicht raten und nicht drumherum bauen. Anhalten, den Stand in `tasks/` festhalten, mir
sagen was fehlt. Ein ehrlicher Stopp ist billiger als eine plausible Erfindung — genau daran
ist dieses Thema zweimal gestorben.

## Was ich am Ende bekomme

1. **Je Phase ein Bericht** unter `tasks/ke-p<N>-report.md`: was geaendert wurde, der ROTE
   Lauf vor dem Fix mit Ausgabe, der gruene danach, Suite-Zahl, Clean-Code-Urteil.
2. **`PLAN-KOSTEN-ENDSPIEL.md` fortgeschrieben** — je Phase abgehakt, mit dem, was sich
   gegenueber dem Plan als anders herausgestellt hat. Ueberholtes korrigieren, nicht
   fortschreiben.
3. **Eine Deploy-Checkliste** `tasks/ke-DEPLOY-CHECKLIST.md` fuer mich, mit:
   - was in welcher Klammer live geht (Klammer 1 = Phase 0+1, Klammer 2 = Rest),
   - der Auflage `COST_TRUING_MAX_ATTEMPTS` zurueck auf 5,
   - allen neuen Env-Variablen mit Wert,
   - dem Abnahmekriterium fuer Phase 7 woertlich: welcher Befehl, welche Log-Zeile,
     welche Zahl gruen ist und ab wann zurueckgerollt wird.
4. **Eine ehrliche Restliste**: was NICHT umgesetzt wurde und warum.
