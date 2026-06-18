// Wiederverwendbarer Phasen-Workflow fuer den Multi-Tenant-Umbau (siehe PLAN-MULTI-TENANT-TELNYX.md).
// Pro Lauf EINE Phase: Plan -> Implementieren (isolierter Worktree) -> dualer Review
// (Safety/Verhalten + dedizierter Clean-Code-Auditor gegen .claude/refs/clean-code.md).
// Aufruf (Workflow-Tool):
//   args = { phaseId:"P1", phaseTitle:"Direktiven-Renderer", branch:"phase/p1-directive-renderer",
//            baseBranch:"master", extraNotes:"...", planDoc:"PLAN-MULTI-TENANT-TELNYX.md" }
// baseBranch = der Stand, auf dem die Phase aufbaut (z.B. "master" nachdem P0 gemergt ist,
// oder ein Vorgaenger-Branch wie "phase/p0-telephony-port").
// planDoc = die Strategie-/Phasendatei, aus der die Phase gelesen wird (Default unten);
//   z.B. "PLAN-MULTI-TENANT-IDENTITY.md" fuer die Identitaets-/Laufzeit-Schicht.

export const meta = {
  name: 'phase-impl',
  description: 'Eine Umbau-Phase umsetzen: Plan -> Implementieren (Worktree) -> dualer Review (Safety/Verhalten + Clean-Code-Auditor). Clean-Code (.claude/refs/clean-code.md) ist hartes Gate (S1/S2 = Blocker).',
  phases: [
    { title: 'Plan', detail: 'Regelkonformer Umsetzungsplan (liest clean-code.md + Plan-Doku + echten Code)' },
    { title: 'Implementieren', detail: 'Umsetzung im Worktree, clean-code-konform, npm test gruen' },
    { title: 'Review', detail: 'Safety/Verhalten-Reviewer + dedizierter Clean-Code-Auditor (parallel)' },
  ],
}

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent"
const NODE_MODULES = `${REPO}/node_modules`

