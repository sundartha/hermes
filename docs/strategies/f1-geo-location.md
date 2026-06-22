# F1 — Geo-Location: Nummer + Sprache pro User-Standort

> **Strategie-Dokument — KEIN Code, KEINE Implementierung.** Ziel: Jeder User bekommt
> anhand seines geografischen Standorts automatisch eine passende Telnyx-Nummer
> (Laendervorwahl) und eine passende Gespraechssprache zugeordnet.
> DE → `+49` + Deutsch · GB → `+44` + Englisch · FR → `+33` + Franzoesisch.
>
> **Verifikation:** Alle Code-Aussagen in diesem Dokument wurden am 2026-06-22 von drei
> read-only Recherche-Agenten gegen den AKTUELLEN Stand des Repos geprueft
> (`src/server.js`, `src/onboarding.js`, `src/worker/provisioning.js`, `src/telephony/*`,
> `src/store/*`, `src/db/schema.sql`, `src/claude.js`, `src/bridge.js`, `src/config.js`,
> `src/mcp-tools.js`). Zeilenangaben sind verifiziert; wo der Code seit einer frueheren
> Fassung verschoben war, sind die Angaben korrigiert.
>
> **Einstufung: GROSS** — zwei Subsysteme (Sprache + Nummern-Provisioning), eine
> Schema-Migration ueber zwei Store-Backends, echtes Geld und Provider-Live-Verhalten.
> Daher 9 Phasen in zwei Bloecken, Phase 1 als gemeinsames Fundament.

---

## 0. Die zwei tragenden Erkenntnisse (am Code verifiziert)

Diese zwei Befunde bestimmen die gesamte Architektur. Wer sie versteht, versteht den Plan.

**(A) Die Telefonnummer IST der dauerhafte Geo-Anker — nicht die IP.**
Das Routing kennt den Standort heute schon implizit ueber die Nummer:
- **Inbound:** `findTenantByNumber(to)` (`src/store/state-ops.js:284`) — die ANGERUFENE
  Nummer bestimmt den Tenant (`return hit ? hit.tenantId : null`, nur bei
  `status === active`). Eine deutsche `+49`-Nummer antwortet auf Deutsch, egal wer anruft.
- **Outbound:** `outboundFrom(s, tenantId)` → `findActiveNumber` (`src/server.js:650`,
  `src/store/views.js:20`) — die ABSENDER-Nummer wird aus dem Store gewaehlt.

Daraus folgt die zentrale Architektur-Entscheidung: **`country` + `language` gehoeren auf
den Number-Record** (plus einen Tenant-Default). Dann ist die Geo-Zuordnung zur Laufzeit
ein harter, nicht spoofbarer Fakt (die Nummer existiert) — kein Client-Claim. IP-Geo wird
nur **einmalig** gebraucht: bei der Registrierung, um das Land vorzuschlagen.

**(B) `call.language` ist ein vollstaendig verdrahteter, aber TOTER Datenkanal.**
Das Feld existiert end-to-end, wird aber an KEINER Stelle ausgelesen, um TTS/STT/Prompt zu
steuern. Verifiziert (genau 3 Schreibstellen, 0 wirksame Lesestellen):
- Geschrieben: API `src/server.js:741` (`language: b.language || "de"`), `createCall`-Default
  `src/store/state-ops.js:98` (`language: language || "de"`).
- MCP-Schema: `src/mcp-tools.js:88` (`place_call`, optional, Default `"de"`).
- DB-Spalte: `src/db/schema.sql:63` (`language TEXT NOT NULL DEFAULT 'de'`).
- PG-Roundtrip: Hydrate `src/store/pg.js:428` (`language: r.language`), Flush `:588/:595`
  (reines Row-Mapping, keine Logik).
- **Konsum: NULL.** Ein vollstaendiger `grep` ueber `src/` nach gelesenem `.language` zeigt
  nur diese reinen Daten-Mappings — nirgends waehlt `call.language` eine Voice, eine
  STT-Locale oder eine Prompt-Sprache. Stattdessen ist Sprache an ~18 Stellen hart `de`
  verdrahtet (§2.4).

Konsequenz: Der groesste Teil der „Sprachzuordnung" ist **kein neues Modell**, sondern:
diesen toten Kanal an den richtigen Stellen aktiv konsumieren.

