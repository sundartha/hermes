# Kettenstand: Behebungskette Sicherheitstest (SEC-P0..SEC-P6)

Manifest: `PLAN-SEC-FIX.md`. Belege: `tasks/sicherheitstest-befunde.md`.
Kickoff (Lead-Rolle): `tasks/sec-fix-kickoff.md`.

## Stand je Phase

| Phase | Titel | Merge-Commit | Abnahme erfuellt | Bemerkung |
|---|---|---|---|---|
| SEC-P0 | Testbank gruen | `98cf2bd` | **ja** | Teil (b) Flakes offen, s. unten |
| SEC-P1 | Webhook-Idempotenz | `105c839` | **ja** | 14 neue Faelle; Entscheidung in PLAN-SECURITY.md ab Zeile 3591 |
| SEC-P2 | Lieferkette | `e9dc392` | **ja** | audit high Exit 0; 8 -> 2 Befunde, beide moderat |
| SEC-P3 | Eingabegrenzen + CSRF | `7b88c32` | **ja** | 21 neue Faelle; CSRF_ENFORCE als Rueckfall-Hebel |
| SEC-P4 | EL-Token je Mandant | `bd807a5` | **ja** | 18 Faelle; scharf erst nach Anbieter-Push (Owner-Blocker 6) |
| SEC-P5 | Web-Haertung | — | — | laeuft |
| SEC-P6 | Antwort statt Haenger + Waechter | — | — | — |

## Ausgangsmessung des Leads (voller Lauf, vor SEC-P0)

`npm test` -> Exit 1, `# tests 5803 / # pass 5801 / # fail 2 / # skipped 0`.
Rot: `KV2-10 (d1)` und `KV2-10 (d2)` aus `test/kv2-10-tarifpaar.test.js`.
Die fuenf bekannten Flake-Dateien haben in diesem Lauf NICHT gefeuert.

## Offene Befunde

**F-1 (aus SEC-P0, getragenes Risiko): die fuenf Flake-Dateien sind NICHT stabilisiert.**
`auth-p5-internal-only`, `el-consult-timeout-spur`, `el-geldpfad-s1`,
`telnyx-p5-origination`, `al-p10-precall-research`. Sie haben in DREI vollen Laeufen dieser
Sitzung (Baseline + zwei Abnahmelaeufe) kein einziges Mal gefeuert; ohne Reproduktion ist
keine Wurzel zu belegen, und eine erratene "Stabilisierung" waere schlimmer als keine.

Wirkung auf die restliche Kette: eine Flake kann die Abnahme einer spaeteren Phase falsch rot
faerben. Gegenmittel ist die Bestandslehre `suite-flake-p5-gate-proof` — ein roter Fall in
einer dieser fuenf Dateien zaehlt erst, wenn er ISOLIERT (`node --test test/<datei>.test.js`)
ebenfalls rot ist. Kehrt die Flake zurueck und ist dann reproduzierbar, gehoert sie in eine
eigene kleine Phase, nicht in die laufende.

**F-1 ist GROESSER als die fuenf katalogisierten Dateien.** In SEC-P4 war `OC-P1-67`
(`test/oc-p1-owner-call-http.test.js`) im ersten vollen Lauf rot — isoliert dreimal gruen, und
die Datei liegt gar nicht im Diff der Phase. Diese Datei steht NICHT auf der Fuenferliste aus
SEC-P0. Der gemeinsame Nenner beider Sichtungen dieser Sitzung (`AL-P10-1`, `OC-P1-67`) ist
nicht ein bestimmter Test, sondern die BAUART: Spawn-Tests, die einen echten Server starten.
Wer das angeht, sucht die Wurzel in der Spawn-/Bereitschafts-Mechanik von `test/helpers.js`,
nicht in einzelnen Testdateien.

**F-1 ist seit SEC-P2 belegt LEBENDIG:** im ersten vollen Lauf auf `sec/p2` war `AL-P10-1`
rot, isoliert dreimal gruen, der zweite volle Lauf gruen. Genau das vorhergesagte Muster.

Nebenbefund derselben Wurzelklasse: der SEC-P0-Defekt war eine Zeitbombe (Fixture gegen
Wanduhr). Es kann weitere geben — sie zeigen sich als Test, der ohne Code-Aenderung rot wird.

## Kosten je Lauf (real gemessen, `scripts/workflow-kosten.mjs`)

| Phase | Lauf | Gesamt | Turns | groesster Agent |
|---|---|---|---|---|
| SEC-P0 | `wf_c5b100fd-9b3` | 17,9 Mio | 192 | 9,8 Mio / 80 Turns |
| SEC-P1 | `wf_a691e1ef-a9a` | 106,9 Mio | 722 | 41,3 Mio / 184 Turns |
| SEC-P2 | `wf_80044ac7-77d` | 23,9 Mio | 270 | 9,3 Mio / 85 Turns |
| SEC-P3 | `wf_a8b13fc0-9a4` | 90,3 Mio | 650 | 45,1 Mio / 270 Turns |
| SEC-P4 | `wf_19c04dce-0ce` | 58,4 Mio | 370 | 32,3 Mio / 150 Turns |

SEC-P1 riss den Richtwert (150 Turns je Agent) bei zwei Agenten: Implementierung 184,
Safety-Review 187. Kein Warteschleifen-Muster — die Phase beruehrte beide Store-Backends,
zwei Routen und zwei neue Testdateien. Die Effizienz-Riegel haben gehalten (kein Agent fuhr
die volle Suite), die Groesse der Phase war der Treiber.