// STATUS: I0/I1/I2 GEMERGT (master=d3ba593, 2026-06-16, 287/287). Dieser A-Fallback
// ist auf I4 (resolveTenant) code-gegroundet - Welle 1 parallel zu I3 (PARALLEL-
// PHASES-IDENTITY.md). I4 haengt nur an I0, NICHT an I3 (verschiedene Funktionen in
// state-ops.js + server.js). Owner-Entscheidungen #1/#2/#8 sind fixiert (sub / 1:1 /
// ein MULTI_TENANT-Flag, siehe extraNotes). NICHT pushen, NICHT mergen (Owner merged
// koordiniert). VOR dem naechsten Lauf phaseId/extraNotes/planDoc auf die dann
// gewaehlte Phase umschreiben. Siehe [[phase-impl-workflow-args]] [[i2-design-decisions]].
const A = (typeof args === 'object' && args) ? args : {
  phaseId: "I2",
  phaseTitle: "settings/calendar zu pro-Tenant-Maps heben (gefaehrlichster Umbau, allein, dreifaches Gate)",
  branch: "phase/i2-settings-calendar-map",
  baseBranch: "master",
  planDoc: "PLAN-MULTI-TENANT-IDENTITY.md",
  extraNotes: `WICHTIG ZUR PHASE: I2 ist der GEFAEHRLICHSTE Umbau der Identitaets-Schicht: s.settings und s.calendar von flachen Singletons auf tenantId-gekeyte Maps heben - EXAKT nach dem fertigen, getesteten usage-Map-Muster aus P4. json ist Prod -> eine falsche Migration wirkt sofort cross-tenant-persistent (Pre-Mortem R2); ein vergessener pg-Wrapper = stiller Backend-Drift (R6). Lies den I2-Abschnitt in PLAN-MULTI-TENANT-IDENTITY.md ("**I2 — settings/calendar zu pro-Tenant-Maps**") + die Abschnitte "Datenmodell-Aenderungen", "json.load()-Migration (Pflicht in I2)" + Pre-Mortem R2/R5/R6. I0 (tenantContext-Seam) und I1 (Call-Pfad-Identitaet ueber den Seam, beide Engines) sind auf master @8c2cfc4 gemergt (npm test 277 gruen, BEIDE Backends inkl. pglite, Node v26). NICHT erneut bauen.

ABGRENZUNG (was I2 IST und was NICHT):
- I2 IST: nur settings + calendar -> Map; settingsFor/calendarFor (analog usageFor); die vier Ops bekommen tenantId; tenantContext liest ab jetzt aus den Maps; json.load()-Migration Singleton->Owner-Bucket; pg-flush/hydrate auf Owner-Bucket-aus-der-Map umstellen; die direkten Konsumenten reichen die richtige tenantId durch.
- I2 IST NICHT: ownerName-pro-Tenant (schon I1 erledigt - tenantContext liest tenant.ownerName). registerTenant bleibt 2-arg (s,id) - der ownerName+Map-Init bei Registrierung ist I3, NICHT hier. KEIN resolveTenant / MULTI_TENANT-Flag / Auth-Achse (I4+). KEIN Scope-Filtern von /api/* (I5/I6) - /api/state bleibt owner-only und in der heutigen FLACHEN Response-Form. KEIN pg-Entpinnen von OWNER_TENANT_ID (I8) - der Spiegel bleibt owner-hydriert/-geflusht, nur das Shape im Spiegel wird Map. KEINE neue Env/config (BASE_ENV unberuehrt). KEIN schema.sql-Change.

KONTEXT (Ist-Stand SELBST am echten Code auf master @8c2cfc4 verifiziert - SELBST greppen, das Plan-Doc ist pre-I1 und teils gedriftet):
- defaults.js: defaultSettings() = flaches Objekt {agentName, greeting, allowCalendar, allowBooking, allowSummaries, allowPersonalData, allowBankData}. demoCalendar() = Liste aus DEMO_EVENTS. emptyUsage()/emptyUsageMap()={[OWNER_TENANT_ID]:emptyUsage()} = das VORBILD (Owner-Bucket vorbelegt). OWNER_TENANT_ID="owner".
- state-ops.js makeDefaultState(): settings: defaultSettings() (FLACH), calendar: demoCalendar() (FLACHE Liste), usage: emptyUsageMap() (MAP - das Vorbild). usageFor(s,tenantId) = (s.usage[tenantId] ||= emptyUsage()) - lazy Map-Accessor, EXPORTIERT aus state-ops, aber NICHT in der store.js-Fassade und NICHT als json/pg-Wrapper (genau dieses Muster spiegeln). getCalendar(s) sortiert s.calendar in place. addCalendarEvent(s,title,start,end) pusht. findConflict(s,start,end) nutzt getCalendar(s). updateSettings(s,patch) whitelistet patch gegen defaultSettings() und schreibt s.settings[key].
- state-ops.js tenantContext(s, ownerName, tenantId): 3-ARG (config-frei, I0-Entscheidung; ownerName wird vom Wrapper hereingereicht) - NICHT 2-arg wie im Plan-Doc. Liefert {tenantId, ownerName:(tenant&&tenant.ownerName)||ownerName, settings:s.settings, calendar:s.calendar}. I2 aendert NUR die letzten beiden auf settingsFor(s,tenantId)/calendarFor(s,tenantId).
- json.js load(): Migrationszeile state.settings = {...defaultSettings(), ...state.settings} (forward-compat fuer neue Felder) + state.usage = migrateUsageToMap(state.usage). migrateUsageToMap erkennt das alte flache Shape an typeof usage.costEur==="number" und macht {[OWNER]:{...emptyUsage(),...usage}}, idempotent fuer bereits-Map. Das ist die EXAKTE Blaupause der I2-Migration.
- pg.js: makePgStore-Spiegel, owner-scoped. hydrate(): state.settings = settingsRows.length ? rowToSettings(rows[0]) : state.settings (FLACH); state.calendar = calRows.map(rowToCalendarEvent) (FLACH); ABER state.usage[OWNER_TENANT_ID] = rowToUsage(...) (in die MAP - das Vorbild). flush(): flushSettings(client,tenantId,state.settings), flushCalendar(client,tenantId,state.calendar), ABER flushUsage(client, tenantId, ops.usageFor(state, tenantId)) (Owner-Bucket AUS DER MAP - das Vorbild). makePgStore-Methoden getCalendar/addCalendarEvent/findConflict/updateSettings spiegeln die json-Signaturen.
- store.js: explizite Re-Export-Liste mit HEUTE 29 Namen (Kopf-Kommentar "29 Funktionen"); getCalendar/addCalendarEvent/findConflict/updateSettings stehen bereits drin. usageFor/settingsFor/calendarFor stehen NICHT in der Fassade (interne state-ops-Helfer).
- Konsumenten (SELBST gegreppt, beide Backends + Realtime): claude.js execTool get_calendar-READ nutzt store.tenantContext(call.tenantId).calendar.slice(0,8) (schon ueber den Seam); book_appointment ruft store.findConflict(start,end) + store.addCalendarEvent(title,start,end) GLOBAL (Kommentar dort: "die Kalender-Schreib-/Konflikt-Seite ist eigener Scope" = DIESE Phase). server.js /api/state: settings: s.settings, calendar: store.getCalendar().filter(...), usage: {...s.usage[OWNER_TENANT_ID], maxBudgetEur} (Owner-Bucket-Muster mit Kommentar). server.js /voice/incoming Greeting nutzt store.tenantContext(call.tenantId).settings.greeting (schon ueber den Seam). server.js POST /api/settings: store.updateSettings(req.body). server.js POST /api/calendar: store.addCalendarEvent(title,start,end). mcp-tools.js liest s.calendar/s.settings AUS DER /api/state-RESPONSE (get_calendar/get_agent_status fetchen GET /api/state) - NICHT aus dem Store; bridge.js hat 0 Kalender/Settings-Bezug (erbt ueber claude.js).

ZIEL-DESIGN (am Ist-Code verankert; finale Mechanik darf der Plan-Agent code-gegroundet schaerfen, Umfang/Invarianten bleiben):
- defaults.js: NEU defaultSettingsMap() = {[OWNER_TENANT_ID]: defaultSettings()} und calendarMap() = {[OWNER_TENANT_ID]: demoCalendar()} (beide analog emptyUsageMap, Owner vorbelegt).
- state-ops.js: makeDefaultState() settings: defaultSettingsMap(), calendar: calendarMap(). NEU settingsFor(s,tenantId) = (s.settings[tenantId] ||= defaultSettings()) und calendarFor(s,tenantId) = (s.calendar[tenantId] ||= []) (EXAKT analog usageFor: lazy, Nebeneffekt im Kommentar; ein NEUER Tenant bekommt eine leere Kalender-Liste, der Owner ist in der Map vorbelegt). getCalendar(s,tenantId)=calendarFor(s,tenantId).sort(...); addCalendarEvent(s,tenantId,title,start,end) pusht in calendarFor; findConflict(s,tenantId,start,end) ueber getCalendar(s,tenantId); updateSettings(s,tenantId,patch) whitelistet in settingsFor(s,tenantId). tenantContext(s,ownerName,tenantId): settings: settingsFor(s,tenantId), calendar: calendarFor(s,tenantId).
- SCHLUESSEL-ENTSCHEIDUNG (usageFor-Parity, verbindlich): settingsFor/calendarFor werden NUR aus state-ops.js exportiert (damit pg.js sie als ops.settingsFor/ops.calendarFor in flush/hydrate nutzen kann) - sie bekommen KEINEN json/pg-Wrapper und stehen NICHT in der store.js-Fassade. Genau wie usageFor. Folge: die store.js-Fassade behaelt 29 Namen (die vier umzustellenden behalten ihren Namen, bekommen nur ein tenantId-Arg). Der Kopf-Kommentar "29 Funktionen" bleibt 29. (Das Plan-Doc sagt faelschlich "28->30 / VIER Stellen" - usageFor-Parity gewinnt; wenn der Plan-Agent die Fassaden-Variante fuer noetig haelt, MUSS er begruenden, warum usageFor anders behandelt wird - sonst Clean-Code-Inkonsistenz.)
- json.js: getCalendar(tenantId)/addCalendarEvent(tenantId,...)/findConflict(tenantId,...)/updateSettings(tenantId,patch) reichen tenantId an die ops durch. load(): die Singleton->Map-Migration an EINER Stelle (analog migrateUsageToMap): state.settings = migrateSettingsToMap(state.settings) (flach erkannt an typeof settings.agentName==="string" -> {[OWNER]:{...defaultSettings(),...flach}}; bereits Map -> jeder Bucket {...defaultSettings(),...bucket}, Owner sicherstellen; forward-compat der alten Zeile bleibt erhalten) und state.calendar = migrateCalendarToMap(state.calendar) (Array.isArray -> {[OWNER]:array}; bereits Map -> Owner sicherstellen; fehlend -> calendarMap()).
- pg.js: hydrate() -> if(settingsRows.length) state.settings[OWNER_TENANT_ID]=rowToSettings(rows[0]) (analog der usage-Zeile, NICHT flach zuweisen; ohne Zeilen bleibt der Owner-Bucket aus defaultSettingsMap); state.calendar[OWNER_TENANT_ID]=calRows.map(rowToCalendarEvent) (ueberschreibt den Demo-Owner-Bucket mit den DB-Zeilen, wie heute). flush() -> flushSettings(client,tenantId,ops.settingsFor(state,tenantId)) und flushCalendar(client,tenantId,ops.calendarFor(state,tenantId)) (EXAKT wie flushUsage(...ops.usageFor(state,tenantId)) daneben). makePgStore-Methoden getCalendar/addCalendarEvent/findConflict/updateSettings bekommen das tenantId-Arg analog json.js. KEINE Aenderung an flushSettings/flushCalendar/rowToSettings/rowToCalendarEvent selbst, an schema.sql oder migrate.js.
- claude.js: book_appointment -> store.findConflict(call.tenantId, start, end) und store.addCalendarEvent(call.tenantId, input.title, start, end); den jetzt-veralteten Kommentar ("bleibt bewusst global / eigener Scope") aktualisieren (Kalender ist ab jetzt pro Tenant getrennt). get_calendar-READ bleibt unveraendert (laeuft schon ueber tenantContext.calendar, das jetzt calendarFor liest). KEINE Aenderung an Disclosure/systemPrompt/summarizeCall/toolDefs (die lesen settings schon ueber tenantContext).
- server.js: /api/state MUSS die heutige FLACHE Response-Form behalten (Dashboard + mcp-tools.js lesen settings/calendar aus der Response): settings: s.settings[OWNER_TENANT_ID] (Owner-Bucket, Muster wie die usage-Zeile daneben; kurzer Kommentar), calendar: store.getCalendar(OWNER_TENANT_ID).filter(...). POST /api/settings -> store.updateSettings(OWNER_TENANT_ID, req.body||{}). POST /api/calendar -> store.addCalendarEvent(OWNER_TENANT_ID, title, ...). OWNER_TENANT_ID ist in server.js bereits importiert. KEINE Scope-/Auth-Aenderung (das ist I5/I6).

EXPLIZIT NICHT (kein Vorgriff/BDUF):
- KEIN settingsFor/calendarFor in der store.js-Fassade oder als json/pg-Wrapper (usageFor-Parity).
- KEIN requestTenant/resolveTenant, KEIN MULTI_TENANT-Flag, KEIN Scope-Filter auf /api/* (I4/I5/I6); /api/state bleibt owner-only + flach.
- KEINE registerTenant-Signatur-Aenderung (I3); KEIN ownerName-Schreibpfad.
- KEIN pg-Entpinnen (I8); KEIN schema.sql/migrate.js-Change; KEINE neue SQL.
- KEINE neue Env/config -> config.js + .env.example + test/helpers.js BASE_ENV bleiben 0 Diff (Lehre test-base-env-drift greift NUR bei neuer config-Var - hier keine).
- KEINE Aenderung an bridge.js, mcp-tools.js, den Safety-Gates, der Auth-Middleware, den Telephony-Adaptern, pruneOldData, eraseTenantData/exportTenantData, der Disclosure.

ABSOLUTE REGELN / SICHERHEITS-INVARIANTEN DIESER SCHEIBE (als Test festnageln):
- OWNER-BEOBACHTBARES VERHALTEN BYTE-IDENTISCH: I2 ist KEIN reiner Refactor (das Daten-SHAPE aendert sich bewusst Singleton->Map), aber das fuer den Owner SICHTBARE Verhalten bleibt identisch: gleicher Greeting, gleiche get_calendar-Ausgabe, gleiche Konflikt-/Buchungs-Logik, gleiche /api/state-Response-Form, gleiche POST-/api/settings- und POST-/api/calendar-Antworten, gleiche Disclosure. Die Bestandssuite belegt das (Owner-Bucket == heutiges Singleton).
- MAP-TRENNUNG (Pre-Mortem R2-Kern): zwei synthetische Tenants haben getrennte settings/calendar; eine Aenderung an B beruehrt A NICHT. Pure-Unit gegen settingsFor/calendarFor/updateSettings.
- MIGRATION (R2): ein alter store.json-Shape (flaches settings-Objekt + flache calendar-Liste) laedt fehlerfrei und landet im Owner-Bucket; eine leere calendar-Liste -> leerer Owner-Bucket (byte-identisch zur seedState-Form). Idempotent (bereits Map -> unveraendert, Owner sichergestellt). Migration an EINER Stelle (json.load()).
- BACKEND-PARITY (R6): frischer json-Owner-Bucket == frischer pg-Owner-Bucket fuer settings/calendar; der pg-Flush/Hydrate round-trippt die Owner-Buckets korrekt. settingsFor/calendarFor sind an allen noetigen Stellen vorhanden (state-ops-Export + pg flush/hydrate), KEIN stiller undefined-Drift.
- DISCLOSURE fest verdrahtet (claude.js + bridge.js) UNVERAENDERT. Safety-Gates (numberGateError/Budget/Allowlist/Max-Dauer) / Auth / Secrets UNVERAENDERT. Audio nie durch MCP. usage-Bucket (Budget-Gate) UNANGETASTET.

CODE-GEGROUNDETE LANDMINES (SELBST greppen auf BASE master @8c2cfc4 - KEINE Zeilennummern, sie rotten):
- pg.js flush: der Owner-Bucket MUSS aus der Map gezogen werden (ops.settingsFor/ops.calendarFor) wie es flushUsage mit ops.usageFor schon tut - sonst flusht ein {owner:{...}}-Objekt in die flache settings-Spalte (Drift/Crash). pg.js hydrate analog: in state.settings[OWNER]/state.calendar[OWNER] schreiben, NICHT flach zuweisen (sonst zerstoert der erste Hydrate-Write das Map-Shape).
- /api/state: settings/calendar MUESSEN als Owner-Bucket (flach) in die Response, NICHT als Map - sonst brechen Dashboard (public/index.html) UND mcp-tools.js (s.calendar.map/s.settings.allowCalendar aus der Response). Das ist KEINE Scope-Aenderung, sondern Erhalt der heutigen Response-Form.
- Facade-Signaturen aendern sich (tenantId-Arg) -> ALLE direkten Caller von getCalendar/addCalendarEvent/findConflict/updateSettings muessen die tenantId mitgeben (claude.js book_appointment: call.tenantId; server.js: OWNER_TENANT_ID). Ein vergessener Caller ruft mit undefined-tenantId -> Bucket unter Schluessel "undefined" (stiller Datenverlust). SELBST alle Caller greppen.
- json.load()-Migration: die alte forward-compat-Zeile ({...defaultSettings(),...state.settings}) darf NICHT verloren gehen - sie wandert in den Owner-Bucket der Migration. Detektion flach-vs-Map ueber einen stabilen Marker (typeof agentName==="string" / Array.isArray), NICHT ueber Anzahl.
- Test-Isolation (P6a/P3-Lehre): KEINE pglite+Server-Spawn-Mischung in EINER Testdatei. Map-Trennung+Migration = eigene reine Unit-Datei (state-ops/defaults/json.load via tempDataDir, KEIN Spawn, KEINE pglite). Backend-Parity = store-pg.test.js (pglite-only, KEIN Spawn). /api/state-/Settings-/Calendar-Form = api.test.js (Server-Spawn, json).

JUSTIERTE BESTANDSTESTS (bewusster Shape-/Signatur-Wechsel -> Aenderung ERLAUBT, aber MINIMAL + in deviations begruendet; SELBST am Code verifizieren, Liste ist Befund nicht Dogma):
- test/tenant-context.test.js: die Assertions "ctx.settings === s.settings (Singleton-Referenz)" / "ctx.calendar === s.calendar" stimmen nicht mehr - ctx.settings ist jetzt der Owner-Bucket. Auf "=== settingsFor(s,OWNER)/calendarFor(s,OWNER)" bzw. "=== s.settings[OWNER]/s.calendar[OWNER]" umstellen (Owner-Bucket-Referenz). Kommentar mitziehen.
- test/store-pg.test.js: s.settings deepEqual defaultSettings() -> gegen den Owner-Bucket (s.settings[OWNER] bzw. settingsFor). getCalendar()/findConflict()/addCalendarEvent()/updateSettings() -> tenantId (OWNER_TENANT_ID) mitgeben. load().settings.agentName -> Owner-Bucket.
- test/tenant-erasure-pg.test.js: store.updateSettings({...}) -> updateSettings(OWNER,{...}); getCalendar().length -> getCalendar(OWNER).length; reopened.load().settings.agentName -> Owner-Bucket.
- test/api.test.js: srv.readStore().calendar.some(...) und srv.readStore().settings sind nach I2 Maps -> [OWNER_TENANT_ID] indizieren (OWNER_TENANT_ID importieren). Die Response-Assertions (res.json()) bleiben unveraendert (Response ist weiter flach).
- test/tenant-erasure.test.js bricht NICHT (eraseTenantData liest settings/calendar nicht; die geseedete flache Form bleibt unberuehrt) - NICHT anfassen.
- KEINE Aenderung an seedState() noetig (flach bleibt; Spawn-/file-backed Tests laufen durch die json.load-Migration; das ist sogar der Migrations-Pfad selbst).

TESTS (PFLICHT, F.I.R.S.T., offline, KEIN Netz):
- NEU tenant-settings-calendar-map.test.js (reine Unit: state-ops + defaults + json.load via tempDataDir; KEINE pglite, KEIN Spawn): (1) Map-Trennung - settingsFor/calendarFor zweier synthetischer Tenants sind unabhaengig, updateSettings(B,...) laesst A unveraendert, addCalendarEvent(B,...) erscheint nicht bei A. (2) Migration - ein flaches store.json (settings-Objekt + calendar-Liste, Muster seedState) laedt in den Owner-Bucket; leere calendar-Liste -> leerer Owner-Bucket; idempotent (zweiter load unveraendert); forward-compat (fehlendes neues settings-Feld wird im Owner-Bucket gedefaultet). (3) tenantContext(owner) liefert Owner-Bucket-settings/-calendar (byte-identisch zu den heutigen Werten).
- store-pg.test.js erweitern (pglite ONLY): Backend-Parity - frischer pg-Owner-Bucket settings == defaultSettings(), calendar == demoCalendar(); updateSettings(OWNER,...) + addCalendarEvent(OWNER,...) round-trippen durch flush/hydrate (reopen zeigt die Werte); settingsFor/calendarFor sind ueber den pg-Pfad erreichbar (kein undefined-Drift). Bestehende store-pg-Faelle minimal auf die tenantId-Signaturen ziehen (s.o.).
- Bestandssuite: 277 bleiben gruen, BEIDE Backends; jede Anpassung begruenden. Gesamt = 277 + neue Tests.

DETERMINISTISCHER CHECK (Gate, DREIFACH wie im Plan-Doc):
(a) node --check auf jede neue/geaenderte .js (defaults.js, state-ops.js, json.js, pg.js, claude.js, server.js + neue/justierte Testdateien).
(b) npm test BEIDE Backends (json-Default + pglite-in-process) gruen, 0 fail; SELBST zaehlen (Reviewer-/Auditor-Counts NIE blind glauben).
(c) Dreifach: Bestandssuite byte-identisch gruen (Owner-Bucket == Singleton) + Migrations-Test (alter Shape -> Owner-Bucket) + Map-Trennungs-Test + Backend-Parity json==pg.
(d) Dichtheit: git diff master HEAD zeigt 0 Verhaltens-Diff in src/bridge.js, src/config.js, .env.example, src/mcp-tools.js, schema.sql/migrate.js, den Safety-Gate-/Auth-Pfaden und den Telephony-Adaptern; geaendert NUR: defaults.js (2 neue Map-Factories) + state-ops.js (settingsFor/calendarFor + 4 Ops bekommen tenantId + tenantContext liest Maps) + json.js (2 Migrations-Helfer + 4 Wrapper-Signaturen) + pg.js (hydrate/flush Owner-Bucket + 4 Methoden-Signaturen) + claude.js (NUR book_appointment 2 Caller + Kommentar) + server.js (NUR /api/state-Form + 2 Route-Caller) + neue/justierte Tests. store.js 0 Diff (Fassade bleibt 29).

COMMIT: git add EXPLIZIT: git add src/ test/ && git commit. KEINE neuen Dependencies. node_modules-Symlink NICHT committen (git rm --cached node_modules falls gestaged). config.js/.env.example/package.json/store.js NICHT veraendert. Commit-Msg: feat(i2): settings/calendar auf pro-Tenant-Maps (settingsFor/calendarFor analog usageFor) + json.load-Migration + pg-Parity.`
}
const PHASE = A.phaseId || 'P?'
const PHASE_TITLE = A.phaseTitle || ''
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`
const BASE = A.baseBranch || 'master'
const EXTRA = A.extraNotes ? `\nZUSATZ-HINWEISE DES AUFTRAGGEBERS:\n${A.extraNotes}\n` : ''
// Plan-Datei aus args (abwaertskompatibel: Default = der bisherige Bestandsplan)
const PLAN_DOC = A.planDoc || "PLAN-MULTI-TENANT-TELNYX.md"

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT, kein Optional): Lies "${REPO}/.claude/refs/clean-code.md" - das ist der verbindliche Prueftkatalog dieses Repos - und befolge ihn bei JEDER Code-Entscheidung. Insbesondere:
- Keine Duplizierung (G5/S2) - gemeinsame Logik extrahieren.
- Keine Magic Numbers ausser 0/1/-1 (G25) - benannte Konstante, in config.js wenn konfigurierbar (G35).
- Kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports/Variablen (G12).
- Aussagekraeftige, intentions-ausdrueckende Namen (N-Serie); Nebeneffekte im Namen sichtbar (N7).
- Eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34); <=3 Argumente (F1).
- Konstruktion von Fachlogik trennen, Lazy-Init-Antipattern vermeiden (P15).
- Kommentare: kein brittle Datei:Zeile-Verweis (rottet -> C2), nichts Redundantes (C3).
- Konventionen des Bestands einhalten (G24/G11): ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae).
- Neues Verhalten braucht einen automatisierten Test (P11/T-Serie); bei reinem Refactor muss die bestehende Suite OHNE Test-Aenderung gruen bleiben.`

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (numberGateError: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS ausloesen, brauchen dieselben Gates.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Twilio-Signaturpruefung (/voice), Basic-Auth (Dashboard/API), MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras.`

// ---------- Phase 1: Plan ----------
phase('Plan')
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten und CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.

1. Lies "${REPO}/${PLAN_DOC}" und finde den Abschnitt "**${PHASE} — ...**" (Ziel, betroffene Dateien, deterministisch pruefbares Ergebnis, Risiko). Das ist der Auftrag dieser Phase.
2. Lies "${REPO}/.claude/refs/clean-code.md" (Prueftkatalog) - dein Plan muss regelkonform sein.
3. Lies den ECHTEN Code auf Basis-Branch "${BASE}": fuer Dateien, die evtl. noch nicht in master sind (z.B. src/telephony/*), nutze \`git show ${BASE}:<pfad>\`; fuer unveraenderte Dateien reicht der Arbeitsbaum. Grep gezielt nach den relevanten Symbolen/Call-Sites.

${CLEAN_CODE_REQ}
${ABS_RULES}${EXTRA}

LIEFERE: (1) exakte Liste neuer Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits als Vorher/Nachher mit Datei:Zeile; (3) welche Tests neu/angepasst werden (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis dieser Phase als konkreten Check (Befehl + erwartete Ausgabe). Halte den Blast-Radius klein. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: 'Plan' }
)

// ---------- Phase 2: Implementieren + Verifizieren (Worktree) ----------
phase('Implementieren')
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    branch: { type: 'string' },
    baseBranch: { type: 'string' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    filesEdited: { type: 'array', items: { type: 'string' } },
    testsAddedOrChanged: { type: 'array', items: { type: 'string' } },
    nodeCheckPass: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    testPassCount: { type: 'number' },
    testFailCount: { type: 'number' },
    smokePass: { type: 'boolean' },
    smokeNote: { type: 'string' },
    cleanCodeSelfCheck: { type: 'string', description: 'kurze Selbstpruefung gegen clean-code.md' },
    committed: { type: 'boolean' },
    deviations: { type: 'array', items: { type: 'string' } },
    diff: { type: 'string', description: `voller git diff ${BASE} HEAD` },
    summary: { type: 'string' },
  },
  required: ['branch', 'nodeCheckPass', 'testsPass', 'testPassCount', 'testFailCount', 'committed', 'diff', 'summary'],
}
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert vom Arbeitsstand des Nutzers - du fasst dessen Working-Tree NICHT an). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess diesem Plan um:

=== PLAN ===
${plan || '(Plan fehlt - brich ab und melde es in deviations)'}
=== ENDE PLAN ===

VORGEHEN:
1. node_modules fehlt im Worktree. ZUERST symlinken: ln -s "${NODE_MODULES}" node_modules
2. Branch von der Basis anlegen: git checkout -b ${BRANCH} ${BASE}
3. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test ausfuehren. Bestehende Tests duerfen nur dann angepasst werden, wenn die Phase bewusst Verhalten aendert (im Plan begruendet); reiner Refactor -> Suite OHNE Test-Aenderung gruen. Neues Verhalten -> neuer Test im selben Lauf.
6. Smoke (best-effort, wo sinnvoll): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env starten, betroffene Route via curl pruefen, Server killen. Zu flaky -> smokePass=false + Grund, KEIN Blocker.
7. node_modules-Symlink NICHT committen (git rm --cached node_modules falls gestaged). Dann: git add src/ test/ && git commit -m "feat(${String(PHASE).toLowerCase()}): <kurze Beschreibung>".
8. cleanCodeSelfCheck: pruefe deinen eigenen Diff kurz gegen clean-code.md (Duplizierung? Magic Numbers? Namen? tote Kommentare?) und fasse zusammen.
9. Erfasse git diff ${BASE} HEAD vollstaendig im Feld diff.

${ABS_RULES}

Fuelle das Ergebnis EHRLICH. Wenn Tests nicht gruen werden oder du blockiert bist: testsPass=false + ehrliche deviations, nicht schoenen.`,
  { label: `${PHASE}-implement`, phase: 'Implementieren', schema: IMPL_SCHEMA, isolation: 'worktree' }
)

