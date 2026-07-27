# 28 - Welle W3: Owner-Checkliste (live und manuell)

Stand: 2026-07-27 | Live-Commit: `af98442` (Gateway + Website, beide `status: live`)
Vorgaenger: [`27-w2-bericht.md`](27-w2-bericht.md)

W3 ist die einzige Welle, die kein Kommando wiederholen kann. **Protokollpflicht:** jeder Test
braucht Datum, Beleg (Call-ID / Screenshot / abgelesener Wert), Ergebnis und - bei den
Live-Anrufen - die Kosten. Ohne Protokoll gilt der Test als nicht gelaufen.

---

## 0. Deploy-Vorbedingung - ERFUELLT

| Nachweis | Wert |
| --- | --- |
| `curl https://vodafone-agent.onrender.com/healthz` | `{"ok":true,"commit":"af98442...","configHash":"90c7d824..."}` |
| Boot-Banner | `[boot] deployed commit=af98442bb4acaf71b99a0c7264a02a21ee5cca67` |
| Gateway-Deploy | `dep-d9jg61ad0e5s738tepig`, manuell, **live** 07:05:31 UTC |
| Website-Deploy | `dep-d9jg50poagis738psqug`, auto, **live** 07:02:46 UTC |

## 1. Was das Boot-Banner bereits beantwortet (kein Handgriff noetig)

| Achse | Live-Wert | erledigt damit |
| --- | --- | --- |
| Voice-Engine | `budget` | Praemisse aller VOICE-Tests bestaetigt |
| Land-Gate | `*` (weltweit offen) | OUT-02-Praemisse bestaetigt |
| Stundenlimit | **6 Calls/h PRO TENANT** | GAP-10 wirkt live (war plattformweit) |
| Budget-Achse | Tenant + Plattform **Spend-Monat**, `BUDGET_MONTH_ENABLED=true` | eine der vier unverifizierten Env-Achsen |
| Decken | Tenant 1500 ct, Plattform 3000 ct, Worst-Case-Tarif 300 ct/min | 900 ct Worst-Case < 1500 ct -> Guard schlaegt zu Recht nicht an |
| Alarmkanal | kein fatales Finding beim Start | `PLATFORM_ALERT_SMS_TO` ist gesetzt (sonst exit(1)) |

## 2. Bereits gemessen (2026-07-27, ohne Kosten)

| Befund | Beleg |
| --- | --- |
| `/legal/privacy` und `/legal/terms` liefern **404** auf `sundartha.com` | `curl` gegen die Live-Domain |
| `/datenschutz` enthaelt weiterhin das Wort **"Platzhalter"** | `curl \| grep` |
| Beides zusammen ist genau der Grund, warum **GAP-15 x2 rot** ist | `npm run test:gates` |

**Das ist kein Codedefekt.** Die Mechanik aus P14 steht (Content-Quelle, EN-Route, noindex);
was fehlt, ist der TEXT. Siehe Aufgabe O13 unten.

---

## 3. Deine Aufgaben - in dieser Reihenfolge

### Stufe A - kostenlos, kein Anruf, kein Browser-Login (4 Handgriffe)

**A1 - MCP-19 + DID-13: `PAYMENT_CURRENCY` im Render-Dashboard ablesen.**
Service `vodafone-agent` -> Environment. Erwartet: `eur` (Owner-Entscheidung 7.1: EUR ueberall).
*Abbruchbedingung:* steht dort `usd`, sind **alle** Geld-Ergebnisse aus W1/W2 neu zu bewerten -
Anzeige und Belastung waeren dann auseinander (FTC-/PangV-relevant). Wert notieren.

**A2 - die zwei restlichen unverifizierten Env-Achsen ablesen.**
Im selben Screen: `MULTI_TENANT` und `SELF_SERVICE_ENABLED`. Der Blueprint fuehrt beide auf
`false` - Werte, unter denen ein Self-Service-Launch nicht existieren kann. Das Boot-Banner
sagt "Web-Login aktiv", was dagegen spricht; der Dashboard-Wert entscheidet.

**A3 - LAW-16: Datenresidenz bestaetigen.** Region des Service = `frankfurt` (aus der API
bestaetigt). Nur noch die Frage, ob das fuer Nicht-EU-Kunden so gewollt ist. Reine
Entscheidung, kein Test.

**A4 - LAW-23: `PLAN-SECURITY.md` sichten** - gibt es eine Rubrik zu Consent/TCPA? Heute nein.
Ergebnis notieren, keine Aenderung noetig.

> **PROTOKOLL Stufe A, 2026-07-27 (Owner am Render-Dashboard abgelesen).**
>
> | Test | Wert | Urteil |
> | --- | --- | --- |
> | **MCP-19 / DID-13** - `PAYMENT_CURRENCY` | **`eur`** | **BESTANDEN.** Deckt sich mit dem Code-Default (`src/config.js`) und mit Owner-Entscheidung 7.1. Die Invariante *Anzeige-Waehrung = Belastungs-Waehrung* haelt live. **Der Abbruchpunkt aus `PLAN-I18N-TESTS.md` 5 (W3) greift NICHT** - die Geld-Ergebnisse aus W1/W2 bleiben gueltig. |
> | **A2** - `MULTI_TENANT` | **`true`** | Live-Wert steht, siehe Divergenz unten. |
> | **A2** - `SELF_SERVICE_ENABLED` | **`true`** | dito |
>
> **Damit sind alle vier nie verifizierten Env-Achsen belegt:** `BUDGET_MONTH_ENABLED` (Boot-Banner),
> `PLATFORM_ALERT_SMS_TO` (fataler Guard haette sonst `exit(1)` ausgeloest), `MULTI_TENANT` und
> `SELF_SERVICE_ENABLED` (hier). Der offene Punkt 3 aus dem W1-Bericht ist geschlossen.
>
> **NEUER BEFUND - der Blueprint wuerde das Produkt abschalten.** Gemessene Divergenz:
>
> | Schluessel | `render.yaml` | live |
> | --- | --- | --- |
> | `PAYMENT_CURRENCY` | `"eur"` | `eur` (deckungsgleich) |
> | `MULTI_TENANT` | **`"false"`** | **`true`** |
> | `SELF_SERVICE_ENABLED` | **`"false"`** | **`true`** |
>
> Das bestaetigt Wurzel **W26** ("`render.yaml` ist Doku, nicht Wahrheit") nicht mehr als
> Vermutung, sondern als Messung - und macht sie zur **Falle**: wer den Blueprint jemals auf den
> dashboard-verwalteten Service anwendet, schaltet Multi-Tenancy und Self-Service ab. Der Dienst
> wuerde weiterlaufen und dabei aufhoeren, ein Produkt zu sein. Gehoert in die Fix-Kette nach W3,
> nicht in W3 selbst.

