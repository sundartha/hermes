# F1 — Geo-Location basierte Nummern- und Sprachzuordnung

> Strategie (KEIN Code, KEINE Implementierung). Jeder User bekommt anhand seines
> Standorts automatisch eine passende Telnyx-Nummer (Laendervorwahl) und eine
> passende Gespraechssprache. DE → +49 + Deutsch, FR → +33 + Franzoesisch.
>
> Erarbeitet mit Agent-Team (4 Read-Only-Recherche-Agenten: Provisioning/Telnyx,
> Store-Schema/Migration, LLM/Sprache/Voice, Inbound-/Outbound-Routing). Alle
> Annahmen gegen den echten Code verifiziert (`src/server.js`, `src/onboarding.js`,
> `src/telephony/*`, `src/store/*`, `src/claude.js`, `src/db/schema.sql`,
> `src/config.js`). Einstufung: **GROSS** (zwei Subsysteme, Schema-Migration,
> echtes Geld, Provider-Live-Verhalten) — daher 9 Phasen in zwei Bloecken.

---

## 0. Die zwei tragenden Erkenntnisse (am Code verifiziert)

**(A) Die Telefonnummer IST der dauerhafte Geo-Anker — nicht die IP.**
Das Routing kennt den Standort heute schon implizit ueber die Nummer:
- Inbound: `findTenantByNumber(to)` (`src/store/state-ops.js:284`) — die ANGERUFENE
  Nummer bestimmt den Tenant. Eine deutsche +49-Nummer antwortet auf Deutsch, egal
  wer anruft.
- Outbound: `outboundFrom(s, tenantId)` → `findActiveNumber` (`src/server.js:650`,
  `src/store/views.js:20`) — die ABSENDER-Nummer wird aus dem Store gewaehlt.

Daraus folgt die Architektur-Entscheidung: **`country` + `language` gehoeren auf den
Number-Record** (plus ein Tenant-Default). Dann ist die Geo-Zuordnung zur Laufzeit
ein harter, nicht spoofbarer Fakt (die Nummer existiert), kein Client-Claim. IP-Geo
wird nur EINMAL gebraucht — bei der Registrierung, um das Land vorzuschlagen.

**(B) `call.language` ist ein vollstaendig verdrahteter, aber TOTER Datenkanal.**
Das Feld existiert end-to-end (API `src/server.js:741`, MCP `src/mcp-tools.js:88`,
`createCall` Default `"de"` `src/store/state-ops.js:98`, DB-Spalte `src/db/schema.sql:63`,
PG-Roundtrip `src/store/pg.js:428,595`) — wird aber **nirgends ausgelesen**, um TTS/STT/
Prompt zu steuern. Sprache ist an ~18 Stellen hart `de` verdrahtet (siehe §3.3). Der
groesste Teil der "Sprachzuordnung" ist also nicht ein neues Modell, sondern: diesen
toten Kanal an den richtigen Stellen aktiv konsumieren.

> Wichtige Klarstellung zum Brief ("deutsches/franzoesisches Sprachmodell"): Es ist
> **dasselbe** Claude-Modell fuer alle Sprachen (`config.claudeModel` = `claude-haiku-4-5`,
> `src/config.js:45`; mehrsprachig). "FR-Modell" = derselbe Claude mit (a) FR-System-Prompt
> + (b) FR-STT-Locale + (c) FR-TTS-Voice + (d) FR-Offenlegung. **Kein Modellwechsel** —
> spart Komplexitaet und Kosten. (Die FR-Gespraechsqualitaet von Haiku 4.5 ist als offene
> Frage zu verifizieren, siehe §6.)

---

## 1. Ziel & Akzeptanzkriterien

### 1.1 Definition "Geo-Location"

Geo-Location = der **Laendercode**, der (1) die Nummern-Vorwahl beim Kauf und (2) die
Gespraechssprache bestimmt. Quellen-Prioritaet (fail-safe, spoof-resistent):

