# Phase KV-P0 — Flush-Stichtag (`BILLING_FLUSH_EPOCH`)

**Gate: PASS**
**finalBranch:** `phase/kv-p0-flush-stichtag`
**headCommit:** `b8028cc` (Parent `375a032` auf master, master steht inzwischen weiter vorn — Rebase vor Merge empfohlen, s. unten)

## Flush-Stichtag: die Altzeilen koennen nicht mehr abgerechnet werden

138 nie an Stripe gemeldete `usage_event`-Zeilen aus dem Vorbetrieb (Stand 2026-08-03) lagen hinter einem scharfen (`PAYMENT_ENABLED=true`), aber ausloeserlosen Endpunkt (`POST /api/billing/flush-meters`). Ein einziger Aufruf haette sie alle auf einmal an echte Kunden gemeldet — darunter Inbound-Minuten zum alten 300-ct-Worst-Case-Tarif und zwei als `number_month` etikettierte Einrichtungsgebuehren. Diese Phase baut einen Riegel: ohne gesetzten, gueltigen Stichtag wird **nichts** gemeldet; mit Stichtag wird nur gemeldet, was **auf oder nach** ihm liegt. Die 138 Altzeilen selbst werden von dieser Phase **nicht angefasst** — sie bleiben stehen und werden lediglich fuer den Flush unerreichbar, solange der Stichtag nicht zurueckdatiert wird.

## Was gebaut wurde