// ---------- Phase 3: Dualer Review (parallel) ----------
phase('Review')
const SAFETY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    testsPassIndependently: { type: 'boolean' },
    independentTestSummary: { type: 'string' },
    scopeRespected: { type: 'boolean' },
    safetyGatesIntact: { type: 'boolean' },
    disclosureIntact: { type: 'boolean' },
    authFailClosedIntact: { type: 'boolean' },
    noSecretsLeaked: { type: 'boolean' },
    behaviorAsIntended: { type: 'boolean' },
    approved: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['approved', 'testsPassIndependently', 'safetyGatesIntact', 'disclosureIntact', 'blockers', 'verdict'],
}
const CC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    s1: { type: 'array', items: { type: 'string' }, description: 'Tests/Sicherheit/Korrektheit - Format: "ID · Datei:Zeile · Verstoss · Fix"' },
    s2: { type: 'array', items: { type: 'string' }, description: 'Duplizierung' },
    s3: { type: 'array', items: { type: 'string' }, description: 'Ausdrucksstaerke/Namen/Kommentare' },
    s4: { type: 'array', items: { type: 'string' }, description: 'Struktur/Anzahl' },
    blocker: { type: 'boolean', description: 'true wenn s1 oder s2 nicht leer' },
    passNotes: { type: 'string' },
    topTodos: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['s1', 's2', 's3', 's4', 'blocker', 'verdict'],
}