1. **Explizite User-Wahl bei der Registrierung** — autoritativ. Der User waehlt sein
   Land bewusst (es kostet Geld und bestimmt seine Nummer → Consent ohnehin noetig).
2. **IP-Geo als reine VORBELEGUNG** (maxmind/ip-api o.ae.) — nur ein Vorschlag im
   Formular, NIE autoritativ (VPN-spoofbar).
3. **Fallback `config.provisioningCountry`** (Default `"DE"`, `src/config.js:172`),
   wenn IP-Geo fehlschlaegt und keine User-Wahl vorliegt.

Nach dem Kauf ist die **Nummer** der Laufzeit-Source-of-Truth (siehe §0-A) — IP-Geo
wird zur Laufzeit nie mehr befragt.

> Scoping-Entscheidung Inbound: Die Sprache eines eingehenden Anrufs richtet sich nach
> der **angerufenen** Nummer (dem Tenant), NICHT nach einer Echtzeit-Geo des Anrufers.
> Caller-ANI/IP-Geo zur Laufzeit ist bewusst out-of-scope (Aufwand, Genauigkeit). Eine
> +33-Nummer fuehrt FR, eine +49-Nummer DE — deterministisch und korrekt.

### 1.2 Akzeptanzkriterien — Nummernzuordnung

- [ ] Bei Registrierung mit Land FR wird eine `+33`-Nummer gesucht/gekauft (statt `+49`).
- [ ] Der gekaufte Number-Record traegt `country` (ISO-2) und `language` (z.B. `"fr"`).
- [ ] Pro Provisioning-Job wird der `countryCode` aus dem Record/Request abgeleitet,
      NICHT global aus `config.provisioningCountry` (heute `src/server.js:1008`).
- [ ] Doppelkauf bleibt durch die drei Bestandsschloesser ausgeschlossen (siehe §5/R1).
- [ ] Outbound: hat ein Tenant Nummern in mehreren Laendern, wird die zur Ziel-Vorwahl
      passende Absendernummer gewaehlt; sonst die Primaer-Nummer (kein Zufall).
- [ ] Kein Land ausserhalb von `allowedCountryCodes` wird ohne bewusste Freigabe gekauft
      oder angerufen.

### 1.3 Akzeptanzkriterien — Sprachzuordnung

- [ ] Ein Inbound-Call auf eine FR-Nummer wird in FR gefuehrt: System-Prompt,
      Offenlegung, STT-Locale (`fr-FR`), TTS-Voice, statische Ansagen — alle FR.
- [ ] `call.language` wird tatsaechlich konsumiert (nicht mehr toter Kanal).
- [ ] Der Offenlegungssatz existiert als **fest verdrahtete FR-Variante** (Regel 2 bleibt
      gewahrt: byte-stabil, kuratiert, nicht per Call-Parameter abschaltbar/frei waehlbar).
- [ ] DE bleibt **byte-identisch** zum heutigen Verhalten (kein FR-Pfad faerbt DE ab).
- [ ] Unbekannte/fehlende Sprache → Fallback `de` (heutiges Verhalten).

---

## 2. Architektur-Skizze

### 2.1 Geo-Dienst (woher kommt der Standort?)

Neue, kleine Adapter-Schicht (z.B. `src/geo/`) mit EINER Aufgabe: IP → ISO-Laendercode,
nur zur **Registrierungszeit** in `/api/onboard` (`src/server.js:927`). Bewusst hinter
einem Env-Flag + Provider-Abstraktion (wie Telephonie-Ports), damit der Geo-Provider
(maxmind-DB lokal vs. ip-api HTTP) austauschbar ist und Tests ohne Netz laufen. Liefert
nur einen **Vorschlag**; die Entscheidung faellt der User (oder der Config-Fallback).

### 2.2 Land → Nummer-Mapping

