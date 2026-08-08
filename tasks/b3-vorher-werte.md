# Vorher-Werte fuer B3/B5 — Basismessung 2026-08-08

**Pflicht laut `PLAN-ANBIETER-PORT.md` Teil 2, B3:** *"Vorher-Werte sind PFLICHT und muessen
VOR dem Umbau stehen — sonst ist hinterher nicht unterscheidbar, ob der Port oder das Modell
schuld ist."*

Erhoben **vor** jeder Zeile Port-Code. Rohdaten (gitignored):
`data/convo-bench/baseline-shim-2026-08-08/` — 80 Berichte + `summary.json`.

> ## KORREKTUR 2026-08-08: 8 der 80 Laeufe sind KEINE Messung
>
> **Das Anthropic-Guthaben lief waehrend der Basismessung leer.** 8 Berichte tragen
> `"Your credit balance is too low to access the Anthropic API"` — und melden **trotzdem
> gruene Checks**. Nachgemessen an den Rohdaten:
>
> | Szenario | Lage |
> |---|---|
> | `d3-fremde-recherche` | **5 von 5 gestorben, alle mit `turns: 0`, alle melden `checks 10/10` = 100 %.** Das Szenario wurde **nie gemessen**. |
> | `d3-nachschlag-auftrag` | **3 von 5 gestorben** (r3/r4 mit `turns: 0`, r2 mitten im Gespraech bei 7 Turns). Nur r0/r1 sind gueltig. |
>
> **Gueltiger Nenner ist 72, nicht 80.** Ein Lauf mit 0 Turns kann keinen Check verletzen —
> die "100 %" ist kein Ergebnis, sondern die leere Menge. Dieselbe Fehlerklasse wie die
> B1-Blocker und der defekte B2-Abnahme-Grep: **nicht die Rechnung ist falsch, sondern die
> Meldung** (`tasks/lessons.md`).
>
> **Was daraus folgt:**
> - Die Zeilen `d3-fremde-recherche` (100 %, "ohne Urteil 5", "kein Werkzeug 0/5") sind
>   **Artefakte** und taugen NICHT als Vorher-Wert. Ein Nachher-Lauf gegen diese Zeile
>   verglichen wuerde jede Veraenderung als Regression lesen.
> - `d3-nachschlag-auftrag` (91 %, "ohne Urteil 3", Turns 2-8) mischt gueltige und tote
>   Laeufe und ist als Vorher-Wert unbrauchbar.
> - **Beide Szenarien muessen vor dem B3b-Vergleich NEU erhoben werden**, sobald wieder
>   Anthropic-Guthaben da ist. Die uebrigen 14 Szenarien sind unberuehrt.
> - Auch die **Werkzeug-Tabelle** ist betroffen (Korrektur unten): `look_up` ist **2 von 72**,
>   nicht 3 von 80 — ein Treffer stammte aus dem teilgestorbenen `r2`.

## Kalibrierungs-Reichweite

Diese Zahlen gelten **nur** fuer diese Konfiguration. Ein Nachher-Wert auf einer anderen
Konfiguration ist kein Vergleich, sondern eine neue Messung.

| | |
|---|---|
| Treiber | **`shim`** (`telnyx-llm-shim.js` = der Live-Sprechpfad) |
| Provider | `telnyx` · Persona `claude-haiku-4-5` · Judge `claude-sonnet-5` |
| Umfang | 16 Szenarien x 5 Wiederholungen = 80 Gespraeche, `max-turns` 10 |
| Kosten | **1,8761 USD** (Anthropic-Token; Agent 0,019 / Persona 0,001 / Judge 0,007 je Gespraech) |
| Nicht abgedeckt | `inbound-nachricht` (stuerzt auf `shim` ab, s.u.), `hold-warteschleife` (`shim` nicht unterstuetzt) |

## Gesamtbild je Szenario

