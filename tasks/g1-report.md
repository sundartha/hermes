# Phase G1 — Identitaets-Bindung (Detailbericht)

**Phase:** G1 — Identitaets-Bindung (Safety, isoliert, ZUERST)
**Kern:** firstName/lastName, Default "Jonas" raus, caller_name entfernen, fail-closed Gate
**Gate:** **PASS** (Safety APPROVED + Clean-Code S1/S2 leer)
**finalBranch:** `phase/g1-identity-binding`
**headCommit:** `f39de65b28e326ff15c50f8ab4fc4325eff9bc78`
**Tests:** 721/721 gruen (json + pglite), 0 fail
**Fix-Runden:** 0

---

## 1. Worum es geht

Owner-Identitaet wird zweiteilig und fest gebunden:

- **Zwei Eingaben** `firstName` + `lastName` (Owner-Entscheidung #1). Daraus wird `ownerName = "${firstName} ${lastName}"` **komponiert** und gespeichert (Bestandskonsumenten unveraendert); `firstName` zusaetzlich persistiert (LLM-Persona).
- **Offenlegung** (`disclosureSentence`) = `ownerName` (voll). **LLM-Persona** (`systemPrompt`) = `firstName`. **Beide ausschliesslich aus `tenant`** — `call.callerName` faellt komplett raus (war spoofbar).
- **`caller_name` Producer-Kette** entfernt; DB-Spalte `caller_name` bleibt additiv-nullable (kein destruktives Migrat).
- **Variante (a):** Owner-Tenant wird beim Laden idempotent aus Config (`OWNER_FIRST_NAME`/`OWNER_LAST_NAME`) belegt — schuetzt den ungegateten Inbound-Greeting.
- **Default "Jonas" raus:** `OWNER_NAME` entfaellt, ersetzt durch zwei Pflicht-Vars (Boot-Refusal bei leer, fail-closed wie `TWILIO_NUMBER`).
- **Outbound-Gate** in `POST /api/calls`: leerer `ownerName` -> 403; zusaetzliches fail-closed Glied, NIE in `/voice/outbound` (Premature-close-Schutz).

---

## 2. Plan (gekuerzt)

Grounded gegen `master` (6c59aa4). G0 bereits gemergt. Autoritativ: PLAN-CONVERSATION-QUALITY.md §G1 + §2 + §5.

**Designkern (eine Quelle, fail-closed):** ownerName komponiert + gespeichert, firstName zusaetzlich; Disclosure = ownerName (voll), Persona = firstName; callerName raus; caller_name-Spalte additiv-nullable; Variante (a) config-Seed des Owner-Tenants; "Jonas"-Default an der Quelle weg (Boot-Refusal); Outbound-403-Gate nur am Producer.

1. **`tenantContext` erweitern um `firstName`** (`src/store/state-ops.js`): zusaetzliches Feld; Quelle `tenant.firstName`, sonst aus effektivem `ownerName` abgeleitet via lokalem Helper `firstNameOf` (erstes Whitespace-Token) -> EINE Ableitungsstelle.
2. **`registerTenant` Signatur `{ firstName, lastName }`**: komponiert ownerName, persistiert firstName; geteilter Helper `applyOwnerIdentity` (trimmt, leere Teile weggelassen). Set-on-create, kein Upsert.
3. **Variante (a):** neue config-freie state-op `seedOwnerIdentity` (analog `seedOwnerNumber`), aufgerufen aus json `finishLoad()` und pg `init()` (nach hydrate, mit Persistenz).
4. **`claude.js`:** `disclosureSentence` zieht `store.tenantContext(call.tenantId).ownerName` (callerName raus, Wortlaut byte-identisch); `systemPrompt` nutzt `ctx.firstName` fuer alle Persona-Stellen; SITUATION-Zeile von callerName entkoppelt; `summarizeCall` (voller Name) unveraendert.
5. **`config.js`:** `OWNER_NAME`/"Jonas"-Default raus; `ownerFirstName`/`ownerLastName` + `get ownerName()` (komponiert); `assertConfig` macht beide zur Boot-Pflicht.
6. **caller_name Producer-Kette entfernen:** `mcp-tools.js` (Schema+Doku), `routes/_validation.js` (TEXT_LIMITS), `server.js` (invalidText + createCall-Aufruf), `state-ops.js` (Destructuring -> `callerName: null`). DB-Spalte + pg-Roundtrip bewusst belassen.
7. **`server.js`:** neues Identitaets-Gate in `POST /api/calls` (nach KYC, vor numberGate, 403 + audit); Onboard-Route nimmt `firstName`/`lastName`.
8. **`db/schema.sql`:** additive Spalte `first_name TEXT` (NULLABLE, Muster wie owner_name).
9. **`pg.js`:** `first_name` hydrieren (NUR-nicht-null) + flushen (INSERT/UPDATE konsistent); RLS-Count unberuehrt (Spalte, kein neuer Table).
10. **`render.yaml` + `.env.example`:** `OWNER_FIRST_NAME`/`OWNER_LAST_NAME` (`sync:false` in Render).
11. **Tests:** Bestands-Pins bewusst umkehren (BASE_ENV, Disclosure-Marker, callerName-Inversionen); neue Negativ-/Pre-Mortem-Tests.

**Pre-Mortem-Risiken:** (a) Default-`""`-ohne-Gate -> 403-Gate + Negativ-Test "nie '...von .'"; (b) BASE_ENV maskiert Boot-Refusal -> Reject-Test leert `OWNER_FIRST_NAME` im Spawn-Env; (c) Live-Owner kippt nach Deploy -> render.yaml `sync:false` + Owner-Checkliste vor upstream-Push.

**Split-Empfehlung:** **nicht splitten** — Test-Inversionen koppeln Datenmodell und Bindung eng.

---

## 3. Implementierungs-Zusammenfassung

Umgesetzt im isolierten Worktree, Branch `phase/g1-identity-binding`, committet (`f39de65`).

**Geaenderte Quelldateien:**
- `src/config.js` — `ownerFirstName`/`ownerLastName` + Getter `ownerName`, Boot-Pflicht beider.
- `src/claude.js` — `disclosureSentence` an `tenant.ownerName` gebunden (callerName ignoriert, Wortlaut byte-identisch); `systemPrompt`-Persona = `firstName`.
- `src/server.js` — fail-closed Identitaets-Gate (403 + audit) in `POST /api/calls`; Onboard nimmt firstName/lastName; caller_name-Annahme entfernt.
- `src/store/state-ops.js` — `tenantContext` liefert firstName; `firstNameOf` + `applyOwnerIdentity` + `seedOwnerIdentity`; `registerTenant` neue Signatur; createCall-Producer `callerName: null`.
- `src/store/json.js` — `seedOwnerIdentity` in `finishLoad()`.
- `src/store/pg.js` — `seedOwnerIdentity` in `init()` (geseedet + geflusht); `first_name` hydrate/flush.
- `src/db/schema.sql` — additive Spalte `first_name TEXT`.
- `src/mcp-tools.js` — caller_name-Schema + Doku entfernt.
- `src/routes/_validation.js` — caller_name aus TEXT_LIMITS entfernt.
- `render.yaml`, `.env.example` — OWNER_FIRST_NAME/OWNER_LAST_NAME.

**Neue Testdateien:**
- `test/g1-identity-binding.test.js` — callerName-Override wirkungslos, Persona=Vorname vs. voller Offenlegungsname, Outbound-Gate, "nie '...von .'", TeXML-Offenlegung mit registriertem ownerName.
- `test/g1-config-boot-refusal.test.js` — Boot-Refusal bei leerem OWNER_FIRST_NAME (Spawn-Env explizit geleert gegen BASE_ENV-Maskierung).
- `test/g1-owner-identity-seed.test.js` — applyOwnerIdentity/seedOwnerIdentity-Komposition + Idempotenz.

**Angepasste Bestands-Tests:** `helpers.js` (BASE_ENV), `_outbound-harness.js` (DISCLOSURE_JONAS voll), `disclosure-regression.test.js`, `disclosure-outbound.test.js`, `claude-identity.test.js`, `tenant-context.test.js`, `api.test.js` (caller_name-400 entfernt), `store-pg-multitenant.test.js`, `i9-self-service.test.js`, `number-lifecycle.test.js`, `onboarding-identity.test.js`, `read-scope-tenant.test.js`, `voice-greeting-tenant.test.js`, `config-failclosed.test.js`, `config-payment-guard.test.js`.

**Verifikation:** `node --check` aller geaenderten Quelldateien sauber; `npm test` 721/721 gruen (json + pglite). Smoke: Server bootet mit OWNER_FIRST_NAME/OWNER_LAST_NAME, `/healthz` ok; `POST /api/calls` mit valider Identitaet + ignoriertem `caller_name:"Spoofer"` passiert das Gate und scheitert erst am echten Twilio-Originate (Fake-Creds, erwartet); Boot-Refusal bei leerem OWNER_FIRST_NAME manuell bestaetigt.

### Deviations

1. **Outbound-403-Gate ist genuine defense-in-depth und in einem gebooteten Server nicht direkt erreichbar** — `tenantContext` faellt fuer jeden Tenant auf `config.ownerName` zurueck, das per assertConfig-Boot-Pflicht nie leer ist. Statt eines kuenstlich erzwungenen 403 (nur via Boot-Refusal-Umgehung) wurde der Schutz an der Wurzel getestet: die Offenlegung rendert NIE "...von ." (offline am Renderer + am Prompt); das Gate ist im Code als fail-closed Glied vor `numberGateError` verankert. Smoke bestaetigt: valide Identitaet passiert das Gate.
2. **pg.js `init()`: der Variante-(a)-Seed-Flush wird AWAITED** (Plan sagte fire-and-forget ueber flushChain). Grund: pglite teilt eine Verbindung -> ein nicht-erwarteter Flush konkurriert mit dem ersten Folge-Query um die Transaktion ("current transaction is aborted"). Bewusste, dokumentierte Abweichung; `init` ist ohnehin async und einmalig.
3. **Zusaetzlich angepasste Testdateien** (vom Plan-Blast-Radius nicht erfasst, aber notwendig): `disclosure-outbound.test.js`, `read-scope-tenant.test.js`, `number-lifecycle.test.js`, `onboarding-identity.test.js`, `config-failclosed.test.js`, `config-payment-guard.test.js` (registerTenant-Signatur-Caller bzw. OWNER_NAME-Literale / REQUIRED_OK-Pflichtfelder).
4. **`g1-owner-identity-seed.test.js`** als separate Unit-Datei (Plan nannte die Units, ohne Dateinamen festzulegen).

---

## 4. Safety-Urteil

**APPROVED.** Tests selbst verifiziert gruen auf beiden Backends (721/721; gezielter Lauf der pg-/pglite- + 3 G1-Testdateien 46/46).

- Safety-Gates intakt (neues Identitaets-Gate nur additiv, fail-closed, NIE in `/voice/outbound`).
- Disclosure intakt: Wortlaut byte-identisch, von beiden Engines geteilt (`claude.js` disclosureSentence; `bridge.js` importiert sie unveraendert); nur die Quelle gebunden (tenant.ownerName, nicht per Call-Parameter ueberschreibbar).
- `caller_name` vollstaendig aus der Producer-Kette entfernt (mcp-tools-Schema, _validation, server createCall-Aufruf, state-ops-Signatur); DB-Spalte bleibt additiv-nullable (kein destruktives Migrat).
- "Jonas"-Default an der Quelle weg (config.js + render.yaml), erzwungen durch assertConfig-Boot-Refusal (fail-closed wie TWILIO_NUMBER).
- Auth fail-closed unveraendert; keine Secrets geleakt; Scope respektiert; de-DE unangetastet; keine neuen Dependencies.

**Blocker:** keine.

**Concerns (nicht-blockierend):**
- Kein direkter Test fuer den Laufzeit-403-Identitaets-Gate (config.ownerName im Test-Env via BASE_ENV immer gesetzt); Kern-Invariante "Offenlegung rendert nie '...von .'" via Negativ-Test belegt, Gate als Defense-in-Depth hinter dem harten Boot-Refusal-Pin.
- Deploy-operativ (Spec §3 Pre-Mortem c bewusst akzeptiert): Live-Owner kippt nach Deploy auf Boot-Refusal, falls OWNER_FIRST_NAME/OWNER_LAST_NAME in Render-Env nicht gesetzt werden (render.yaml jetzt `sync:false`). Owner-Checkliste vor upstream-Push noetig.

---

## 5. Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-Verstoesse. Branch merge-faehig.

**S1 (Blocker):** keine.

**S2 (Blocker):** keine. Duplizierung aktiv vermieden: `applyOwnerIdentity` = EINE Kompositionsstelle (registerTenant + seedOwnerIdentity teilen sie), `firstNameOf` = EINE Ableitungsstelle, `tenantContext` = EINE effective-owner-Aufloesung.

**S3 (Hinweis, nicht-blockierend):**
- `src/config.js:105-107` — `ownerName` ist ein Getter, der bei jedem Lesen neu komponiert. Korrekt und kommentiert (kein Lazy-Init), aber ein Property-Getter mit Logik kann Konsumenten ueberraschen. Akzeptabel da rein abgeleitet/idempotent; Doc-Kommentar vorhanden.
- `src/store/state-ops.js:357` `firstNameOf` — `split(/\s+/)[0] || ""` dicht aber lesbar und gekapselt; korrekt fuer leere/Nicht-String-Eingabe.
- Kommentardichte (`state-ops.js`, `pg.js`, `server.js`) — lange Begruendungs-Bloecke (teils 6-8 Zeilen). Inhaltlich praezise, nicht redundant (WARUM, nicht WAS), passen zum Bestandsstil; Umfang grenzwertig, aber durch Safety-Kontext gerechtfertigt.

**S4 (sehr leicht):**
- `src/store/state-ops.js:365` `applyOwnerIdentity` ist `export`, wird aber nur in-file konsumiert; `export` koennte entfallen (engere Schnittstelle). Belanglos, kein toter Code.
- `firstNameOf`/`applyOwnerIdentity`/`seedOwnerIdentity` stehen direkt beim Verwendungsort (vertikale Naehe erfuellt, kein Flag).

**PassNotes:** Safety/Regel-Treue vorbildlich: Offenlegungssatz-Wortlaut unveraendert (nur Quelle gebunden); Gate fail-closed am richtigen Ort (Producer, nicht Webhook); kein neuer Default-Identitaets-Fallback. Pg-Round-Trip vollstaendig (hydrate NUR-nicht-null + flush Upsert + Spalten in SELECT/INSERT/UPDATE konsistent). Tests als Highlight: Negativ-/Pre-Mortem-Faelle (kein "...von .", callerName-Override wirkungslos, Boot-Refusal mit explizit geleertem Spawn-Env gegen BASE_ENV-Maskierung), Units offline+statisch, Variante-a-Seed (json+pg) verifiziert.

---

## 6. Fix-Runden

**0 Fix-Runden.** Gate war beim ersten dualen Review PASS (Safety APPROVED, Clean-Code S1/S2 leer). Keine blockierenden To-dos. Optional vor/nach Merge: `export` von `applyOwnerIdentity` entfernen (S4, belanglos); Boot-Refusal-Smoke mit leeren OWNER_*-Vars manuell; OWNER_FIRST_NAME/OWNER_LAST_NAME im Render-Dashboard setzen, bevor live deployt wird (sonst Boot-Refusal beim naechsten Deploy).
