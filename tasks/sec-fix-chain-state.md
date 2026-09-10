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
| SEC-P5 | Web-Haertung | `320be0a` | **ja, auch live** | Aussenmessung 2026-09-10 bestanden, s. unten |
| SEC-P6 | Antwort statt Haenger + Waechter | `4345c98` | **ja** | 18 neue Faelle; Pin NACHGEZOGEN (alle Werte sinken); Waechter-3-Erwartung korrigiert |

## Zusatzbefund SEC-P6: die Waechter-3-Erwartung der Vorlage war falsch gemessen

`PLAN-SEC-FIX.md` verlangte, `toolDefs("de")` liefere exakt vier Namen. Am Code und an der
Laufzeit gemessen liefert `toolDefs` NUR den festen Basissatz beider Engines
(`end_call`, `take_message`); die beiden bedingten Werkzeuge (`get_consult`, `look_up`)
haengt erst `agentTools(call)` an. Ein Waechter auf `toolDefs` mit der Vier-Namen-Erwartung
waere sofort rot gewesen - also genau der Waechter, den man am naechsten Tag abschaltet.
Der Zwei-Namen-Satz ist ausserdem bereits dreifach gepinnt (P1b-2, M8, P11-5).

Umgesetzt ist deshalb die inhaltlich gemeinte Zusage an der Stelle, an der der Satz
ENTSTEHT: `agentTools` ist dafuer aus `src/claude.js` exportiert (eine Zeile, keine
Verhaltensaenderung, kein neuer Aufrufer in `src/`). Gepinnt sind beide Endzustaende -
Kanaele offen = exakt vier Namen, Kanaele zu = exakt der Basissatz; die beiden Faelle sind
einander Positiv-Kontrolle (die Messung reagiert auf 2 <-> 4).

## Zusatzbefund SEC-P6: der Fehlerpfad hatte ZWEI Haelften

Ein try/catch nur um die Gate-Schleife haette 14 der 17 Faelle NICHT behoben: die
Ablehnungs-Senke der Route ruft nach dem Gate erneut `store.tenantGeo` (ueber
`denialDimensions`) - selbst eine der sterbenden Datenquellen. Sie warf dort ein zweites
Mal, ausserhalb jedes Gates, also wieder ohne Antwort. Beide Haelften sind gefixt und
einzeln gepinnt (`SEC-P6-4`, `SEC-P6-5`). Volle Begruendung in PLAN-SECURITY.md,
Abschnitt "SEC-P6".

## Ausgangsmessung des Leads (voller Lauf, vor SEC-P0)

`npm test` -> Exit 1, `# tests 5803 / # pass 5801 / # fail 2 / # skipped 0`.
Rot: `KV2-10 (d1)` und `KV2-10 (d2)` aus `test/kv2-10-tarifpaar.test.js`.
Die fuenf bekannten Flake-Dateien haben in diesem Lauf NICHT gefeuert.

## LIVE seit 2026-09-10

Die Kette ist gemergt (`7937e9c`, inkl. Merge mit FW1/FW2 von upstream) und **deployt**:
Gateway `vodafone-agent` manuell um 20:02, Marketing `hermes-web` automatisch um 19:58.
Der HSTS-Header des Static-Service ist im Render-Dashboard gesetzt (Owner-Schritt erledigt).

**Aussenmessung SEC-P5 am 2026-09-10, alle drei Oberflaechen bestanden:**

| Oberflaeche | HSTS | `script-src` |
|---|---|---|
| `sundartha.com` | `max-age=15552000; includeSubDomains` | `'self'` |
| `app.sundartha.com` | dito | `'self'` |
| `vodafone-agent.onrender.com` | dito | `'self'` |

Kein `'unsafe-inline'` und kein `'unsafe-eval'` mehr in `script-src` auf irgendeiner der drei.
Der urspruengliche Befund (HSTS fehlte auf allen dreien, `'unsafe-inline'` auf zweien) ist
damit geschlossen — gemessen, nicht behauptet.

## Die Kette ist vollstaendig. Endstand am 2026-09-09

