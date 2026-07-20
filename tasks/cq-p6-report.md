# Phase-Report P6 — "Mandat statt Rückfrage" (`mandate`-Schema)

- **Aufgabetyp**: Mandat statt Rückfrage (keine Rückfrage an den Orchestrator nötig)
- **Gate**: **PASS**
- **finalBranch**: `phase/cq-p6-mandate`
- **headCommit**: `1c9135e5a815ce6d6f5cc2345798ada0f8fbbbe0`
- **Basis**: `master` @ `6c84f2d` (P5 gemergt)
- **Committed**: ja · **Push**: nein (weder `origin` noch `upstream`)

---

## 1. Plan (gekürzt)

### Ziel

Ein additives, strukturiertes `mandate`-Feld: `place_call` → `/api/calls` → Store → Prompt-Sektion. Der Agent darf im vom Owner vorab gesetzten Rahmen **mündlich verbindlich zusagen**, statt jede Terminfrage als Nachricht zurückzugeben.

### E1-Grenze (hart, unverhandelbar)

Kein `book_appointment`, kein `get_calendar`, kein `calendarSection`/`calendarExcerpt`, kein Kalender-Lesepfad, kein `execTool`-Case. Die beiden unbedingten Grenzen-Zeilen aus P1b (`- Du hast KEINEN Kalenderzugriff…`, `- Du buchst KEINE Termine fest.`) bleiben wörtlich stehen. Der Mandats-Block enthält einen expliziten Auflösungssatz gegen den scheinbaren Widerspruch: *„Eintragen oder buchen kannst du weiterhin nichts – du sagst nur verbindlich zu, was in diesem Rahmen liegt."*

Kein neues Config-Flag, keine neue Env-Var (Feld ist selbst-gatend: fehlt es, rendert nichts, `.env.example`/`test/helpers.js` BASE_ENV unberührt). Kein `mandate_received`-Meta in der `/api/calls`-Antwort — ungültige Werte enden fail-loud in 400, ein stilles Ignorieren wie bei `context`/`context_received` ist hier nicht nötig.

### Design-Entscheidungen (Auszug)

| # | Entscheidung |
|---|---|
| D1 | Mandats-Block als eigene Top-Level-Sektion zwischen `DEINE GRENZEN` und `SO KOMMST DU ZUM ERGEBNIS` |
| D2 | `systemPrompt` joint künftig mit `.filter(Boolean).join("\n\n")` — Byte-Identität ohne Mandat, Muster aus P5 (`briefing`/`constraints`) |
| D3 | Jeder Unterblock rendert nur bei gesetztem Feld; `AUSSERHALB`-Block rendert immer, sobald irgendein Mandats-Feld gesetzt ist (Default `take_message`) |
| D4 | Constraints-Vorrangsatz nur, wenn `call.constraints` gesetzt ist |
| D5 | Unbekannter `on_out_of_scope`-Wert im Store → Fallback auf Default, kein Throw (fail-safe) |
| D6 | `toolDefs()` bleibt parameterlos (kein call-abhängiges Tool-Set — Blast-Radius `bridge.js`/`telnyx-llm-shim.js` vermieden) |
| D7 | `take_message`-Description bekommt einen neuen, mandats-**un**abhängigen Satz (Haiku-Lehre: Verbot am Tool-Entscheidungspunkt) |
| D8 | Enum lebt in `src/store/defaults.js` — EINE Quelle für zod-Schema, Validierung, Prompt-Renderer |
| D9 | Persistenz als JSONB, Muster `context` (P3): Spalte + `ALTER … IF NOT EXISTS`, im INSERT, NICHT im `ON CONFLICT DO UPDATE SET`, Hydrierung in `rowToCall` (Lehre I8) |

### Geplante Artefakte