> **Klarstellung zum Brief („deutsches/franzoesisches/englisches Sprachmodell"):**
> Es ist **dasselbe** Claude-Modell fuer alle Sprachen
> (`config.claudeModel = "claude-haiku-4-5"`, `src/config.js:45`; von Haus aus mehrsprachig).
> „FR-Modell" = derselbe Claude mit (a) FR-System-Prompt + (b) FR-STT-Locale +
> (c) FR-TTS-Voice + (d) FR-Offenlegung. **Kein Modellwechsel** — spart Komplexitaet und
> Kosten. Die FR/EN-Gespraechsqualitaet von Haiku 4.5 ist als offene Frage zu verifizieren
> (§6, Frage 2).

---

## 1. Ziel & Akzeptanzkriterien

### 1.1 Definition „Geo-Location"

Geo-Location = der **Laendercode** (ISO-2), der (1) die Nummern-Vorwahl beim Kauf und
(2) die Gespraechssprache bestimmt. Quellen-Prioritaet — fail-safe und spoof-resistent:

1. **Explizite User-Wahl bei der Registrierung** — autoritativ. Der User waehlt sein Land
   bewusst (es kostet Geld und bestimmt seine Nummer → Consent ist ohnehin noetig).
2. **IP-Geo als reine VORBELEGUNG** (maxmind / ip-api o.ae.) — nur ein Vorschlag im
   Formular, NIE autoritativ (VPN-/Proxy-spoofbar).
3. **Fallback `config.provisioningCountry`** (Default `"DE"`, `src/config.js:172`), wenn
   IP-Geo fehlschlaegt und keine User-Wahl vorliegt.

Nach dem Kauf ist die **Nummer** die Laufzeit-Source-of-Truth (§0-A) — IP-Geo wird zur
Laufzeit nie mehr befragt.

> **Scoping-Entscheidung Inbound:** Die Sprache eines eingehenden Anrufs richtet sich nach
> der **angerufenen** Nummer (dem Tenant), NICHT nach einer Echtzeit-Geo des Anrufers.
> Caller-ANI-/IP-Geo zur Laufzeit ist bewusst out-of-scope (Aufwand, Genauigkeit). Eine
> `+33`-Nummer fuehrt FR, eine `+49`-Nummer DE — deterministisch und korrekt.

### 1.2 Akzeptanzkriterien — Nummernzuordnung

- [ ] Bei Registrierung mit Land FR wird eine `+33`-Nummer gesucht/gekauft (statt `+49`).
- [ ] Der gekaufte Number-Record traegt `country` (ISO-2) und `language` (z.B. `"fr"`).
- [ ] Der `countryCode` wird **pro Provisioning-Job** aus Record/Request abgeleitet, NICHT
      global aus `config.provisioningCountry` (heute `src/server.js:1008`).
- [ ] Doppelkauf bleibt durch die drei Bestandsschloesser ausgeschlossen (§4/R1).
- [ ] Outbound: Hat ein Tenant Nummern in mehreren Laendern, wird die zur Ziel-Vorwahl
      passende Absendernummer gewaehlt; sonst die `primary`-Nummer (kein Zufall).
- [ ] Kein Land ausserhalb von `allowedCountryCodes` wird ohne bewusste Freigabe gekauft
      oder angerufen.

### 1.3 Akzeptanzkriterien — Sprachzuordnung

- [ ] Ein Inbound-Call auf eine FR-Nummer wird in FR gefuehrt: System-Prompt, Offenlegung,
      STT-Locale (`fr-FR`), TTS-Voice, statische Ansagen — alle FR.
- [ ] `call.language` wird tatsaechlich konsumiert (nicht mehr toter Kanal).
- [ ] Der Offenlegungssatz existiert als **fest verdrahtete FR-Variante** (Regel 2 bleibt
      gewahrt: byte-stabil, kuratiert, nicht per Call-Parameter abschaltbar/frei waehlbar).
- [ ] DE bleibt **byte-identisch** zum heutigen Verhalten (kein FR/EN-Pfad faerbt DE ab).
- [ ] Unbekannte/fehlende Sprache → Fallback `de` (heutiges Verhalten).

---

## 2. Aktuelle Architektur (Ist-Zustand) — verifizierte Bestandsaufnahme

### 2.1 Provisioning-Pfad (wie eine Nummer heute gekauft wird)

Genau EIN Einstieg, fire-and-forget, mit globalem Land:

```
POST /api/onboard (server.js:927)
  └─ requestNumber  → Number-Record status "requested", KEIN Geld (status :944)
  └─ Queue-Enqueue  (server.js:977, Dedup-Key provision_${numberId} :976)
  └─ void runProvisioningDrain()  (Aufruf server.js:998, fire-and-forget)
        └─ runProvisioningDrain  (Definition server.js:1005)
              opts = { countryCode: config.provisioningCountry,
                       connectionId: config.telnyxConnectionId }   (server.js:1008)
              opts.holdAmountCents = config.numberSetupFeeCents     (server.js:1011, FIX)
        └─ handleProvisionJob  (worker/provisioning.js:16; State-Lock status===REQUESTED :21)
              └─ provisionNumber(s, deps, { numberId, countryCode, connectionId,
                                            type, holdAmountCents, currency })
                                            (onboarding.js:35)
```

Schluessel-Fakten:
- **`countryCode` ist heute GLOBAL** — einmal vor dem Drain in ein geteiltes `opts`-Objekt
  gebaut (`server.js:1008`), nicht pro Job. Fuer per-User-Geo muss er **pro Job** aus dem
  Record/Request kommen.
- **`provisionNumber` nimmt `countryCode` bereits als Argument** (`onboarding.js:35`) — die
  Signatur muss NICHT umgebaut werden, nur der Aufrufer.
- **`numberSetupFeeCents` ist FIX** (`server.js:1011`) — derselbe Hold-Betrag fuer alle
  Laender (Risiko R3 bei laenderabhaengigen Preisen).
- **`connectionId` ist global** (`config.telnyxConnectionId`) — eine Connection fuer alle.

### 2.2 Idempotenz / Geld-Sicherheit (Bestand — NICHT anfassen)

- **Drei Schloesser gegen Doppelkauf:**
  1. Queue-Dedup `provision_${numberId}` (`server.js:976`).
  2. Zustands-Schloss `status === REQUESTED` (`worker/provisioning.js:21`).
  3. Telnyx `Idempotency-Key` `order_${numberId}` — gebaut in `onboarding.js:75`, als
     Header gesetzt in `src/telephony/adapters/telnyx/numbers.js:46`.
- **Money-Rollback:** Schlaegt `configureNumber`/`captureHold` fehl →
  `rollbackAfterOrder` (`onboarding.js:92,101`) → `failNumber` + `releaseNumber` +
  `cancelHoldIfHeld` (`onboarding.js:128-136`). Hold-vor-Order-Invariante.
- **Notbremsen (`src/config.js`):** `maxNumbers` Default 5 (`:150`), `maxNumbersPerTenant`
  Default 1 (`:152`), `provisioningEnabled` Default `false` (`:158`).
- **Kein Retry/Backoff/429-Handling** im gesamten Telnyx-Pfad — `assertOk`
  (`numbers.js:24-26`) wirft hart bei `!res.ok`. Bei Multi-Country-Volumen relevant (R6).

### 2.3 Routing (Inbound + Outbound)

- **Inbound:** `findTenantByNumber` (`state-ops.js:284`) gibt **nur** `tenantId` zurueck
  (nur `status === active` routet). `/voice/incoming` (`server.js:401`) ruft danach
  `createCall({...})` (`:426`) **ohne** `language` auf → `createCall`-Default `"de"`
  (`state-ops.js:98`). Es fehlt eine Schwester-Query, die `language`/den ganzen Record
  liefert.
- **Outbound:** `outboundFrom(s, tenantId)` (`server.js:650`, Aufruf `:716`) bekommt das
  Ziel `to` NICHT. `findActiveNumber` (`views.js:20-27`) nimmt via `.find()` schlicht das
  **erste** aktive Record — kein Tie-Break, keine Geo-Logik. Das Land-Gate
  `allowedCountryCodes` (Default `+49`, `config.js:139`) prueft nur das ZIEL, nicht den
  Absender.
- **Provider pro Nummer:** `number.provider`; Adapter-Dispatch `src/telephony/registry.js`.

### 2.4 Sprache hart „de" — vollstaendige, verifizierte Fundstellenliste (~18)

| # | Schicht | Datei:Zeile | Befund |
|---|---|---|---|
| 1 | System-Prompt („Nur … Deutsch") | `src/claude.js:56` (Block `:52-80`) | hart DE |
| 2 | Summary-Prompt | `src/claude.js:306` | „… auf Deutsch" |
| 3 | Offenlegungssatz | `src/claude.js:89` (`:87-90`) | hart DE |
| 4 | Outbound-Bruecke (`openingText`) | `src/claude.js:104` | hart DE |
| 5 | Datums-Locale `de-DE` | `src/claude.js:33,47`, `src/mcp-tools.js:28` | hart DE |
| 6 | Realtime Stil/Anweisungen | `src/bridge.js:50` | DE + `systemPrompt(call)` |
| 7 | Realtime Voice | `src/bridge.js:126` | `config.realtimeVoice` (kein Sprach-Switch) |
| 8 | Realtime STT (Whisper) | `src/bridge.js:129` | `model: "whisper-1"`, **keine** Locale (Auto-Detect) |
| 9 | Realtime Opener | `src/bridge.js:137` | hart DE |
| 10 | Gather-STT `de-DE` (Twilio) | `src/telephony/adapters/twilio/render.js:19` | hart DE |
| 11 | Gather-STT `de-DE` (Telnyx) | `src/telephony/adapters/telnyx/render.js:39` | hart DE |
| 12 | TTS-Voice Polly DE | `twilio/render.js:11` (`Polly.Vicki-Neural`) | nur DE-Eintrag |
| 13 | TTS-Voice Azure DE | `telnyx/render.js:17` (`Azure.de-DE-KatjaNeural`) | nur DE-Eintrag |
| 14 | Voice-Profil-Enum (nur DE) | `src/telephony/directives.js:9` (`DE_FEMALE_NEURAL`) | ein Eintrag |
| 15 | Voice-Profil-Default say/gather | `src/telephony/directives.js:24,32` | Default DE |
| 16 | Reprompt/Fehler/Degradation | `src/server.js:349,350,354` | hart DE |
| 17 | Inbound-Hangups | `src/server.js:412,421` | hart DE |
| 18 | Greeting-Default | `src/store/defaults.js:123` | hart DE |
| 19 | Greeting-Templates | `src/self-service.js:18-22` | hart DE |

> **Wichtig zu #7/#8:** Realtime-Voice kommt aus `config.realtimeVoice` (nicht inline) und
> Whisper laeuft heute ohne `language`-Hint (Auto-Detect). Fuer FR/EN braucht Realtime daher
> eine bewusste Voice-Wahl pro Sprache UND einen expliziten Whisper-Locale-Hint, sonst driftet
> die Engine. Realtime ist aber nicht der Live-Default (Budget-Engine), daher Phase 5 optional.

### 2.5 Store / DB — Schema & Migrations-Mechanik (verifiziert)

- **Number-Tabelle (`schema.sql:149-157`):** `id, tenant_id, e164, provider, status,
  provider_number_id, created_at`. **KEIN `country`, KEIN `language`.**
- **Number-Record (Code, `state-ops.js:473` `requestNumber`, `:305` `seedOwnerNumber`):**
  `{ id, e164, tenantId, provider, status, providerNumberId, paymentIntentId }`. Ebenfalls
  ohne `country`/`language`.
- **Tenant-Tabelle (`schema.sql:9-33`):** `id, status, created_at, owner_name, idp_subject,
  first_name, kyc_level, stripe_customer_id, stripe_payment_method_id`. **Kein Geo-Feld.**
- **Call-Tabelle:** `language TEXT NOT NULL DEFAULT 'de'` (`schema.sql:63`) — existiert,
  ist aber der tote Kanal aus §0-B.
- **Migrations-Muster (kein Framework, idempotent-additiv):**
  - **PG:** `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, bei jedem Boot re-applied
    (`src/db/migrate.js`). Belege: Tenant `schema.sql:15,19,20,23,28,32,33`; Number
    `:161,162,166`.
  - **JSON:** Default-Merge beim Lesen — `migrateSettingsToMap` (`src/store/json.js:104-115`,
    Kern `:111` `{ ...defaultSettings(), ...bucket }`), bei jedem `load()` angewandt (`:34`).
- **PG-Hydrate/Flush:** Tenants `pg.js:268` (`hydrateTenants`), Numbers `pg.js:310-342`
  (`hydrateTenantInto`) / Flush `pg.js:682` (`flushNumbers`); Tenant-Flush `pg.js:473`.
- **RLS:** Number-Tabelle hat RLS (`schema.sql:279-280`, `ENABLE`+`FORCE`). Tenant-Tabelle
  hat **keine** RLS (Kommentar `pg.js:267`) — fuer nicht-sensible Geo-Daten ok, bewusst notiert.

### 2.6 Telnyx-Nummernsuche (Ist)

`searchNumbers` (`src/telephony/adapters/telnyx/numbers.js`) baut die Query via
`URLSearchParams`: `filter[country_code]` (`:34`), `filter[features][]=voice` fix (`:35`),
`filter[limit]` mit Default `DEFAULT_SEARCH_LIMIT = 1` (`:17,:36`), optional
`filter[phone_number_type]` (`:37`). Der Port-Vertrag
(`src/telephony/ports.js:87`) lautet `(params: { countryCode, type?, limit? }) =>
Promise<AvailableNumber[]>`. Hinweis im Code: „Verifiziert gegen Telnyx-Doku (2026-06-15),
live UNBESTAETIGT" (`numbers.js:6`). → `limit:1` + keine Auswahl-Logik ist fuer
Multi-Country zu wenig (R5).

### 2.7 Config-Bestand (verifiziert)

| Feld | Datei:Zeile | Default |
|---|---|---|
| `claudeModel` | `config.js:45` | `"claude-haiku-4-5"` (mehrsprachig) |
| `provisioningCountry` | `config.js:172` | `"DE"` |
| `allowedCountryCodes` | `config.js:139` | `"+49"` (nur Ziel-Gate) |
| `maxNumbers` | `config.js:150` | `5` |
| `maxNumbersPerTenant` | `config.js:152` | `1` |
| `provisioningEnabled` | `config.js:158` | `false` |

---

## 3. Gewuenschte Architektur (Soll-Zustand)

### 3.1 Geo-Dienst (woher kommt der Standort?)

Neue, kleine Adapter-Schicht (z.B. `src/geo/`) mit EINER Aufgabe: IP → ISO-Laendercode,
nur zur **Registrierungszeit** in `/api/onboard` (`src/server.js:927`). Bewusst hinter einem
Env-Flag + Provider-Abstraktion (wie die Telephonie-Ports), damit der Geo-Provider
(maxmind-DB lokal vs. ip-api HTTP) austauschbar ist und Tests ohne Netz laufen. Liefert nur
einen **Vorschlag**; die Entscheidung faellt der User (oder der Config-Fallback).

### 3.2 Land → Nummer-Mapping

Konfigurationstabelle `countryCode → Telnyx-Suchparameter`
(ISO-2 → `{ telnyxCountryCode, connectionId, phoneNumberType?, locality? }`). Pro Land ggf.
eine eigene `connectionId` (heute global `config.telnyxConnectionId`, `server.js:1008`) und
ein hoeheres Such-`limit` mit Verfuegbarkeits-Auswahl statt `limit:1`.

### 3.3 Land → Sprache-Mapping + Locale-Bundle

Konfigurationstabelle `countryCode → language` (`DE→de`, `FR→fr`, `GB→en`, `AT→de`,
`CH→de`, …) plus ein **Locale-Bundle** `language → { systemPromptParts, disclosureSentence,
sttLocale, voiceProfile, staticTexts }`. Heute existiert nur DE, ueberall hart verdrahtet
(§2.4). Das Bundle wird der **einzige** Ort, an dem Sprach-Strings leben — neue Sprache =
neuer Bundle-Eintrag, keine verstreuten Aenderungen.

### 3.4 Speicherung (Store/DB) — gespaltene Verantwortung

- **`number.country` + `number.language` (number-level)** — der Routing-Anker (§0-A).
  Praezedenz wie `number.provider`/`number.status`. Die Number-Tabelle hat RLS
  (`schema.sql:279-280`).
- **`tenant.country` + `tenant.defaultLanguage` (tenant-level)** — Default/Fallback, das
  IP-Geo bei Registrierung schreibt. Praezedenz wie `kyc_level`/`stripe_*`. Hinweis:
  Tenant-Tabelle ohne RLS (`pg.js:267`) — fuer nicht-sensible Geo-Daten ok.
- **Optional `settings.language`** — falls der Owner die Sprache im Dashboard umstellen soll
  (automatischer JSON-Backfill via `defaultSettings()`, `src/store/defaults.js:126`).
- Alle Felder **additiv NULLABLE**, Code-Fallback `|| "de"` / `|| "DE"` ueberall — nie hart
  annehmen, dass sie gesetzt sind (R7).

### 3.5 Inbound-Routing (Nummer → Sprache)

`/voice/incoming` (`server.js:401`): nach `findTenantByNumber(to)` (`:408`) ist der
Number-Record bekannt. Dessen `language` wird an `createCall({ … language })` (`:426`)
durchgereicht. Damit es WIRKT, muessen die fuenf Konsum-Schichten `call.language` lesen
(§3.7). Benoetigt eine **Schwester-Query** zu `findTenantByNumber` (gibt heute nur
`tenantId`), die `language`/den ganzen Record liefert.

### 3.6 Outbound-Routing (Ziel-Land → Absendernummer)

`outboundFrom(s, tenantId, to)` (neu mit `to`) waehlt die Nummer, deren `country`/Prefix zur
Ziel-Vorwahl passt, sonst die als `primary` markierte. Die Gespraechssprache des Outbound =
`language` der gewaehlten Absendernummer.

### 3.7 Sprach-Konsum — die fuenf Schichten

Eine aufgeloeste `call.language` fliesst durch genau diese Stellen (heute alle hart DE):
1. **LLM-Prompt:** `systemPrompt(call)` / `summarizeCall` (`src/claude.js:52-80,306`).
2. **Offenlegung:** `disclosureSentence(call)` (`src/claude.js:87-90`) → wirkt automatisch in
   `openingText` (`:100-104`) und Realtime-Opener (`src/bridge.js:137`).
3. **TTS-Voice + STT-Locale:** Voice-Profil aus `call.language` statt Default
   `DE_FEMALE_NEURAL` (`directives.js:24,32`); Profil→Voice-Mapping + `language`-Attribut in
   `twilio/render.js:11,19` und `telnyx/render.js:17,39`.
4. **Statische Server-Texte:** Reprompt/Fehler/Hangup/Greeting (`server.js:349-354,412,421`,
   `store/defaults.js:123`, `self-service.js:18-22`).
5. **Realtime (optional):** OpenAI-Instructions + Voice + Whisper-Locale
   (`bridge.js:50,126,129,137`).

---

## 4. Pre-Mortem-Risiken

> Ein Jahr in der Zukunft: Das Feature ist gescheitert. Was ist passiert? — Schwerpunkt
> bewusst auf **Anrufe / Kosten / Auth / Provider-Live**.

| # | Risiko | Warum es entstehen koennte | Gegenmassnahme / Akzeptanz |
|---|---|---|---|
| **R1** Kosten — Doppelkauf | Geo-Umbau am Provisioning-Pfad bricht versehentlich ein Idempotenz-Schloss | Die drei Bestandsschloesser (§2.2) bleiben **unangetastet**; per-Job-`countryCode` aendert nur den Suchparameter, nicht die Dedup-Kette. Test: zweimal drainen → kein zweiter Kauf. |
| **R2** Kosten — falsche Laenderzuordnung | IP-Geo liefert falsches Land (VPN/Proxy) → teure Auslandsnummer | IP-Geo ist nur **Vorschlag**; User bestaetigt Land explizit; `allowedCountryCodes`/`maxNumbers` deckeln den Blast-Radius; Auslandskauf nur bei bewusst freigeschaltetem Land. |
| **R3** Kosten — variabler Preis vs. fixer Hold | `numberSetupFeeCents` ist **fix** (`server.js:1011`); andere Laender = andere Preise → Hold zu niedrig (Capture-Diskrepanz) oder zu hoch | Pro-Land-Preis/Hold in der Land→Nummer-Tabelle (Phase 9); bis dahin nur Laender mit bekanntem/aehnlichem Tarif freischalten. |
| **R4** Auth/Sicherheit — Spoofing | User spooft IP → falsche Nummer/Sprache | Standort ist nie Client-autoritativ: IP-Geo nur Vorbelegung, User-Wahl + Auth + Caps autoritativ; **nach** Kauf ist die Nummer (harter Fakt) die Laufzeitquelle. Inbound-Sprache haengt an der eigenen Nummer, nicht am Anrufer. |
| **R5** Verfuegbarkeit | Im Zielland keine kaufbare Nummer → harter Fehler (`onboarding.js`), `limit:1` (`numbers.js:17`) liefert nichts | Hoeheres Such-`limit` + Auswahl-Logik; klare User-Fehlermeldung; ggf. Fallback-Locality; pro Land vorab Verfuegbarkeit pruefen. |
| **R6** Telnyx Rate-Limits | Kein Retry/Backoff (§2.2); bei Volumen → 429 → Nummern bleiben `failed`, kein Auto-Recovery | Retry/Backoff fuer Such-/Order-Calls (Phase 9); Reconciliation der `failed`-Jobs. Bis dahin: Volumen klein halten. |
| **R7** Migration Bestand | Bestands-Nummern/-Tenants ohne `country`/`language` → `undefined` → Routing/Sprache bricht | Phase 1 backfillt **alle** Bestands-Records auf `DE`/`de` (heutiger De-facto-Zustand). Additiv NULLABLE + Code-Fallback `|| "de"`/`|| "DE"` (nie hart annehmen). |
| **R8** Offenlegung FR/EN (Regel 2) | Uebersetzung „schaltet" den Pflichtsatz indirekt ab/veraendert ihn frei | Pro-Sprache-Offenlegung als **fest verdrahtete, kuratierte** Variante im Locale-Bundle — byte-stabil, nicht per Call-Parameter waehlbar; gilt auch fuer Realtime-Opener (`bridge.js:137`). |
| **R9** STT-Locale-Falle | Zu kurze/falsche Locale (`"fr"` statt `"fr-FR"`) → Provider faellt still auf Englisch → leeres Transkript | Locale strikt als volle BCP-47 (`fr-FR`) + passender Provider-Model-String; Voice-Profil **fail-closed** (wirft bei unbekanntem Profil statt still DE). |
| **R10** Voice-Verfuegbarkeit | FR/EN-TTS-Voice (Polly/Azure) im Provider-Account nicht freigeschaltet → Render crasht | Voice-Pendant vorab in Twilio- UND Telnyx-Account verifizieren (z.B. `Polly.Lea-Neural` / `Azure.fr-FR-DeniseNeural`); Snapshot-Tests anpassen. |
| **R11** Outbound — falscher Absender | Tenant mit `+49` UND `+33`; `findActiveNumber` nimmt erstes Element → `+49` ruft FR-Ziel | `outboundFrom(…, to)` waehlt laenderpassend; `primary`-Flag bei Mehrfachnummern; Land-Gate + Absenderwahl gekoppelt. |
| **R12** JSON/PG-Divergenz | Neues Feld nur in einem Backend → „frischer pg != frischer json" | Beide Backends im selben Phasen-Schritt: `schema.sql`-ALTER + `pg.js` hydrate/flush + JSON-Default-Merge + `store.js`-Export; ein Test gegen beide Backends. |
| **R13** Realtime-Drift | Whisper Auto-Detect (`bridge.js:129`) + DE-Opener bei FR-Call → Sprachmix | Phase 5: expliziter Whisper-Locale + Sprach-Opener + Voice pro Sprache. Solange Realtime nicht Live-Default ist, kontrolliert deferrable. |

---

## 5. Phasenplan

> Pro Phase: **Ziel · betroffene Dateien · Abhaengigkeiten · Parallelisierbarkeit ·
> Review-/Testkriterium.** Jede Phase ist einzeln reviewbar (eigener `clean-code-reviewer`-Lauf)
> und testbar (eigene Tests/Smoke). Reihenfolge: **Phase 1 ist Fundament fuer beide Bloecke und
> MUSS zuerst laufen.** Pre-Mortem zu jeder Phase: zuerst Tests/Smoke, dann Code; DE
> byte-identisch halten; nichts an den Geld-/Idempotenz-Schloessern aufweichen.

### Phase 1 — Store-Schema: Geo-Felder + Migration (FUNDAMENT, PFLICHT zuerst)
- **Ziel:** `country` (ISO-2) + `language` (BCP-47-kurz) additiv NULLABLE auf
  **Number-Record** und **Tenant** (`tenant.country`/`defaultLanguage`); optional
  `settings.language`. **Backfill** aller Bestands-Records auf `DE`/`de`. JSON- und
  PG-Backend konsistent. Code-Fallback `|| "de"`/`|| "DE"` ueberall.
- **Dateien:** `src/store/state-ops.js` (Number-Record `requestNumber :473`,
  `seedOwnerNumber :305`, `createCall :98`, `registerTenant`, neue Setter),
  `src/store/defaults.js` (`:126` falls `settings.language`), `src/store/json.js`
  (Default-Merge `:104-115`), `src/store/pg.js` (hydrate/flush tenants `:268,:473` +
  numbers `:310-342,:682`), `src/db/schema.sql` (`ALTER TABLE number/tenant ADD COLUMN IF
  NOT EXISTS`, Muster `:15-33,:161-166`), `src/db/migrate.js`, `src/store.js`
  (Setter-Export), `src/store/views.js` (falls Projektion noetig).
- **Abhaengigkeiten:** keine.
- **Parallelisierbar:** **Nein** (Fundament fuer alle weiteren Phasen).
- **Review-/Testkriterium:** Test gegen BEIDE Backends — frischer JSON-Store und frischer
  PG-Store haben dieselben Felder (R12); Bestands-Record ohne Feld liest `de`/`DE` (R7);
  idempotentes Re-Migrate bei Boot wirft nicht.

---

### Block A — Sprachzuordnung (Phase 2–5) — kein Geld, macht `call.language` lebendig

### Phase 2 — Sprach-Resolver + LLM-Schicht sprachabhaengig
- **Ziel:** Locale-Bundle (`language → strings`) + Resolver; `systemPrompt`/`summarizeCall`
  pro Sprache; Offenlegung als feste, kuratierte Variante pro Sprache (R8). Claude-Modell
  unveraendert.
- **Dateien:** `src/claude.js` (`:33,:47,:52-80,:87-90,:104,:306`), neues `src/i18n/`-Bundle.
  `src/llm.js` unveraendert.
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Ja** (disjunkt zu Phase 3 — `claude.js` vs. Renderer).
- **Review-/Testkriterium:** Snapshot je Sprache fuer System-Prompt + Offenlegung; DE-Output
  byte-identisch zu heute; FR/EN-Offenlegung exakt der kuratierte String (nicht frei waehlbar).

### Phase 3 — Telephonie-Renderer sprachabhaengig (STT + TTS)
- **Ziel:** `VOICE_PROFILE` um FR/EN erweitern; Voice-Mapping + `language`-Attribut pro
  Sprache (`de-DE`/`fr-FR`/`en-GB`, passende Polly/Azure-Voice, Deepgram-Model). Fail-closed
  bei unbekanntem Profil (R9/R10).
- **Dateien:** `src/telephony/directives.js` (`:9,:24,:32`),
  `src/telephony/adapters/twilio/render.js` (`:11,:19`),
  `src/telephony/adapters/telnyx/render.js` (`:17,:39`), zugehoerige Snapshot-Tests.
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Ja** (disjunkt zu Phase 2).
- **Review-/Testkriterium:** Snapshot je Provider×Sprache (TwiML/TeXML); unbekanntes Profil
  wirft (kein stilles DE); DE-Snapshots byte-identisch.

### Phase 4 — Statische Texte + Inbound-Wiring (Nummer → Sprache)
- **Ziel:** Statische Server-Texte pro Sprache; `/voice/incoming` leitet `language` aus der
  angerufenen Nummer/Tenant ab und gibt sie an `createCall`; Profil-Durchreichung in
  `turnDirectives`/`streamDirectives`. Schwester-Query zu `findTenantByNumber`.
- **Dateien:** `src/server.js` (`/voice/incoming :401-433`, statisch `:349-354,:412,:421`),
  `src/store/defaults.js` (`:123`), `src/self-service.js` (`:18-22`), neue Query in
  `src/store/state-ops.js`/`views.js`.
- **Abhaengigkeiten:** Phase 1 (hart); **wirksam erst mit Phase 2+3** (Konsum).
- **Parallelisierbar:** **Nein** (zentrale `server.js`-Naht, haengt am Konsum aus 2/3).
- **Review-/Testkriterium:** Inbound-Smoke FR-Nummer → FR-Greeting/Hangup/STT/Voice; DE-Nummer
  unveraendert; fehlende `language` → `de`.

### Phase 5 (optional/deferrable) — Realtime-Engine-Sprache
- **Ziel:** `bridge.js` OpenAI-Instructions + Voice pro Sprache + **expliziter Whisper-Locale**
  (statt Auto-Detect) + Sprach-Opener (R13). Nur falls `VOICE_ENGINE=realtime` genutzt wird
  (Budget-Engine ist Live-Default).
- **Dateien:** `src/bridge.js` (`:50,:126,:129,:137`).
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Ja** (eigene Datei).
- **Review-/Testkriterium:** Realtime-Session FR → FR-Opener + FR-Voice + FR-Whisper-Locale;
  DE unveraendert.

---

### Block B — Geo-Nummernzuordnung (Phase 6–9) — echtes Geld, Provider-Live

### Phase 6 — Geo-Quelle bei Registrierung + Persistenz
- **Ziel:** IP-Geo-Lookup-Schicht (oder explizite User-Wahl) in `/api/onboard`: Land
  ermitteln (Vorschlag + User-Bestaetigung), `country` (+abgeleitete `language`) in `tenant`
  und Number-Request schreiben. IP-Geo NICHT autoritativ (R4); Fallback
  `config.provisioningCountry`.
- **Dateien:** `src/server.js` (`/api/onboard :927-998`), `src/onboarding.js`
  (`requestNumber`-Pfad), `src/store/state-ops.js` (`requestNumber :473`), neue
  `src/geo/`-Adapterschicht, `src/config.js` (Geo-Env), `.env.example`.
- **Abhaengigkeiten:** Phase 1.
- **Parallelisierbar:** **Nein** (`server.js` + `onboarding.js`).
- **Review-/Testkriterium:** Onboard mit IP→FR schlaegt `country=FR`/`language=fr` vor; User
  kann ueberschreiben; IP-Geo-Ausfall → Fallback `DE`; gespoofte IP aendert nichts
  Autoritatives (R4).

### Phase 7 — Per-Job-countryCode + Telnyx-Geo-Suche
- **Ziel:** `runProvisioningDrain` baut `countryCode`/`connectionId` **pro Job** aus dem
  Record statt global (`:1008` → in den Handler); Telnyx `searchNumbers` mit hoeherem `limit`
  + Verfuegbarkeits-Auswahl (R5) + optional Locality; Port-Vertrag erweitern.
  Idempotenz-Schloesser unangetastet (R1).
- **Dateien:** `src/server.js` (`runProvisioningDrain :1005-1017`),
  `src/worker/provisioning.js`, `src/onboarding.js` (`provisionNumber :35` nutzt
  Record-Country), `src/telephony/adapters/telnyx/numbers.js` (`:17,:32-37`),
  `src/telephony/ports.js` (`:87`).
- **Abhaengigkeiten:** Phase 1, Phase 6.
- **Parallelisierbar:** **Nein** (`server.js` + Provisioning; haengt an Phase 6).
- **Review-/Testkriterium:** FR-Request → `+33`-Suche; zweimal drainen → genau ein Kauf (R1);
  keine kaufbare Nummer → klare Fehlermeldung statt Crash (R5); Hold/Order-Reihenfolge intakt.

### Phase 8 — Outbound-Nummernwahl nach Ziel-Land
- **Ziel:** `outboundFrom(s, tenantId, to)` waehlt laenderpassende Absendernummer, Fallback
  `primary`; `primary`-Konzept bei Mehrfachnummern (R11); `allowedCountryCodes` abstimmen.
  Gespraechssprache = `language` der gewaehlten Nummer.
- **Dateien:** `src/server.js` (`outboundFrom :650-653`, Aufruf `:716`),
  `src/store/views.js` (`findActiveNumber :20` laenderbewusst / neue Query), `src/config.js`
  (`allowedCountryCodes :139`).
- **Abhaengigkeiten:** Phase 1, Phase 6 (Nummern brauchen `country`).
- **Parallelisierbar:** **Nein** (`server.js`+`views.js`, ueberschneidet `server.js` mit Phase 7).
- **Review-/Testkriterium:** Tenant mit `+49`+`+33` → FR-Ziel waehlt `+33` (R11); Single-Number
  unveraendert; kein passendes Land → `primary`.

### Phase 9 (optional) — Kosten/Hold pro Land + Telnyx-Retry/Backoff
- **Ziel:** Pro-Land-Preis/Hold statt fixem `numberSetupFeeCents` (R3); Retry/Backoff fuer
  Telnyx-429/5xx + Reconciliation der `failed`-Jobs (R6).
- **Dateien:** `src/billing/*`, `src/config.js`, `src/telephony/adapters/telnyx/numbers.js`.
- **Abhaengigkeiten:** Phase 6, Phase 7.
- **Parallelisierbar:** bedingt (Billing-Teil disjunkt zur Retry-Logik).
- **Review-/Testkriterium:** Hold == realer Laenderpreis (kein Capture-Mismatch, R3);
  simulierter 429 → Backoff + Recovery statt `failed`-Leiche (R6).

> **Bloecke:** A (Sprache) und B (Nummern) sind nach Phase 1 weitgehend unabhaengig.
> **Empfehlung: Block A zuerst** (kein Geld, macht den toten `call.language`-Kanal lebendig,
> sofort fuer DE+FR/EN testbar), dann Block B (Geld + Provider-Live). Phase 4/7/8 teilen sich
> `server.js` → bei paralleler Arbeit zwingend per Claim koordinieren (Lehre: geteilter
> Worktree, Memory `shared-worktree-concurrent-writes`).

---

## 6. Offene Fragen (vor Implementierung mit dem Boss klaeren)

1. **Sprach-Set:** Nur DE+FR+EN im ersten Wurf, oder direkt N Sprachen (Tabelle generisch
   auslegen)? Welche Laender → welche Sprache (AT/CH → de, GB/IE → en)?
2. **FR/EN-Qualitaet:** Liefert `claude-haiku-4-5` ausreichende FR/EN-Gespraechsqualitaet,
   oder braucht eine Sprache ein staerkeres Modell (dann doch sprachabhaengiges
   Modell-Mapping)?
3. **Voice-/STT-Verfuegbarkeit:** Sind FR/EN-TTS-Voices (Polly/Azure) und FR/EN-STT
   (Deepgram-Model) in BEIDEN Provider-Accounts (Twilio + Telnyx) freigeschaltet?
4. **Telnyx-Live-Felder:** `phone_number_type`-Werte, Locality-Filter, FR/GB-Verfuegbarkeit,
   Preis und eigene `connectionId` pro Land — live verifizieren (Doku-Stand `numbers.js:6`,
   „live UNBESTAETIGT").
5. **Geo-Provider:** maxmind-DB (lokal, kein Netz, Lizenz) vs. ip-api (HTTP, Rate-Limit)?
   DSGVO der IP-Geolokalisierung (Speicherung/Consent)?
6. **Mehrfachnummern:** Darf ein Tenant mehrere Laender-Nummern haben? Wenn ja:
   `primary`-Definition, Dashboard-UI, `maxNumbersPerTenant` (heute 1) anheben?
7. **Land-Gate-Politik:** `allowedCountryCodes` (Default `+49`) — pro Tenant oder global
   lockern? Wie verhindern, dass eine FR-Freischaltung ungewollt teure Ziele oeffnet?
8. **Sprache aenderbar?** Soll der Owner die Sprache nachtraeglich umstellen koennen
   (`settings.language`) oder ist sie an die Nummer gebunden (unveraenderlich)?
9. **Bestands-Migration aktiv?** `MULTI_TENANT`/`PROVISIONING_ENABLED` sind heute aus — gibt
   es ueberhaupt schon echte Nicht-Owner-Nummern zu migrieren, oder ist R7 vorerst trivial
   (nur Owner = DE)?