const reviews = await parallel([
  // (a) Safety/Verhalten - unabhaengiger Re-Run + absolute Regeln
  () => agent(
    `Du bist ein STRENGER, adversarialer Safety-/Verhaltens-Reviewer in einem frischen Worktree. Pruefe Phase ${PHASE} auf Branch "${BRANCH}".
UNABHAENGIGE VERIFIKATION (selbst ausfuehren):
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()} ${BRANCH}   (eigener Branch-Name, gleicher Commit - vermeidet Worktree-Kollision)
3. npm test selbst laufen lassen -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${BRANCH} lesen und gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras), safetyGatesIntact (numberGateError/Allowlist/Budget/Max-Dauer), disclosureIntact (claude.js+bridge.js), authFailClosedIntact (Signaturpruefung/Basic-Auth/MCP-Auth), noSecretsLeaked, behaviorAsIntended (Verhalten exakt wie im Plan beabsichtigt - bei Refactor byte-identisch).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine eigenen Tests gruen. Sei skeptisch; im Zweifel blockieren. Rueckgabe IST das Urteil.`,
    { label: `${PHASE}-review-safety`, phase: 'Review', schema: SAFETY_SCHEMA, isolation: 'worktree' }
  ),
  // (b) Dedizierter Clean-Code-Auditor gegen den Prueftkatalog
  () => agent(
    `Du bist der CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${BRANCH}", Basis "${BASE}") streng gegen den Prueftkatalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG - das ist deine Wissensbasis und definiert die Schweregrade S1-S4 und die Audit-Regeln (u.a.: nur gesehenen Code bewerten, nicht raten; [Prozess/Repo]-Eintraege nur bei direkter Evidenz).
2. Lies den geaenderten Code: git diff ${BASE} ${BRANCH} ; und die neuen Dateien per git show ${BRANCH}:<pfad>.
3. Gehe Kategorie fuer Kategorie, Eintrag fuer Eintrag durch. Pro FLAG: "ID · Datei:Zeile · was den Verstoss ausmacht · konkreter Fix". Ordne jedem FLAG den Schweregrad zu (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Setze blocker=true, wenn s1 ODER s2 nicht leer ist (das verhindert den Merge). passNotes: was sauber ist. topTodos: die 1-3 wichtigsten. Rueckgabe IST der strukturierte Audit. Erfinde nichts (Audit-Regel 1).`,
    { label: `${PHASE}-review-cleancode`, phase: 'Review', schema: CC_SCHEMA, isolation: 'worktree' }
  ),
])

const safetyReview = reviews[0]
const cleanCodeAudit = reviews[1]
const approved = !!(safetyReview && safetyReview.approved && cleanCodeAudit && !cleanCodeAudit.blocker)

return {
  phaseId: PHASE,
  branch: BRANCH,
  baseBranch: BASE,
  approved,
  gate: approved ? 'PASS' : 'BLOCKED (Safety nicht approved ODER Clean-Code S1/S2)',
  plan,
  impl,
  safetyReview,
  cleanCodeAudit,
}