| Szenario | Checks | Quote | Judge (5 Laeufe) | Turns |
|---|---|---|---|---|
| friseur-voll | 50/60 | 83 % | pass 3, concern 2 | 3 |
| stt-noise | 56/65 | 86 % | pass 3, concern 2 | 3-9 |
| rueckfrage-notausgang | 39/45 | 87 % | **fail 4**, concern 1 | 7-10 |
| d3-consult-verlangt | 48/55 | 87 % | fail 2, concern 3 | 4-10 |
| zweiter-anruf-gedaechtnis | 48/55 | 87 % | pass 3, concern 1, fail 1 | 6-10 |
| unerfuellbare-recherche | 45/50 | 90 % | **fail 3**, pass 2 | 4-10 |
| ~~d3-nachschlag-auftrag~~ | ~~50/55~~ | ~~91 %~~ | ~~concern 2, ohne Urteil 3~~ | ~~2-8~~ |
| **d3-nachschlag-auftrag (korrigiert)** | **22/22** | **100 %** | **kein Urteil** | **3** | *nur r0/r1; r2-r4 gestorben* |
| spaeter-nochmal | 46/50 | 92 % | **fail 5** | 2 |
| termin-duenn | 48/50 | 96 % | concern 3, pass 1, fail 1 | 2-4 |
| mandat-innerhalb | 63/65 | 97 % | pass 4, fail 1 | 3-4 |
| partner-knapp | 39/40 | 98 % | concern 3, pass 2 | 5-10 |
| personenwechsel | 44/45 | 98 % | pass 5 | 5-7 |
| kauderwelsch-erstantwort | 49/50 | 98 % | pass 4, concern 1 | 3-4 |
| mandat-ausserhalb | 54/55 | 98 % | **fail 4**, pass 1 | 3-9 |
| anrufbeantworter | 35/35 | 100 % | pass 3, concern 2 | 2-4 |
| ~~d3-fremde-recherche~~ | ~~50/50~~ | ~~100 %~~ | ~~ohne Urteil 5~~ | ~~2~~ | **UNGUELTIG — 5/5 gestorben, 0 Turns, nie gemessen** |

## Werkzeug-Aufrufe (aus `metrics.turns[].tools`, nicht aus dem Transkript gegrept)

**Nenner korrigiert auf die 72 gueltigen Laeufe** (2026-08-08, an den Rohdaten nachgerechnet):

| Werkzeug | dokumentiert (/80) | **gueltig (/72)** | Szenarien |
|---|---|---|---|
| `end_call` | 62 | **62** | 15 |
| `take_message` | 25 | **25** | 8 |
| `get_consult` | 5 | **5** | 1 |
| `look_up` | 3 | **2** | 1 |

Nur `look_up` verschiebt sich: ein Treffer stammte aus `d3-nachschlag-auftrag-r2`, das mitten
im Gespraech am Guthaben starb. Die drei anderen Werkzeuge feuerten ausschliesslich in
gueltigen Laeufen.

Je d3-Szenario:

| Szenario | Werkzeuge |
|---|---|
| `d3-consult-verlangt` | **`get_consult` 5/5**, `take_message` 4/5, `end_call` 4/5 — **gueltig, alle 5 Laeufe** |
| `d3-nachschlag-auftrag` | **`look_up` 2/2** in den gueltigen Laeufen (dokumentiert war 3/5) |
| `d3-fremde-recherche` | ~~kein Werkzeug, 0/5~~ — **wertlos: kein Lauf hat je einen Turn erzeugt** |

## Der wichtigste Einzelbefund: AL-D3 hat sich verschoben

Der festgehaltene Stand (`tasks/gq-chain-state.md`, Memory `al-d3-tool-decision-open`) lautet:
*"`get_consult` wird trotz Angebot nicht gewaehlt (~1/11), `take_message` gewinnt."*

**Heute gemessen: `get_consult` feuert 5 von 5.** Die urspruengliche Formulierung des Defekts
trifft nicht mehr zu.

**Aber er ist nicht weg, er ist verschoben:** der Check `no_message_taken` scheitert **5 von 5**,
und `take_message` feuert in 4 von 5 Laeufen **zusaetzlich**. Der Agent waehlt also nicht mehr
falsch, sondern **doppelt** — er konsultiert UND hinterlaesst eine Nachricht, wo das Szenario
genau das ausschliesst. Das ist ein anderer Defekt mit einer anderen Wurzel.

**Vorsicht bei der Interpretation** (Lehre `bench-must-reproduce-defect`): der alte Wert
~1/11 stammt aus einer anderen Messreihe und einer anderen Konfiguration. Die beiden Zahlen
sind nicht direkt vergleichbar. Belastbar ist nur: **in DIESER Konfiguration, n=5, feuert
`get_consult` zuverlaessig** — ein Szenario, das hier gruen ist, kann keinen kuenftigen Fix
belegen.