> **PROTOKOLL Sprach-Achse, 2026-07-27 - der Weltdefault ist LIVE eingeschaltet.**
>
> `WORLD_DEFAULT_LANGUAGE_ENABLED=true` am Service `vodafone-agent` gesetzt (Render-API,
> Deploy `dep-d9jget3eo5us73bch3j0`, live 07:24:18 UTC). Owner-Auftrag; Risiko vertretbar,
> weil es keine fremden Kunden gibt ([[no-existing-customers-premise]]) und `en` als
> Weltdefault ohnehin die beschlossene Produktrichtung ist (7.12).
>
> **Messung danach (kostenlos, ueber den MCP-Connector):** `list_calls` liefert weiterhin
> deutsches Datumsformat (`Mo., 27.07., 07:17`). Das Format stammt seit P12 aus der
> Tenant-Sprache (`makeDateFormatter(loc.dateLocale)`, `src/mcp-tools.js`).
>
> **Zwei Schluesse:**
> 1. **Der Owner-Tenant ist EXPLIZIT auf `de` gesetzt** (eine der Stufen settings/number/
>    tenant), nicht auf den Fallback angewiesen. Waere ueberall `null`, haette der Flip die
>    Aufloesung soeben auf `en` gekippt. Das beobachtete deutsche Anruferlebnis ist damit
>    korrekte Konfiguration, kein Defekt.
> 2. **Der Flip laesst den Bestand unberuehrt** - genau die Zusage aus P10. Bemerkenswert:
>    die DID ist eine US-Nummer (`+1 706`); waere die Sprache aus der Nummer abgeleitet,
>    stuende jetzt Englisch da. Der Tenant gewinnt ueber die Nummer, wie vorgesehen.
>
> **NEUER BEFUND - der configHash sieht diese Aenderung nicht.**
> `configFingerprint` (`src/config-fingerprint.js`) hasht sieben Achsen: Land-Gate,
> Stundenlimit, Budget-Monat, Multi-Tenant, Waehrung, Plattform-Cap, Tenant-Cap.
> `worldDefaultLanguageEnabled` ist NICHT dabei - `/healthz` meldete vor und nach dem Flip
> denselben Hash (`90c7d824...`, ueber 10 Minuten gepollt). Ein Schalter, der die
> **gesprochene Sprache jedes ungesetzten Tenants** umstellt, ist am Deploy-Wahrheitssignal
> also unsichtbar. Das ist keine Fehlfunktion, aber eine Luecke in genau der Sicht, die
> GAP-36/W26 herstellen sollte. Kandidat fuer die Fix-Kette nach W3.

### Stufe B - Browser, kein Anruf (6 Handgriffe)

**B1 - WEB-02: echter Login gegen die Live-Instanz.** `https://app.sundartha.com` einloggen.
Welches Dashboard siehst du - Owner oder Tenant? Sprache? Screenshot.

**B2 - PROMPT-05: gibt es einen Weg, `settings.language` selbst zu korrigieren?**
Beide Dashboards durchklicken. Erwartet: nein. Screenshot des Settings-Bereichs.

**B3 - PAY-11: Geldbetraege im Tenant-Dashboard.** Nach P15b kommt die Formatierung vom
Server. Pruefe, ob Betraege und Datum zur Sprache passen. Screenshot.

**B4 - DID-18: Fehlermeldung "Einrichtung fehlgeschlagen."** Fehlerzustand herbeifuehren
(z.B. Aktivierung ohne hinterlegte Karte). Ist der Text deutsch, obwohl der Tenant `en` ist?

**B5 - LANG-20: das Label "Automatic (by number)"** in den `apps/web`-Settings - verschleiert
es den DE-Fallback? Screenshot.

**B6 - MCP-18 + UI-20: `navigator.language` im claude.ai-Doppel-Iframe.** DevTools im Widget
oeffnen. *Hinweis:* seit P13 rendert der Server die Sprache ins Widget - der Test misst nur
noch, ob das Host-Signal ueberhaupt verlaesslich waere. Niedrige Prioritaet.

### Stufe C - claude.ai-Connector, kein Anruf (2 Handgriffe, WICHTIG)

**C1 - O14-Handprobe: sind die MCP-Tool-Beschreibungen jetzt englisch?**
Ich sehe in meiner eigenen Session weiterhin die **deutschen** Beschreibungen - aber meine
Verbindung stammt von VOR dem Deploy und ist damit ein Cache-Artefakt, kein Messwert.
**Du musst den Connector in claude.ai neu verbinden** (trennen + neu hinzufuegen), dann in
einem frischen Chat pruefen, ob `place_call` eine englische Beschreibung traegt.
*Warum das zaehlt:* `convo-bench` ist fuer diese Achse nachweislich das falsche Instrument -
er seedet den Anruf direkt und ruft MCP nie auf. Es gibt keinen automatisierten Waechter.

**C2 - P13-Widget-Smoke.** Im frisch verbundenen Connector `get_agent_status` aufrufen.
Erscheint die Karte? Ist sie in der Agentensprache? Screenshot.
*Der Plan sagt woertlich: "Die Suite allein ist hier kein Beweis."*

### Stufe D - echtes Geld, echte Leitung (zuletzt, je Anruf einzeln freigeben)

**Bindende Regeln fuer ALLE Anrufe dieser Stufe:**
- **Nur Nummern in deinem eigenen Besitz.** Consent-Modell ist mit 7.4 zurueckgestellt, das
  Land-Gate steht auf `*` - es gibt kein TCPA-/PECR-Gate im Produkt.
- Nach jedem Anruf: Call-ID, Dauer, Kosten notieren.
- `OUTBOUND_FROZEN` bleibt aus, `FAKE_ORIGINATE` bleibt aus (sonst kein Live-Test).

**D1 - PROMPT-23: EN-Anruf auf Deutsch-Drift abhoeren.** Tenant mit `settings.language="en"`,
Anruf an deine eigene Nummer, mehrere Turns, Transkript sichern. **Das ist der wichtigste
Test der Welle** - er misst, ob die 15 Fix-Phasen die gesprochene Sprache wirklich umgestellt
haben.

**D2 - LANG-25: hoert ein US-Empfaenger zuerst Deutsch?**
*Abbruchbedingung:* bestaetigt sich der deutsche Offenlegungssatz an einem US-Ziel, wird
**kein weiterer Live-Anruf gefahren** - der Befund ist dann erwiesen, alles Weitere kostet nur
Geld.

**D3 - MCP-20: Live-Karte eines EN-Tenants** zeigt "Gegenseite:" - haengt sich an D1 an, wenn
du den Anruf aus claude.ai ausloest. Screenshot.

**D4 - OUT-26: DE-Origin nach US-Ziel.** Bekanntes Vorwissen: US-DID -> DE-Mobil ist
intermittent, die Gegenrichtung ist ungemessen. Niedrigste Prioritaet der vier.

**VOICE-27 + VOICE-28** (klingt EN britisch statt amerikanisch / STT-Guete bei US-Akzent)
haengen sich an D1 an und brauchen **keinen eigenen Anruf**.

---

## 4. Was NICHT zu W3 gehoert, aber daneben liegt

**O13 - Rechtstexte liefern.** `/legal/privacy` und `/legal/terms` sind live 404,
`/datenschutz` traegt weiter "Platzhalter". Solange das so ist, bleiben GAP-15 x2 rot. Das ist
Textarbeit (ggf. mit Anwalt), keine Testarbeit - und sie blockiert keinen anderen W3-Test.

