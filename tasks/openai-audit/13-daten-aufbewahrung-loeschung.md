# Dimension D13 — Dateninventar, Aufbewahrung, Loeschung, Datenschutzerklaerung

Dimension: D13 | Quelle: Code auf Branch master

## Kurzfassung

Das Dateninventar ist gut strukturiert (Postgres-Schema mit RLS, JSON-Backend spiegelbildlich), Retention fuer Calls/Transkripte/Notifications ist ECHT implementiert (drei gestaffelte Fristen, Cron alle 6h) und die Datenschutzerklaerung ist ungewoehnlich detailliert und ehrlich ("[OFFEN]"-Markierungen statt Fantasieangaben). Der schwerste Befund: die Privacy-Policy behauptet "eine vollstaendige Loeschung deiner Anruf- und Kontodaten fuehren wir auf Anfrage durch" — der einzige Loeschweg im Code (`scripts/erase-tenant.js`) loescht explizit NUR Calls/Transkripte/Action-Items/Notifications/private Nummer und laesst laut eigenem Kommentar "Settings/Profile/aktive Nummern/Kalender/Usage" unangetastet; Tenant-Zeile, Account-Zeile (Login-Identitaet), KYC- und Stripe-Referenzen werden NIE geloescht. Zweiter schwerer Befund: die Policy erklaert Websuche/Recherche als "nicht aktiv" (`RESEARCH_ENABLED=false`/`LOOKUP_ENABLED=false` in render.yaml), waehrend Projektwissen ausserhalb dieses Reviews eine Live-Aktivierung seit 2026-08-01 nahelegt — aus dem Repo allein nicht entscheidbar, weil Render-Services laut Bestandsdokumentation Dashboard-verwaltet sind und vom Blueprint abweichen koennen. Dritter Befund: LLM-Provider ist im Code umschaltbar (Anthropic/DeepSeek), die Policy nennt ausschliesslich Anthropic.

## Pruefpunkte

### PP-D13-01 Dateninventar Call-Daten (Postgres)

- Status: PASS
- Evidenz: `src/db/schema.sql:211-393` (Tabelle `call`: from/to E.164, caller_name, briefing, constraints, summary, objective_achieved, context JSONB, mandate JSONB, result JSONB inkl. `evidence`, consults JSONB, lookup_log JSONB, appointment_date/time, amount/currency, callee_confirmed_timezone); `src/db/schema.sql:552-561` (`transcript_segment`: role/text/at pro Call, eigene Tabelle); `src/db/schema.sql:564-573` (`action_item`); `src/db/schema.sql:576-583` (`calendar_event`)
- Risiko: keins — reine Bestandsaufnahme, Felder sind zweckgebunden und einzeln kommentiert (Herkunft/Zweck stehen im Schema-Kommentar selbst, ungewoehnlich gut dokumentiert)
- Empfehlung: keine
- Prioritaet/Kategorie: N/A / N/A

### PP-D13-02 Verschluesselung ruhend/unterwegs nicht im Code verifizierbar

- Status: UNKNOWN
- Evidenz: `src/portal-pool.js:52` (`new pg.Pool({ connectionString: config.store.databaseUrl })` — kein `ssl:`-Objekt gesetzt); keine weitere pg-Pool-Instanziierung mit expliziter TLS-Option gefunden (`grep -rn "new pg\." src/` liefert nur diese Stelle plus die Owner-Spiegel-Pool-Instanziierung mit identischem Muster)
- Risiko: TLS zur DB haengt ausschliesslich am `sslmode`-Parameter in der `DATABASE_URL` (Render-Dashboard-Secret), nicht am Code — ein versehentlich ohne `sslmode=require` gesetzter Connection-String wuerde unbemerkt unverschluesselt verbinden, ohne dass der Code das verhindert oder meldet. Verschluesselung ruhend (Postgres-Storage-Encryption) ist eine Render-Plattformeigenschaft, im Repo nicht referenziert/geprueft.
- Empfehlung: `sslmode`/TLS explizit im Code erzwingen (z.B. Boot-Guard, der die Connection-String-Form prueft) statt sich implizit auf die Env-Variable zu verlassen; Verschluesselung-ruhend-Zusage des Hosters in README/PLAN-SECURITY referenzieren
- Prioritaet/Kategorie: P2 / C