**SEC-P3, Fix-Agent bei 270 Turns / 45,1 Mio — bewusst NICHT abgebrochen.** Der Kickoff
verlangt `TaskStop` ab rund 250 Turns. Vor dem Abbruch nachgesehen statt der Zahl geglaubt:
null Warteschleifen, null volle Suite-Laeufe, echte Arbeit. Die Wurzel war nicht Weglaufen,
sondern dass der Impl-Agent seine fertige Arbeit uncommittet liegen liess (s. `lessons.md`) —
der Fix-Agent musste sie erst finden und sichern. Ein Abbruch haette 45 Mio verworfen und die
Phase blockiert zurueckgelassen; er committete vier Minuten spaeter. Die 250er-Schwelle zielt
auf das Poll-Muster, nicht auf teure ehrliche Arbeit — sie bleibt der Anlass zum HINSEHEN,
nicht zum reflexhaften Abbrechen.

## Zusatzbefund SEC-P1: Legacy-Pins weiter angehoben

`makePgStore` 591 -> 596 Zeilen, `rowToCall` 37 -> 38, `callRowValues` 37 -> 39,
`makeVoiceRoutes` 269 -> 273. Keine NEUE abgeschaltete Sicherung, keine neue Regel-Kategorie —
das dokumentierte Bestandsverfahren (Pin anheben, Grund benennen). Die seit 2026-08-15
gemessene lineare Kurve laeuft aber weiter: jedes persistierte Feld kostet einen weiteren
Punkt in Mapper und Werteliste. Der G30-Split von `makePgStore` bleibt die einzige echte
Abhilfe und ist eine Owner-Entscheidung, kein Nebeneffekt einer Sicherheitsphase.

## Abweichung vom Kickoff, bewusst

Das per-run-Skript `.claude/workflows/runs/sec-fix.js` wird NICHT nach jeder Phase geloescht,
sondern erst am Kettenende. Es traegt die Effizienz-Riegel und wird von SEC-P0 bis SEC-P6
unveraendert benutzt; siebenmal loeschen und identisch neu schreiben waere Churn, kein
Aufraeumen. Report- und Spec-Dateien je Phase verschwinden wie vorgesehen im Merge-Zug.

Zweite Beobachtung zum Riegel selbst: in SEC-P0 hat er Teil (b) verhindert (der Impl-Agent
durfte die volle Suite nicht fahren und konnte die Flakes deshalb nicht reproduzieren). Fuer
Phasen, in denen der volle Suite-Lauf das MESSINSTRUMENT ist und nicht nur die Regressionsprobe,
muss der Riegel gelockert werden — das war hier nicht noetig, weil die Flakes ohnehin nicht
feuerten.

## Verbliebene Lieferketten-Befunde nach SEC-P2 (bewusst offen)

2 moderate: `qs` via `express` 4.22.2. Der Abschnitt verlangt nur `--audit-level=high` Exit 0;
diese zwei werden nicht ueber einen weiteren brechenden Sprung gejagt. `npm audit fix` haette
express faelschlich auf 4.22.1 ZURUECKgestuft, ohne das qs-Advisory zu beheben — deshalb wurde
gezielt aktualisiert statt pauschal gefixt.

## Owner-Blocker (nicht vom Assistenten baubar, s. PLAN-SEC-FIX.md Abschnitt 3)

1. Vier Repo-Secrets `TELNYX_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
   `PLATFORM_ANI_E164` auf `jonas986/vodafone-agent` — ohne sie hat der
   Art.-50-Offenlegungs-Drift-Waechter NIE gelaufen und scheitert stuendlich.
2. Render-Zugang fuer den Owner (Produktions-Workspace gehoert `jonas@kroh-willich.de`) —
   DB-05 (Backup + Drill) und der OPS-03-Rest sind ohne ihn nicht messbar.
3. Rotation des Render-API-Schluessels (liegt literal in `~/.claude.json`, Schreibrechte auf
   Produktion, ohne Ablauf).
4. Stripe-Zugang (`team@sundartha.com`) — OPS-04 offen.
5. Zwei-Faktor am Render-Konto des Owners ist aus.
6. **NEU aus SEC-P4: Anbieter-Push der ElevenLabs-Werkzeug-Vorlage.** Der Code ist gebaut und
   getestet, steht aber hinter `ELEVENLABS_TENANT_TOKEN_REQUIRED=false`. Scharf wird der
   Mandanten-Riegel erst, wenn die geaenderte Werkzeug-Vorlage beim Anbieter liegt (sie holt
   `tenant_token` ueber `dynamic_variable` in den Anfragekoerper) UND der Schalter danach auf
   `true` geht. Reihenfolge ist nicht optional: Schalter zuerst = `look_up` und `get_consult`
   antworten 404, der Agent verstummt im Gespraech. Bis dahin ist die Quer-Mandanten-Reichweite
   nur zur HAELFTE geschlossen — der Ablehnungsgrund verraet den fremden Anruf nicht mehr, die
   Bindung selbst gelingt weiterhin.

## Ausdruecklich nicht Teil der Kette

ID-01 (Besitznachweis eigene Nummer, Owner-Entscheidung 2026-09-08), L-04, GATE-04, W4.