- Neue Bench-Szenarien `mandat-innerhalb.mjs` / `mandat-ausserhalb.mjs` + neuer Check `no_message_taken`
- Vier neue Testdateien: `cq-p6-mandate.test.js` (M1–M11, Prompt-Rendering), `cq-p6-mandate-http.test.js` (HM1–HM5, HTTP-Validierung via Spawn), `cq-p6-mandate-persist.test.js` (PM1–PM3, pg+json Roundtrip), `cq-p6-bench-mandate.test.js` (B1–B5, Check/Registry)
- Edits: `src/store/defaults.js` (Enum), `src/routes/_validation.js` (`validateMandate` + generalisierter `validateSubObject`/`pickKnownFields`), `src/telephony/outbound-gates.js` (neues Gate `valid_mandate` zwischen `valid_text` und `assistant_context`), `src/routes/api-calls.js`, `src/store/state-ops.js`, `src/db/schema.sql`, `src/store/pg.js`, `src/claude.js` (Kernstück: `mandateSection()`), `src/mcp-tools.js` (zod-Schema `place_call.mandate`), `scripts/convo-bench/*`, drei Bestandstest-Anpassungen (Order-Pin, Schema-Pin, Testname-Entstaubung)

### Pre-Mortem (Plan)

| Risiko | Entschärfung |
|---|---|
| Mandat als Buchungsvollmacht missverstanden | Auflösungssatz + unbedingte Grenzen-Zeilen bleiben, M8 pinnt sie, Bench-Check `no_invented_promise` |
| Zusage außerhalb des Mandats | `constraints`-Vorrang, `AUSSERHALB`-Block rendert immer, Default `take_message` konservativ, Bench-Szenario (b) misst genau das |
| `mandate` geht bei Restart verloren / wird überschrieben (Lehre I8) | `rowToCall`-Hydrierung + PM1/PM2-Roundtrip |
| Korrupter `on_out_of_scope`-Wert crasht laufenden Turn | D5 Fallback statt Throw, M6 beweist es |
| Freitext-Mandat als Kosten-/Injection-Vektor | Längen-Caps in `TEXT_LIMITS`, unbekannte Sub-Keys fallen weg, Validierung nach allen Sicherheits-Gates und vor `reserve_budget` |
| Stiller Prompt-Drift durch neue Sektion | `filter(Boolean)` + unveränderte SP1–SP6-Pins |

---

## 2. Implementierungs-Zusammenfassung

- **Tests**: 2513 / 2513 grün, 0 Fehler (`node --check` auf allen 8 geänderten `src/`-Dateien sauber)
- **Smoke-Test**: Server auf `PORT=3999` mit `SKIP_TWILIO_SIGNATURE_CHECK=true` + geseedeter Owner-Nummer.
  1. `POST /api/calls` mit `mandate.on_out_of_scope=nope` → HTTP 400, `error='mandate.on_out_of_scope muss einer von take_message, decline, accept_best sein'` — exakt wie im Plan gefordert.
  2. `POST /api/calls` mit gültigem `mandate` → alle Gates passiert, HTTP 500 nur am Offline-Originate (Twilio-Trial-Hinweis), `store.json` enthält den normalisierten `mandate`-Wert unverändert.
  3. `/healthz` → 200.

### Kern der Umsetzung