Alle sieben Phasen sind gemergt, jede mit erfuellter Abnahme, jede vom Lead selbst
nachgemessen. `npm audit --omit=dev --audit-level=high` liefert Exit 0. Der Launch-Katalog
(`test:gates`, 767 Faelle, 3 rot) und die Abnahmebank (`test:abnahme`, 13 von 14) duerfen rot
sein — das sind keine Regressionsbaenke.

## Offener Befund F-1, jetzt DIAGNOSTIZIERT: die Bank ist unter voller Parallelitaet nicht mehr verlaesslich gruen

**Messung am Kettenende, gleicher Commit, dieselbe Bank:**

| Lauf | Parallelitaet | Ergebnis | Dauer |
|---|---|---|---|
| 1 | Standard (15 Kerne) | 5880/5883, **3 rot** | 150 s |
| 2 | Standard | 5881/5883, **2 rot** | 150 s |
| 3 | Standard | 5881/5883, **2 rot** | 150 s |
| 4 | `--test-concurrency=4` | **5883/5883, Exit 0** | 410 s |

Die Fehlermenge WECHSELT zwischen den Laeufen (`AL-P10-1`, `dial-target-normalization`,
`OC-P1-60`, `INBOX-P2 C2`); jeder betroffene Fall ist isoliert drei- bis viermal gruen, und
keine der Dateien liegt im Diff der Phase, in der sie auffiel. **Es sind Rennen, keine
Regressionen** — und die gedrosselte Messung beweist es, statt es zu behaupten.

**Die Kette hat den Druck selbst erhoeht.** 146 Testdateien starten einen echten Server; 51
Testdateien hat diese Kette beruehrt, mehrere Spawn-Tests sind neu hinzugekommen. Der Schwellwert,
ab dem die vorhandene Race kippt, ist dadurch ueberschritten worden. SEC-P0 konnte das nicht
fixen: damals feuerte keine einzige Flake, und ohne Reproduktion ist keine Wurzel zu belegen.
Jetzt IST sie reproduzierbar.

**Was das fuer die Abnahmen dieser Kette heisst: nichts.** Jede Phase hatte ihren eigenen
gruenen Volllauf, und die neuen Faelle jeder Phase sind deterministisch gruen — sie starten
keine Serverfarm. Betroffen ist die Verlaesslichkeit kuenftiger Laeufe, nicht die Gueltigkeit
der bisherigen.

