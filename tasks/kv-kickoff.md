# Kickoff: Kosten-Vollstaendigkeits-Kette (KV) — Lean Lead

> **EIGENE, FRISCHE SESSION. Dieser Text ist der ERSTE Prompt darin — nichts davor.**
>
> Nicht in der Session starten, in der Plan und Messungen entstanden sind: deren Kontext
> traegt die komplette Entscheidungs- und Messhistorie, und der Lead soll genau die **nicht**
> mitschleppen. Er braucht drei Dateien und sonst nichts.
>
> **Empfehlung fuer die Lead-Session selbst: Sonnet, nicht Opus.** Der Lead liest keinen
> Code, trifft keine Architekturentscheidung und schreibt keine Implementierung — er pinnt
> Phasen, startet Workflows, prueft Diffs und mergt. Die Denkarbeit liegt vollstaendig in
> den Workflow-Agenten, und die bringen ihre eigenen Pins mit.

---

Du bist der **Lead** einer Phasen-Kette. Deine Rolle ist duenn und bleibt duenn:
pro Phase **genau EIN** `phase-impl-lean`-Workflow, du bekommst nur den kompakten Return
plus die Report-Datei zurueck, du mergst, du gehst zur naechsten Phase. Du liest **nie**
selbst Code, du implementierst **nie** selbst, du reviewst **nie** selbst.

## Zuerst lesen (nur diese drei)

1. `tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md` — der Plan. Owner-Entscheidungen sind
   **beantwortet** (Abschnitt "Owner-Entscheidungen", Tabelle mit Stand 2026-08-03), KV-M1
   ist **gemessen** (Abschnitt "ERGEBNIS KV-M1"). Beides ist bindend, nicht neu zu
   verhandeln.
2. `.claude/refs/workflow.md` — Pflicht.
3. `.claude/refs/clean-code.md` — hartes Gate im Review (S1/S2 = Blocker).

`tasks/kosten-inventar.md` ist die Beweisgrundlage des Plans; **nicht** vorab lesen (42 KB).
Nur nachschlagen, wenn ein Phasen-Report ausdruecklich eine Inventar-ID (K…/L…) anzweifelt.

## Was schon entschieden und gemessen ist — nicht neu aufrollen

- **Inbound bucht auf dieselbe Tenant-Kostendecke** wie Outbound (Entscheidung 1a).
- **Der Live-Zaehler gilt fuer beide Richtungen** (Entscheidung 3b). `activeOutboundCallsFor`
  wird richtungsoffen; es entsteht **keine** zweite `activeInboundCallsFor` (G5).
- **Keine nutzungsbasierte Weiterbelastung an Stripe** (Entscheidung 2a) — KV-P9 ist
  gestrichen; der Flush-Pfad wird als "gebaut, bewusst inaktiv" in `README.md` dokumentiert
  (Teil der Definition of Done von KV-P0).
- **Plattform-Fixkosten bleiben komplett draussen**, auch aus KV-M4 (Entscheidung 7).
- **Inbound-Ist-Kosten: 1,87 US-Cent je angefangener Minute** (US-DID, Budget-Engine,
  Assistant-Pfad NICHT beteiligt). Der Inbound-Satz fuer KV-P2 wird daran kalibriert;
  der Plan schlaegt **6 ct/min** vor (3x ueber Ist, 5x unter dem alten Fallback). Der
  Outbound-Worst-Case von 30 ct/min waere 16-fach ueberhoeht und ist **nicht** zu verwenden.

## Die Kette — 9 Phasen, in dieser Reihenfolge

| # | Phase | Kurz | Hinweis |
|---|---|---|---|
| 1 | **KV-P0** | Flush-Stichtag | Schutz, zuerst. Plus README-Zeile (Entscheidung 2a). |
| 2 | **KV-M0** | Live-Konfig ins Boot-Banner | Entsperrt jede Zahl danach. |
| 3 | **KV-P1** | Kosten-Landkarte als Struktur | **Vorbedingung von P2/P3/P6/P7.** Aendert kein Verhalten. |
| 4 | **KV-P2** | Inbound auf die Gate-Achse | Satz kalibrieren (s.o.). Live-Term zieht mit. Beruehrt Absolute Regel 1. |
| 5 | **KV-P3** | Inbound in den Ist-Abgleich | Hart nach P2. |
| 6 | **KV-M3** | Deckungsquote: richtiger Nenner | Mit den drei Nebenzaehlern aus TOD 8. |
| 7 | **KV-P6** | Ledger in Mikro-Cent | Neue Spalte, kein Backfill. |
| 8 | **KV-M4** | Monatliche Gegenprobe | Nur loggen. Kein zweiter Timer. Keine Fixkosten. |
| 9 | **KV-P7** | Latente Pfade verriegeln | **Scope neu ableiten**, s.u. |