### PP-D13-03 Consult-/Recherche-Daten sind im Dateninventar erfasst und MCP-seitig minimiert

- Status: PASS
- Evidenz: `src/db/schema.sql:340-346` (`consults`/`lookup_log` JSONB am Call, Kommentar: "Faellt wie consults automatisch unter Erase/Export/Retention"); `src/mcp-tools.js:193-199,1015-1046` (`get_transcript`: Whitelist-Filter, Roh-Transkript wird NIE ausgeliefert — nur `result_summary`, `objective_achieved` und fuenf Karten-Felder aus `resultCardView`)
- Risiko: keins fuer diesen Pruefpunkt; Consult-Anfragen/-Antworten selbst laufen ueber `answer_consult`/`await_call_event` und tragen laut Schema-Kommentar dieselbe Retention wie der Call — das ist konsistent, aber siehe PP-D13-06 zur fehlenden dedizierten kuerzeren Frist fuer Consult-Inhalte
- Empfehlung: keine akut
- Prioritaet/Kategorie: N/A / N/A

### PP-D13-04 Retention: drei gestaffelte, technisch umgesetzte Fristen mit periodischem Sweep

- Status: PASS
- Evidenz: `src/config.js:1939` (`RETENTION_DAYS`, Default 30) `src/config.js:1947-1948` (`DIAGNOSTIC_RETENTION_DAYS`, Default 7 lt. `.env.example:999`) `src/config.js:1960` (`EVIDENCE_RETENTION_DAYS`, Default 0 lt. `.env.example:1006`); `src/store/state-ops.js:5096-5170` (`pruneExpiredRecords`, `purgeExpiredDiagnosticTranscripts`, `purgeExpiredResultEvidence`, komponiert in `pruneOldData`); `src/boot.js:107-108,115-121,1234-1235` (Sweep alle 6h + einmal beim Boot, fuer beide Backends identisch: `src/store/json.js:1334-1339`, `src/store/pg.js:829-834`)
- Risiko: keins — Frist ist definiert UND technisch durchgesetzt, Code und `.env.example`-Dokumentation stimmen ueberein
- Empfehlung: keine
- Prioritaet/Kategorie: N/A / N/A

### PP-D13-05 Unbegrenzte Speicherung bei Tenant-/Account-/Billing-Stammdaten (keine Frist definiert)

- Status: PARTIAL
- Evidenz: `src/db/schema.sql:13-160` (Tabelle `tenant`: owner_name, private_number, KYC-Level, Stripe-Kunden-/Zahlungsmittel-/Abo-IDs, Geo, Newsletter-Empfaenger — keine einzige Spalte mit TTL/Retention-Bezug); kein Treffer fuer eine Retention-Regel auf `settings`, `number`, `usage`, `profile`, `account`, `session` in `src/store/state-ops.js` (`pruneOldData` deckt ausschliesslich `calls`/`notifications`/`actionItems`/Diagnose-Transkripte/Ergebnis-Zitate ab, s. PP-D13-04)
- Risiko: Konto-/Abrechnungs-Stammdaten eines laengst inaktiven Tenants bleiben technisch unbegrenzt gespeichert; das deckt sich zwar mit der Policy-Aussage "Kontodaten bleiben fuer die Dauer des Vertragsverhaeltnisses gespeichert" (Vertragsdauer ist bewusst die Frist), aber es gibt NACH Vertragsende keinen technischen Loeschmechanismus fuer die tenant-Zeile selbst (s. PP-D13-07) — die Frist "Vertragsende" wird also nie tatsaechlich vollzogen
- Empfehlung: Entweder die Policy-Aussage praezisieren ("Kontodaten bleiben auch nach Vertragsende gespeichert, bis eine Loeschung beantragt wird") oder einen automatischen Nachlauf fuer `tenant`/`account` nach `status=closed`/Kuendigungsabschluss bauen
- Prioritaet/Kategorie: P1 / B

### PP-D13-06 audit_log: bewusste Ausnahme von jeder Tenant-Loeschung, dokumentiert

