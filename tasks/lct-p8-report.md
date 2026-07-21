# LCT Phase P8 — Flag `COST_TRUING_BOOKING_ENABLED` entfernen

- **Status:** Gate = **PASS**
- **finalBranch:** `phase/lct-p8-remove-flag`
- **headCommit (Worktree):** `14e1da0f8a4bd39b8bc484d7ae16459f23098c05`
- **Ausgangspunkt:** `master` HEAD `3537272`
- **Ergebnis:** Flag vollstaendig entfernt (grep 0 Treffer), Sicherungen unkonditional gehaertet statt entfernt, Buchungslogik byte-identisch, 2846/2846 Tests gruen (JSON-Backend).

---

## DEPLOY-KONSEQUENZ

> **Nach P8 ist die Korrekturbuchung im Code BEDINGUNGSLOS aktiv.** Der bisherige `COST_TRUING_BOOKING_ENABLED`-Schalter existiert nicht mehr — es gibt keinen Env-Abschalter mehr, der den AN-Zweig deaktivieren koennte. Ein Deploy dieses Standes schaltet die Korrekturbuchung ohne Moeglichkeit zum Zurueckrudern per Konfiguration scharf.
>
> Die eigentlich vorgesehene Zeit-Vorbedingung fuer diese Phase — **ein voller Abrechnungsmonat Live-Betrieb mit Flag AN, ohne Drift-Alarm** (so im urspruenglichen ABSCHALTPLAN in `src/config.js` festgehalten) — wurde **nicht erfuellt**. Der Owner hat sie am **2026-07-21 bewusst uebergangen**, mit folgender Begruendung:
> - kein Nutzerbestand (null zahlende Nutzer),
> - der Flip (`COST_TRUING_BOOKING_ENABLED=true`) war **nie live**,
> - der maximal moegliche Schaden ist durch `MAX_BUDGET_EUR` (aktuell 30) gedeckelt.
>
> **In dieser Kette wird nicht deployt.** P8 macht den AN-Zustand zum **Code-Default**, nicht zum **Live-Zustand** — der Branch ist gemergt in den Sinne dieser Kette, aber ein Produktions-Deploy ist ein separater, spaeterer Schritt und erfordert eine neue Bewertung zum Zeitpunkt, an dem echte Nutzer existieren (siehe Safety-Concern unten).
>
> Zusaetzliche operative Voraussetzung fuer einen kuenftigen Deploy: Da der Pflicht-Mengen-Riegel (`costTruingBookingFindings`) ab dieser Phase **unkonditional** ist, muss vor dem naechsten Live-Deploy geprueft werden, dass `COST_TRUING_REQUIRED_RECORD_TYPES` im Render-Dashboard (nicht nur in `render.yaml`, da Dashboard-managed) einen **nicht-leeren** Wert traegt — sonst verweigert der Riegel den Produktions-Boot (`exit(1)`).

---

## Plan (gekuerzt)

Verifiziert auf `master` HEAD `3537272`. Vor dem Umbau bestaetigte grep-Treffer fuer `COST_TRUING_BOOKING_ENABLED`/`costTruingBookingEnabled` in: `src/boot.js`, `src/boot-guard.js`, `src/config.js`, `src/billing/cost-truing.js`, `test/cost-truing-booking.test.js`, `test/cost-truing-booking-guard.test.js`, `test/provider-rate-guard.test.js`, `test/config-namespaces.test.js`, `test/helpers.js`, `.env.example`, `render.yaml`.

**Drei Wahrheiten vor dem ersten Edit:**

1. **Der Pflicht-Mengen-Riegel darf nicht sterben.** `boot-guard.js` hatte einen Kurzschluss `if (bookingEnabled !== true) return [];` als erste Zeile von `costTruingBookingFindings`. Die Flag-Bedingung faellt weg, die Pruefung selbst wird **unkonditional** — mechanisches Loeschen haette den Riegel entweder mitgeloescht oder ihn ueber ein `undefined`-als-falsy stillgelegt.
2. **Versteckte Kopplung 1 — Spawn-Test-Suite.** `test/helpers.js` `BASE_ENV` setzte `COST_TRUING_REQUIRED_RECORD_TYPES: ""` (leer) **und** `COST_TRUING_BOOKING_ENABLED: "false"`. Der Flag-`false` schluckte bisher die leere Pflicht-Menge per Kurzschluss. Sobald der Riegel unkonditional wird, waere ohne Anpassung **jeder** Spawn-Test am Boot gescheitert (`process.exit(1)`) — `BASE_ENV` musste die Pflicht-Menge auf einen nicht-leeren Wert setzen.
3. **Versteckte Kopplung 2 — `truedSourceOf` in In-Process-Tests.** `test/cost-truing-observe.test.js` setzte das Flag nie, las also bislang den Falsy-Zweig (`P3`-Verhalten, roher `measured.source`). Nach P8 faellt dieser Zweig weg; Test `(h2)` (vollstaendige Records, `estimatedCostCents=null`) haette gebrochen und musste intentionserhaltend (bookbarer Schaetzbetrag statt `null`) nachgezogen werden.