- `BILLING_FLUSH_EPOCH` (neue Env-Variable, ISO-8601 mit Zone) — fail-closed geparst in `src/config.js` (`isoInstantEnv`, Muster `numEnv`/`boolEnv`): fehlt/leer → `null` (kein Fatal, dokumentierter Ruhezustand); gesetzt aber falsche Form → `fatalConfigErrors` → Boot-Refusal.
- `state-ops.flushableMeterEvents(s, { flushEpochIso })` — neue, alleinige Auswahlfunktion: baut auf `pendingMeterEvents` auf, filtert `occurredAt >= epochIso` (inklusiv), liefert `{ events, skipped, skipReason }`.
- `billing/meter.js`: `aggregatePendingMeters(s)` → `aggregateMeterEvents(events)` umbenannt und umgebaut — nimmt nur noch eine ihm uebergebene Liste entgegen, waehlt selbst nichts mehr aus (hat keinen Zugriff mehr auf `s`).
- `flushMeters` reicht `flushEpochIso` durch, liefert jetzt `{ sent, failed, skipped, skipReason }` statt `{ sent, failed }`; loggt bei `skipReason === "no_flush_epoch"` eine `console.warn`-Zeile (nur Zaehler, kein Event-Inhalt).
- Route (`routes/api-billing.js`): reicht `config.billing.flushEpochIso` durch, Audit-Zeile traegt `sent=… failed=… skipped=… grund=…`.
- Env-Verdrahtung an vier Stellen (`config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV) — s. unten.
- Neue Testdatei `test/kv-p0-flush-epoch.test.js` (KV-P0-1..10).

## filterLocation

`src/store/state-ops.js` → `flushableMeterEvents(s, { flushEpochIso })`, direkt hinter `pendingMeterEvents`.

Nicht umgehbar fuer einen zweiten Aufrufer, weil `aggregateMeterEvents` (umbenannt aus `aggregatePendingMeters`) keinen Zugriff mehr auf den State `s` hat — es nimmt nur noch eine ihm uebergebene `events`-Liste entgegen und kann daher selbst nicht mehr auswaehlen. Ein zweiter Flush-Pfad muesste entweder `flushableMeterEvents` aufrufen (dann gilt der Riegel automatisch) oder `pendingMeterEvents`+`aggregateMeterEvents` direkt verdrahten und den Filter explizit auslassen — das waere im Diff eine sichtbare, bewusste Aussage ueber Geld, kein Vergessen.

Repo-weit gegrept (Impl- und Safety-Bericht unabhaengig bestaetigt): `billing.reportMeter` hat in `src/` genau **einen** Aufrufer (`meter.js:76`, innerhalb von `flushMeters`, hinter `flushableMeterEvents`). `flushMeters` selbst hat genau **einen** Produktions-Aufrufer (`api-billing.js:69`).

## failClosedProof

Drei unabhaengige Ebenen, alle per Test belegt:

1. **Kern** — KV-P0-2 (kein `flushEpochIso`-Feld → `sent=0`, `skipped=3`, `skipReason='no_flush_epoch'`), KV-P0-5 (Muell-Strings `"morgen"`/`"1999-hello"`/`""`/`"kein-datum"` → je `sent=0`), KV-P0-7 (nicht-String-Typen `null`/`undefined`/`0`/`true`/`new Date(0)` → je `events.length=0`, inkl. des `new Date(null)`-Fallstricks: `new Date(null)` ist in JS ein **gueltiges** Datum, 1970-01-01 — ohne den `typeof`-Waechter wuerde ausgerechnet der "nicht gesetzt"-Wert zum aeltesten Stichtag und damit zu "meldet alles" werden).
2. **HTTP-Ebene** — `api-flush-meters.test.js` Fall (E): aktiv, ein pending Event, `flushEpochIso:null` → `200 {sent:0,failed:0,skipped:1,skipReason:'no_flush_epoch'}`, `stripe.meterPosts.length=0`, Event bleibt `stripeMeterSent:false`.
3. **Mutationsprobe M2** (Fail-Richtung umgedreht: bei fehlendem Epoch alle statt keine Events zurueckgeben) faerbte genau die Faelle rot, die diese Behauptung pruefen (KV-P0-2/-5/-7, api-flush-meters (E), zusaetzlich KV-P0-8s zweite Assertion) — der Beweis ist damit eine falsifizierte Gegenprobe, nicht nur eine gruene Behauptung.

Die Safety-Review hat das unabhaengig selbst durchgerechnet (eigener Lauf, eigene Mutation) und bestaetigt: Env fehlt/leer/Whitespace/unparsebar → in jedem Fall `events:[]`; ein NaN-Vergleich kommt gar nicht erst vor, weil bei unlesbarem Stichtag frueh mit leerer Liste ausgestiegen wird.

## bothBackendsProof

KV-P0-8 (`test/kv-p0-flush-epoch.test.js`), lokal **und** in der unabhaengigen Safety-Review gruen verifiziert: `makePgTestStore()` (pglite) → zwei `recordUsageEvent` (vor/nach Stichtag) → `store.save()` → **frische** Store-Instanz über `makePgStore(runner)` + `init()` (echte Re-Hydrierung aus der DB, kein In-Memory-Zustand) → `flushMeters` auf dem re-hydrierten Zustand liefert `sent=1`/`skipped=1` (identisch zum json-Backend-Verhalten in KV-P0-1/-3). Zusaetzliche Typ-Assertion: `typeof usageEvents[0].occurredAt === "string"` — haelt fest, dass `occurred_at` (TEXT-Spalte, `schema.sql`) als String zurueckkommt, nicht als `Date`.

**Strukturelles Argument** (nicht nur Testbeleg): der Filter sitzt in `state-ops.js` hinter der Hydrierung beider Backends auf derselben In-Memory-Struktur (`s.usageEvents`) — es gibt nur eine Implementierung, kein zweiter SQL-`WHERE`-Zweig in `pg.js`.

**Ehrlich, ausdruecklich offen:** das ist eine Konstruktionsgarantie plus **ein** Test gegen pglite, **keine** erschoepfende Pruefung jeder pg-Eigenart, und **der Riegel ist gegen die echte LIVE-Datenbank nicht verifiziert** — in dieser Phase gab es keinen Prod-Zugriff. Die Aussage "beide Backends" beruht auf pglite + Konstruktionsargument, nicht auf einem Test gegen die Produktions-Postgres-Instanz.

## Zeitvergleichstyp

String-gegen-String-Vergleich (`e.occurredAt >= epochIso`), beide Seiten kanonisches UTC-ISO-8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`). `recordUsageEvent` stempelt `new Date().toISOString()` (Default) bzw. die durchgereichte Aufrufer-Uhr — alle vier Aufrufer im Repo (`llm-usage.js`, `call-finish.js`, `metering.js` zweimal) liefern kanonisches UTC. Das pg-Backend haelt `occurred_at` als `TEXT` und hydriert denselben String unveraendert; json haelt ihn ohnehin nur im Speicher.

Der Stichtag wird **zweimal** kanonisiert, bevor verglichen wird: `config.js.isoInstantEnv` beim Env-Parse, `state-ops.parseValidDate`+`toISOString()` unmittelbar vor dem Vergleich in `flushableMeterEvents` selbst (die Funktion traut ihrem Aufrufer nicht). `>=` ist bewusst inklusiv — KV-P0-3 prueft den Grenzfall exakt auf dem Stichtag und die Gegenprobe eine Millisekunde davor.