**Nicht in dieser Kette — blockiert, nicht vergessen:**

- **KV-P4** (DID-Miete): blockiert an KV-M2. Es existiert nur die Juni-Rechnung; 2 der 3
  Nummern sind juenger. Wartet auf die naechste Telnyx-Rechnung.
- **KV-P5** (SMS-Preis): blockiert an U3 — es wurde noch **nie** eine SMS gesendet, der
  Preis ist ohne absichtliche Test-SMS nicht messbar. Die Luecke ist dadurch latent.
- **KV-P8** (abgebrochener KI-Turn): blockiert an U4 — kein Anthropic-Admin-Key.

**Zu KV-P7, wichtig:** die KV-M1-Messung hat die Ausgangslage verschoben. Der
`text-to-speech`-Beleg des gemessenen Anrufs traegt **sowohl** die Zeichenzahl (729) **als
auch** einen Betrag (51.030 Mikro-Cent) — TTS-Geld erreicht ueber den Ist-Abgleich also
sehr wohl die Achse, anders als die Erstfassung des Plans annimmt. Die Phase muss deshalb
**zuerst klaeren, welche TTS-Luecke real ist** (eigenes ElevenLabs-Kontingent ueber den
Relay vs. der von Telnyx berechnete Betrag), bevor sie einen Preis-pro-Zeichen-Parameter
baut. Faellt die Klaerung so aus, dass der Telnyx-Beleg die Kosten bereits vollstaendig
traegt, schrumpft KV-P7 auf die zwei Boot-Guards. **Diese Klaerung ist Teil der Phase, keine
Vorarbeit des Lead.**

## Modellpolitik — Sonnet ist der Default, Opus die Ausnahme

**Nicht die ganze Kette mit Opus fahren.** Der Plan teilt die Phasen selbst in zwei Klassen
(Abschnitt "Zum Verfahren"), und genau daran haengt der Modell-Pin:

| Phase | Warum | Plan-Agent | Impl / Audit / Fix / Report | Safety-Review |
|---|---|---|---|---|
| KV-P0, KV-P2, KV-P3 | beruehren Absolute Regel 1 (Geld-Pfad, Kosten-Gate) | **Opus** | Sonnet | **Opus** |
| KV-P7 | Boot-Guards — ein falsch gebauter Guard toetet den Boot | **Opus** | Sonnet | **Opus** |
| KV-M0, KV-P1, KV-M3, KV-P6, KV-M4 | eng umrissen, kippen keine Gate-Entscheidung | Sonnet | Sonnet | Sonnet |

Fuenf der neun Phasen laufen damit **komplett auf Sonnet**. Opus sieht nur die vier, in
denen eine falsche Entscheidung Geld bewegt oder den Start verhindert — und auch dort nur
Plan und Safety-Review, nie die Implementierung.

Warum das trägt: KV-P1 aendert ausdruecklich **kein Verhalten** (es deklariert den
IST-Zustand), KV-M0 und KV-M4 sind reine Ausgabe bzw. reines Logging ohne Sperrwirkung,
KV-M3 aendert eine WARN-Meldung (keinen Sperrpfad), und KV-P6 fuegt eine additiv-nullable
Spalte hinzu, die die Gate-Achse nachweislich nicht beruehrt. Fuer keine dieser fuenf gibt
es eine Entscheidung, an der ein staerkeres Modell etwas retten koennte — der harte Filter
ist dort der Test, nicht das Modell.

**Effort ebenfalls je `agent()` setzen** — das ist der zweite Kostenhebel und wirkt
unabhaengig vom Modell:

- Report-/Zusammenfassungs-Agenten: `effort: 'low'` (sie fassen zusammen, sie entscheiden nichts)
- Clean-Code-Audit: `effort: 'medium'`
- Implementierung: Default lassen (nicht setzen)
- Plan und Safety-Review der vier Opus-Phasen: `effort: 'high'`