Zusatz: `costTruingCoveragePercent([])` liefert `0` — nach P8 emittiert jeder generische Spawn-Boot (0 Calls) eine neue, aber **korrekte** WARN „Deckungsquote 0% liegt unter …=80%". Blast-Radius geprueft: keine Assertion bricht, nur ein Kommentar in `boot-failclosed.test.js` musste nachgezogen werden. `MIN_COVERAGE_PERCENT` in `BASE_ENV` auf 0 zu senken wurde verworfen (haette `voice-tariff-full-cost-guard.test.js:88` gebrochen).

**Aenderungsumfang laut Plan:**

- **Produktionscode (4 Dateien):** `src/config.js` (Flag-Definition inkl. Kommentarblock loeschen, Namespace-Liste bereinigen), `src/billing/cost-truing.js` (`truedSourceOf` und `trueOneCall`: Flag-Verzweigung entfernen, Rest byte-identisch), `src/boot-guard.js` (`costTruingBookingFindings`: Kurzschluss entfernen, Pruefung wird unkonditional; Kurs-Guard-Kommentar ohne Flag-Token umschreiben), `src/boot.js` (`assertCostTruingBooking`: `bookingEnabled`-Parameter aus dem Aufruf entfernen).
- **Deploy/Doku (2 Dateien):** `.env.example`, `render.yaml` — Kommentarblock + Env-Key ersatzlos loeschen, angrenzende `COST_TRUING_*`-Keys bleiben.
- **Tests (7 Dateien):** `test/helpers.js` (BASE_ENV: Pflicht-Menge nicht-leer setzen, Flag-Zeile loeschen), `test/cost-truing-booking.test.js` (AUS-Zweig-Tests g-a/g-b/g-c/o loeschen, `fakeConfig` ohne Flag), `test/cost-truing-booking-guard.test.js` (U1 + p3 loeschen, U2-U5/(n2)/(p1)/(p2) ohne `bookingEnabled`-Param, (n1) flag-frei umbauen), `test/provider-rate-guard.test.js` (Flag-Assertions in F2-01/F2-02 entfernen), `test/config-namespaces.test.js` (gepinnte Counts nachziehen: billing 36→35, Total 124→123, checked 116→115), `test/boot-failclosed.test.js` (nur Kommentar zur neuen unbedingten Deckungs-WARN), `test/cost-truing-observe.test.js` ((h2) mit bookbarem `estimatedCostCents` statt `null`).

**Rot-vor-Fix-Nachweis laut Plan:** grep-Kriterium vorher ungleich 0, danach 0; (n1) startet ohne jedes Flag-Setup und erwartet Boot-Refusal bei leerer Pflicht-Menge; Verifikations-Zwischenschritt — Riegel testweise aushebeln, (n1)/(n2) muessen kippen, danach zurueckbauen; Kurs-Guard F2-01 bleibt unveraendert scharf ohne Flag-Assertion.

Bestaetigte Byte-Identitaet: `bookCorrectionFor`, `refundProven`, `applyCostCorrectionCents` (Asymmetrie, Rundung, Provider→Bucket-Umrechnung, `NO_ESTIMATE`/`INCOMPLETE`) bleiben unangetastet — es verschwindet ausschliesslich die Flag-Verzweigung an drei Stellen.

---

## Impl-Zusammenfassung