- Status: PASS
- Evidenz: `src/db/schema.sql:1010-1013` ("audit_log: immutable append-only. tenant_id BEWUSST KEIN FK (muss Tenant-Loeschung ueberdauern, Compliance Art. 15). Keine RLS")
- Risiko: keins — legitime, dokumentierte Ausnahme (Nachweispflicht); Warnung im Schema selbst, `audit_log` nie ueber Kunden-Reads zu exponieren, ist vorhanden
- Empfehlung: keine
- Prioritaet/Kategorie: N/A / N/A

### PP-D13-07 Vollstaendige Konto-/Anruf-Loeschung existiert NICHT als Netz-Endpunkt — nur als manuelles CLI-Skript, das die eigene "vollstaendig"-Behauptung nicht einloest

- Status: FAIL
- Evidenz: `scripts/erase-tenant.js:1-9` ("BEWUSST KEIN Netz-Endpunkt ... entfernt call-verknuepfte Daten EINES Tenants ... Settings/Profile/aktive Nummern (s.numbers)/Kalender/Usage bleiben"); `src/store/state-ops.js:527-560` (`eraseTenantData`: loescht NUR `calls`, `actionItems`, `notifications` (ueber `callIds`) und die `private_number`-Spalte am Tenant — keine weitere Spalte); `apps/web/src/data/legal/privacy.de.json:54` ("eine vollstaendige Loeschung deiner Anruf- **und Kontodaten** fuehren wir auf Anfrage durch"); kein Treffer fuer `eraseTenantData`/`exportTenantData` in `src/self-service-routes.js` als DELETE-Route (`grep -n "router\.delete" src/self-service-routes.js` liefert nur `/api/self-service/newsletter-recipients`); Tenant-Status `TENANT_STATUS.CLOSED` wird im gesamten `src/`-Baum an KEINER Stelle GESCHRIEBEN (nur gelesen: `src/web-auth.js:534` als Ausschlussfilter, `src/store/state-ops.js:2729` als Gate-Check) — es gibt also keinen Codepfad, der einen Tenant je in den Zustand `closed` versetzt
- Risiko: (a) Die oeffentliche Datenschutzerklaerung behauptet eine Faehigkeit ("vollstaendige Loeschung ... Kontodaten"), die der Code nachweislich nicht besitzt — Account-Zeile (Login-Identitaet/E-Mail), Settings, Nummern-Zuordnung, Profil, Nutzungs-/Budgetdaten, KYC- und Stripe-Referenzen ueberleben jede Loeschanfrage. (b) Der einzige Ausfuehrungsweg ist ein von Hand auszufuehrendes Skript ohne Audit-Log-Eintrag (kein `auditStore.record`-Aufruf in `erase-tenant.js`) — eine Nutzeranfrage nach Art. 17 haengt vollstaendig an einem manuellen Operator-Schritt ohne Nachweispflicht im System selbst.
- Empfehlung: Entweder (1) die Policy-Formulierung auf das tatsaechliche Verhalten zuruecknehmen ("wir loeschen deine Anrufdaten auf Anfrage; Kontodaten bleiben fuer die Vertragsabwicklung bestehen, bis der Vertrag beendet ist") oder (2) `eraseTenantData` um Account-/Settings-/Profil-/Nummern-Scope erweitern und tatsaechlich ueber einen (admin-gesicherten) Endpunkt mit Audit-Eintrag erreichbar machen, wenn "vollstaendig" gemeint ist
- Prioritaet/Kategorie: P1 / A (O-6: Privacy Policy muss eingehalten werden, nicht nur formuliert sein)

### PP-D13-08 Vertragsende-Cleanup loescht Nummer + WorkOS-Identitaet, aber KEINE Call-/Transkript-Daten