**Offen benannter Randbefund aus der Safety-Review:** die strikte Formvalidierung (`ISO_INSTANT_PATTERN`) sitzt ausschliesslich in `config.js`, nicht neben dem Filter selbst. `flushableMeterEvents` nutzt das laxere `parseValidDate`/`new Date()`: ein direkt (ohne den Umweg über `config.js`) hereingereichter Wert wie `"2026"` ergaebe dort einen gueltigen, aber falschen Stichtag (2026-01-01) und wuerde die Juli-2026-Altzeilen faelschlich freigeben. Heute unerreichbar, weil `config.js` der einzige Leser von `process.env.BILLING_FLUSH_EPOCH` ist und die Route ausschliesslich `config.billing.flushEpochIso` durchreicht (bereits kanonisch oder `null`). Restrisiko fuer ein kuenftiges Skript, das die Env-Variable roh liest und direkt an `flushMeters`/`flushableMeterEvents` reicht.

## Env-Verdrahtung (inkl. BASE_ENV-Pin)

1. `src/config.js` — Parser `isoInstantEnv()` hinter `boolEnv`; `rawConfig.flushEpochIso` im Payment/Billing-Block hinter `numberSetupFeeCents`; `"flushEpochIso"` ans Ende von `CONFIG_NAMESPACES.billing` (Zaehler 35→36, Gesamt-Keys 138→139).
2. `.env.example` — dokumentiert im Payment/Billing-Block hinter `NUMBER_SETUP_FEE_CENTS=0`, Default leer, Fail-Richtung im Kommentar erklaert.
3. `render.yaml` — gleiche Stelle ergaenzt, `value: ""`. **Vorbehalt (MEMORY):** die Live-Render-Services sind Dashboard-managed, `render.yaml` ist nicht die Live-Wahrheit — ein Blueprint-Apply wuerde einen im Dashboard gesetzten Stichtag mit `""` ueberschreiben. Fail-Richtung bliebe dabei sicher (es wuerde dann nichts mehr gemeldet), aber es waere ein stiller Betriebs-Ueberraschungseffekt.
4. `test/helpers.js` `BASE_ENV` — `BILLING_FLUSH_EPOCH: ""` gepinnt (Lehre `test-base-env-drift`: verhindert, dass eine lokal gesetzte `.env` per dotenv in die Spawn-Tests leakt).

Alle vier Stellen sind durch KV-P0-10 gegeneinander gepinnt (Datei-Read-Regex).

## Doku-Zeilen

- **README.md**, Abschnitt "Bewusste Prototyp-Abweichungen (vs. Produkt-PRD)": neuer Punkt "Nutzungsbasierte Weiterbelastung: gebaut, bewusst inaktiv" — haelt fest, dass der Ledger und der Melde-Pfad vollstaendig existieren, aber nicht laufen (kein Ausloeser), dass es **keine** nutzungsbasierte Weiterbelastung gibt (Owner-Entscheidung 2026-08-03), und dass `BILLING_FLUSH_EPOCH` unset der ausgelieferte Zustand ist, in dem nichts gemeldet wird.
- **PLAN-SECURITY.md**, neuer Abschnitt "KV-P0 — Flush-Stichtag verriegelt die Nachmeldung an Stripe": beschreibt was hinzukommt, die Fail-Richtung, das Warum (138 Altzeilen), was sich nicht aendert, den Betriebs-Vorbehalt (nie zurueckdatieren) und ein ausdruecklich benanntes, bewusst getragenes Restrisiko: ein Betreiber mit Admin-Sitzung, der den Stichtag zurueckdatiert und den Endpunkt aufruft, kann die Altzeilen weiterhin melden — der Riegel schuetzt gegen den versehentlichen Ein-Klick-Fall, nicht gegen Absicht.

## Mutationsproben mit Ergebnis

Alle 5 geforderten Mutationen einzeln gefahren, verglichen, zurueckgenommen (`git diff` nach Rueckname zeigte 0 Aenderungen):