Phase P8 wurde wie geplant umgesetzt: `COST_TRUING_BOOKING_ENABLED` ist aus `src/config.js`, `src/boot.js`, `src/boot-guard.js`, `src/billing/cost-truing.js`, `.env.example`, `render.yaml` und allen betroffenen Testdateien entfernt (grep 0 Treffer, gross- und camelCase). Der bisherige AN-Zweig der Korrekturbuchung ist jetzt unkonditional und byte-identisch zur vorherigen Buchungslogik. Der sicherheitskritische Pflicht-Mengen-Riegel wurde von flag-bedingt auf unkonditional gehaertet — per Rot/Gruen-Probe direkt am Code bewiesen (Riegel testweise ausgehebelt, (n1)/(n2)/U2/U5 kippen sofort rot, danach sauber zurueckgesetzt, `git diff` bestaetigt byte-identisch zum vorherigen Edit-Stand).

`test/helpers.js` `BASE_ENV` musste `COST_TRUING_REQUIRED_RECORD_TYPES` auf einen nicht-leeren Wert (`sip-trunking,call-control`) setzen, sonst haette der jetzt unkonditionale Riegel die gesamte Spawn-Test-Suite am Boot gehindert.

Alle 2846 Tests laufen zweimal hintereinander gruen (kein Flake), JSON-Backend. Committed auf Branch `phase/lct-p8-remove-flag`, Commit `14e1da0`.

### Deviations

1. **`render.yaml`/`.env.example` behalten `COST_TRUING_REQUIRED_RECORD_TYPES` leer (Bestand).** Der Plan schrieb hier keine Aenderung vor. Da der Pflicht-Mengen-Riegel ab dieser Phase unkonditional ist, wuerde ein Render-Deploy mit exakt diesem Wert (falls das Dashboard Blueprint-Defaults uebernaehme) den Boot verweigern. Da Render laut Wissensstand Dashboard-managed ist (`render.yaml` != Live-Werte), wurde dies ausserhalb des Scopes dieser Phase belassen — mit dem expliziten Hinweis, dass der Owner vor einem Live-Deploy den tatsaechlichen Render-Dashboard-Wert pruefen/setzen muss (siehe DEPLOY-KONSEQUENZ oben).
2. **Dritte, vom Plan nicht erkannte Kopplung gefunden und behoben:** Der Store-Stub in `test/cost-truing-observe.test.js` hatte kein `applyCostCorrectionCents`. Der Plan nahm an, `(e)` und `(h2)` blieben gruen, weil `dataComplete=false` die Buchung verhindere — tatsaechlich ruft `bookCorrectionFor` `store.applyCostCorrectionCents` **immer** auf, sobald `estimatedCostCents` bookbar ist (`dataComplete` steuert nur das Verhalten *innerhalb* der Store-Funktion). Ohne Fix waeren beide Tests mit `TypeError` gecrasht. Root-Cause-Fix: Store-Stub bekam dieselbe echte state-ops-Delegation wie in `cost-truing-booking.test.js` (kein Test-Verbiegen, sondern Wiederherstellung eines vollstaendigen Store-Kontrakts).
3. **Voller manueller Smoke-Test liess sich im frischen Worktree nicht vollstaendig durchfuehren** (fehlende geseedete Nummer via `npm run bootstrap-tenant`, unrelated zu P8). Ersatz: automatisierte Spawn-Tests (n1)/(n2)/F2-01/F2-02 starten denselben `src/server.js`-Prozess mit `SKIP_TWILIO_SIGNATURE_CHECK` und decken Boot-Refusal (leere Pflicht-Menge) sowie Boot-Erfolg (Pflicht-Menge gesetzt) ab, plus die manuelle Rot/Gruen-Riegel-Probe direkt am Code.

---

## ROT-VOR-FIX-Nachweis

**grep-Treffer vor dem Umbau:** 21 Treffer in 12 Dateien fuer `COST_TRUING_BOOKING_ENABLED`/`costTruingBookingEnabled` ueber `src/`, `test/`, `.env.example`, `render.yaml` (im Transcript dokumentiert).

**Die zwei Boot-Guards, geprueft ohne jedes Flag-Setup (nach dem Umbau):**

1. **Pflicht-Mengen-Riegel:** `COST_TRUING_REQUIRED_RECORD_TYPES=""`, kein `COST_TRUING_BOOKING_ENABLED` gesetzt (existiert nicht mehr) → `exit(1)`, Meldung nennt `COST_TRUING_REQUIRED_RECORD_TYPES`, kein „Gateway laeuft"-Banner. Gegenprobe mit nicht-leerer Pflicht-Menge → `/healthz` 200.
   - **Load-bearing-Beweis:** Riegel testweise mit `if (false && requiredRecordTypes.length === 0)` ausgehebelt → `(n1)` kippt sofort rot (Server bootet trotz leerer Pflicht-Menge), ebenso die davon abhaengigen fatal-Erwartungen in U2/U5. Nach Rueckbau (Backup-Restore, `git diff` bestaetigt byte-identisch zum vorherigen Stand) sind alle Tests wieder gruen.