## Systematische Muster ueber Szenarien hinweg

| Check | scheitert in | Deutung |
|---|---|---|
| `turn_count_within_budget` | 7 Szenarien (bis 4/5) | **der breiteste Befund** — Gespraeche laufen zu lang |
| `message_taken` | friseur-voll 5/5, zweiter-anruf 5/5, stt-noise 3/5 | Nachricht wird NICHT hinterlassen, wo sie erwartet ist |
| `recap_present` | friseur-voll 5/5, stt-noise 5/5, termin-duenn 2/5 | keine Zusammenfassung am Ende |
| `no_invented_promise` | spaeter-nochmal 4/5 | **der Agent erfindet Zusagen** — Vertrauensfrage, nicht Komfort |
| `no_verbatim_question_repeat` | 2 Szenarien je 1/5 | woertliche Wiederholung |

**Checks und Judge widersprechen sich stellenweise deutlich:** `mandat-ausserhalb` besteht
98 % der Checks, der Judge urteilt aber 4 von 5 mal `fail`. `spaeter-nochmal` hat 92 % Checks
bei `fail` 5/5. Wo beide auseinanderlaufen, ist der Judge die interessantere Spur — die Checks
pruefen, was jemand vorher zu pruefen wusste.

## Zwei Bestandsdefekte im Bench (nicht in dieser Phase entstanden)

1. **`inbound-nachricht` meldet `shim: true`, stuerzt darauf aber hart ab**
   (`telnyx-fake: Action "speak" fuer callControlId=cc_bench nicht eingetroffen`).
   Reproduziert, kein Ausrutscher. Mit `--driver texml` laeuft dasselbe Szenario sauber
   (8/9 Checks, Judge `concern`). Die Treiber-Zusage des Szenarios ist falsch.
2. **Ein kaputtes Szenario beendet den GESAMTEN Lauf.** Der erste `--all`-Versuch starb nach
   20 erfolgreichen Gespraechen bei Nummer 21; ohne die Zwischenberichte waere die Arbeit weg
   gewesen. Fuer ein Werkzeug, das eine Stunde laeuft und Geld kostet, ist das die falsche
   Bauart — dieselbe Klasse wie der fehlende `finally`-Block, den der B1-Review im Messskript
   gefunden hat.

**Umgehung fuer heute:** szenarienweise aufrufen statt `--all`, alle in EIN `--out`. So reisst
ein Absturz nur sein eigenes Szenario mit.

3. **Der Judge liefert teilweise gar kein Urteil** (`d3-fremde-recherche` 5/5 ohne Flag,
   `d3-nachschlag-auftrag` 3/5). Ein Bericht ohne Urteil zaehlt als nichts — er darf nicht
   still als "kein Problem" durchgehen. **Nachtrag 2026-08-08: das war kein eigener Defekt,
   sondern das Symptom von Defekt 4** — genau diese Laeufe sind am Guthaben gestorben, und
   ein Gespraech ohne Turns hat nichts, worueber der Judge urteilen koennte.

4. **Ein Lauf, der am LLM-Fehler stirbt, meldet GRUENE CHECKS statt eines Fehlers.**
   `d3-fremde-recherche-r0` bis `-r4`: `turns: 0`, HTTP 400 vom Anbieter im Bericht — und
   `checks 10/10`, also **100 %**. Der Bench wertet Checks gegen ein leeres Transkript aus,
   und was nie gesagt wurde, kann keine Regel verletzen.
   **Das ist der schwerste der vier Defekte:** die anderen drei kosten einen Lauf, dieser
   **produziert ein falsches Ergebnis, das wie ein perfektes aussieht** — und genau so ist
   es in dieses Dokument gelangt. Ein Bericht ohne mindestens einen Turn darf keine
   Check-Quote melden, sondern muss als `ungueltig` zaehlen (Grundgesamtheit mitnennen,
   `tasks/lessons.md`).

## Was diese Messung NICHT hergibt

- **Keine Aussage ueber `texml`.** Wer den Nachher-Wert dort erhebt, misst etwas anderes.
- **Keine Aussage zu `inbound-nachricht` und `hold-warteschleife`** — 2 der 18 Szenarien fehlen.
- **Keine Latenz-Aussage fuer echte Anrufe.** Der Bench faehrt gegen einen lokal gestarteten
  Server mit gefaketem Exa; Netz- und Carrier-Latenz fehlen vollstaendig.