| # | Mutation | Ergebnis |
|---|---|---|
| M1 | Filter in `flushableMeterEvents` entfernt (`const events = pending`) | rot genau KV-P0-1/-3/-4/-8, gruen KV-P0-2/-5/-7 — Plan-Erwartung exakt getroffen. |
| M2 | Fail-Richtung umgedreht (kein Epoch → alle statt keine Events) | rot KV-P0-2/-5/-7/api-flush-meters(E) wie geplant, zusaetzlich KV-P0-8 (dessen zweite Assertion denselben No-Epoch-Fall auf pg prueft). |
| M3 | `typeof`-Waechter entfernt | rot nur KV-P0-7 + api-flush-meters(E) (letztere zusaetzlich, da sie `flushEpochIso:null` auch an der HTTP-Grenze prueft). |
| M4 | `>=` zu `>` | rot **KV-P0-3 UND KV-P0-4** — Plan-Mutationstabelle sagte nur KV-P0-3 voraus; Abweichung dokumentiert: Plan-Abschnitt 3 legt KV-P0-4s Fixture woertlich auf denselben Grenzwert wie KV-P0-3 fest — interner Widerspruch zwischen zwei Plan-Abschnitten, keine Implementierungsluecke. Probe blieb trotzdem eng (2 von ~3800 Tests). |
| M5 | `isoInstantEnv` in `config.js` durch rohen `??`-Fallback ersetzt | rot nur KV-P0-9(b)/(c) wie geplant. |

Die Safety-Review hat M2 unabhaengig nochmals selbst gefahren (voller Lauf: 3817→3807 gruen, 10 rot, exakt die zugehoerigen Tests, keine halbe Suite) und danach per `git checkout --` zurueckgenommen.

## Angepasste Bestandstests mit Begruendung

- `test/usage-event-meter.test.js` INV(4): `aggregatePendingMeters(s)` → `aggregateMeterEvents(pendingMeterEvents(s))` — Aggregator waehlt seit KV-P0 nicht mehr selbst aus.
- `test/usage-event-meter.test.js` INV(5)/(5b)/(5c): `flushEpochIso` (fester, weit zurueckliegender Wert) an allen drei Aufrufen ergaenzt, Rueckgabe-Assertion um `skipped:0`/`skipReason:null` erweitert — die drei Invarianten pruefen weiterhin dasselbe, jetzt ueber einem gesetzten Stichtag.
- `test/store-pg-multitenant.test.js` T-PA6-4: Import/Aufruf auf `aggregateMeterEvents(pendingMeterEvents(rs))` umgestellt — reiner API-Anpassungsschritt, Aussage unveraendert.
- `test/api-flush-meters.test.js` (B)/(C)/(D): Body-Assertion um `skipped`/`skipReason` erweitert, `startBillingApp` bekam `flushEpochIso`-Parameter mit Default vor den Fixtures, damit diese Tests weiterhin einen scharfen Flush messen; neuer Fall (E) misst den Riegel selbst auf HTTP-Ebene.
- `test/config-namespaces.test.js`: `billing:35→36`, `EXPECTED_TOTAL_KEYS 138→139`, `checked 129→130` — additive Buchhaltung des einen neuen primitiven Blatts.
- `test/auth-p6-operator-routes.test.js` AUTH-P6-3/4: **nicht im Plan gelistet**, beim `npm test`-Lauf real gekippt (das geteilte `OPERATOR_CONFIG` setzt kein `flushEpochIso`, der Flush ist damit fail-closed geriegelt) — Assertion um `skipped`/`skipReason` erweitert; Datei prueft die Admin-Sitzungs-Sicherung, nicht die Metering-Fachlogik, Erweiterung ist additiv, keine Abschwaechung.

## Safety-Urteil

Unabhaengige Review (eigener Worktree, eigener Testlauf): `npm test` 3817/3817 gruen, eigene Mutationsprobe bestaetigt fail-closed und Unumgehbarkeit repo-weit gegengrept. Verdikt: **FREIGABE**.

Vier Punkte ausdruecklich als Concern/Restrisiko festgehalten (kein Blocker):