2. **Kurs-Guard:** `PROVIDER_TO_BUCKET_RATE_MICRO=920` (Kurs ausserhalb Band), kein Flag-Setup → `exit(1)`, `/Start abgebrochen/`, kein Boot-Banner. Unveraendert scharf — nur die Flag-Assertion in F2-01/F2-02 entfiel.

---

## Harte Zusagen mit Beleg

| Zusage | Beleg |
|---|---|
| **grep 0 Treffer** | `grep -rn "COST_TRUING_BOOKING_ENABLED"` und `grep -rni "costTruingBookingEnabled"` ueber `src/ test/ .env.example render.yaml` → 0 Treffer, verifiziert von Impl, Safety- und Clean-Code-Review unabhaengig. |
| **Pflicht-Mengen-Riegel unkonditional UND existiert noch** | `costTruingBookingFindings` nimmt `bookingEnabled` nicht mehr als Parameter an; `if (bookingEnabled !== true) return [];` entfernt; `REQUIRED_TYPES_EMPTY`-Pruefung bleibt `fatal: true` und laeuft bei jedem Boot. Rot/Gruen-Probe (Riegel testweise ausgehebelt → (n1)/(n2)/U2/U5 kippen) beweist, dass er tatsaechlich load-bearing ist, nicht nur kosmetisch vorhanden. |
| **Kurs-Guard fatal** | `PROVIDER_TO_BUCKET_RATE_MICRO=920` ohne Flag-Setup → `exit(1)` + `/Start abgebrochen/`, kein Boot-Banner (F2-01, unabhaengig von Safety-Review nachvollzogen). |
| **Buchungslogik byte-identisch** | In `cost-truing.js` fielen exakt zwei Flag-Verzweigungen weg: `truedSourceOf` (`!bookingEnabled → measured.source` geloescht), `trueOneCall` (`if (measured && bookingEnabled)` → `if (measured)`). `bookCorrectionFor`, `refundProven`, `applyCostCorrectionCents`, Rundung, Provider→Bucket-Umrechnung, `NO_ESTIMATE`/`INCOMPLETE`-Asymmetrie unveraendert — von Safety- und Clean-Code-Review getrennt bestaetigt. |
| **AUS-Zweig geloescht, nicht auskommentiert** | Kein einziger Fall von totem/auskommentiertem Code: AUS-Zweig in `config.js` (Flag-Definition), `cost-truing.js` (`truedSourceOf`/`trueOneCall`), `boot-guard.js` (Kurzschluss), `boot.js` (`bookingEnabled`-Param) sowie die zugehoerigen AUS-Zweig-Tests (g-a/g-b/g-c/o, U1, p3) wurden geloescht. Von Clean-Code-Audit unter C5/G9 explizit verifiziert. |

---

## Safety-Urteil

**Verdict: APPROVED.**

- `behaviorAsIntended`, `testsPassIndependently`, `redBeforeFixCredible`, `safetyGatesIntact`, `disclosureIntact`, `grepZeroHits`, `requiredSetGuardSurvivesWithoutFlag`, `rateGuardStillFatal`, `bookingLogicUnchanged`, `noDeadOrCommentedCode`, `noFailOpenPath`, `scopeRespected` — alle **true**, **keine Blocker**.
- Unabhaengig verifiziert (eigenes Spawn-Skript, nicht die Suite): (1) leere Pflicht-Menge ohne Flag → `exit(1)`, nennt die Env-Var, kein Boot-Banner, erwaehnt das alte Flag nicht; (2) Pflicht-Menge gesetzt → `/healthz` 200; (3) Kurs ausserhalb Band ohne Flag → `exit(1)`, kein Boot-Banner.
- Voll-Suite: JSON-Backend 2846/2846 gruen. pg-Backend 2498 pass / 42 fail — **alle 42 Fehlschlaege sind reine DB-Unerreichbarkeit** (kein lokales Postgres im Worktree, AggregateError/ECONNREFUSED), keiner davon im P8-Umfang (cost-truing/boot/rate-guard: 0 Fehler).
- Scope eng eingehalten: nur das Flag plus notwendige Test-/Config-/Doc-Anpassungen, keine neuen Dependencies, kein Fremd-Refactoring.