Kein `max`, nirgends. Und keinen Opus-Agenten fuer eine Phase spawnen, die nur eine
Log-Zeile oder eine Banner-Ausgabe anfasst.

## Ablauf je Phase — strikt

1. **Per-run-Skript schreiben.** Die Phase wird **hart im Skript gepinnt**, nie ueber `args`
   durchgereicht (bekannte args-Misfire). Skript nach `.claude/workflows/runs/kv-<phase>.js`.
2. **Modell- und Effort-Pins explizit je `agent()`**, nie erben lassen — s. eigener
   Abschnitt "Modellpolitik" unten. Kurzfassung: Sonnet ist der Default, Opus nur dort, wo
   der Plan es begruendet.
3. **Regel 0 im Worktree:** erst `git checkout -b phase/kv-<name> master`, **dann** lesen.
   Der Lead prueft vorher selbst mit `git merge-base --is-ancestor`, dass die Basis aktuell
   ist.
4. **EINE Bahn zur Zeit.** Nie zwei Workflows parallel (zwei Wellen = ~35 `node --test` =
   Systemlast weit ueber den Kernen).
5. **Waehrend eine Welle laeuft: kein Merge auf master, kein `git stash`.** Ein
   master-Commit waehrend des Laufs erzeugt einen falsch-positiven Stale-Base-Blocker;
   `refs/stash` ist worktree-GETEILT und wird geklobbert.
6. **PASS ist keine Merge-Freigabe.** Vor JEDEM Merge selbst `git diff --stat master..<branch>`
   pruefen — ein gestorbener Impl-Agent hinterlaesst einen leeren Branch trotz PASS. Bei
   leerem Diff: nicht mergen, Lauf wiederholen.
7. **Merge im Lead**, nie im Workflow. Danach der naechsten Phase.
8. **Niemals `git add -A`.** Dateien einzeln adden.

## Definition of Done je Phase

- `npm test` gruen (roter Test heisst: etwas ist kaputt).
- `npm run test:gates` darf rot sein — das ist der Launch-Katalog, kein Regressionsfang.
- Neues Verhalten hat einen Test; Mutationsprobe belegt, dass er greift.
- **KV-P0, KV-P2, KV-P3, KV-M3 aktualisieren `PLAN-SECURITY.md`** (KV-P2/P3 tragen die neue
  Inbound-Kosten-Kante mit Zahlen ein).
- Jede Bau-Phase nach KV-P1 kippt **genau eine** Zeile der Landkarte von `nein` auf `ja`,
  und der Landkarten-Test erzwingt, dass die Realitaet mitkippt.
- Neue Spalte = `ADD COLUMN IF NOT EXISTS` in `db/schema.sql` (laeuft beim Boot
  automatisch). Datenheilung = eigener, benannter, idempotenter Backfill-Schritt im Code —
  ein Einmal-SQL in der Konsole zaehlt **nicht** als erledigt.

## Nach der letzten gemergten Phase (Pflicht, im selben Zug)

Prozessmuell der Kette entfernen: `tasks/<phase>-report.md`, `-workflow-report.md`,
`-spec.md`, verbrauchte Kickoffs (auch **diese** Datei), die per-run-Skripte aus
`.claude/workflows/runs/` (neueste Kopie bleibt als Vorlage). Behalten: der Kettenstand,
offene Befunde, `tasks/lessons.md`, `PLAN-KOSTEN-VOLLSTAENDIGKEIT.md` mit den
Phasen-Ergebnissen. **Reihenfolge:** untrackte Doku erst committen, dann loeschen.

## Deploy

Der Merge auf `master` macht **nichts** live. Render deployt vom Upstream-Remote; ein
`git push origin` allein aendert nichts. Deploy-Stand nie aus einer Notiz lesen, sondern
messen (`/healthz` + `git merge-base --is-ancestor`). Vor dem Deploy den Owner fragen.

## Berichte an den Owner

Kurz, deutsch, ohne Floskeln. Pro Phase: was gebaut wurde, welche Landkarten-Zeile kippte,
welche Zahl sich geaendert hat, was offen blieb. Vor dem Start: Umfang, Phasenzahl und
Modell-Pins ankuendigen. Nach dem Ende: Verbrauch nennen.

**Starte mit KV-P0.**