- Status: PARTIAL
- Evidenz: `src/billing/contract-end-cleanup.js:66-108` (`attemptContractEndCleanup` ruft `releaseTenantNumbersOnErase` (Nummer) und `attemptWorkosDelete` (Login-Identitaet) — `store.eraseTenantData` wird an KEINER Stelle in dieser Datei aufgerufen, bestaetigt durch `grep -n "eraseTenantData" src/billing/contract-end-cleanup.js` ohne Treffer); `release-reconcile.js:222` (eigener Kommentar: "die kuenftige Erase-Route komponiert store.eraseTenantData (Daten) + diese Fn (Nummern)" — die Komposition ist laut Code selbst NOCH NICHT gebaut)
- Risiko: Eine Kuendigung (312k-Kette) loest heute NUR Nummernfreigabe + WorkOS-Loeschung aus; Call-Records/Transkripte/Zusammenfassungen des gekuendigten Tenants bleiben unangetastet und fallen — wenn ueberhaupt — erst ueber die zeitbasierte `RETENTION_DAYS`-Frist (30 Tage nach Call-Ende, nicht nach Kuendigung). Ein Tenant, dessen letzter Call juenger als 30 Tage vor der Kuendigung liegt, hat seine Daten also laenger im System als sein Vertrag lief.
- Empfehlung: `attemptContractEndCleanup` um einen `eraseTenantData`-Aufruf ergaenzen (der Kommentar in `release-reconcile.js:222` beschreibt diesen Schritt bereits als vorgesehen) ODER die Policy-Aussage zur Speicherdauer bei Kuendigung entsprechend praezisieren
- Prioritaet/Kategorie: P1 / B

### PP-D13-09 Datenexport (Art. 15/20) ist als Endpunkt verdrahtet und tenant-gescoped

- Status: PASS
- Evidenz: `src/routes/api-read.js:119-123` (`GET /api/tenant-data/export`, `internalOnly`); `src/self-service-routes.js:370` (`store.exportTenantData(tenant)` im Self-Service-Pfad); `src/store/state-ops.js:517-524` (`tenantCallScope` als gemeinsame Scope-Quelle fuer Export UND Erase — "sonst leakt der Export Daten, die das Erase loescht, oder umgekehrt")
- Risiko: gering — Export nutzt denselben Scope wie Erase (kein Drift), ist aber wegen PP-D13-07 nur ein TEIL-Export (dieselbe Call-/Transkript-/ActionItem-Teilmenge, nicht Settings/Profil/KYC/Stripe)
- Empfehlung: Export-Umfang in der Policy als "Anruf- und Konto-Kerndaten" statt implizit "alles" beschreiben, wenn Settings/Billing-Referenzen nicht enthalten sind
- Prioritaet/Kategorie: P2 / C

### PP-D13-10 Diagnose-Retention (kurze Frist fuer Eigenanrufe) ist eng und fail-closed gebaut

- Status: PASS
- Evidenz: `src/diagnostic-retention.js:23-70` (Grant nur bei `calleeIsOwner` — exakter String-Vergleich Ziel==eigene hinterlegte Nummer — UND `DIAGNOSTIC_RETENTION_DAYS>0`; jeder Widerspruch/jede fehlende Bedingung faellt auf Bestandsverhalten "Purge nach Summary" zurueck); `src/store/state-ops.js:512-515` (`purgeTranscript`: EINE Mutationsquelle)
- Risiko: keins
- Empfehlung: keine
- Prioritaet/Kategorie: N/A / N/A

### PP-D13-11 Privacy-Policy vs. Code: Websuche/Recherche als "nicht aktiv" beschrieben — aus dem Repo allein nicht verifizierbar, ob das noch stimmt