---

## 5. PROTOKOLL Bahn 1 + Bahn 2 (2026-07-27, autonom)

**Auftrag des Owners:** Bahn 1 (Schreibtisch/offline) und Bahn 2 (Browser, kein Anruf,
kein Geld) autonom abarbeiten. Bahn 3 (claude.ai-Connector + die vier Live-Anrufe) bleibt
beim Owner.

**Vorbefund, der diesen Abschnitt ueberhaupt noetig macht.** Die Stufen A-D oben decken
16 Katalog-IDs ab. W3 hat aber **26** (Abschnitt 6.1/6.2 in `PLAN-I18N-TESTS.md`, plus die
Modus-Korrektur UI-20 aus 7.14). **Zehn IDs standen in keiner Stufe**: LAW-05, LAW-10,
LAW-11, LAW-12, LAW-24, PAY-02, PAY-19, FMT-02, MCP-17, MCP-21. Sie sind hier nachgezogen.

**Methode und ihre Grenze.** Kein Produktionscode angefasst (`git diff --name-only --
src/ public/ apps/ scripts/ render.yaml` = leer). Live-Zugriffe ausschliesslich LESEND
(`curl`, Browser ohne Login). **Ich habe mich NICHT eingeloggt** - Zugangsdaten einzugeben
ist mir untersagt. Wo ein Test die eingeloggte Sicht braucht, steht das ausdruecklich als
Rest-Aufgabe. Wo der Katalog eine Sichtpruefung verlangt, deren Aussage sich am
AUSGELIEFERTEN Live-Bundle deterministisch belegen laesst, ist das Bundle der Beleg - es
ist der staerkere Beweis als ein Screenshot, weil es zeigt, was live wirklich liegt.

### 5.1 Bahn 1 - Schreibtisch (9 IDs)

| ID | Urteil | Beleg (Kommando -> beobachtet) |
| --- | --- | --- |
| **LAW-05** | **BEFUND bestaetigt** - Land-Gate ist reine Whitelist | `grep -ciE "consent\|dnc\|timezone\|zeitfenster" src/telephony/outbound-gates.js` -> **0**. Die Ablehnungsgruende der Kette: `kyc, abo, billing_hold, allowlist, denylist, format, land, stundenlimit, ziel_limit, budget_tenant, reserve_*, platform`. Kein Consent-, kein Zeitfenster-Glied. |
| **LAW-10** | **BEFUND bestaetigt** - keine KI-Stimmen-Einwilligung | `grep -ciE "aiVoiceConsent\|artificial.?voice" src/telephony/outbound-gates.js` -> **0**. Ein Anruf mit KI-Stimme an eine US-Nummer laeuft durch die gesamte Kette ohne Consent-Pruefung. |
| **LAW-11** | **BEFUND bestaetigt, Anker verschoben** | Der Katalog-Anker `datenschutz.astro` traegt seit P14 KEINEN Text mehr (`grep -c "Platzhalter"` -> **0**); die Seite ist nur noch Huelle um `apps/web/src/data/legal/privacy.de.json`. Dort: `grep -c "Platzhalter"` -> **1**, `grep -ciE "CCPA\|Do Not Sell\|California"` -> **0**. Live gegengeprueft: `curl https://sundartha.com/datenschutz \| grep -c "Platzhalter"` -> **1**. |
| **LAW-12** | **bestaetigt** (Zustand wie dokumentiert) | `apps/web/src/data/legal/terms.de.json`: `grep -c "Platzhalter"` -> **1**. Kein final verbindlicher Text. Gleicher Ankerwechsel wie LAW-11. |
| **LAW-16** | **BESTANDEN** | `grep -n "region:" render.yaml` -> `11: region: frankfurt`. EU-Residenz fuer ALLE Tenants, keine Region-Wahl pro Land. Die Luecke ist die fehlende Offenlegung ggue. Nicht-EU-Kunden - sie haengt an O13 (Rechtstexte), nicht an der Technik. |
| **LAW-23** | **BEFUND bestaetigt** - Doku-Luecke | `grep -ciE "consent\|TCPA\|Ofcom" PLAN-SECURITY.md` -> **0**. Die 21 Rubriken decken Budget/Reserve/Provisioning/Billing/Identitaet/Kosten ab, keine einzige Recht/Consent. |
| **LAW-24** | **BEFUND bestaetigt UND praezisiert** | `src/i18n/locales.js:287-291` (EN) instruiert das Modell per Prompt (`Your first sentence must be exactly: ...`) statt es LLM-frei zu erzwingen. **Praezisierung:** DE (`:116-121`) und FR (`:215-219`) sind strukturell IDENTISCH - die schwaechere Garantie haengt am PFAD (realtime), nicht an der Sprache. Der Katalog rahmt sie faelschlich als EN-Eigenheit. Zusatz: Entscheidung 7.14 erklaert den Realtime-Zweig zu "kein Produktpfad". |
| **FMT-02** | **Wurzel behoben - NEUER, groesserer Befund an ihrer Stelle** | s. 5.3 unten. Die Simulation selbst: bei `2026-07-28T00:30:00Z` steht UTC auf `Tuesday 28/07`, `America/Los_Angeles` auf `Monday 27/07` -> **Tagesabweichung reproduziert**. |
| **PAY-02** | **ENTSCHIEDEN, kein offener Widerspruch** | Owner-Entscheidung 7.1 (EUR ueberall) + live `PAYMENT_CURRENCY=eur` (Stufe A oben). Anzeige-Waehrung == Belastungs-Waehrung haelt. **Rest-Aufgabe (Doku, kein Test):** den "USD bindend"-Vermerk in der Projekt-Historie und den Kommentar in `apps/web/src/pages/preise.astro` als ueberholt markieren. |

### 5.2 Bahn 2 - Browser / Live-Oberflaechen (10 IDs)