1. Strikte Formvalidierung sitzt nur in `config.js`, nicht neben dem Filter (s. Zeitvergleichstyp oben) — heute unerreichbar, aber Falle fuer einen kuenftigen zweiten Env-Leser.
2. `render.yaml` mit `value:""` koennte bei einem (laut MEMORY derzeit nicht praktizierten) Blueprint-Apply einen Dashboard-Wert stumm ueberschreiben — Richtung bleibt fail-closed.
3. Branch-Basis `375a032` liegt hinter dem aktuellen master; Diff-Pruefung ergab, dass die scheinbare Aenderung an einer Kickoff-Doku-Datei kein Loeschen durch diese Phase ist, sondern neuerer master-Inhalt — Rebase vor Merge trotzdem empfohlen.
4. Der zurueckdatierbare Admin-Fall ist bewusst getragenes, in `PLAN-SECURITY.md` benanntes Restrisiko.

## Clean-Code-Audit (S1-S4)

**Verdikt: PASS.** Keine S1-/S2-Befunde, damit kein Blocker.

- S1: leer.
- S2: leer.
- S3: leer.
- S4 (kosmetisch, kein Fix noetig): `epochIso`-Zwischenvariable in `flushableMeterEvents` sauber; positiv vermerkt: `METER_FLUSH_SKIP` als benannte Konstante (G25), `parseValidDate` als eine wiederverwendete Quelle statt Duplikat (G5), `aggregateMeterEvents` sauber von `flushableMeterEvents` getrennt (SRP).

Geprueft und bestaetigt: Ganzzahl-Cents durchgehend, keine Magic Numbers ohne Namen, ein Konzept pro Test, Grenzfall als eigener Test, Kommentare durchgehend Deutsch ohne Umlaute (gegrept, 0 Treffer), kein toter/auskommentierter Code, `node --check` auf allen vier Kerndateien gruen.

## Fix-Runden

Keine — der Bericht listet `=== FIXES ===` leer. Die Phase ging ohne Nachbesserungsrunde durch Safety und Clean-Code-Audit.

## Was diese Phase NICHT tut

- **Kein Ausloeser gebaut.** Kein Cron, kein Sweep-Hook, kein Timer für `flushMeters`. Der Endpunkt bleibt manuell, admin-only.
- **Keine Altzeile angefasst.** Die 138 Zeilen mit `stripeMeterSent=false` wurden nicht geloescht, umetikettiert oder nachgebucht — sie bleiben unveraendert im Ledger stehen, lediglich fuer den Flush unerreichbar solange der Stichtag nicht zurueckdatiert wird.
- **Keine Gate-Achse beruehrt.** `usage.costCents`/`spendMonthCostCents`, `bookCents`, `budgetExceeded`, Sofortbuchung, Ist-Abgleich — unveraendert. `state-ops.js` bekam nur Zuwachs (neue Funktion + Konstante), keine Aenderung an bestehenden Gate-Pfaden.
- **KV-P9 gestrichen.** Kein Backfill, keine DB-Spalte, kein `schema.sql`-Edit, keine Aenderung an Abo-Preis/Tarif.
- Keine Auth-Aenderung, kein neuer `route-policy.js`-Eintrag, keine neue Dependency.

## Was der Lead nach dem Merge tun muss

**`BILLING_FLUSH_EPOCH` muss im Render-Dashboard (Live-Service, dashboard-managed, nicht `render.yaml`) explizit gesetzt werden**, sobald der Flush-Pfad je bewusst genutzt werden soll — mit einem Zeitpunkt **nach** allen 138 Altzeilen, niemals rueckdatiert vor sie.

**Wenn der Lead das nicht tut:** Der ausgelieferte Zustand ist `BILLING_FLUSH_EPOCH` leer/unset → jeder Aufruf von `POST /api/billing/flush-meters` liefert `{sent:0, failed:0, skipped:N, skipReason:"no_flush_epoch"}` und meldet **nichts** an Stripe — das ist die sichere Fail-Richtung und erfordert keine Aktion, solange der Flush-Pfad ohnehin nicht genutzt wird (README: "gebaut, bewusst inaktiv", keine nutzungsbasierte Weiterbelastung). Es besteht also **kein Zeitdruck** und **kein Risiko** durch Nichtstun — der Riegel ist im Ruhezustand sicher. Handlungsbedarf entsteht erst, wenn/falls der Lead den Flush-Pfad je aktiv nutzen will; dann zuerst den Stichtag setzen, danach den Endpunkt aufrufen, nie umgekehrt. **Nicht separat verifiziert:** ob `render.yaml`s `value:""` bei einem kuenftigen Blueprint-Apply einen im Dashboard bereits gesetzten Wert ueberschreiben wuerde (Concern 2 oben) — vor einem Blueprint-Apply gegenpruefen.