- **`src/store/defaults.js`**: `MANDATE_OUT_OF_SCOPE`-Enum (`take_message`/`decline`/`accept_best`), `MANDATE_OUT_OF_SCOPE_VALUES`, `MANDATE_OUT_OF_SCOPE_DEFAULT = take_message` — EINE Quelle für zod-Schema, Validierung, Prompt-Renderer.
- **`src/routes/_validation.js`**: `validateMandate` über einen neuen gemeinsamen Unterbau `validateSubObject`/`pickKnownFields`, den `validateAssistantContext` (P3-Bestand) MIT übernommen hat — verhaltens-erhaltender Refactor, byte-identisch für `context` (durch Bestandssuite + Matrix-Beweis abgesichert).
- **`src/telephony/outbound-gates.js`**: neues Gate `valid_mandate` zwischen `valid_text` und `assistant_context` — reines 400-Eingabeband, NACH allen Sicherheits-Gates, VOR `reserve_budget`, kein Audit bei reinem Formatfehler.
- **Durchreichen**: `api-calls.js` → `state-ops.js::createCall` → `pg.js` (JSONB-Spalte `$29`, NICHT im `ON CONFLICT DO UPDATE SET`, `rowToCall`-Hydrierung) + json-Backend (Muster `context`/Lehre I8) → `src/db/schema.sql` (`CREATE`-Spalte + idempotenter `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- **`src/claude.js`** (Kernstück): `mandateSection()` zwischen `boundaryRules` und der Outcome-Sektion; `systemPrompt()` auf `.filter(Boolean).join("\n\n")` umgestellt (Muster D8) — Mandat `""` bei fehlendem Feld hält alle Bestandspins (SP1–SP6, P5-O1..O7, P1b-1..5, R1–R4) byte-identisch **ohne Teständerung** grün. `MANDATE_OUT_OF_SCOPE_SENTENCE` als ein Objekt-Dispatch (G23, statt if/else-Kette). `take_message`-Description um einen mandats-unabhängigen Satz ergänzt (D7).
- **`src/mcp-tools.js`**: `mandate`-Objektschema (`decide_freely`/`fallback_order`/`on_out_of_scope` als `z.enum`) zwischen `constraints` und `context`; Beschreibungen sind bewusst das Feature (zwingen das aufrufende Chat-Modell zum konkreten Rahmen).
- **Bench**: zwei neue Szenarien (`mandat-innerhalb`/`mandat-ausserhalb`) + neuer Check `no_message_taken` (Gegenstück zu `message_taken`, gemeinsame Zählquelle `actionItemCount`, G5).
- **Vier neue Testdateien** (M1–M11, HM1–HM5, PM1–PM3, B1–B5, insgesamt 26 neue Tests) plus vier gezielte Bestands-Anpassungen (Gate-Order-Pin, `place_call`-Schema-Pin, Testname-Entstaubung in `cq-p4-bench-hardening`).

### Deviations (vom Plan abweichende, dokumentierte Entscheidungen)

1. **Import statt Re-Export**: Die Plan-Formulierung zu `MANDATE_OUT_OF_SCOPE_VALUES` war doppeldeutig zwischen Re-Export und reinem Import; entschieden für einen reinen Import in `_validation.js` (kein externer Konsument braucht den Wert von dort — `mcp-tools.js` importiert direkt aus `store/defaults.js`, wie der Plan an anderer Stelle vorgibt). Minimale API-Fläche statt unnötigem Re-Export (G8).
2. **M1/M2-Interpretation**: Der Plan ließ offen, was „Baseline" exakt meint. Interpretiert als: M1 = Determinismus + kein `SPIELRAUM`-Marker bei fehlendem `mandate`; M2 = `{}` und `null` kollabieren auf denselben Output wie das fehlende Feld (Muster R4). Kein Duplikat des riesigen SP1-Golden-Literals angelegt (G5) — dessen Grün-Bleiben ohne Teständerung ist bereits der harte Byte-Identitäts-Beweis.
3. **`mandat-ausserhalb.mjs`**: trägt laut Plan ein `mustNotAskSubstrings`-Feld, obwohl der zugehörige Check (`no_redundant_ask_about_briefed_info`) nicht in der `checks`-Liste des Szenarios steht — bleibt damit unbenutzte Metadaten. Wörtlich aus dem Plan übernommen, auch ohne aktuelle Wirkung.

---

## 3. Safety-Urteil (final)

**Verdikt: APPROVED.** Phase P6 verletzt keine der absoluten Regeln.

### Prüfmethode (unabhängig, in eigenem Worktree)

- `npm test` zweimal: 2513/2513 grün, kein Flake.
- pg-/RLS-/P6-Strang isoliert: 140/140 grün.
- **Cross-Branch-Byte-Identitäts-Beweis** (stärker als die Phasen-eigenen Pins): 2 Worktrees (master @ `6c84f2d` vs. P6), Matrix aus 4 Tenants × 4 Sprachen × 2 Richtungen × 3 `agentStyle` × 4 `briefing`/`constraints`-Kombinationen × 5 „kein Mandat"-Schreibweisen = 1920 Fälle, je `systemPrompt`/`openingText`/`disclosureSentence`. Ergebnis: `diff master.json p6.json` → exit 0, 0 Zeilen, 7.236.194 Bytes identisch. Damit ist `.filter(Boolean)` in `systemPrompt` als No-op für den Bestand bewiesen, nicht nur behauptet.
- **Adversariale Tests** (temporär, danach entfernt) gegen Branch UND master:
  - ADV-A: Mandat umgeht das Nummern-Gate NICHT (`+49110` mit vollem Mandat → abgelehnt, 0 Calls).
  - ADV-C: Prototype-Pollution/unbekannte Keys (`__proto__`/`constructor`/`evil`) → nur bekannte Felder persistiert, `Object.prototype` unverändert. **Grün auf Branch, ROT auf master** (Feld existiert dort nicht) → Normalisierung wirkt echt.
  - ADV-D: Typ-Verwirrung (`decide_freely` als Objekt/Zahl/Array/Boolean, `mandate` als Array) → je 400, 0 Calls. Grün auf Branch, ROT auf master.
  - ADV-E: Längendeckel (`fallback_order` 501 Zeichen → 400; exakt 500 → passiert). Grün auf Branch, ROT auf master.
  - ADV-F: Kein Leak des Mandats-Freitexts im Server-Log.
  - ADV-B: war ein Testartefakt (Loopback-Ausnahme `isTrustedLocalCaller`, identisch rot auf master), mit `X-Forwarded-For` nachgestellt → externer Aufrufer 401, 0 Calls. Auth fail-closed bestätigt intakt.
- Positiver Render-Check: Sektionsreihenfolge `DEINE GRENZEN` < `DEIN SPIELRAUM` < `SO KOMMST DU ZUM ERGEBNIS` bestätigt; alle vier E1-/P1b-Invarianten-Zeilen stehen weiter im Prompt; `toolDefs()` unverändert nur `end_call`, `take_message`.
- Gate-Kette manuell verifiziert: `valid_mandate` sitzt im reinen Eingabe-Validierungsband NACH allen Sicherheits-Gates und VOR Budget/Minuten — identische Naht wie `valid_text`, per Test gepinnt.
- Diff-Sweep: 21 Dateien, alle P6, keine neue npm-Dependency, keine `.env.example`/`render.yaml`/`src/config.js`-Änderung, `bridge.js`/`auth.js`/`web-auth.js`/`middleware.js`/`wiring/auth-gate.js` nicht im Diff, kein Secret-Muster, `mandate` erscheint in keiner MCP-Tool-Ausgabe/keinem Widget.

### Die vier harten Invarianten — gemessen, nicht geglaubt

- **SAFETY-GATES**: intakt, empirisch bewiesen (Denylist-Nummer trotz Mandat abgewiesen).
- **OFFENLEGUNG**: `disclosureSentence`/`openingText` byte-identisch zu master über 1920 Matrix-Fälle, auch mit gesetztem Mandat.
- **AUTH FAIL-CLOSED**: unberührt, externer Aufrufer weiterhin 401.
- **SECRETS**: keine neuen Muster, kein Leak.

### Concerns (keine Blocker)

1. Messbares Abnahmekriterium der Phase (Bench n≥5, Pass-Rate ≥80 %) noch nicht eingelöst — laut Plan explizit Owner-Arbeit (echte API-Kosten). Code fertig, Wirkungsnachweis steht aus.
2. Prompt-Spannung zwischen `boundaryRules` („Terminwunsch als Nachricht aufnehmen") und `mandateSection` („NICHT als Nachricht weitergeben") — bewusst über einen Auflösungssatz entschärft, keine strukturelle Sicherung fällt (kein Buchungs-Tool), aber die Auflösung ist reine Modell-Entscheidung — genau das muss der ausstehende Bench messen.
3. `on_out_of_scope='accept_best'` **ohne** `decide_freely` rendert einen spielraum-losen Annahme-Auftrag („nimm die beste Möglichkeit an") — widerspricht der eigenen Tool-Beschreibung („OHNE dieses Feld darf der Agent gar nichts zusagen"). Owner-gesteuert, Enum-Beschreibung warnt bereits, aber keine Code-Schranke gegen diese Kombination.
4. Fehler-Präzedenz minimal verändert: gleichzeitig ungültiges `mandate` UND `context` meldet jetzt zuerst den `mandate`-Fehler (rein kosmetisch, kein Verhaltensrisiko).
5. (Nicht P6, nur Abgrenzung) `/api/calls` nimmt Loopback-Aufrufer ohne `X-Forwarded-For` von der Basic-Auth aus (`isTrustedLocalCaller`, dokumentiert als AM1) — Verhalten identisch zu master, kein neues Loch.
6. `PLAN-SECURITY.md` bewusst nicht aktualisiert — für P6 korrekt (kein Sicherheits-Gate berührt).

---

## 4. Clean-Code-Audit (final)

**Verdikt: PASS (kein Blocker).** S1 = 0, S2 = 0.

- **s1** (Blocker): keine
- **s2** (Blocker): keine
- **s3** (nicht blockierend, 2 Beobachtungen):
  1. `src/claude.js` `MANDATE_OUT_OF_SCOPE_SENTENCE.TAKE_MESSAGE` + `.ACCEPT_BEST` wiederholen fast wortgleich „halte … mit allen Details fest – Tag, Uhrzeit, Preis und bis wann … gilt". Regel 3 (Vorrang Lesbarkeit) greift: eine Extraktion würde zwei eigenständige LLM-Anweisungssätze nur fragmentieren — keine Änderung nötig, nur notiert.
  2. `src/claude.js` `MANDATE_CONSTRAINTS_PRECEDENCE` beginnt mit eingebettetem Leerzeichen für die Konkatenation — entspricht dem im File bereits etablierten Idiom (vgl. `assistantContextSection`/`calendarSection` mit führendem `\n`) — konsistente Konvention, kein Fix nötig.
- **s4** (Nitpicks): keine

### Geprüfte Dateien

`src/claude.js` (`mandateSection`/`hasMandateContent`/`MANDATE_*`-Konstanten), `src/store/defaults.js` (Enum), `src/store/{state-ops,pg}.js` (Persistenz, additive nullable Spalte korrekt NICHT im `ON CONFLICT DO UPDATE SET` — Muster `context`/`diagnostic`), `src/db/schema.sql` (`CREATE` + idempotenter `ALTER`, Muster `context`), `src/routes/_validation.js` (`validateMandate` + generalisierter `validateSubObject`/`pickKnownFields` — **reduziert** Duplizierung gegenüber vorher, G5 proaktiv verbessert), `src/routes/api-calls.js` + `src/telephony/outbound-gates.js` (neues Gate an derselben Naht wie `valid_text`/`assistant_context`, Reihenfolge-Test aktualisiert), `src/mcp-tools.js` (zod-Schema mit `MANDATE_OUT_OF_SCOPE_VALUES` als EINE Quelle), `scripts/convo-bench/*` (zwei neue Szenarien + `no_message_taken`-Check, saubere Gegenstück-Symmetrie zu `message_taken`), vier neue Testdateien + drei angepasste Bestandstests.

Volle Suite (Original-Worktree der Phase): 2513/2513 grün. Isolierter Lauf aller P6-relevanten Testdateien: 64/64 grün. `node --check` auf allen 8 geänderten `src/`-Dateien sauber. Keine Magic Numbers außerhalb bestehender Konventionen, kein toter/auskommentierter Code, keine `console.log`/`TODO`/`eslint-disable`-Marker, keine abgeschalteten Sicherungen. E1-Invariante bleibt strukturell unangetastet UND ist per Test (M8/M9) explizit gepinnt. Disclosure/`openingText` byte-identisch mit/ohne Mandat (M10).

### passNotes (Auszug)

Vorbildliche Phase: (1) proaktive Dedup-Verbesserung statt neuer Duplizierung (`validateAssistantContext` MIT auf `validateSubObject`/`pickKnownFields` umgestellt); (2) durchgängiges „byte-identisch ohne Mandat"-Muster (D8) konsequent durchgezogen und per Test bewiesen; (3) E1-Invariante per Test UND Quellcode-Marker-Scan (M9) gegen Regression abgesichert; (4) DB-Migration folgt exakt dem etablierten additiven-Spalten-Muster; (5) Gate-Platzierung korrekt hinter der kompletten Sicherheits-/Geld-Gate-Kette, Reihenfolge-Test mitgezogen; (6) sehr hohe Testdichte für eine reine Prompt-/Validierungs-Erweiterung (23 neue/geänderte Tests), inkl. Persistenz-Roundtrip in beiden Backends und HTTP-Ebene. Kein Scope-Creep.

### topTodos

- Kein Pflicht-Fix aus Clean-Code-Sicht — Phase ist mergefähig.
- Optional/informativ (kein Clean-Code-Punkt, sondern Produkt-/Verhaltensfrage für Safety/Verhalten): `on_out_of_scope='accept_best'` ohne `decide_freely` hat de facto keinen definierten Rahmen, soll aber trotzdem „die beste angebotene Möglichkeit" annehmen — einzige Absicherung ist die MCP-Tool-Beschreibung, keine Code-Schranke.
- Die zwei S3-Beobachtungen sind bewusst nicht-blockierend (Regel 3 bzw. Bestandskonvention rechtfertigen den Ist-Zustand).

---

## 5. Fix-Runden

**Keine.** Beide Reviews (Safety final, Clean-Code final) kamen im ersten Durchlauf ohne Blocker durch (S1 = 0, S2 = 0, `approved: true`, `blockers: []`). Es gab keine Fix-Runde.

---

## 6. Offene Owner-/Deploy-Auflagen (NICHT-Agenten-Arbeit, Restrisiken, Bestandsdaten-Auflagen)

1. **Bench-Messläufe mit echten API-Kosten.** Das Abnahmekriterium des Plans (beide Szenarien `mandat-innerhalb`/`mandat-ausserhalb`, `n ≥ 5`, Pass-Rate ≥ 80 %) verlangt `npm run convo-bench` gegen die echte Anthropic-API. Szenarien, Check (`no_message_taken`) und Registrierung sind fertig und offline getestet — der Lauf selbst ist explizit Owner-Arbeit. **Keine Bench-Baseline vorhanden** → der Lauf ist eine Erstmessung, kein A/B.
2. **Probeanruf.** Ob ein Haiku-Modell am Telefon im Mandat tatsächlich selbst zusagt statt auf `take_message` auszuweichen, entscheidet sich erst live — nicht Teil dieser Phase.
3. **Postgres-Migration.** `ALTER TABLE call ADD COLUMN IF NOT EXISTS mandate JSONB;` läuft idempotent beim Boot über `schema.sql`. Beim nächsten Deploy den Boot-Log auf einen sauberen Schema-Durchlauf prüfen (Render-Free-Tier: kein `preDeploy`, die Migration hängt am Prozessstart).
4. **Kein `git push`** (weder `origin` noch `upstream`) im Rahmen dieser Phase — Deploy bleibt eine separate Owner-Entscheidung.
5. **Restrisiko `accept_best` ohne `decide_freely`** (Safety-Concern #3 / Clean-Code-topTodo): Owner sollte entscheiden, ob diese Kombination in einer Folge-Phase strukturell verboten (z. B. `accept_best` erfordert `decide_freely`) oder bewusst so belassen wird — aktuell nur durch die MCP-Tool-Beschreibung („NUR wenn der Nutzer ausdrücklich sagt …") abgesichert, keine Code-Schranke.
6. **Prompt-Spannung `boundaryRules` vs. `mandateSection`** (Safety-Concern #2): der Auflösungssatz ist eine reine Modell-Entscheidung ohne strukturelle Sicherung dahinter (kein Buchungs-Tool existiert zwar, aber die Textebene bleibt uneindeutig) — der ausstehende Bench-Lauf (Punkt 1) ist der eigentliche Wirkungsnachweis dafür, ob das Modell die Auflösung korrekt versteht.
7. **`PLAN-SECURITY.md`**: für P6 bewusst nicht aktualisiert (kein Sicherheits-Gate berührt, reine additive Eingabe-Validierung) — zur Kenntnis, kein offener Punkt.