| ID | Urteil | Beleg |
| --- | --- | --- |
| **WEB-02** | **gemessen, ohne Login entschieden** | `curl -o /dev/null -w "%{http_code} %{redirect_url}" https://vodafone-agent.onrender.com/tenant.html` -> **`302 -> /app`**. Damit ist `WEB_DIST_DIR` live **gesetzt** (die Weiche in `src/app.js` registriert diesen Redirect nur dann). Im Browser auf `https://app.sundartha.com/app`: `document.documentElement.lang` = **`"en"`**, `location.pathname` = **`/app/`**, Titel `Hermes - App`. Das ist genau der Katalog-Zweig "`<html lang="en">` und `/app`". **Offen bleibt allein die eingeloggte Sicht** (Stufe B1). |
| **PROMPT-05** | **UEBERHOLT - die Luecke ist geschlossen** | Der Katalog behauptet "kein Dashboard-Weg, `settings.language` zu korrigieren". Gegenbeweis: `apps/web/src/components/app/SettingsIsland.astro:58-59` traegt `<select id="settings-language">`, und `src/self-service.js:20` fuehrt `language` in `SELF_SERVICE_FREE_FIELDS` - der Tenant darf es selbst schreiben. Live gegengeprueft: das ausgelieferte `/app`-HTML enthaelt `settings-language`. |
| **LANG-20** | **BEFUND bestaetigt - LIVE** | `"Automatic (by number)"` liegt woertlich im ausgelieferten `/app`-HTML UND im Chunk `/_astro/api.*.js`; `apps/web/src/lib/api.js:459-464` zeigt den Grund: statischer Label-Katalog ohne dynamischen Teil. Kein Hinweis, welche Sprache "Automatic" fuer DIESEN Tenant bedeutet. |
| **PAY-11** | **GETRAGEN** (Entscheidung 7.15) | s. 5.3. `public/tenant.html` ist live nicht mehr erreichbar (302 -> `/app`); dort steht heute genau **1** `de-DE` (`STATIC_FORMAT_LOCALE`, dokumentierter fail-soft-Ausgangswert), P15b holt die Locale vom Server. Die LIVE-Oberflaeche `apps/web` haelt dagegen `en-US` hart. **Owner 2026-07-27: das Dashboard bleibt einsprachig englisch** - damit ist das kein Defekt mehr, sondern ein getragenes Risiko (7.13 Punkt 6). |
| **DID-18** | **GETRAGEN, mit latentem Rest** (Entscheidung 7.15) | `"Einrichtung fehlgeschlagen."` steht in `public/tenant.html:348` - diese Datei ist live geschattet. Im ausgelieferten Live-Bundle `/_astro/api.*.js` steht stattdessen **`"Number setup failed"`** (`apps/web/src/lib/api.js:191`), hart **englisch** - und das ist nach 7.15 der Sollzustand. **Latenter Rest:** faellt `WEB_DIST_DIR` je weg, entfaellt der 302 und der deutsche Text wird wieder ausgeliefert. |
| **MCP-21** | **GESCHLOSSEN** | Der Katalog sagt vorher: Label englisch, Wert deutsch. Heute nimmt `permissionsSummary(settings, labels)` (`src/mcp-tools.js:217-222`) die Labels als Parameter, und `src/i18n/mcp-texts.js` fuehrt sie je Sprache (`PersoenlicheDaten` / `PersonalData` / `DonneesPersonnelles`). Label und Wert stammen aus DERSELBEN Quelle (`loc.mcp`, `:742`) - der beschriebene Bruch ist strukturell ausgeschlossen. |
| **MCP-18** | **GEGENSTANDSLOS** | Der Test misst die Verlaesslichkeit von `navigator.language` im claude.ai-Iframe. Seit **P13/E4** liest das Produkt dieses Signal nicht mehr: `src/ui/widget-i18n.js:170-175` setzt die Locale serverseitig als Literal. `grep -rn "navigator.language" src/` -> nur noch **zwei Kommentarzeilen**, keine Codestelle. Ein Signal, das niemand liest, braucht keine Verlaesslichkeitsmessung. |
| **UI-20** | **GEGENSTANDSLOS** | Identische Begruendung wie MCP-18 (beide beschreiben denselben Sachverhalt; UI-20 wurde in 7.14 nur im Modus korrigiert). |
| **MCP-17** | **Praemisse entfallen** | Der Test fragt, ob **deutsche** Tool-Beschreibungen eine englische Chat-Session verschlechtern. `src/mcp-tools.js:4-12` haelt als Systemgrenze fest: alles, was nur das Modell liest, ist **einsprachig englisch** und wird bewusst nicht lokalisiert (per `test/p15-mcp-tool-descriptions-en.test.js` gepinnt). Stichprobe: `get_agent_status` -> "Status of the phone agent: ...". Es gibt keine deutschen Beschreibungen mehr, deren Wirkung zu messen waere. **Rest-Aufgabe bleibt C1**: dass der LIVE verbundene Connector diese Texte auch ausliefert (Cache-Frage, kein Code-Zustand). |
| **PAY-19** | **code-seitig BESTAETIGT, Live-Probe geparkt** | `grep -rniE "requires_action\|authentication_required\|next_action\|3ds" src/billing/` -> **kein Handling**; `src/billing/stripe.js:32` haelt `OFF_SESSION = "true"` mit dem Kommentar "kein 3DS-Redirect noetig". Ein SCA-Fehlschlag hat damit keinen Retry-/Redirect-Zweig - `assertOk` wirft, der Kunde bekommt nie die Chance zur Authentifizierung. **Geparkt:** die Live-Bestaetigung braucht einen Checkout mit 3DS-Testkarte plus `placeHold` gegen echtes Stripe-TEST - eine eigene Sitzung mit Geld-Naht, nicht Teil dieser. |

### 5.3 Zwei Befunde, die groesser sind als ihre Test-ID

**B1 - Die Zeitzonen-Achse hat exakt den Defekt, den die Sprach-Achse gerade behoben hat.**
P8 hat FMT-01/FMT-02 an der Wurzel gefixt: `src/claude.js:43` nimmt die Zeitzone des
TENANTS statt der des Serverprozesses. Der Katalogtext zu FMT-02 ist damit doppelt
ueberholt - und er war zusaetzlich sachlich falsch: er nennt das Abweichungsfenster
"UTC 22:00-24:00", gemessen liegt es bei **UTC 00:00-07:00** (bei `2026-07-28T07:30:00Z`
stehen UTC und LA wieder auf demselben Tag).

Der ERSATZBEFUND wiegt schwerer. `TIMEZONE_FOR_COUNTRY` (`src/geo/resolve.js:44-48`) kennt
**acht** Laender (DE/AT/CH/FR/GB/IE/US/CA); `timezoneForCountry` faellt fuer alles andere
auf `DEFAULT_TIMEZONE = "Europe/Berlin"` (`src/store/defaults.js:369`). Bei dem in 7.11
beschlossenen **weltweiten** Start heisst das: ein Tenant in Japan, Brasilien oder Indien
bekommt eine **Berliner Uhr** in seinem Prompt - bis zu 12 Stunden daneben, also regelmaessig
der falsche Wochentag. Selbst innerhalb der acht: `US -> America/New_York`, ein Kunde in
Los Angeles liegt 3 h daneben (der Code nennt das ausdruecklich eine "Anzeige-Naeherung").

Das ist strukturell **dieselbe** Luecke, die fuer die Sprache mit 7.12 (`en` als Weltdefault,
WORLD-01/02/03) geschlossen wurde. Fuer die Zeitzone gibt es keine entsprechende
Entscheidung. **Empfehlung: eigene Katalog-IDs in der Fix-Kette nach W3**, nicht in W3.

**B2 - Beide Dashboard-Befunde zeigen auf eine Oberflaeche, die live niemand mehr sieht.**
PAY-11 und DID-18 zielen auf `public/tenant.html`. Live faengt `src/app.js` diesen Pfad ab
und leitet mit **302 auf `/app`** um (der Astro-Build). Gemessen:

| Achse | Katalog-Anker `public/tenant.html` | LIVE-Oberflaeche `apps/web` -> `/app` |
| --- | --- | --- |
| Geld/Datum | seit P15b **serverseitig** (`formatLocale` aus `/api/self-service/state`), nur der fail-soft-Ausgangswert ist `de-DE` | **hart `en-US`** (`lib/api.js:332`, `lib/subscribe.js:34`), Preise als `€4.99` ueber `formatPlanPrice` |
| Fehlertext Nummer | `"Einrichtung fehlgeschlagen."` (deutsch) | `"Number setup failed"` (**englisch**, `lib/api.js:191`) |

Der PAY-11-Zustand ist **kein Versehen**: `test/dashboard-i18n-surface.test.js` pinnt
`en-US` als gruene Regressions-Baseline (WEB-18) - eine bewusste Entscheidung fuer die
englische Marketing-Oberflaeche. Nur ist `/app` inzwischen nicht mehr Marketing, sondern
**das Tenant-Dashboard fuer alle Sprachen weltweit**. Ein deutscher Tenant sieht dort
`7/27/2026` und `€4.99` statt `27.07.2026` und `4,99 €`, ein franzoesischer ebenso.

**Das war eine Produktfrage, kein Bug** - und sie ist entschieden.

> **ENTSCHIEDEN (Owner, 2026-07-27): `/app` bleibt einsprachig englisch.** Begruendung: der
> Umbau waere zu viel Aufwand fuer den Gewinn. Festgehalten als **Entscheidung 7.15** in
> `PLAN-I18N-TESTS.md`, das getragene Risiko als **7.13 Punkt 6**.
>
> **PAY-11 und DID-18 sind damit abgeschlossen** - als getragene Risiken, nicht als Defekte.
>
> **Gegenprobe an den Gates (2026-07-27):** alle sechs roten WEB-/GAP-Gates durchgesehen -
> **keines** schreibt die jetzt verworfene Richtung fest, es musste nichts geloescht oder
> aufgeweicht werden. Im Gegenteil:
> - **WEB-18** steigt von der Regressions-Baseline zum **Waechter dieser Entscheidung** auf
>   (`CAL_LOCALE`/`DATE_LOCALE` = `en-US`, Verbot von `de-DE`/`fr-FR` unter `apps/web/src`).
> - **WEB-10** und **WEB-13** bleiben **zu Recht rot**: die Entscheidung lautet "das Dashboard
>   ist englisch", NICHT "deutscher Text ist dort in Ordnung". Ein deutscher Klartext-Fehler
>   und eine deutsche Session-abgelaufen-Seite bleiben auf einer englischen Oberflaeche
>   Defekte.
> - **WEB-07/08/19, GAP-30** fordern Funktion bzw. Katalog-Deckungsgleichheit - unberuehrt.
>
> **Ein latenter Rest bleibt bestehen** (DID-18): der deutsche Text in
> `public/tenant.html:348` verschwindet nicht, er ist nur durch den 302 unerreichbar. Faellt
> `WEB_DIST_DIR` je weg, wird er wieder ausgeliefert. Kein Handlungsbedarf heute, aber ein
> Grund, `WEB_DIST_DIR` als betriebskritisch zu behandeln (es entscheidet nicht nur ueber
> das Aussehen, sondern darueber, WELCHES Dashboard ein Kunde sieht).

### 5.4 Stand nach diesem Durchgang

| | Anzahl | IDs |
| --- | --- | --- |
| **abgeschlossen** | 21 | MCP-19, DID-13, LAW-05, LAW-10, LAW-11, LAW-12, LAW-16, LAW-23, LAW-24, FMT-02, PAY-02, WEB-02 (Shell), PROMPT-05, LANG-20, MCP-21, MCP-18, UI-20, MCP-17 (Code-Teil), PAY-19 (Code-Teil), **PAY-11 + DID-18 (getragen, 7.15)** |
| **wartet auf Owner-Entscheidung** | 0 | - |
| **Bahn 3 - Owner** | 6 | PROMPT-23, LANG-25, MCP-20, OUT-26 (Live-Anrufe) + VOICE-27, VOICE-28 (haengen an D1) |
| **Rest-Aufgaben aus Bahn 2** | 3 | B1 eingeloggte Sicht, C1 Connector-Neuverbindung, PAY-19 Live-Stripe-Probe |

**Kein einziger Test dieser beiden Bahnen hat einen Abbruchpunkt ausgeloest.** Die
Live-Anrufe der Stufe D sind damit weiterhin freigegeben - vorbehaltlich der Regeln dort.

---

## 6. KORREKTUR (2026-07-27, spaeter am Tag): der Owner-Tenant ist NICHT `de`

**Der Eintrag in Abschnitt 3 ("PROTOKOLL Sprach-Achse") ist falsch** und wird hiermit
zurueckgezogen. Er schloss aus einem deutschen Datumsformat in `list_calls`, der
Owner-Tenant sei "EXPLIZIT auf `de` gesetzt" und "der Flip laesst den Bestand unberuehrt".
Beides trifft nicht zu.

**Zwei unabhaengige Live-Messungen ueber den MCP-Connector, beide heute:**

| Signal | frueherer Eintrag | jetzt gemessen |
| --- | --- | --- |
| `list_calls`, Datum desselben Anrufs | `Mo., 27.07., 07:17` (deutsch) | **`Mon 27/07, 07:17`** (englisch) |
| `get_agent_status`, Permission-Feldnamen | (nicht gemessen) | **`PersonalData`, `BankData`** - die EN-Labels aus `src/i18n/mcp-texts.js:70-74` |

Beide Renderings stammen aus derselben Quelle (`tenantLanguage` ->
`resolveCallLanguage`, `src/store/state-ops.js:659-663`). Waere der Tenant explizit `de`,
koennte **keine** Cache- oder Sitzungsfrage daraus Englisch machen.

**Die Kette, die das erklaert.** `resolveCallLanguage` ist
`settings.language || numberRecord.language || tenant.defaultLanguage || DEFAULT_LANGUAGE`.
Der Owner-Tenant traegt auf allen drei ersten Stufen `null` (Bestandsdaten von vor F1/A1) -
also entscheidet `DEFAULT_LANGUAGE`, und genau die haengt seit P10 am geflippten Schalter
(`src/store/defaults.js:356-362`). Lokal reproduziert:

```
WORLD_DEFAULT_LANGUAGE_ENABLED=false -> resolveCallLanguage = de
WORLD_DEFAULT_LANGUAGE_ENABLED=true  -> resolveCallLanguage = en
```

