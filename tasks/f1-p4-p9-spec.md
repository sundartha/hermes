# F1 — Authoritative Spec P4-P9 (Owner-Entscheidungen 2026-06-22)

> Verbindliche Scope-/Design-/Invarianten-Definition fuer die Restphasen der Geo-Location.
> Quelle: `docs/strategies/f1-geo-location.md` (verifizierte Zeilenangaben dort) + die unten
> fixierten Owner-Entscheidungen zu den 9 offenen Fragen aus §6. P1-P3 sind gemergt
> (master=ac614ee, DE+FR fuer Renderer/LLM). Zeilennummern sind HINWEISE (koennen rotten) -
> per grep auf Symbole/Call-Sites verifizieren.

## Owner-Entscheidungen zu §6 (verbindlich fuer ALLE Restphasen)

1. **Sprach-Set:** DE + FR + EN. country->language-Tabelle generisch: `DE/AT/CH->de`,
   `FR->fr`, `GB/IE->en`. P2/P3 haben nur DE+FR gebaut -> **EN-Bundle muss ergaenzt werden**
   (i18n-Bundle, Renderer-Voice/STT, statische Texte). Tabelle so auslegen, dass weitere
   Sprachen = ein Eintrag.
2. **Modell:** EIN Modell (`claude-haiku-4-5`) fuer alle Sprachen. KEIN sprachabhaengiges
   Modell-Mapping.
3. **Voice/STT-Verfuegbarkeit (R10/R9):** FAIL-CLOSED bauen (unbekanntes Voice-Profil wirft,
   nie still DE/EN). Echte Twilio/Telnyx/Deepgram-Freischaltung wird NICHT blind angenommen ->
   Live-Verifikation als separates Smoke-Gate VOR Produktiv-Schalter. Produktiv-Flags bleiben aus.
4. **Telnyx-Live-Felder (R5):** dito - fail-closed, Smoke-Gate. `phone_number_type`/Locality/
   Preis/connectionId pro Land werden im Code als Tabelle vorgesehen, aber Live-Werte erst per
   Smoke bestaetigt. `PROVISIONING_ENABLED` bleibt Default false (Dry-Run byte-identisch).
5. **Geo-Provider:** **maxmind GeoLite2 lokal** (DSGVO-sauber, IP verlaesst den Server NIE).
   Hinter einem **Geo-Port (DIP)** wie die Telefonie-Ports. Ops-Flag `GEO_ENABLED` (Default
   **aus**, damit Tests/CI netzfrei laufen; in Prod an). Mechanik: **IP -> Land -> Sprache,
   automatisch**. `DE` ist NUR der Fail-Notnagel, wenn die IP gar nichts aufloest (lokale Dev,
   privates Netz, DB fehlt) - NICHT der Normal-Default. User-Korrektur des vorgeschlagenen
   Landes ist optional (R4 VPN-Spoof), nicht autoritativ-erzwungen.
