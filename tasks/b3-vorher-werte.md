# Vorher-Werte fuer B3/B5 — Basismessung 2026-08-08

**Pflicht laut `PLAN-ANBIETER-PORT.md` Teil 2, B3:** *"Vorher-Werte sind PFLICHT und muessen
VOR dem Umbau stehen — sonst ist hinterher nicht unterscheidbar, ob der Port oder das Modell
schuld ist."*

Erhoben **vor** jeder Zeile Port-Code. Rohdaten (gitignored):
`data/convo-bench/baseline-shim-2026-08-08/` — 80 Berichte.

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
| d3-nachschlag-auftrag | 50/55 | 91 % | concern 2, **ohne Urteil 3** | 2-8 |
| spaeter-nochmal | 46/50 | 92 % | **fail 5** | 2 |
| termin-duenn | 48/50 | 96 % | concern 3, pass 1, fail 1 | 2-4 |
| mandat-innerhalb | 63/65 | 97 % | pass 4, fail 1 | 3-4 |
| partner-knapp | 39/40 | 98 % | concern 3, pass 2 | 5-10 |
| personenwechsel | 44/45 | 98 % | pass 5 | 5-7 |
| kauderwelsch-erstantwort | 49/50 | 98 % | pass 4, concern 1 | 3-4 |
| mandat-ausserhalb | 54/55 | 98 % | **fail 4**, pass 1 | 3-9 |
| anrufbeantworter | 35/35 | 100 % | pass 3, concern 2 | 2-4 |
| d3-fremde-recherche | 50/50 | 100 % | **ohne Urteil 5** | 2 |

## Werkzeug-Aufrufe (aus `metrics.turns[].tools`, nicht aus dem Transkript gegrept)

| Werkzeug | Laeufe | Szenarien |
|---|---|---|
| `end_call` | 62/80 | 15 |
| `take_message` | 25/80 | 8 |
| `get_consult` | **5/80** | 1 |
| `look_up` | **3/80** | 1 |

Je d3-Szenario:

| Szenario | Werkzeuge |
|---|---|
| `d3-consult-verlangt` | **`get_consult` 5/5**, `take_message` 4/5, `end_call` 4/5 |
| `d3-nachschlag-auftrag` | `look_up` 3/5, `end_call` 2/5 |
| `d3-fremde-recherche` | **kein Werkzeug, 0/5** |

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
   still als "kein Problem" durchgehen.

## Was diese Messung NICHT hergibt

- **Keine Aussage ueber `texml`.** Wer den Nachher-Wert dort erhebt, misst etwas anderes.
- **Keine Aussage zu `inbound-nachricht` und `hold-warteschleife`** — 2 der 18 Szenarien fehlen.
- **Keine Latenz-Aussage fuer echte Anrufe.** Der Bench faehrt gegen einen lokal gestarteten
  Server mit gefaketem Exa; Netz- und Carrier-Latenz fehlen vollstaendig.