Die frueher notierte Beobachtung ("bemerkenswert: die DID ist eine US-Nummer `+1 706`;
waere die Sprache aus der Nummer abgeleitet, stuende jetzt Englisch da") war der richtige
Hinweis - nur die Schlussfolgerung war umgekehrt. `languageForCountry("US")` steht **nicht**
in `LANGUAGE_FOR_COUNTRY` und faellt deshalb auf genau diesen Weltdefault.

**Warum die erste Messung deutsch aussah:** der geloggte Anruf lief um **07:17 UTC**, der
Flip ging um **07:24 UTC** live. Die MCP-Sitzung, die ihn rendert, bindet ihre Sprache
EINMAL bei der Registrierung (`registerTools`, `src/mcp-tools.js:63`) - die damalige
Verbindung hielt also noch den Vor-Flip-Zustand. Genau das Cache-Artefakt, das dieselbe
Checkliste unter C1 fuer die Tool-Beschreibungen bereits vermutet hatte; es betrifft auch
die Sprache.

### 6.1 Was daraus fuer den Betrieb folgt

**Der Live-Agent spricht ab dem naechsten Anruf Englisch.** Konkret, fuer einen Anruf an
das deutsche Mobiltelefon, mit dem alle 26 bisherigen Testanrufe gefuehrt wurden:

- der **Offenlegungssatz** - der fest verdrahtete erste Satz jedes Outbound-Calls - kommt
  auf Englisch,
- **STT und TTS** laufen auf `en-GB`, waehrend der Gegenueber Deutsch spricht,
- Zusammenfassungen und Dashboard-Texte folgen ebenfalls `en`.

**Noch ist nichts passiert:** der letzte Anruf (27/07, 07:17 UTC) liegt VOR dem Flip
(07:24 UTC). Es hat also seit der Umstellung kein echtes Gespraech gegeben - der Befund ist
eine Konfigurationslage, kein eingetretener Schaden.

### 6.2 Was daraus fuer die offenen Live-Tests folgt

| Test | Auswirkung |
| --- | --- |
| **PROMPT-23** (EN-Anruf auf Deutsch-Drift abhoeren) | **Vorbedingung ist unbeabsichtigt bereits erfuellt** - der Tenant loest auf `en` auf. Der Test ist ohne weitere Vorbereitung fahrbar. |
| **LANG-25** (hoert ein US-Empfaenger zuerst Deutsch?) | **Fragestellung ueberholt.** Der Offenlegungssatz ist jetzt englisch; die im Katalog befuerchtete Lage (Deutsch an US-Ziel) kann in dieser Konfiguration gar nicht mehr eintreten. |
| **VOICE-27/28** (klingt EN britisch? STT-Guete) | unveraendert an PROMPT-23 haengend, jetzt aber am echten Zustand statt an einer herbeigefuehrten Sonderlage. |
| **MCP-20, OUT-26** | unveraendert. |

### 6.3 Offene Entscheidung

Der Zustand ist **nicht falsch, sondern ungewollt entstanden**: die Owner-Entscheidung 7.12
("`en` als Weltdefault") zielte auf Laender OHNE eigenes Bundle - nicht darauf, den
deutschsprachigen Betreiber-Tenant mit deutschen Gespraechspartnern auf Englisch zu stellen.
Dass es ihn trotzdem trifft, liegt allein an der **US-DID** und an drei `null`-Feldern.

Drei Wege, alle ohne Deploy:
1. **Tenant explizit auf `de` setzen** (`settings.language="de"`) - der Weltdefault bleibt
   fuer alle anderen an. Praeziseste Loesung, aendert nichts an der Produktrichtung.
2. **`WORLD_DEFAULT_LANGUAGE_ENABLED=false`** - nimmt 7.12 zurueck, trifft alle.
3. **So lassen** - dann sind PROMPT-23 und die Sprachtests am echten Zustand fahrbar, aber
   jeder Anruf an einen deutschen Gespraechspartner laeuft auf Englisch.

**Bis diese Entscheidung faellt, wird kein Live-Anruf gefahren** - er wuerde sonst einen
Zustand messen, der danach womoeglich nicht mehr gilt, und dabei echtes Geld kosten.

---

## 7. PROTOKOLL Stufe D - Live-Anrufe (2026-07-27)

**Freigabe:** Owner, ausdruecklich, "erst einen Anruf, dann berichten". Ziel
`+49 173 725 2163` (die Nummer aller 26 vorherigen Testanrufe, im eigenen Besitz).
`OUTBOUND_FROZEN` aus, `FAKE_ORIGINATE` aus, Absender `+1 706 710 1188` (US-DID).

**Es blieb bei EINEM Anruf** - die drei uebrigen Live-Tests brauchen keinen eigenen, jeder
aus einem anderen Grund (s. 7.2-7.4).

### 7.1 PROMPT-23 - BESTANDEN (der wichtigste Test der Welle)

| | |
| --- | --- |
| Call-ID | `call_ms35d4vfqfad` |
| Dauer | **76 s**, Status `completed`, `diagnostic: true` (Rohtranskript gesichert) |
| Sprachlage | Tenant loeste ueber den Weltdefault auf **`en`** auf (s. Abschnitt 6) - die Vorbedingung "Tenant mit `settings.language="en"`" war damit ohne Vorbereitung erfuellt |
| Ergebnis | **KEIN Deutsch-Drift.** Ueber sechs Turns durchgehend Englisch, inklusive dreier Rueckfragen bei unklarer Antwort. |
| `objective_achieved` | `unclear` - nicht wegen der Sprache, sondern weil die Rueckfrage nach dem Terminvorlauf dreimal nur mit "Yes" beantwortet wurde (s. VOICE-28) |

**Damit ist die zentrale Frage der 15 Fix-Phasen beantwortet:** die gesprochene Sprache ist
wirklich umgestellt, sie kippt auch ueber mehrere Turns nicht zurueck ins Deutsche.

### 7.2 VOICE-27 - gemessen, aber die Katalogfrage ist falsch gestellt

Der Katalog fragt: "klingt der EN-Outbound hoerbar **britisch statt US-amerikanisch**?"
Owner-Hoereindruck am echten Anruf: **weder noch - es klingt deutsch.** Englische Saetze,
gesprochen mit eindeutig deutschem Akzent.

**Ursache, im Code belegt:** die ElevenLabs-Stimme ist **eine einzige globale ID**
(`ELEVENLABS_VOICE_ID`, `src/config.js:260`), die der Renderer sprachblind in jedes `<Say>`
schreibt. `synthToServeUrl` (`src/tts/directive-synth.js:45-55`) bekommt die Sprache nicht
einmal als Parameter - es gibt dort keine Verzweigung, die es geben koennte. Das Modell ist
`eleven_flash_v2_5` (`src/config.js:261`), also **multilingual**: es spricht andere Sprachen,
behaelt aber den Akzent der STIMME.

**Nicht verwechseln:** `en-GB` regiert nur die **Erkennung** (`<Gather language="en-GB">`),
nicht die Stimme. Die beiden Achsen sind getrennt, und nur eine loest pro Sprache auf.

**VOICE-27 ist damit gegenstandslos in seiner heutigen Formulierung** - eine Wahl zwischen
britisch und amerikanisch setzt eine englische Stimme voraus, die es nicht gibt. Der
Sachverhalt gehoert vollstaendig zu **VOICE-12**.

### 7.3 VOICE-12 - vom Quelltext-Befund zum LIVE gehoerten Defekt

VOICE-12 steht seit W2 als roter Launch-Gate im Katalog
(`test/telnyx-elevenlabs-render.test.js:80`, Sollzustand aus Owner-Entscheidung 7.5:
"TTS-Stimme loest regional auf"). Bisher war er **allein aus dem Quelltext hergeleitet**.
Mit diesem Anruf ist er **empirisch bestaetigt**: ein Mensch hat den Defekt gehoert.

Der Gate-Test ist bewusst am gerenderten Ergebnis formuliert, nicht an einer Signatur - ein
Fix darf die Stimme aus dem Locale-Bundle, einer Env-Tabelle oder vom Tenant ziehen.

### 7.4 MCP-20 - GESCHLOSSEN, ohne eigenen Anruf

Der Katalog sagt vorher: "JEDE Zeile der Gegenseite traegt das Praefix `"Gegenseite:"`,
unabhaengig vom EN-Tenant", und verlangt als Beleg genau das, was hier ohnehin passiert ist -
ein `place_call` aus claude.ai mit Beobachtung der Live-Karte.

**Gemessen am selben Anruf:** die Zeilen kamen als **`"Other party: ..."`** und
**`"Agent: ..."`** herein - die EN-Varianten aus `src/i18n/mcp-texts.js:69`. Der Code fuehrt
das Praefix je Sprache (`de` "Gegenseite" / `en` "Other party" / `fr` "Interlocuteur",
konsumiert in `src/mcp-tools.js:131`).

**Der vorhergesagte Defekt tritt nicht ein.** Und es ist genau der End-to-End-Beweis, den
MCP-20 forderte: echter Gateway, echtes Netz, echte Karte, kein Mock.

### 7.5 LANG-25 - entfaellt (gegenstandslos)

Die Frage lautet "hoert ein US-Empfaenger bei Outbound zuerst **Deutsch**?". In der
aktuellen Konfiguration ist der Offenlegungssatz **englisch** (s. Abschnitt 6) - die
befuerchtete Lage kann nicht mehr eintreten. Kein Anruf, keine Kosten.

### 7.6 OUT-26 - NICHT FAHRBAR (Vorbedingung existiert nicht)

OUT-26 verlangt **DE-Origin nach US-Ziel**. Es gibt keine DE-DID: beide vorhandenen Nummern
sind US-Nummern (`+1 706 710 1188` am MCP-Tenant, `+1 864 302 8341` am Bootstrap-Tenant
`owner`, s. Abschnitt 8). Ein `+49`-Anschluss haengt an einer offenen
Regulatory-Freigabe bei Telnyx. **Geparkt, bis eine DE-DID existiert** - das ist keine
Test-, sondern eine Beschaffungsfrage.

### 7.7 Nebenbefund: die als intermittent bekannte Richtung hat zugestellt

Der Anruf lief **US-DID -> DE-Mobil** - genau die Richtung, die als unzuverlaessig
dokumentiert ist (Session-Memory `telnyx-fresh-did-no-de-routing`). Er kam zustande und
lief 76 s sauber durch. Ein einzelner Datenpunkt widerlegt keine Intermittenz, aber er
gehoert ins Protokoll.

### 7.8 Stufe D - Bilanz

| Test | Ergebnis | Anrufe |
| --- | --- | --- |
| **PROMPT-23** | **BESTANDEN** - kein Deutsch-Drift ueber 6 Turns | 1 |
| **MCP-20** | **GESCHLOSSEN** - Praefix folgt der Tenant-Sprache, live bewiesen | 0 (am selben Anruf) |
| **VOICE-28** | **BEFUND** - STT unter `en-GB` verstuemmelt deutsch akzentuiertes Englisch | 0 (am selben Anruf) |
| **VOICE-27** | **gegenstandslos** - geht in VOICE-12 auf | 0 |
| **VOICE-12** | **live bestaetigt** (war nur Quelltext-Befund) | 0 (am selben Anruf) |
| **LANG-25** | **entfaellt** - Offenlegung ist englisch | 0 |
| **OUT-26** | **geparkt** - keine DE-DID vorhanden | 0 |

**Gesamtkosten der Stufe: ein Anruf von 76 Sekunden.** Geplant waren vier.

### 7.9 DE-Gegenprobe - die Dashboard-Einstellung wirkt SOFORT

Nachdem der Owner im Dashboard (`/app` -> Settings -> Language -> German)
`settings.language="de"` gesetzt hatte, zweiter Anruf an dieselbe Nummer.

| | |
| --- | --- |
| Call-ID | `call_ms35q1u5livq` |
| Dauer | **100 s**, Status `completed`, `diagnostic: true` |
| Ergebnis | **Durchgehend Deutsch, ab dem ersten Satz.** Kein Neustart, kein Deploy, keine Wartezeit. |
| `objective_achieved` | `true` |

**Drei unabhaengige Belege aus demselben Vorgang:**

1. **Vor** dem Waehlen meldete `get_agent_status` wieder `PersoenlicheDaten` / `Bankdaten`
   statt der EN-Labels - die Aenderung war bereits wirksam, bevor ein Anruf lief.
2. Im Gespraech sprach der Agent durchgehend Deutsch, inklusive Rueckfragen.
3. Das Transkript-Praefix kam als **`Gegenseite:`** herein; im EN-Anruf davor war es
   **`Other party:`**.

**Damit ist die Sprachachse in BEIDEN Polaritaeten live bewiesen** - nicht nur "Englisch
funktioniert", sondern "die Achse folgt der Einstellung, in beide Richtungen, sofort".

**Nebenbefund zur MCP-Bindung:** derselbe Connector, dieselbe Sitzung lieferte erst EN-,
dann DE-Labels. Die Sprache wird also **pro Anfrage** aufgeloest, nicht einmal je
Registrierung. Das **schwaecht die Cache-These aus Abschnitt 6**: die deutsche
Vormittagsmessung erklaert sich eher damit, dass sie VOR dem Wirksamwerden des Flips
erhoben und erst spaeter niedergeschrieben wurde. An der Kern-Korrektur (der Tenant war
NICHT explizit `de`) aendert das nichts - sie ist durch den Flip-Effekt selbst bewiesen.

**Nebenbefund STT:** die deutsche Erkennung war hoerbar besser als die englische im Anruf
davor - konsistent mit VOICE-28 (`en-GB` kaempft mit deutschem Akzent).

### 7.10 Zwei offene Beobachtungen aus dem DE-Anruf

**B3 - die Zusammenfassung nennt eine Uhrzeit, die im mitgelesenen Transkript nicht fiel.**
`result_summary`: *"Ein Termin wurde fuer Samstag um 10:00 Uhr gebucht."* In den
mitgelesenen Zeilen sagte die Gegenseite **"Um siebzehn Uhr"**. Der Anruf lief danach noch
rund 35 s weiter - eine Korrektur in den unbeobachteten Turns ist moeglich und ungeprueft.
`get_transcript` liefert bewusst nur die Zusammenfassung; das Rohtranskript liegt im
Diagnose-Speicher (`diagnostic: true`). **Zu klaeren, bevor daraus ein Befund wird.** Faellt
die Uhrzeit im Rohtranskript nirgends, erfindet die Zusammenfassung Termindaten - das waere
ein P0 der Gespraechsqualitaet, kein i18n-Thema.

**B4 - die Zusammenfassung behauptet eine Buchung, die untersagt war.** `constraints`
lauteten woertlich "Nichts zusagen und nichts verbindlich buchen"; die Zusammenfassung sagt
"Ein Termin wurde gebucht". Der Agent hat im beobachteten Teil nur erfragt, nicht zugesagt -
der Fehler liegt also vermutlich in der Zusammenfassung, nicht im Gespraech. Gleiche
Klaerung wie B3.

### 7.11 Kostenachse - die zwei Testanrufe haben den Tenant-Deckel fast erschoepft

| Zeitpunkt | `costEur` | Delta |
| --- | --- | --- |
| vor den Tests | 3,94 | - |
| nach PROMPT-23 (76 s) | 6,94 | **+3,00** |
| nach der DE-Gegenprobe (100 s) | 12,97 | **+6,03** |

**12,97 von 15,00 EUR Tenant-Deckel.** Zwei weitere Anrufe und der Budget-Guard friert
Outbound ein.

Die Zahlen passen exakt auf eine **vorlaeufige Buchung zum Worst-Case-Satz**
(100 s -> 2 angefangene Minuten x 300 ct/min = 6,00 EUR). Die gemessenen ECHTEN Kosten
liegen bei rund 5,4 ct/min, also ~9 ct fuer diesen Anruf - Faktor ~65 darueber. Der
stuendliche Cost-Truing-Sweep sollte das nach unten korrigieren
(Session-Memory `kosten-endspiel-live-verified`). **Noch nicht gegengeprueft** - erst nach
dem naechsten Sweep entscheidbar, ob das erwartete Verhalten ist oder ein Befund.

---

## 8. W3-Reste abgeschlossen (2026-07-27)

### 8.1 NEUER BEFUND B5 - `diagnostic: true` ist ein stiller Blindgaenger

**Beide Testanrufe wurden mit `diagnostic: true` gefahren, und bei BEIDEN ist das
Roh-Transkript trotzdem weg.** Beleg: `get_call_status` liefert nach `completed` fuer
`call_ms35d4vfqfad` UND `call_ms35q1u5livq` ein **leeres** `last_transcript_lines` -
waehrend des Gespraechs waren die Zeilen da.

Die Regel steht in `src/diagnostic-retention.js:28-32`; lokal durchgespielt:

```
true  <- private Nummer gesetzt und gleich dem Ziel
false <- private Nummer NICHT gesetzt
false <- private Nummer gesetzt, aber anderes Ziel
false <- Frist auf 0 gedreht
```

Die Aufbewahrung wird also nur gewaehrt, wenn das Ziel **exakt der verifizierten privaten
Nummer des Tenants** entspricht (`store.tenantPrivateNumber`). Ist sie nicht gesetzt -
oder steht `DIAGNOSTIC_RETENTION_DAYS` auf 0 - wird der Wunsch **wortlos verworfen**.

**Das eigentliche Problem ist nicht die Regel, sondern das Schweigen.** `diagnostic` ist im
MCP-Schema ein reines EINGABE-Feld (`src/mcp-tools.js:508`); **kein Ausgabefeld irgendeiner
Antwort meldet, ob es gewaehrt wurde**. Die Tool-Beschreibung verspricht woertlich "Keeps
the raw transcript for a limited period". Der Aufrufer erfaehrt das Gegenteil erst, wenn er
die Forensik braucht - und dann ist sie weg.

**Direkte Folge in dieser Sitzung:** B3 (Abschnitt 7.10) ist **nicht mehr aufklaerbar**. Ob
die Zusammenfassung "10:00 Uhr" erfunden hat oder ob die Uhrzeit in den unbeobachteten
Turns wirklich fiel, laesst sich an keinen Daten mehr entscheiden - nur noch an der
Erinnerung des Owners.

**Zu klaeren (eine Frage an den Owner):** ist im Dashboard eine private Nummer hinterlegt?
Wenn ja, war `DIAGNOSTIC_RETENTION_DAYS=0` die Ursache; wenn nein, war es die fehlende
Nummer. Fuer den Befund selbst - der stille Blindgaenger - ist die Antwort egal.

**Einordnung:** kein i18n-Thema. Gehoert zur Gespraechsqualitaets-/Forensik-Achse und
verschaerft eine bereits bekannte Lehre (`umlaut-transliteration-root-cause`:
"Roh-Transkript nach Summary geloescht = keine Call-Forensik").

### 8.2 PAY-19 - LIVE BESTAETIGT, und schaerfer als der Katalog vermutete

Probe gegen Stripe **TEST** (Key-Praefix vor dem Lauf geprueft, Abbruch bei Live-Key),
`placeHold` (`src/billing/stripe.js:148-156`) 1:1 repliziert, 3DS-Pflicht ueber das
dokumentierte Test-Token `pm_card_authenticationRequired` - **keine Karteneingabe, kein
Echtgeld**. Testkunde nach dem Lauf geloescht.

| Feld | Wert |
| --- | --- |
| HTTP | **402** |
| `error.code` / `decline_code` | **`authentication_required`** |
| `payment_intent.status` | **`requires_payment_method`** |
| `next_action` | **nicht vorhanden** |
| `message` | "Your card was declined. This transaction requires authentication." |

**Der Katalog erwartet einen `requires_action`-Fehler. Das trifft nicht zu** - Stripe
liefert `requires_payment_method` mit dem Code `authentication_required`, und vor allem:
**es gibt gar kein `next_action`**. Damit ist der Befund staerker als formuliert. Nicht nur
fehlt dem Code ein Redirect-/Retry-Zweig (`grep -rniE "requires_action|next_action|3ds"
src/billing/` -> 0 Treffer); es gibt in dieser Antwort **nichts, wohin man umleiten
koennte**. Eine Erholung muesste eine NEUE on-session-Bestaetigung durch den Kunden sein,
kein Redirect.

`assertOk` wirft bei 402 -> der Call gilt als fehlgeschlagen, der Kunde bekommt nie die
Gelegenheit zur Authentifizierung. **PAY-19 bestaetigt, Live-Teil erledigt.**

### 8.3 Verbleibende W3-Reste

| Rest | Stand |
| --- | --- |
| **B1/B2 (eingeloggtes Dashboard)** | **faktisch erledigt** - der Owner hat sich eingeloggt und die Sprache auf German umgestellt (s. 7.9). Damit ist belegt: das Dashboard ist erreichbar, es traegt ein bedienbares Sprach-Dropdown (PROMPT-05) und die Aenderung wirkt. Ein Screenshot fehlt, die Aussage nicht. |
| **C1 (Connector)** | erledigt (s. 5.2, MCP-17) - die Tool-Beschreibungen kommen englisch. |
| **OUT-26** | geparkt - keine DE-DID (s. 7.6). Beschaffungsfrage. |
| **B3/B4** | **nicht mehr aufklaerbar** (s. 8.1). Als offene Beobachtung an die Gespraechsqualitaets-Achse uebergeben. |

**W3 ist damit abgeschlossen** - bis auf OUT-26, das an einer Nummer haengt, die es noch
nicht gibt.