Konfigurationstabelle `countryCode → Telnyx-Suchparameter` (ISO-2 →
`{ telnyxCountryCode, connectionId, phoneNumberType?, locality? }`). Heute ist die Suche
quasi parameterlos: `searchNumbers({ countryCode, type, limit })` mit `limit` Default 1
und nur `filter[features][]=voice` fix (`src/telephony/adapters/telnyx/numbers.js:32-37`).
Pro Land braucht es ggf. eine eigene `connectionId` (heute global
`config.telnyxConnectionId`, `src/server.js:1008`) und ein hoeheres Such-Limit mit
Verfuegbarkeits-Auswahl.

### 2.3 Land → Sprache-Mapping

Konfigurationstabelle `countryCode → language` (`DE→de`, `FR→fr`, `AT→de`, `CH→de`, …)
plus ein **Locale-Bundle** `language → { systemPromptParts, disclosureSentence,
sttLocale, voiceProfile, staticTexts }`. Heute existiert nur DE, ueberall hart verdrahtet
(§3.3). Das Bundle wird der einzige Ort, an dem Sprach-Strings leben.

### 2.4 Speicherung (Store/DB)

Verifizierte Migrations-Mechanik (kein zentrales Framework):
- **JSON-Backend:** Default-Merge beim Lesen (`src/store/json.js`); Settings-Bucket-Felder
  backfillen automatisch via `{ ...defaultSettings(), ...bucket }`.
