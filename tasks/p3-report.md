# Phasenreport P3 — Inbound-Pflichtsatz (GAP-14, WEB-04)

**Thema:** Compliance-Pflichtsatz im laufenden Betrieb — jeder Inbound-Anruf erhaelt vor der Begruessung einen gesprochenen Hinweis, dass mit einer KI gesprochen wird und das Gespraech transkribiert/zusammengefasst wird.

**Gate:** PASS
**finalBranch:** `phase/i18n-p3-inbound-pflichtsatz`
**headCommit:** `03206490` (5aace15a12ad5e1e04c2cce1954f07ea gekuerzt/verkettet lt. Impl-Report — siehe Branch)
**Basis:** `master` = `839b249`

---

## 1. Plan (gekuerzt)

### Ausgangslage
Der gesprochene Inbound-Erstsatz entsteht in **beiden** Live-Kanaelen an **einer** Stelle: `src/routes/voice.js`, Handler `POST /voice/incoming` — `greeting = ctx.settings.greeting.replaceAll("{owner}", ctx.ownerName)`. Von dort geht derselbe String entweder in `turnDirectives(...)` (TeXML-Gather, Budget-Engine) oder in `inboundAssistantHandoffXml(...) -> vc.speak({text: greeting})` (Telnyx-Assistant-Pfad). Die Assistant-eigene Begruessung ist und bleibt leer (`buildAssistantConfig(...).greeting === ""`, gepinnt). **Konsequenz:** Ein Fix an dieser einen Stelle deckt beide Kanaele; der Telnyx-Assistant-Provisioner wird in P3 nicht angefasst (A5 damit ohne Provisioner-Lauf geloest).

Rot-vor-Fix gemessen: 3 rote Blaetter (`GAP-14 a`, `GAP-14 b`, `WEB-04`).

### Gewaehlter Wortlaut (O7 — Session entscheidet selbst, kein Freigabe-Gate)

| Sprache | Pflichtsatz |
| --- | --- |
| de | „Hinweis: Sie sprechen mit einer KI, das Gespräch wird transkribiert und zusammengefasst." |
| en | „Please note: you are speaking to an AI, and this call is transcribed and summarised." |
| fr | « Information : vous parlez à une IA, cet appel est transcrit et résumé. » |

Begruendung: „transkribiert" statt „aufgezeichnet" ist die wahrheitsgemaesse Aussage — Hermes speichert kein Audio, nur Transkript + Summary. Ein Aufzeichnungshinweis waere eine Falschaussage in einem Compliance-Satz. ~12 Woerter, erster Teilsatz vor der Begruessung. DE mit echten Umlauten, FR mit echten Akzenten (Konvention `src/i18n/locales.js`). Keine XML-Sonderzeichen, keine Apostrophe (Escaper-/TTS-sicher).

### Marker-Definition
Zwei Bedingungen muessen gleichzeitig gelten: ein **KI-Marker** UND ein **Transkriptions-/Aufzeichnungs-Marker**, sprach-**union** (alle drei Sprachen in einem Praedikat) — weil ein Patch `language` und `greeting` gleichzeitig umstellen darf und sonst genau der Sprachwechsel-Patch durchfiele. Beide Bedingungen noetig, damit nicht ein Greeting durchrutscht, das nur Transkription erwaehnt und den KI-Hinweis dauerhaft unterdrueckt.