**Empfehlung (naechste Arbeit, NICHT in dieser Kette gebaut):** die Wurzel sitzt in der
Spawn-/Bereitschafts-Mechanik von `test/helpers.js`, nicht in einzelnen Testdateien — eine
deterministische Bereitschaftspruefung statt eines Zeitfensters, eigener Zustand je Test,
sauberes Abraeumen des Kindprozesses. Eine dauerhafte Drosselung der Parallelitaet ist
ausdruecklich NICHT die Loesung (sie verdeckt die Ursache und verdreifacht die Laufzeit), aber
sie ist ein brauchbarer Hebel, wenn ein einzelner CI-Lauf verlaesslich sein muss.

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
| SEC-P5 | `wf_2b6d8a49-c2b` | 42,4 Mio | 352 | 20,4 Mio / 134 Turns |
| SEC-P6 | `wf_b57ea129-640` | 66,4 Mio | 430 | 35,0 Mio / 185 Turns |
| **Summe** | | **406,2 Mio** | **2986** | |

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
6. **SEC-P4, Anbieter-Seite ERLEDIGT 2026-09-10, Schalter noch AUS.** Beide Live-Werkzeuge
   (`look_up` = `tool_6601m0bpfeqme9ssbpw9z8qhreyy`, `get_consult` =
   `tool_8801m00mvv3zfxhbcwbszpvfg9ae`) tragen jetzt `tenant_token` im
   `request_body_schema`, gefuellt ueber `dynamic_variable: "tenant_token"` — dieselbe
   Mechanik, die `conversation_id` ueber `system__conversation_id` schon benutzt.

   **Nicht** ueber `scripts/push-elevenlabs.mjs` gepatcht (das schriebe die GANZE
   Live-Konfiguration aus der lokalen `.env`), sondern gezielt: Schnappschuss per GET,
   EIN Feld ergaenzt, `PATCH /v1/convai/tools/{id}` mit exakt dem Live-Stand zurueck.
   Gegengeprueft per erneutem GET und Feld-fuer-Feld-Vergleich: **nur** die neun Felder der
   neuen Eigenschaft sind dazugekommen, nichts entfernt, nichts geaendert. `required` bleibt
   `["query"]` bzw. `["question"]` — ein fehlender Wert ergibt `FEHLT`, keinen Anbieter-Fehler.
   Schnappschuesse vorher/nachher liegen im Scratchpad der Sitzung.

   **Warum das ohne Risiko war:** `tenantTokenVerdict` liefert bei leerem Wert `FEHLT`, und
   `FEHLT` haengt am Schalter. Solange `ELEVENLABS_TENANT_TOKEN_REQUIRED` fehlt (live nicht
   gesetzt = Default `false`), laeuft alles wie vorher.

   **WAS NOCH FEHLT, und warum es einen Testanruf braucht:** dass das Feld ANKOMMT, ist noch
   nicht gemessen. Der Server loggt im Erfolgsfall nichts (`PASSEND` und `FEHLT`-bei-Schalter-aus
   kehren beide still zurueck, `webhooks-elevenlabs.js:217/218`) — ein Logblick beweist also
   nichts. Der Beleg ist EIN Testanruf ueber den EL-Weg und danach der Blick in den
   ElevenLabs-Gespraechsdatensatz, ob der Werkzeug-Aufruf ein NICHT-leeres `tenant_token`
   trug. Erst dann darf `ELEVENLABS_TENANT_TOKEN_REQUIRED=true` gesetzt werden. Umgekehrt
   waere der Preis: `look_up` und `get_consult` antworten 404 und der Agent verstummt.

   Kontext, der die Dringlichkeit bestimmt: `ELEVENLABS_OUTBOUND_ENABLED` ist live **`true`**
   (im Dashboard nachgesehen) — der EL-Weg ist der tatsaechlich genutzte Outbound-Pfad, kein
   ruhender Zweig.

~~Alter Stand:~~ **NEU aus SEC-P4: Anbieter-Push der ElevenLabs-Werkzeug-Vorlage.** Der Code ist gebaut und
   getestet, steht aber hinter `ELEVENLABS_TENANT_TOKEN_REQUIRED=false`. Scharf wird der
   Mandanten-Riegel erst, wenn die geaenderte Werkzeug-Vorlage beim Anbieter liegt (sie holt
   `tenant_token` ueber `dynamic_variable` in den Anfragekoerper) UND der Schalter danach auf
   `true` geht. Reihenfolge ist nicht optional: Schalter zuerst = `look_up` und `get_consult`
   antworten 404, der Agent verstummt im Gespraech. Bis dahin ist die Quer-Mandanten-Reichweite
   nur zur HAELFTE geschlossen — der Ablehnungsgrund verraet den fremden Anruf nicht mehr, die
   Bindung selbst gelingt weiterhin.
7. ~~HSTS des Static-Service im Render-Dashboard~~ — **ERLEDIGT 2026-09-10.** Gesetzt unter
   `hermes-web` -> Headers (eigener Navigationspunkt unter "Manage", NICHT in Settings):
   Path `/*`, `Strict-Transport-Security`, `max-age=15552000; includeSubDomains`. Wirkte
   sofort, ohne Redeploy. Die Dashboard-Kopie ist eine DRITTE Stelle neben `src/middleware.js`
   und `render.yaml` — der Test kann sie nicht sehen, ein Tippfehler dort bliebe unentdeckt.
8. ~~Aussenmessung der drei Oberflaechen~~ — **ERLEDIGT 2026-09-10**, s. Abschnitt oben.

## Ausdruecklich nicht Teil der Kette

ID-01 (Besitznachweis eigene Nummer, Owner-Entscheidung 2026-09-08), L-04, GATE-04, W4.
