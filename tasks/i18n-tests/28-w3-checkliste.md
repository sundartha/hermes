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