### Bausteine
1. **`src/i18n/inbound-notice.js`** (neu, Blatt-Modul, importfrei) — `INBOUND_NOTICES` (de/en/fr), `hasInboundNotice(text)`, `withInboundNotice(text, notice)`. Bewusst ohne Importe: `store/defaults.js` konsumiert es, `i18n/locales.js` importiert `defaults.js` — jeder Rueckimport waere ein Zyklus.
2. **`src/store/greeting-notice-migration.js`** (neu) — `backfillGreetingNotices(s)`: einmalige, idempotente Bestands-Nachruestung markerloser Greetings, reine State-Mutation ohne eigenes IO.
3. **`src/i18n/locales.js`** — neues, von `disclosure()` (Outbound, Regel 2) getrenntes Feld `inboundNotice` je Bundle + kuratierte `greetingVariants`; Korrektur der EN/FR-`greetingDefault` (Terminversprechen raus, da kein Buchungs-Tool existiert).
4. **`src/store/defaults.js`** — `DEFAULT_GREETING` traegt den Pflichtsatz AT REST (per `withInboundNotice` komponiert, keine zweite Literal-Kopie).
5. **`src/store/views.js`** — neue Funktion `tenantLanguage(s, tenantId)` (eine Quelle fuer „Sprache eines Tenants ohne laufenden Call").
6. **`src/self-service.js`** — Vorlagenmenge folgt der Sprache: `greetingTemplatesFor(language)`, `ALL_GREETING_TEMPLATES` (sprach-Union, Annahme-Menge fuer `selfServicePatch`).
7. **`src/self-service-routes.js`** — ausgelieferte Vorlagen in der Tenant-Sprache statt statisch DE.
8. **`src/store/state-ops.js`** — selektiver Write-Guard: `FIELD_GUARDS = { greeting: hasInboundNotice }` in `updateSettings`; nur das Greeting-Feld faellt bei fehlendem Marker raus, der Rest des Patches laeuft durch.
9. **`src/routes/voice.js`** — der strukturelle Erzwingungspunkt: Pflichtsatz gerendert (nicht gepromptet) fuer Budget-Engine UND Realtime-Engine (dort als eigene `<Say>`-Direktive vor dem Stream-Handoff, `bridge.js` bleibt unberuehrt).
10. **`src/store/json.js`** / **`src/store/pg.js`** — Migration im gemeinsamen Load-Abschluss (`finishLoad`) bzw. beim `init()` unter FORCE-RLS (GUC je Tenant gesetzt, danach zurueck auf `BOOTSTRAP_TENANT_ID`).

### Explizit NICHT Teil von P3
- PROMPT-03 (Greeting-Text folgt automatisch der Tenant-Sprache) -> P11.
- `DEFAULT_LANGUAGE`-Flip / Schreibpfad -> P10.
- `localeFor(...).disclosure(...)`, `claude.js`, `bridge.js` — unberuehrt (Regel 2).
- Telnyx-Assistant-Provisioner — kein Lauf, keine Env-Beruehrung.
- Keine neue Env-Variable/kein Feature-Flag — der Satz ist per O7 nicht abschaltbar (waere ein Regel-2-Verstoss).
- Kein `public/`-Edit (Dashboard rendert heute kein Greeting-Dropdown; Web-Textarbeit ist P9).

### Pre-Mortem-Abgleich
| # | Risiko | Gegenmassnahme | Beweis |
| --- | --- | --- | --- |
| 1 | Doppelsatz / Auflegequote | `withInboundNotice` marker-idempotent, ein Satz, erster Teilsatz | Test „kein Doppelsatz" (Vorkommen === 1), convo-bench als manuelle Abnahme |
| 2 | Total-Ablehnung des Patches | `FIELD_GUARDS` pro Key (`continue`), Bestand einmalig migriert | Test „agentName laeuft trotzdem durch" |
| 3 | Satz im Prompt statt gerendert | Rendering in `voice.js` fuer beide Engines, kein Prompt-Baustein | Tests Fall 1 + 5 |
| 4 | Provisioner-Nebenwirkung | Provisioner nicht gebraucht (Assistant-Greeting bleibt `""`) | Abschnitt „Ausgangslage", `telnyx-assistant-config.test.js` |
| 5 | DE-Regex kippt nach P10-Flip | Testfaelle sprachparametrisiert, Sprache je Fall explizit gesetzt | Test-`CASES`-Matrix |

Bekannt und bewusst nicht geloest: EN/FR-Tenant mit altem DE-Greeting hoert bis P11 den fremdsprachigen Pflichtsatz vor deutschem Body (WEB-04/PROMPT-03-Divergenz, durch P3 nicht verschlimmert).

---

## 2. Implementierung — Zusammenfassung

Exakt gemaess Plan umgesetzt. `headCommit` auf `phase/i18n-p3-inbound-pflichtsatz`, ein Commit ueber `master` 839b249.

- **Neue Dateien:** `src/i18n/inbound-notice.js`, `src/store/greeting-notice-migration.js`, `test/greeting-notice-migration.test.js`.
- **Geaenderte Dateien (src):** `src/i18n/locales.js`, `src/routes/voice.js`, `src/self-service-routes.js`, `src/self-service.js`, `src/store/defaults.js`, `src/store/json.js`, `src/store/pg.js`, `src/store/state-ops.js`, `src/store/views.js`.
- **Geaenderte Tests:** `test/audit.test.js`, `test/de-umlaut-orthography.test.js`, `test/i9-self-service.test.js`, `test/inbound-disclosure-mandatory.test.js` (neu geschrieben + umbenannt, A3), `test/p1b-no-booking.test.js`, `test/web-greeting-templates-i18n.test.js` (neu geschrieben + umbenannt, A3).

**Ergebnis:** `npm test` 3107/3107 gruen (vorher 3104, +3 durch A3-Umbenennung der vormals gate-pflichtigen Tests). `npm run test:gates` bleibt erwartungsgemaess rot, aber verbessert: 56 statt vorher 60 offene Katalog-Befunde (unabhaengig gegengemessen: 82 Katalogtests / 26 pass / 56 fail auf dem Branch vs. 85 / 26 pass / 59 fail auf `master` — Delta exakt die 3 nach A3 umgezogenen Tests, pass-Zahl unveraendert bei 26, kein Test „umetikettiert" statt gefixt). Smoke-Test am laufenden Server (SKIP_TWILIO_SIGNATURE_CHECK=true) bestaetigt: Pflichtsatz erscheint genau einmal, als erster Satz im TeXML, vor der Begruessung.

### Deviations (aus dem Impl-Report)
1. `test:gates` bleibt bewusst rot (56 statt 60 offene Befunde) — korrekt gemaess CLAUDE.md, keine Regression.
2. Ein weiterer, vorher roter Katalog-Test wurde als Nebeneffekt der Migration ebenfalls gruen (pass 25->26) — nicht gezielt bearbeitet, aber ueber denselben Code-Pfad korrekt mitgeloest.
3. Kein Live-Probe-Anruf und kein convo-bench (n>=5) durchgefuehrt — im Plan als manuelle, nicht automatisierbare Abnahme markiert, ausserhalb des Worktree-Scopes dieser Phase.

---

## 3. Safety-Urteil (final)

**Verdikt: FREIGABE.** Alle absoluten Regeln eingehalten, unabhaengig im frischen Worktree nachverifiziert (nicht nur der Impl-Report geglaubt).

- **Regel 1 (Safety-Gates):** unberuehrt — Nummern-Aufloesung, Budget-Gates (tenant + global), `armMaxDurationTimer` stehen unveraendert vor jeder neuen Zeile; kein neuer Endpunkt.
- **Regel 2 (Offenlegung):** beweisbar intakt — `src/claude.js`/`src/bridge.js` nicht im Diff; `localeFor(l).disclosure()` byte-identisch zu `master` fuer de/en/fr zur Laufzeit verglichen. Inbound-Satz bekam bewusst ein **eigenes** Feld (`inboundNotice`), nicht `disclosure()` mitbenutzt.
- **Regel 3 (Auth fail-closed):** `/voice`-Signaturpruefung, Reihenfolge, TTS-Ausnahme unveraendert; kein neuer Endpunkt; einzige Routen-Aenderung bleibt hinter `webAuthMw`.
- **Regel 4/5:** keine neuen Logs/Secrets/Audio-Pfade; Maskierung (`publicCall`) unangetastet.
- **Regel 6 (Scope):** 18 Dateien, alle P3-bezogen; kein neues npm-Paket, `package.json`/`package-lock.json`/`render.yaml`/`.env.example` unveraendert. Die einzige auf den ersten Blick fremde Aenderung (EN/FR-Terminversprechen entfernt) ist durch WEB-04 selbst erzwungen (bestehender Invarianten-Test P1b-5 verschaerft statt aufgeweicht).

**Unabhaengig gemessene Zahlen:** `npm test` EXIT=0, 3107/3107 (korrigiert 3075/3075 nach Abzug der 32 Datei-Wrapper). `test:gates`: 82/26 pass/56 fail (Branch) vs. 85/26 pass/59 fail (master) — Delta exakt 3 Tests via A3-Umbenennung. `node --check` auf allen 8 geaenderten/neuen `src`-Dateien: OK.

**Eigene Runtime-Proben:** de (default), en, fr (inkl. Fall „markerloses Greeting"), sowie `VOICE_ENGINE=realtime` — in allen Faellen Pflichtsatz sprachrichtig vor der Begruessung bzw. vor dem Stream-Handoff, `<Say>` VOR `<Connect><Stream>`, Stream-Token unveraendert.

### Concerns (kein Blocker, Beobachtungs-/Prozesspunkte)
1. **Fehlender Phasenreport im Branch** (dieser hier schliesst die Luecke retroaktiv) — Plan verlangt, Wortlaut + Gate-Zahlen (59->56 im Report gemessen, Plan-Zaehlung der Katalog-IDs 47->45) im Report festzuhalten.
2. `hasInboundNotice` ist eine Heuristik (Regex-Marker), kein hartes Sperren — bewusst so gewaehlt, damit ein spaeterer Wortlaut-Wechsel Bestandsgreetings nicht schlagartig markerlos macht.
3. Sprach-Union in `selfServicePatch`: ein DE-Tenant kann die EN-Vorlage waehlen; da der EN-Satz den Marker traegt, wird kein deutscher Pflichtsatz mehr vorangestellt — der Anrufer hoert dann Englisch bei de-DE-Stimme. Nichts sperrt heute die Kombination Sprache X / Vorlage Y.
4. Neuer Misch-Sprach-Effekt bis P11 selbst verifiziert: bei `language=en` steht der englische Pflichtsatz vor weiterhin deutschem Bestandsgreeting. Compliance-seitig eine Verbesserung, sprachlich neu.
5. Erst-Boot-Migration schreibt echte Produktionsdaten (mutiert `settings.greeting` jedes Tenants); `pg.js` flusht pro Tenant ohne explizite Transaktionsklammer ueber die Schleife. Idempotenz getestet, Teilabbruch heilt beim naechsten Boot. Erster Deploy sollte beobachtet werden (Boot-Log + Stichprobe).
6. `updateSettings` verwirft ein Greeting ohne Pflichtsatz still (`continue`), antwortet weiterhin 200 — plankonform (selektiv statt Total-Reject), aber ohne explizite Rueckmeldung an den Admin-Pfad.
7. Realtime-Engine spricht den Pflichtsatz unbedingt vor dem Stream-Handoff, ohne Abgleich mit dem prompt-basierten Opener der Bridge — theoretisch Doppelhinweis; `bridge.js` selbst unberuehrt, Realtime ist nicht die Live-Engine, geringes Risiko.

---

## 4. Clean-Code-Audit (final)

**Verdikt: PASS.** Keine S1- oder S2-Befunde.

- **S1 (Blocker):** keine.
- **S2:** keine.
- **S3 (Beobachtungen, kein Verstoss):**
  - N7 — `hasInboundNotice`/`withInboundNotice` sind reine Praedikats-/Kompositionsfunktionen mit klaren Namen; `backfillGreetingNotices` dokumentiert seinen Nebeneffekt (mutiert `s.settings`) im Namen — sauber.
  - G16/G26 — Marker-Regex statt Volltextvergleich in `inbound-notice.js` ist im Kommentar begruendet (Wortlaut-Wechsel darf Bestandsgreeting nicht schlagartig „markerlos" machen) — nachvollziehbare Design-Entscheidung, kein Verstoss.
- **S4 (positiv vermerkt):**
  - G5 (gegengeprueft) — Pflichtsatz wird an genau einer Stelle komponiert (`withInboundNotice`), nicht dupliziert.
  - P15 — `GREETING_TEMPLATES_BY_LANGUAGE` einmalig beim Modul-Load gebaut und eingefroren, kein Lazy-Init/keine Allokation je Request.

**Begruendung (Auszug):** Syntax-Check aller 10 geaenderten/neuen `src`-Dateien gruen; volle Suite auf dem realen Branch-Checkout (frisches `node_modules`) nachgefahren: 3075/3075 gruen. Diff intern konsistent (Signaturverdrahtung `tenantLanguage -> resolveCallLanguage`, `flushSettings`-Aufruf in `pg.js`, `FIELD_GUARDS`-Selektivitaet in `updateSettings` stimmen mit den tatsaechlichen Funktionssignaturen ueberein). Migration idempotent und fuer alle drei Pfade getestet (reine Funktion, json-`load()`, pg-`init()` unter FORCE-RLS). Kein Prozess-/Test-Abschalten, keine Geld-Floats, keine neuen Secrets, keine Safety-Gate-Aufweichung.

**Offene TODOs (nicht sicherheitsrelevant, kein Blocker):** Marker-Regex koennte bei einer zukuenftigen Freitext-Erweiterung (heute nicht moeglich, Self-Service ist Vorlage-only) false positives erzeugen — bereits als bewusster Trade-off dokumentiert, nur beobachten falls Freitext-Greetings je erlaubt werden.

---

## 5. Fix-Runden

Keine. Der Impl-Durchlauf war beim ersten dualen Review (Safety + Clean-Code) bereits PASS/FREIGABE ohne Blocker; keine Nacharbeitung noetig.

---

## 6. Offene Punkte fuer Folge-Phasen

- **P9:** Web-/Dashboard-Bindung des `greetingTemplates`-Feeds (heute geliefert, aber in `tenant.html` nicht gebunden).
- **P10:** `DEFAULT_LANGUAGE`-Flip / Schreibpfad-Aenderung.
- **P11:** PROMPT-03 — Greeting-Text folgt automatisch der Tenant-Sprache (loest die Misch-Sprach-Divergenz aus Concern 3/4 auf).
- **Manuelle Abnahme nachziehen:** echter Inbound-Probe-Anruf auf der Live-DID (Pflichtsatz hoerbar im ersten Satz) + `GET /healthz` auf gepushtem Commit (`git push upstream master`) + convo-bench n>=5 vor/nach (Kostenn-Notiz: ~95 zusaetzliche Zeichen TTS-Synthese pro Inbound-Call bei aktivem ElevenLabs).