- **PG-Backend:** idempotentes additives DDL `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
  bei jedem Boot re-applied (`src/db/migrate.js`, `src/db/schema.sql`). Belege fuer genau
  dieses Muster: `schema.sql:15,19,20,23,28,32,33` (tenant), `:161,162,166` (number).

Empfohlene Platzierung (gespaltene Verantwortung):
- **`number.country` + `number.language` (number-level)** — der Routing-Anker (§0-A).
  Praezedenz: `number.provider`/`number.status` (`src/store/state-ops.js:50`). Die
  `number`-Tabelle hat RLS (`schema.sql:279-280`).
- **`tenant.country` + `tenant.defaultLanguage` (tenant-level)** — Default/Fallback, das
  IP-Geo bei Registrierung schreibt. Praezedenz: `kyc_level`/`stripe_*`
  (`state-ops.js`-Setter, `schema.sql:28,32`). Achtung: `tenant`-Tabelle hat **keine** RLS
  (`src/store/pg.js:267`) — fuer nicht-sensible Geo-Daten ok, bewusst notiert.
- Optional **`settings.language`**, falls der Owner die Sprache im Dashboard umstellen
  koennen soll (automatischer JSON-Backfill via `defaultSettings()`, `src/store/defaults.js:126`).

### 2.5 Routing bei Inbound (Nummer → Sprache)

`/voice/incoming` (`src/server.js:401`): nach `findTenantByNumber(to)` (`:408`) ist der
Number-Record bekannt. Dessen `language` wird an `createCall({ … language })` (`:426`)
durchgereicht. Damit es WIRKT, muessen die Konsumenten `call.language` lesen (§2.6).
Benoetigt eine Schwester-Query zu `findTenantByNumber` (gibt heute nur `tenantId` zurueck),
die `language`/den ganzen Record liefert.

### 2.6 Sprach-Konsum (die fuenf Schichten)

Eine aufgeloeste `call.language` fliesst durch genau diese Stellen:
1. **LLM-Prompt:** `systemPrompt(call)` / `summarizeCall` (`src/claude.js:39-80,306`).
2. **Offenlegung:** `disclosureSentence(call)` (`src/claude.js:87-90`) → wirkt automatisch
   in `openingText` (`:100`) und Realtime-Opener (`src/bridge.js:137`).
3. **TTS-Voice + STT-Locale:** Voice-Profil aus `call.language` statt Default
   `DE_FEMALE_NEURAL` (`src/telephony/directives.js:24,32`); Profil→Voice-Mapping +
   `language`-Attribut in `twilio/render.js:11,19` und `telnyx/render.js:17,39`.
4. **Statische Server-Texte:** Reprompt/Fehler/Hangup/Greeting (`src/server.js:349-354,412,421`,
   `src/store/defaults.js:123`, `src/self-service.js:18-22`).
5. **Realtime (optional):** OpenAI-Instructions + Voice + Whisper (`src/bridge.js:50,126,129,137`).

### 2.7 Routing bei Outbound (Ziel-Land → Absendernummer)

`outboundFrom(s, tenantId)` (`src/server.js:650`) bekommt heute `to` NICHT und waehlt via
`findActiveNumber` schlicht das **erste** aktive Record (kein Tie-Break, keine Geo-Logik,
`src/store/views.js:21`). Neu: `outboundFrom(s, tenantId, to)` waehlt die Nummer, deren
`country`/Prefix zur Ziel-Vorwahl passt, sonst die als `primary` markierte. Die
Gespraechssprache des Outbound = `language` der gewaehlten Absendernummer.

---

## 3. Bestandsaufnahme (verifizierte Fakten, als Fundament der Phasen)

### 3.1 Provisioning-Pfad
- Genau EIN Einstieg: `POST /api/onboard` (`src/server.js:927`) → `requestNumber` (Status
  `requested`, KEIN Geld) → Queue-Enqueue (`:977`) → `runProvisioningDrain` (`:1005`,
  fire-and-forget) → `handleProvisionJob` (`src/worker/provisioning.js:16`) →
  `provisionNumber` (`src/onboarding.js:35`).
- `countryCode` kommt **global** aus `config.provisioningCountry` und wird **einmal vor**
  dem Drain in ein geteiltes `opts` gebaut (`src/server.js:1008`) → fuer per-User-Geo muss
  es **pro Job** in den Drain-Handler.
- `provisionNumber` nimmt `countryCode` bereits als Arg (`onboarding.js:35`) — kein Umbau
  der Signatur noetig, nur der Aufrufer aendert sich.

### 3.2 Idempotenz / Geld-Sicherheit (Bestand, NICHT anfassen)
- Drei Schloesser gegen Doppelkauf: Queue-Dedup (`provision_${numberId}`, `server.js:976`),
  Zustands-Schloss (`status===REQUESTED`, `worker/provisioning.js:21`),
  Telnyx-`Idempotency-Key` (`order_${numberId}`, `numbers.js:46`).
- Money-Rollback: schlaegt `configureNumber`/`captureHold` fehl → `releaseNumber`
  (`onboarding.js:89-104,128-137`). Hold-vor-Order-Invariante.
- Notbremsen: `maxNumbers` (Default 5), `maxNumbersPerTenant` (Default 1), `provisioningEnabled`
  (Default false) (`src/config.js:150-158`).
- **Kein Retry/Backoff/429-Handling** im gesamten Telnyx-Pfad (`numbers.js`, harter Wurf bei
  `!res.ok`). Bei Multi-Country-Volumen relevant (R6).

### 3.3 Sprache hart "de" — vollstaendige Fundstellenliste (~18)
| Schicht | Datei:Zeile |
|---|---|
| System-Prompt ("Nur … Deutsch") | `src/claude.js:52-80` (`:56`) |
| Summary-Prompt | `src/claude.js:306` |
| Offenlegungssatz | `src/claude.js:87-90` |
| Outbound-Bruecke | `src/claude.js:104` |
| Datums-Locale `de-DE` | `src/claude.js:33,47`, `src/mcp-tools.js:28` |
| Realtime Stil/Voice/Opener | `src/bridge.js:50,126,137` |
| Gather-STT `de-DE` (Twilio/Telnyx) | `twilio/render.js:19`, `telnyx/render.js:39` |
| TTS-Voice (Polly/Azure DE) | `twilio/render.js:11`, `telnyx/render.js:17` |
| Voice-Profil-Enum (nur DE) | `src/telephony/directives.js:8-10` |
| Reprompt/Fehler/Degradation | `src/server.js:349-354` |
| Inbound-Hangups | `src/server.js:412,421` |
| Greeting-Default | `src/store/defaults.js:123` |
| Greeting-Templates | `src/self-service.js:18-22` |

### 3.4 Routing
- Inbound: `findTenantByNumber` (`state-ops.js:284`) gibt nur `tenantId` (nur `status=active`
  routet). `createCall` ohne `language` → `"de"` (`server.js:426`, `state-ops.js:98`).
- Outbound: `outboundFrom` (`server.js:650`) ohne `to`, `findActiveNumber` erstes Element,
  **keine** "Absender passend zum Ziel"-Logik. Land-Gate `allowedCountryCodes` (Default `+49`,
  `config.js:139`) prueft nur das ZIEL.
- Provider pro Nummer: `number.provider`; Adapter-Dispatch `src/telephony/registry.js`.

---

## 4. Pre-Mortem-Risiken

> Ein Jahr in der Zukunft, das Feature ist gescheitert: Was ist passiert?

| # | Risiko | Warum es entstehen koennte | Gegenmassnahme / Akzeptanz |
|---|---|---|---|
| **R1 Kosten — Doppelkauf** | Geo-Umbau am Provisioning-Pfad bricht versehentlich ein Idempotenz-Schloss | Die drei Bestandsschloesser (§3.2) bleiben **unangetastet**; per-Job-`countryCode` aendert nur den Suchparameter, nicht die Dedup-Kette. Test: zweimal drainen → kein zweiter Kauf. |
| **R2 Kosten — falsche Laenderzuordnung** | IP-Geo liefert falsches Land (VPN/Proxy) → teure Auslandsnummer | IP-Geo ist nur **Vorschlag**; User bestaetigt Land explizit; `allowedCountryCodes`/`maxNumbers` deckeln Blast-Radius; FR/Auslandskauf nur bei bewusst freigeschaltetem Land. |
| **R3 Kosten — variabler Preis vs. fixer Hold** | `numberSetupFeeCents` ist **fix** (`server.js:1011`); andere Laender = andere Preise → Hold zu niedrig (Capture-Diskrepanz) oder zu hoch | Pro-Land-Preis/Hold in der Land→Nummer-Tabelle (Phase 9); bis dahin nur Laender mit bekanntem/aehnlichem Tarif freischalten. |
| **R4 Sicherheit — Spoofing** | User spooft IP → falsche Nummer/Sprache | Standort ist nie Client-autoritativ: IP-Geo nur Vorbelegung, User-Wahl + Auth + Caps autoritativ; **nach** Kauf ist die Nummer (harter Fakt) die Laufzeitquelle, kein Claim. Inbound-Sprache haengt an der eigenen Nummer, nicht am Anrufer. |
| **R5 Verfuegbarkeit** | Im Zielland keine kaufbare Nummer → harter Fehler "keine kaufbare Nummer" (`onboarding.js:81`), `limit:1` liefert nichts | Hoeheres Such-Limit + Auswahl-Logik; klare User-Fehlermeldung; ggf. Fallback-Locality; pro Land vorab Verfuegbarkeit pruefen. |
| **R6 Telnyx Rate-Limits** | Kein Retry/Backoff (§3.2); bei Volumen → 429 → Nummern bleiben `failed`, kein Auto-Recovery | Retry/Backoff fuer Such-/Order-Calls (Phase 9); Reconciliation der `failed`-Jobs. Bis dahin: Volumen klein halten. |
| **R7 Migration Bestand** | Bestands-Nummern/-Tenants ohne `country`/`language` → `undefined` → Routing/Sprache bricht | Phase 1 backfillt **alle** Bestands-Records auf `DE`/`de` (heutiger De-facto-Zustand). Additiv NULLABLE + Code-Fallback `|| "de"`/`|| "DE"` (nie hart annehmen). |
| **R8 Offenlegung FR (Regel 2)** | FR-Uebersetzung "schaltet" den Pflichtsatz indirekt ab/veraendert ihn frei | FR-Offenlegung als **fest verdrahtete, kuratierte** Variante im Locale-Bundle — byte-stabil, nicht per Call-Parameter waehlbar; gilt auch fuer Realtime-Opener (`bridge.js:137`). |
| **R9 STT-Locale-Falle** | Falsche/zu kurze Locale (`"fr"` statt `"fr-FR"`) → Provider faellt still auf Englisch → leeres Transkript (real dokumentiert, `telnyx/render.js:25-30`) | Locale strikt als volle BCP-47 (`fr-FR`) + passender Deepgram-Model-String; Voice-Profil fail-closed (wirft bei unbekanntem Profil statt still DE). |
| **R10 Voice-Verfuegbarkeit** | FR-TTS-Voice (Polly/Azure) im Provider-Account nicht verfuegbar → Render crasht | FR-Voice-Pendant vorab im Twilio- UND Telnyx-Account verifizieren (z.B. `Polly.Lea-Neural`/`Azure.fr-FR-DeniseNeural`); Snapshot-Tests anpassen. |
| **R11 Outbound — falscher Absender** | Tenant mit +49 UND +33; `findActiveNumber` nimmt erstes Element → +49 ruft FR-Ziel | `outboundFrom(…, to)` waehlt laenderpassend; `primary`-Flag bei Mehrfachnummern; Land-Gate + Absenderwahl gekoppelt. |
| **R12 JSON/PG-Divergenz** | Neues Feld nur in einem Backend → "frischer pg != frischer json" | Beide Backends im selben Phasen-Schritt: `schema.sql`-ALTER + `pg.js` hydrate/flush + JSON-Default-Merge + `store.js`-Export; ein Test gegen beide Backends. |

---

## 5. Phasenplan

> Pro Phase: Ziel · betroffene Dateien · Abhaengigkeiten · parallelisierbar (ja NUR bei
> disjunkten Dateien UND ohne Abhaengigkeit). **Phase 1 ist Fundament fuer beide Bloecke
> und MUSS zuerst laufen.** Pre-Mortem zu jeder Phase: zuerst Tests/Smoke, dann Code; DE
> byte-identisch halten; nichts an den Geld-/Idempotenz-Schloessern aufweichen.

### Phase 1 — Store-Schema: Geo-Felder + Migration (FUNDAMENT, PFLICHT zuerst)
- **Ziel:** `country` (ISO-2) + `language` (BCP-47-kurz) additiv NULLABLE auf
  **Number-Record** und **Tenant** (`tenant.country`/`defaultLanguage`); optional
  `settings.language`. **Backfill** aller Bestands-Records auf `DE`/`de`. JSON- und
  PG-Backend konsistent. Code-Fallback `|| "de"`/`|| "DE"` ueberall (nie hart annehmen).
- **Dateien:** `src/store/state-ops.js` (Number-Record `:50`, `createCall`, `seedOwnerNumber`
  `:299`, `registerTenant` `:392`, neue Setter), `src/store/defaults.js` (`:126` falls
  `settings.language`), `src/store/json.js` (Default-Merge), `src/store/pg.js`
  (hydrate/flush tenants+numbers), `src/db/schema.sql` (`ALTER TABLE number/tenant ADD
  COLUMN IF NOT EXISTS`, Muster `:15-33,:161-166`), `src/db/migrate.js`, `src/store.js`
  (Setter-Export), `src/store/views.js` (falls Projektion noetig).
- **Abhaengigkeiten:** keine.
- **Parallelisierbar:** **Nein** (Fundament fuer alle weiteren Phasen).

---

### Block A — Sprachzuordnung (Phase 2-5)

### Phase 2 — Sprach-Resolver + LLM-Schicht sprachabhaengig
- **Ziel:** Locale-Bundle (`language → strings`) + Resolver; `systemPrompt`/`summarizeCall`
  pro Sprache; FR-Offenlegung als feste, kuratierte Variante (R8). Claude-Modell bleibt
  unveraendert.
- **Dateien:** `src/claude.js` (`:39-90,:104,:306`), neues `src/i18n/`-Bundle (o.ae.).
  `src/llm.js` unveraendert.
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Ja** (disjunkt zu Phase 3 — `claude.js` vs. Renderer).

### Phase 3 — Telephonie-Renderer sprachabhaengig (STT + TTS)
- **Ziel:** `VOICE_PROFILE` um FR erweitern; Voice-Mapping + `language`-Attribut pro
  Sprache (`de-DE`/`fr-FR`, passende Polly/Azure-Voice, Deepgram-Model). Snapshot-Tests
  aktualisieren. Fail-closed bei unbekanntem Profil (R9/R10).
- **Dateien:** `src/telephony/directives.js` (`:8-10,:24,:32`),
  `src/telephony/adapters/twilio/render.js` (`:11,:19`),
  `src/telephony/adapters/telnyx/render.js` (`:17,:39`), zugehoerige Snapshot-Tests.
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Ja** (disjunkt zu Phase 2).

### Phase 4 — Statische Texte + Inbound-Wiring (Nummer → Sprache)
- **Ziel:** Statische Server-Texte pro Sprache; `/voice/incoming` leitet `language` aus der
  angerufenen Nummer/Tenant ab und gibt sie an `createCall`. Profil-Durchreichung in
  `turnDirectives`/`streamDirectives`.
- **Dateien:** `src/server.js` (`/voice/incoming :408-433`, statisch `:349-354,:412,:421`,
  `:330-342`), `src/store/defaults.js` (`:123`), `src/self-service.js` (`:18-22`),
  Schwester-Query zu `findTenantByNumber` in `src/store/state-ops.js`/`views.js`.
- **Abhaengigkeiten:** Phase 1 (hart); **wirksam erst mit Phase 2+3** (Konsum).
- **Parallelisierbar:** **Nein** (zentrale `server.js`-Naht, haengt am Konsum aus 2/3).

### Phase 5 (optional/deferrable) — Realtime-Engine-Sprache
- **Ziel:** `bridge.js` OpenAI-Instructions + Voice + Whisper pro Sprache. Nur falls
  `VOICE_ENGINE=realtime` genutzt wird (Budget-Engine ist Live-Default).
- **Dateien:** `src/bridge.js` (`:50,:126,:129,:137`).
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Ja** (eigene Datei).

---

### Block B — Geo-Nummernzuordnung (Phase 6-9)

### Phase 6 — Geo-Quelle bei Registrierung + Persistenz
- **Ziel:** IP-Geo-Lookup-Schicht (oder explizite User-Wahl) in `/api/onboard`: Land
  ermitteln (Vorschlag + User-Bestaetigung), `country` (+abgeleitete `language`) in
  `tenant` und Number-Request schreiben. IP-Geo NICHT autoritativ (R4); Fallback
  `config.provisioningCountry`.
- **Dateien:** `src/server.js` (`/api/onboard :927-998`), `src/onboarding.js`
  (`requestNumber`-Pfad), `src/store/state-ops.js` (`requestNumber :468-475`), neue
  `src/geo/`-Adapterschicht, `src/config.js` (Geo-Env), `.env.example`.
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Nein** (`server.js` + `onboarding.js`).

### Phase 7 — Per-Job-countryCode + Telnyx-Geo-Suche
- **Ziel:** `runProvisioningDrain` baut `countryCode`/`connectionId` **pro Job** aus dem
  Record statt global (`:1008` → in den Handler `:1014`); Telnyx `searchNumbers` mit
  hoeherem Limit + Verfuegbarkeits-Auswahl (R5) + optional Locality; Port-Vertrag
  erweitern. Idempotenz-Schloesser unangetastet (R1).
- **Dateien:** `src/server.js` (`runProvisioningDrain :1005-1017`),
  `src/worker/provisioning.js`, `src/onboarding.js` (`provisionNumber :35` nutzt
  Record-Country), `src/telephony/adapters/telnyx/numbers.js` (`:32-42`),
  `src/telephony/ports.js` (`:87`).
- **Abhaengigkeiten:** Phase 1, Phase 6.
- **Parallelisierbar:** **Nein** (`server.js` + Provisioning; haengt an Phase 6).

### Phase 8 — Outbound-Nummernwahl nach Ziel-Land
- **Ziel:** `outboundFrom(s, tenantId, to)` waehlt laenderpassende Absendernummer, Fallback
  Primaer-Nummer; `primary`-Konzept bei Mehrfachnummern (R11); `allowedCountryCodes`
  abstimmen. Gespraechssprache = `language` der gewaehlten Nummer.
- **Dateien:** `src/server.js` (`outboundFrom :650-653`, Aufruf `:716`),
  `src/store/views.js` (`findActiveNumber :20` laenderbewusst / neue Query),
  `src/config.js` (`allowedCountryCodes :139`).
- **Abhaengigkeiten:** Phase 1, Phase 6 (Nummern brauchen `country`).
- **Parallelisierbar:** **Nein** (`server.js`+`views.js`, ueberschneidet `server.js` mit Phase 7).

### Phase 9 (optional) — Kosten-/Hold pro Land + Telnyx-Retry/Backoff
- **Ziel:** Pro-Land-Preis/Hold statt fixem `numberSetupFeeCents` (R3); Retry/Backoff für
  Telnyx-429/5xx + Reconciliation der `failed`-Jobs (R6).
- **Dateien:** `src/billing/*`, `src/config.js`, `src/telephony/adapters/telnyx/numbers.js`.
- **Abhaengigkeiten:** Phase 6, Phase 7.
- **Parallelisierbar:** bedingt (Billing-Teil disjunkt zur Retry-Logik).

> **Bloecke:** A (Sprache) und B (Nummern) sind nach Phase 1 weitgehend unabhaengig und
> koennten als getrennte Straenge laufen. Empfehlung: **Block A zuerst** (kein Geld, macht
> den toten `call.language`-Kanal lebendig, sofort fuer DE+FR testbar), dann Block B (Geld +
> Provider-Live). Phase 4/7/8 teilen sich `server.js` → bei paralleler Arbeit zwingend per
> Claim koordinieren (siehe Lehre zum geteilten Worktree).

---

## 6. Offene Fragen (vor Implementierung klaeren)

1. **Sprach-Set:** Nur DE+FR im ersten Wurf, oder direkt N Sprachen (Tabelle dann generisch
   auslegen)? Welche Laender → welche Sprache (AT/CH → de)?
2. **FR-Qualitaet:** Liefert `claude-haiku-4-5` ausreichende FR-Gespraechsqualitaet, oder
   braucht FR ein staerkeres Modell (dann doch sprachabhaengiges Modell-Mapping)?
3. **Voice-/STT-Verfuegbarkeit:** Sind FR-TTS-Voices (Polly/Azure) und FR-STT (Deepgram
   `nova-3`/passendes Model) in BEIDEN Provider-Accounts (Twilio + Telnyx) freigeschaltet?
4. **Telnyx-Live-Felder:** `phone_number_type`-Werte, Locality-Filter, FR-Verfuegbarkeit,
   FR-Preis und eigene `connectionId` pro Land — live verifizieren (Doku-Stand `numbers.js:6`).
5. **Geo-Provider:** maxmind-DB (lokal, kein Netz, Lizenz) vs. ip-api (HTTP, Rate-Limit)?
   Datenschutz/DSGVO der IP-Geolokalisierung?
6. **Mehrfachnummern:** Soll ein Tenant mehrere Laender-Nummern haben duerfen? Wenn ja:
   `primary`-Definition, Dashboard-UI, `maxNumbersPerTenant` (heute 1) anheben?
7. **Land-Gate-Politik:** `allowedCountryCodes` (Default `+49`) — pro Tenant oder global
   lockern? Wie verhindern, dass FR-Freischaltung ungewollt teure Ziele oeffnet?
8. **Sprache aenderbar?** Soll der Owner die Sprache nachtraeglich umstellen koennen
   (`settings.language`) oder ist sie an die Nummer gebunden (unveraenderlich)?
9. **Bestands-Migration aktiv?** `MULTI_TENANT`/`PROVISIONING_ENABLED` sind heute aus —
   gibt es ueberhaupt schon echte Nicht-Owner-Nummern zu migrieren, oder ist R7 vorerst
   trivial (nur Owner = DE)?