**Zwei Concerns (kein Blocker):**

1. **pg-Backend-Ausfaelle** sind eine Umgebungslimitierung des Worktrees (kein lokales Postgres), keine P8-Regression — sollten aber vor einem Merge/Deploy, falls die Policy „beide Backends gruen" verlangt, auf einer echten Datenbank gegengeprueft werden.
2. **Zeit-Vorbedingung uebergangen:** Der Owner hat die Vorgabe „ein voller Abrechnungsmonat mit Flag AN" am 2026-07-21 bewusst uebersprungen (null zahlende Nutzer, Flip nie live, Schaden durch `MAX_BUDGET_EUR=30` gedeckelt). Ab P8 ist die Korrekturbuchung im Code bedingungslos aktiv; ein Deploy schaltet sie ohne Env-Abschalter scharf. Merge ist nicht gleich Deploy — vor dem ersten Live-Deploy muss dies neu bewertet werden, sobald echte Nutzer existieren.

---

## Clean-Code-Audit

**Verdict: PASS — kein Blocker.**

Sauber verifiziert:
- grep-Kriterium 0 Treffer bestaetigt.
- **C5/G9** (toter/auskommentierter Code): kein einziger Fall — AUS-Zweig in allen vier Kern-Dateien geloescht, nicht auskommentiert.
- **G12** (ungenutzte Imports/verwaiste Konstanten): keine — `boolEnv` bleibt 19x anderweitig genutzt, `applyCostCorrectionCents`-Import in `cost-truing-observe.test.js` aktiv verwendet, `config-namespaces`-Counts korrekt nachgezogen (billing 36→35, Total 124→123, primitive Blaetter 116→115).
- Pflicht-Mengen-Riegel exakt wie gefordert vom Flag-Parameter befreit, blieb unkonditional scharf — kein „undefined-falsy"-Totstellen.
- Tests: AUS-Zweig-Faelle (g-a/g-b/g-c, o, U1, p3) korrekt entfernt statt vergessen; die verbleibenden Tests liefen isoliert 65/65 gruen.
- `npm test`: 2845/2846 gruen; der eine Fehlschlag (`voice-signature-403-log.test.js`) liegt in einer vom Diff nicht beruehrten Datei und lief isoliert 2/2 gruen — bekanntes Lastflake-Muster, keine echte Regression.

**Einziger S3-Befund (kein Blocker):** In `src/config.js:405` blieb der Kommentar ueber `costTruingMinCoveragePercent` bei „Vorbedingung des Flips (P4/P4b lesen DIESELBE Schwelle, bewusst keine zweite)" stehen, obwohl der „Flip" (`COST_TRUING_BOOKING_ENABLED`) in dieser Phase entfernt wird. Der analoge Kommentar in `.env.example:257` wurde im selben Diff korrekt auf eine flip-freie Formulierung umgeschrieben — `config.js` blieb inkonsistent. Empfohlener Fix: Kommentar an die `.env.example`-Formulierung angleichen.

**S4 (kosmetisch, kein Blocker):** In `test/cost-truing-booking-guard.test.js:12` wurde Unit-Test `U1` geloescht, die verbleibenden heissen weiterhin `U2-U5` (Nummerierungsluecke statt Umnummerierung) — rein kosmetisch, keine funktionale Auswirkung.

**Optionaler topTodo (ausserhalb Diff-Scope):** Die vorbestehende Sektionsueberschrift „Kosten-Abgleich im Beobachtungsmodus (LCT P3, misst — bucht NICHT)" in `.env.example:242` und `render.yaml:196` ist seit der Korrekturbuchung faktisch ueberholt (bucht jetzt unkonditional statt nur zu messen) — kein P8-Scope, aber naheliegend fuer eine Folge-Aufraeumung.

---

## Fix-Runden

Keine. Der Impl-Agent lieferte bereits im ersten Durchgang ein Ergebnis, das sowohl vom Safety- als auch vom Clean-Code-Review ohne Blocker (S1/S2 leer) durchgewunken wurde. Der `FIXES`-Abschnitt der Kette ist leer — die zwei gemeldeten Findings (S3 Kommentar-Inkonsistenz in `config.js`, S4 Nummerierungsluecke in Testnamen) sind rein kosmetisch und wurden als offene topTodos dokumentiert statt eine Fix-Runde auszuloesen.