- Status: UNKNOWN
- Evidenz: `apps/web/src/data/legal/privacy.de.json:38` ("Weitere im System angelegte, derzeit abgeschaltete Anbindungen (Websuche vor oder waehrend eines Gespraechs, ...) sind nicht aktiv; vor einer Aktivierung ergaenzen wir diese Erklaerung"); `render.yaml:390-401` (`RESEARCH_ENABLED=false`, `LOOKUP_ENABLED=false`, eigener Kommentar: "Anschalten erst nach Testanruf UND Nennung des ZWEITEN Auftragsverarbeiters in der Datenschutzerklaerung"); `src/research/adapters/exa-search.js:1-8` (Exa als "ZWEITER Auftragsverarbeiter", Owner-Entscheidung 2026-08-01) — Exa wird in `privacy.de.json` an KEINER Stelle namentlich genannt (`grep -n "Exa" apps/web/src/data/legal/privacy.de.json` ohne Treffer)
- Risiko: Sollte `RESEARCH_ENABLED`/`LOOKUP_ENABLED` im Render-DASHBOARD (nicht im Blueprint) auf `true` stehen — Render-Services sind laut Projekt-Historie dashboard-verwaltet und koennen vom `render.yaml`-Stand abweichen — waere die Privacy-Policy-Aussage "nicht aktiv" objektiv falsch UND der Code wuerde gegen seine eigene, selbst gesetzte Vorbedingung verstossen (Anschalten nur NACH Nennung von Exa in der Erklaerung). Dies waere ein Verstoss gegen O-6/O-15/O-16 (unzulaessige Datenverarbeitung ohne Offenlegung) und ein DSGVO-Thema erster Ordnung. Aus dem Repo-Stand allein (Branch master, `render.yaml`) ist der LIVE-Zustand nicht feststellbar.
- Empfehlung: Vor jeder OpenAI-Einreichung den tatsaechlichen Wert von `RESEARCH_ENABLED`/`LOOKUP_ENABLED`/`CONSULT_ENABLED` im Render-Dashboard-Environment (nicht im Blueprint) pruefen und mit der Privacy-Policy abgleichen; bei Diskrepanz die Policy VOR der Einreichung korrigieren
- Prioritaet/Kategorie: P0 / A

### PP-D13-12 Privacy-Policy nennt nur Anthropic als LLM-Sub-Auftragsverarbeiter — Code unterstuetzt einen zweiten (DeepSeek), Live-Wert nicht aus dem Repo ablesbar

- Status: UNKNOWN
- Evidenz: `apps/web/src/data/legal/privacy.de.json:38` (Sprachmodell-Absatz nennt ausschliesslich Anthropic/Anthropic Ireland); `src/llm/provider.js:4` (`LLM_PROVIDER = {ANTHROPIC, DEEPSEEK}`); `render.yaml:373-377` (`LLM_PROVIDER=anthropic` im Blueprint, mit Kommentar "B5 liefert die Faehigkeit zu wechseln, nicht die Umstellung"); `.env.example:26-27` (DeepSeek-Umschaltung Boot-Pflicht nur bei `LLM_PROVIDER=deepseek`)
- Risiko: Der Blueprint-Wert ist `anthropic`; ob der tatsaechlich laufende Render-Dienst denselben Wert traegt, ist aus dem Repo nicht feststellbar (gleiche Dashboard-vs-Blueprint-Luecke wie PP-D13-11). Liefe live DeepSeek, wuerde ein nicht in der Policy genannter Sub-Auftragsverarbeiter (anderes Land, andere Garantie-Grundlage) Gespraechsinhalte verarbeiten.
- Empfehlung: Denselben Live-Abgleich wie PP-D13-11 vornehmen; bei aktivem `LLM_PROVIDER=deepseek` (oder gesetztem `LLM_PROVIDER_FALLBACK=deepseek`) die Policy um DeepSeek als Empfaenger/Drittland-Fall ergaenzen, bevor extern (ChatGPT-Nutzer) auf die Policy verwiesen wird
- Prioritaet/Kategorie: P0 / A

### PP-D13-13 Matrix: Privacy-Policy-Aussagen gegen Code (nur die Punkte mit Abweichung/Unsicherheit; deckungsgleiche Punkte s. Pruefpunkte oben)