6. **Mehrfachnummern:** NEIN, strikt **1 Nummer/Tenant** (`maxNumbersPerTenant=1` bleibt).
   Folge: P8 Outbound-Land-Wahl wird **trivial** (es gibt nur 1 Absendernummer) - keine
   primary-Logik, keine Auswahl unter mehreren Laender-Nummern noetig. P8 reduziert sich auf:
   Gespraechssprache = `language` der (einzigen) aktiven Nummer bzw. `settings.language`-
   Override; Ziel-Land-Gate greift (siehe #7).
7. **Land-Gate:** `allowedCountryCodes` global lockern auf **`+49,+33,+44`** (Default in
   `config.js:139` erweitern + `.env.example`). Gilt fuer Outbound-ZIELE. Kein Pro-Tenant-Gate.
8. **Sprache aenderbar:** JA, `settings.language` ist im Dashboard uebersteuerbar.
   **Aufloesungs-Praezedenz** (fail-safe): `settings.language` (Owner-Override, falls gesetzt)
   -> `number.language` -> `tenant.defaultLanguage` -> `"de"`. Additiv NULLABLE, Backfill-frei
   (fehlend = nicht gesetzt = naechste Stufe).
9. **Bestands-Migration (R7):** trivial. P1 hat alle Bestands-Records auf `DE`/`de` backfilled;
   `MULTI_TENANT`/`PROVISIONING_ENABLED` aus; real existiert nur Owner=DE. Keine zusaetzliche
   Migrationsarbeit noetig - nur die Code-Fallbacks (`|| "de"` / `|| "DE"`) konsequent halten.

**P9-Scope:** MINIMAL jetzt - fixer Hold bleibt, nur Laender mit aehnlichem Tarif freischalten
(R3 vermeiden). Retry/Backoff + failed-Job-Reconciliation (R6) sind eine spaetere eigene Phase.

## Absolute Grundregeln (wie Block A, gelten in ALLEN Phasen)
1. DE bleibt **byte-identisch**. Kein FR/EN-Pfad faerbt DE ab.
2. FR/EN-Offenlegung = fest verdrahtet, kuratiert im Locale-Bundle (Regel 2, R8). Auch Realtime-Opener.
3. Keine neuen npm-Dependencies (maxmind-DB ist eine DATEI/Asset, kein npm-Dep ausser ggf. dem
   Reader - falls ein Reader-Dep noetig: zuerst pruefen ob netzfrei/lizenzkonform, sonst
   minimaler eigener mmdb-Reader bzw. defern und mit Stub bauen; Owner fragen bevor Dep dazukommt).
4. Safety-/Kosten-/Idempotenz-Gates (die DREI Schloesser §2.2, Hold-vor-Order, Budget-Schnittmenge,
   Signaturpruefung) NIE aufweichen. Neue Endpunkte = dieselben Gates.
5. `npm test` nach jeder Phase gruen (beide Backends: json-Default + pglite-in-process).
6. Unbekannte/fehlende Sprache -> `de`. Unbekanntes Land -> `config.provisioningCountry || "DE"`.
7. Kommentare deutsch OHNE Umlaute. ESM, kein Build-Step, kein TypeScript.

---

## Phase P4 (f1-p4) — Statische Texte + Inbound-Wiring + EN-Bundle
**Branch:** `phase/f1-p4-inbound-wiring`, **base:** `master` (enthaelt P1+P2+P3)

**Was zu tun:**
- **EN-Bundle ergaenzen** (P2/P3 haben nur DE+FR): `src/i18n/`-Bundle um `en` (System-Prompt-
  Teile, kuratierte EN-Offenlegung R8, sttLocale `en-GB`, ttsVoice Polly/Azure EN, deepgramModel,
  greetingDefault). Renderer (`twilio/render.js`, `telnyx/render.js`, `directives.js`) um
  `EN_*_NEURAL`-Profil + Voice/STT erweitern - fail-closed (R9/R10). Snapshot-Tests EN je Provider.
- `src/server.js` `/voice/incoming`: `language` aus Number/Tenant ableiten und an `createCall`
  geben (statt hart `"de"`). **Schwester-Query** zu `findTenantByNumber` (liefert language/Record,
  nicht nur tenantId) in `state-ops.js`/`views.js`.
- **Aufloesungs-Praezedenz (#8):** `settings.language` -> `number.language` ->
  `tenant.defaultLanguage` -> `"de"`. Helper an EINER Stelle (resolveCallLanguage o.ae.).
- `settings.language` als optionales, im Dashboard uebersteuerbares Feld (defaults.js Default-Merge,
  whitelist in updateSettings, tenant.html-Select). Additiv NULLABLE.
- Statische Server-Texte (Reprompt/Fehler/Hangup `server.js:349-354,412,421`) + Greeting-Default
  (`defaults.js:123`) + Greeting-Templates (`self-service.js:18-22`) aus dem i18n-Bundle pro Sprache.
- Profil-Durchreichung in `turnDirectives`/`streamDirectives`.

**Invarianten:** DE-Nummer fuehrt DE byte-identisch; FR-Nummer FR; EN-Nummer EN; fehlende
language -> `de`. settings.language-Override schlaegt number.language.
**Test:** Inbound-Smoke je Sprache (Greeting/Hangup/STT/Voice); Praezedenz-Test (Override > Nummer);
DE-Snapshots byte-identisch.

---

## Phase P5 (f1-p5) — Realtime-Engine-Sprache (optional/deferrable)
**Branch:** `phase/f1-p5-realtime`, **base:** `<P4.finalBranch>`

**Was zu tun:**
- `src/bridge.js` (`:50,:126,:129,:137`): OpenAI-Instructions + Voice + **expliziter
  Whisper-Locale** (statt Auto-Detect) + Sprach-Opener aus VOICE_PROFILE/`call.language` (R13).
  Offenlegungs-Opener bleibt fest verdrahtet (kuratierte Variante aus dem Bundle).
- DE/FR/EN aus demselben i18n-Bundle wie P4.

**Invarianten:** Nur bei `VOICE_ENGINE=realtime`; Budget-Engine unberuehrt; DE-Realtime
byte-identisch. `bridge.js` hat als `HEIKLE STELLE` markierte Abschnitte - dort vorsichtig.
**Test:** Realtime-Session FR/EN -> passender Opener+Voice+Whisper-Locale; DE unveraendert.

---

## Phase P6 (f1-p6) — Geo-Quelle bei Registrierung + Persistenz
**Branch:** `phase/f1-p6-geo-source`, **base:** `<P5.finalBranch>` (bzw. P4 falls P5 separat)

**Was zu tun:**
- Neue `src/geo/`-Adapterschicht hinter einem **Port** (DIP, wie Telefonie-Ports):
  `geoLookup(ip) -> { country } | null`. Adapter: maxmind GeoLite2 lokal (#5). Stub-Adapter
  fuer Tests (netzfrei). Ops-Flag `GEO_ENABLED` (Default aus) in `config.js` + `.env.example`.
- `/api/onboard` (`server.js:927-998`): IP ermitteln (`req`-IP, Proxy-aware via vorhandene
  Mechanik), `geoLookup` -> Land-Vorschlag; User-Wahl darf ueberschreiben; Fallback
  `config.provisioningCountry || "DE"`. country (+abgeleitete language via country->language-
  Tabelle) in `tenant` (country/defaultLanguage) und Number-Request (`requestNumber :473`) schreiben.
- IP NICHT autoritativ (R4). IP verlaesst den Server nicht (lokaler maxmind).

**Invarianten:** Onboard mit IP->FR schlaegt country=FR/language=fr vor; User kann ueberschreiben;
Geo-Ausfall/Flag aus -> Fallback DE; gespoofte IP aendert nichts Autoritatives. Idempotenz-
Schloesser unberuehrt.
**Test:** Stub-IP->FR; Ausfall->DE; tenant+number tragen country/language (beide Backends, R12).

---

## Phase P7 (f1-p7) — Per-Job-countryCode + Telnyx-Geo-Suche
**Branch:** `phase/f1-p7-percountry-provision`, **base:** `<P6.finalBranch>`

**Was zu tun:**
- `runProvisioningDrain` (`server.js:1005-1017`): `countryCode`/`connectionId` **pro Job** aus
  dem Number-Record statt global (`:1008`). `provisionNumber` (`onboarding.js:35`) nimmt
  countryCode bereits als Arg - nur der Aufrufer aendert sich. Land->Suchparameter-Tabelle
  (countryCode->{telnyxCountryCode, connectionId?, phoneNumberType?}).
- `searchNumbers` (`telnyx/numbers.js:17,32-37`): hoeheres `limit` + Verfuegbarkeits-Auswahl
  statt `limit:1` (R5); klare Fehlermeldung statt Crash bei 0 Treffern. Port-Vertrag
  (`ports.js:87`) ggf. erweitern.
- **DIE DREI IDEMPOTENZ-SCHLOESSER UNANGETASTET** (R1): Queue-Dedup, status===REQUESTED,
  Telnyx Idempotency-Key. Hold-vor-Order-Invariante.

**Invarianten:** FR-Request -> `+33`-Suche; zweimal drainen -> genau EIN Kauf (R1); keine Nummer
-> Fehlermeldung statt Crash; Hold/Order-Reihenfolge intakt; Dry-Run (PROVISIONING_ENABLED=false)
byte-identisch.
**Test:** per-Job countryCode (FR->+33); Doppel-Drain -> 1 Kauf; 0-Treffer -> sauberer Fehler.

---

## Phase P8 (f1-p8) — Outbound-Sprache + Ziel-Land-Gate (REDUZIERT durch #6)
**Branch:** `phase/f1-p8-outbound-lang`, **base:** `<P7.finalBranch>`

**Was zu tun (klein, weil strikt 1 Nummer/Tenant):**
- Gespraechssprache des Outbound = `language` der (einzigen) aktiven Absendernummer bzw.
  `settings.language`-Override (Praezedenz #8). `outboundFrom` (`server.js:650`) reicht die
  Sprache an `createCall` durch (heute hart/Default `de`).
- **KEINE** Mehrfachnummern-Auswahl/primary-Logik (entfaellt durch #6 - nur 1 Nummer).
- Land-Gate: `allowedCountryCodes` Default auf `+49,+33,+44` (#7) in `config.js:139` +
  `.env.example`. Gate prueft weiterhin das ZIEL.

**Invarianten:** Single-Number-Tenant unveraendert im Routing; Outbound spricht die Sprache der
eigenen Nummer; Ziel in +49/+33/+44 erlaubt, sonst geblockt (fail-closed). from = eigene aktive
Nummer (NIE Owner-Nummer, Toll-Fraud R3 aus I7 bleibt).
**Test:** Outbound von FR-Nummer fuehrt FR; Ziel +33 erlaubt; Ziel ausserhalb Liste geblockt.

---

## Phase P9 (f1-p9) — Kosten/Hold pro Land (MINIMAL, Rest deferred)
**Branch:** `phase/f1-p9-cost-min`, **base:** `<P8.finalBranch>`

**Was zu tun (minimal, #P9-Scope):**
- Pro-Land-Hold-Betrag aus der Land->Nummer-Tabelle ABLEITBAR machen (Struktur vorsehen),
  aber konservativ: nur Laender mit bekanntem/aehnlichem Tarif freischalten -> fixer
  `numberSetupFeeCents` bleibt als Default, Tabelle kann pro Land ueberschreiben. Kein
  Capture-Mismatch (R3): Hold == realer Laenderpreis fuer freigeschaltete Laender.
- **DEFERRED (eigene spaetere Phase, NICHT jetzt):** Telnyx 429/5xx Retry/Backoff,
  failed-Job-Reconciliation (R6). Im Report als offen vermerken.

**Invarianten:** Hold-Betrag korrekt pro freigeschaltetem Land; nicht freigeschaltete Laender
bleiben gesperrt; Idempotenz/Hold-vor-Order unberuehrt.
**Test:** Hold == erwarteter Laenderpreis; nur freigeschaltete Laender provisionierbar.