| tatsaechlich verarbeitete Daten / Prozess | in Erklaerung erwaehnt? | Zweck korrekt? | Aufbewahrung korrekt? | Empfaenger korrekt? |
|---|---|---|---|---|
| Roh-Transkript-Purge nach Summary | Ja (`privacy.de.json:50`) | Ja | Ja, deckt sich mit `state-ops.js` purgeTranscript | N/A |
| 30-Tage-Loeschung abgeschlossener Calls/Notifications/erledigter Aufgaben | Ja (`privacy.de.json:50`) | Ja | Ja, deckt sich mit `RETENTION_DAYS`-Default | N/A |
| Diagnose-Retention (Eigenanruf, 7 Tage) | NEIN — nicht erwaehnt | — | — | — (P2, s.u.) |
| Vollstaendige Konto-Loeschung "auf Anfrage" | Ja (`privacy.de.json:54`) | Ja (Zweck stimmt) | **Nein** — Code loescht nur Call-Scope, s. PP-D13-07 | N/A |
| Vertragsende: Nummernfreigabe + WorkOS-Loeschung | Ja (`privacy.de.json:50`) | Ja | Ja, deckt sich mit `contract-end-cleanup.js` | Ja |
| Websuche/Recherche (Exa) waehrend Anrufen | Erwaehnt als "nicht aktiv" | — | — | **Unsicher** — Live-Zustand nicht aus Repo ablesbar, s. PP-D13-11 |
| LLM-Sub-Auftragsverarbeiter | Nur Anthropic genannt | — | — | **Unsicher** — DeepSeek-Umschaltung existiert im Code, s. PP-D13-12 |
| Audio-Aufzeichnung | Explizit verneint ("Nach Codestand werden keine Tonaufzeichnungen ... gespeichert") | Ja | N/A | N/A |
| Telefonie (Telnyx)/TTS (ElevenLabs)/Hosting (Render)/Zahlungen (Stripe)/Login (WorkOS)/Mail (Brevo/Zoho) | Ja, alle einzeln mit Sitz + Datenkategorie | Ja | N/A | Ja, plausibel und mit Rechtsgrundlage (SCC/DPF) unterlegt |

- Zusatzbefund zur Diagnose-Retention-Zeile: die 7-Tage-Sonderfrist fuer Eigenanrufe (`DIAGNOSTIC_RETENTION_DAYS`) taucht in der Policy nicht als eigener Punkt auf — sie widerspricht der Policy nicht (Ergebnis ist fuer Dritte irrelevant, betrifft nur Anrufe an die eigene Nummer), ist aber eine unvollstaendige Speicherdauer-Angabe.
- Prioritaet/Kategorie (Sammelbefund Diagnose-Zeile): P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Steht `RESEARCH_ENABLED`/`LOOKUP_ENABLED`/`CONSULT_ENABLED` im LIVE Render-Dashboard-Environment auf `true`? Das Repo enthaelt nur den Blueprint-Default (`false`); Bestandswissen dieses Projekts besagt, dass Render-Services dashboard-verwaltet sind und vom Blueprint abweichen koennen — das laesst sich aus `render.yaml` allein nicht entscheiden.
- Welcher `LLM_PROVIDER`-Wert (`anthropic` vs. `deepseek`) laeuft aktuell live? Gleiche Dashboard-vs-Blueprint-Luecke wie oben.
- Ist der Postgres-Connection-String (`DATABASE_URL`) im Render-Dashboard mit `sslmode=require` konfiguriert? Nicht im Code erzwungen, nicht aus dem Repo ablesbar.
- Bietet Render fuer den gebuchten Plan eine dokumentierte Verschluesselung ruhend (at rest) und welche Protokoll-Aufbewahrungsfrist gilt dort? Von der Policy selbst als `[OFFEN]` markiert (`privacy.de.json:46`) — im Repo nicht beantwortbar.
- Ist zwischen dem Zeitpunkt dieses Audits und dem letzten `git log`-Stand (`ff180c0`, 2026-09-18) ein Erase-Endpunkt oder ein WorkOS-Backfill fuer Bestandsdaten in Arbeit, der PP-D13-07/08 bereits adressiert? Aus dem aktuellen Codestand nicht ersichtlich.

## Randbefund (ausserhalb dieser Dimension)

`src/portal-pool.js` prueft aktiv gegen Superuser/BYPASSRLS-Rollen (F5) — das ist eine gute Sicherheitseigenschaft, gehoert aber in die Auth-/RLS-Dimension, nicht in D13.
Die self-service-routes.js-Route `/api/self-service/private-number` (erwaehnt in CLAUDE.md als eigentumsfrei, nur formatvalidiert) ist ein Auth-/Autorisierungs-Thema (wer darf eine fremde Nummer hinterlegen), keine D13-Frage — sollte aber vom Auth-Dimension-Auditor aufgegriffen werden.
