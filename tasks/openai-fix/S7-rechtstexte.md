# Schnitt S7: Rechtstexte und Datenschutz-Abgleich

**Zweck:** die Entscheidungsgrundlage fuer Etappe 9 aus `PLAN-OPENAI.md` (Blocker P0-3, P0-9,
angrenzend P1-39; Anforderungs-IDs O-6, O-7). Dieses Dokument ERMITTELT - es baut nichts. Die
Umsetzung steht in `tasks/openai-e9-spec.md`.

**Zielstand der Ermittlung:** `master` @ `b901f4a`. Jede Aussage unten ist an diesem Stand am Code
belegt (`datei:zeile`) oder ausdruecklich als UNKNOWN / OWNER-EINGABE markiert.

**Grenze dieser Ermittlung, ausdruecklich:** sie ist KEINE Rechtsberatung. Sie stellt fest, welche
Daten der Code an welchen Empfaenger schickt. Ob die daraus folgende Formulierung rechtlich
genuegt - und welche Vertragsgrundlage (AVV, Standardvertragsklauseln, Angemessenheitsbeschluss)
je Anbieter gilt - entscheidet der Owner, bei Bedarf mit anwaltlicher Pruefung. Der heutige Text
sagt das selbst (`apps/web/src/data/legal/privacy.de.json:62`), und dieser Satz bleibt stehen.

---

## 1. Der Live-Wert, der diesen Schnitt entsperrt

**Owner-Angabe 2026-09-20: `LLM_PROVIDER` = `deepseek`.**

Das ist die fehlende Haelfte von F-h (`PLAN-OPENAI.md`, Offene Feststellungsaufgaben) und der
Grund, warum E9 geparkt war. Folge:

| Quelle | Wert | Status |
|---|---|---|
| Owner, 2026-09-20 | `deepseek` | **massgeblich** |
| `render.yaml:384-385` | `anthropic` | VERALTET - Blueprint ist Referenz, nicht Wahrheit (`render.yaml:13-16`: der Dienst ist dashboard-managed) |
| `src/llm/provider.js:7` | `anthropic` (Default) | nur Env-Fallback, kein Live-Beleg |
| `apps/web/src/data/legal/privacy.de.json:38` | "Sprachmodell: Anthropic ..." | **FALSCH** gegenueber dem Live-Zustand |

Damit ist der Auftragsverarbeiter fuer alles, was unser eigener LLM-Seam macht -
Gespraechszusammenfassung (`src/claude.js:1440`), Pre-Call-Briefing (`src/precall-briefing.js:27`),
Eroeffnungszeile (`src/elevenlabs/opening-line-llm.js:15`) - **DeepSeek**
(`src/llm/adapters/deepseek.js:28`, Endpunkt `https://api.deepseek.com/chat/completions`), nicht
Anthropic. Eine Datenschutzerklaerung mit falschem Auftragsverarbeiter ist schlechter als keine:
sie ist eine belegbare Falschauskunft gegenueber jedem Betroffenen.

**Was dieser Wert NICHT aussagt:** er sagt nichts ueber das Modell, das IM Gespraech spricht. Das
laeuft seit dem ElevenLabs-Cutover beim Anbieter (Abschnitt 2, Zeile EL), und der Live-Wert der
Anbieter-Konfiguration ist `claude-sonnet-5` (Vorlagen-SOLL,
`elevenlabs/agent_configs/outbound-agent.template.json:782`). Beides ist gleichzeitig wahr -
zwei verschiedene Sprachmodell-Strecken. Genau das macht den heutigen Text unrettbar: er kennt
nur eine.

---

## 2. Auftragsverarbeiter / Empfaenger - am Code ermittelt

Aufgenommen ist, was der Code tatsaechlich anspricht. Die Spalte "im Text?" prueft gegen
`apps/web/src/data/legal/privacy.de.json` (Stand `b901f4a`).

| # | Empfaenger | Wofuer | Datenart, die hinausgeht | Codebeleg | im Text? |
|---|---|---|---|---|---|
| E1 | **Telnyx** | Rufnummer, Anrufauf-/abbau, SIP-Transport, SMS-Zusammenfassung | Rufnummern beider Seiten, Gespraechsaudio, Verbindungsdaten, SMS-Inhalt | `src/config.js:683`, `src/telephony/adapters/telnyx/*`, `src/sms-summary.js:25-30` | ja, korrekt |
| E2 | **Telnyx-STT (Deepgram-Modelle)** | Spracherkennung auf dem Telnyx-Weg (Budget-Engine / Rueckfall) | Gespraechsaudio -> Wortprotokoll | `src/telephony/adapters/telnyx/stt-model.js:22` (`Deepgram` / `deepgram/nova-3`), gerendert `src/telephony/adapters/telnyx/render.js:125` | ja, korrekt |
| E3 | **ElevenLabs (Agents Platform)** | **fuehrt das Gespraech**: Spracherkennung, Gespraechsmodell, Stimme - ein- und ausgehend | Gespraechsaudio BEIDER Seiten, Wortprotokoll, Auftrag, Hintergrund/Briefing, Name des Auftraggebers, Rufnummer der Gegenstelle, Zeitzonen | SIP-Uebergabe `src/elevenlabs/inbound-sip-uri.js:10`; Anrufstart + Variablen `src/elevenlabs/outbound.js:936-983`; Anbieter-Basis `src/config.js:506` | **NEIN - Text sagt "Sprachsynthese ... kein Audio der Gespraechspartner"** (`privacy.de.json:38`) |
| E4 | **Anthropic als Unterauftragsverarbeiter von ElevenLabs** | das Modell, das im Gespraech antwortet | Wortprotokoll des laufenden Gespraechs + Auftragsdaten (als Prompt des Anbieter-Agenten) | `elevenlabs/agent_configs/outbound-agent.template.json:782` (`"llm": "claude-sonnet-5"`) | nein (Text nennt Anthropic, aber als DIREKTEN Anbieter der falschen Strecke) |
| E5 | **DeepSeek** | eigener LLM-Seam: Zusammenfassung, Briefing, Eroeffnungszeile, Rueckfall-Gespraechsfuehrung | Wortprotokoll, Gespraechsauftrag, Namen, Sprache | `src/llm/adapters/deepseek.js:28`; Verbraucher `src/claude.js:1440`, `src/precall-briefing.js:27`, `src/elevenlabs/opening-line-llm.js:15` | **NEIN - 0 Treffer** |
| E6 | **Anthropic (direkt)** | derselbe Seam, wenn `LLM_PROVIDER`/`LLM_PROVIDER_FALLBACK` auf `anthropic` steht; ausserdem die Vorab-Recherche (serverseitige Websuche INNERHALB des Modellaufrufs) | wie E5; bei Recherche zusaetzlich der Suchbegriff aus dem Auftrag | `src/llm/adapters/anthropic.js:35`; `src/research/adapters/anthropic-web-search.js:11-22`; Wahl `src/config.js:514-527` | ja, aber der falschen Strecke zugeordnet |
| E7 | **Exa** | Nachschlagen IM Gespraech (`look_up`) | die im Gespraech entstandene Suchfrage - also **fremde Rede** | `src/research/adapters/exa-search.js:36-40`, `src/config.js:663-666`; Torkette `src/research/registry.js:30-34` | **NEIN - 0 Treffer**; Text behauptet sogar "nicht aktiv" (`privacy.de.json:38`) |
| E8 | **WorkOS** | Anmeldung, Konto-/Session-Verwaltung, Konto-Loeschung | E-Mail, Anmeldekennung (`sub`), Anmeldezeitpunkte | `src/config.js:2074`, `src/web-auth.js:405-406`, `src/workos-management.js:13` | ja, korrekt |
| E9 | **Stripe** | Abo, Zahlungsmittel, Metering | Zahlungsmittel, E-Mail, Betraege, gemeldete Minuten | `src/config.js:918`, `src/billing/stripe.js:198` | ja, korrekt |
| E10 | **Render** | Hosting von Anwendung UND Postgres, Server-Protokolle; zusaetzlich Konfig-Lesezugriff ueber die Render-API | alle gespeicherten Daten + Zugriffsprotokolle | `render.yaml:6-11` (Region `frankfurt`), `src/render-api.js:25` | ja, korrekt |
| E11 | **Brevo** | Transaktions-Mails (Kuendigungsbestaetigung, Zusammenfassungen, Double-Opt-in) | E-Mail-Adresse, Betreff, Mail-Inhalt (also Gespraechsinhalt) | `src/brevo-mail.js:22-35` | ja, korrekt |
| E12 | **SMTP-Postfach (laut Text Zoho)** | Ersatzweg fuer denselben Mailversand | wie E11 | `src/smtp-mail.js:33`, `src/config.js:2116` (`SMTP_HOST`, env-gesetzt) | ja - der ANBIETERNAME ist am Code aber NICHT belegbar (OWNER-EINGABE) |
| E13 | **MCP-Host (heute Claude, nach der Einreichung ChatGPT)** | die Assistenten-Anbindung, ueber die der Nutzer Hermes steuert | **die letzten Transkriptzeilen beider Seiten**, Ergebniskarte/Zusammenfassung, Rueckfragen aus fremder Rede | `src/mcp-tools.js:169-172` (`last_transcript_lines`), Rueckfrage-Kette `src/config.js:1663-1674` | **NEIN - 0 Treffer** ("MCP", "ChatGPT", "Claude", "Connector" kommen im gesamten Rechtstext-Content nicht vor) |

**Nicht aufgenommen, mit Grund:**

- **MaxMind/GeoLite2** - kein Empfaenger: der Adapter liest eine LOKALE `.mmdb`-Datei, es entsteht
  kein Egress (`src/config.js:1757-1763`). Der heutige Text zaehlt "Laenderermittlung aus der
  IP-Adresse" unter den abgeschalteten Fremd-Anbindungen; das ist in der Sache irrefuehrend, weil
  es nie ein Dritter war.
- **Microsoft/Azure-Stimmen** - im heutigen Text als Telnyx-Unterauftragsverarbeiter genannt. Am
  Code nicht mehr belegbar als aktive Strecke: die Stimme kommt auf beiden gebauten Wegen von
  ElevenLabs (`src/telephony/adapters/telnyx/elevenlabs-voice.js`, `src/config.js:506`). Kein
  Loeschgrund aus dem Code, aber ein Pruefpunkt (OWNER-EINGABE).

---

## 3. Was der heutige Text FALSCH sagt

Jeder Punkt ist eine Aussage, die dem Code widerspricht - nicht eine, die nur unvollstaendig ist.

| ID | Falschaussage | Fundstelle | Code-Gegenbeleg |
|---|---|---|---|
| F1 | "Sprachmodell: Anthropic ... Das Modell fuehrt das Gespraech, erstellt die Zusammenfassung" | `privacy.de.json:38` | Live `LLM_PROVIDER=deepseek` (Owner 2026-09-20) -> Zusammenfassung geht an `api.deepseek.com` (`src/llm/adapters/deepseek.js:28`); das Gespraech fuehrt der Anbieter-Agent (`outbound-agent.template.json:782`) |
| F2 | "Sprachsynthese: Eleven Labs ... Daten: der gesprochene Text des Assistenten ...; **kein Audio der Gespraechspartner**" | `privacy.de.json:38` | Das Gespraech laeuft per SIP gegen `sip.rtc.elevenlabs.io` (`src/elevenlabs/inbound-sip-uri.js:10`) - der Anbieter bekommt das Audio BEIDER Seiten und erkennt es selbst |
| F3 | "Weitere im System angelegte, derzeit abgeschaltete Anbindungen (Websuche ..., alternative Sprachmodelle ...) sind **nicht aktiv**" | `privacy.de.json:38` | Das "alternative Sprachmodell" ist der LIVE-Anbieter. Fuer die Websuche ist der Live-Schalterstand UNKNOWN (F-h, Rest) - die Behauptung ist damit ungedeckt, unabhaengig vom Ausgang |
| F5 | Speicherdauer: "Das Wortprotokoll ... wird geloescht, sobald die Zusammenfassung erstellt ist" | `privacy.de.json:50` | Gilt fuer UNSEREN Store. Beim Anbieter steht `retention_days` laut Besitz-Ausnahme live auf **-1 (unbegrenzt)** (`outbound-agent.template.json:314`) - der Text nennt keine Aufbewahrung beim Anbieter, obwohl dort das vollstaendige Gespraech liegt. **M-2 gemessen 20.09.2026** (GET am Live-Agenten + `npm run elevenlabs:drift`, rein lesend): `retention_days = -1`, vom Drift-Lauf als Abweichung gegen die Vorlage `0` gemeldet - deckt sich mit der Besitz-Ausnahme. Der Live-Wert `-1` ist damit der konkrete Beleg dafuer, dass die fehlende Anbieter-Aufbewahrungsfrist im Text irrefuehrend ist |
| F6 | "eine **vollstaendige Loeschung** deiner Anruf- und Kontodaten fuehren wir auf Anfrage durch" | `privacy.de.json:54` | `eraseTenantData` loescht Calls, Transkripte, Action Items, call-verknuepfte Notifications und die private Nummer; **Settings, Profile, aktive Nummern, Kalender, Usage bleiben** (`src/store/state-ops.js:534-543`, `scripts/erase-tenant.js:2-7`). Die Konto-Identitaet bei WorkOS und die Gespraeche beim Sprach-Anbieter erfasst sie gar nicht |
| F7 | Die Empfaengerliste ist "aus der tatsaechlichen Anbindung im System abgeleitet ... (Stand August 2026)" | `privacy.de.json:6`, `:38` | Der Stand ist durch den ElevenLabs-Cutover (Inbound fuer alle DIDs seit 2026-09-18) und den Anbieter-Flip ueberholt |

**Vormals F4 entfaellt (gemessen, keine Falschaussage):** "Nach Codestand werden keine
Tonaufzeichnungen der Gespraeche gespeichert" (`privacy.de.json:22`). **M-1 gemessen 20.09.2026**
(GET am Live-Agenten + `npm run elevenlabs:drift`, rein lesend): `record_voice = false` - deckt
sich mit der Vorlage (`outbound-agent.template.json:320-327`, SOLL `false`, seit 2026-09-15 nicht
mehr ausgenommen). Die Aussage "keine Tonaufzeichnungen" ist damit durch die Messung bestaetigt
richtig und bleibt unveraendert im Text stehen. Verbleibend sind **sechs** Falschaussagen: F1, F2,
F3, F5, F6, F7.

**Nicht falsch, aber unvollstaendig:** E5 (DeepSeek), E7 (Exa) und E13 (MCP-Host) fehlen ganz.
E13 ist fuer die OpenAI-Einreichung der heikelste: der Zweck der Einreichung ist genau diese
Anbindung, und die Datenschutzerklaerung, die im Listing verlinkt wird, erwaehnt sie nicht.

---

## 4. Was FEHLT (Platzhalter, P0-3)

19 `[OFFEN: ...]`-Marken in drei Dateien, alle inhaltlich Owner-Arbeit:

| Datei | Zeilen mit `[OFFEN` | Worum es geht |
|---|---|---|
| `apps/web/src/data/legal/imprint.de.json` | 6, 10 (2x), 14, 18, 22, 26 | Firmenname/Rechtsform, ladungsfaehige Anschrift, Vertretung, Telefonnummer nach Paragraph 5 DDG, Registereintrag, USt-IdNr. |
| `apps/web/src/data/legal/privacy.de.json` | 6, 10 (2x), 38, 42, 46 | Anschrift der verantwortlichen Stelle, Datenschutzbeauftragter ja/nein, AVV-Bestaetigung je Anbieter, DPF-Zertifizierungspruefung, Protokoll-Aufbewahrung bei Render |
| `apps/web/src/data/legal/terms.de.json` | 6, 10, 38 (3x), 74 | Firmenname/Anschrift, Widerrufs-Anschrift, Entscheidung zum vorzeitigen Leistungsbeginn, Sitz der Gesellschaft |

Der Selbst-Hinweis im Impressum ist eindeutig: "Solange die oben markierten Angaben fehlen,
erfuellt die Seite die Anbieterkennzeichnung nach Paragraph 5 DDG nicht vollstaendig"
(`imprint.de.json:38`). **Keine dieser Angaben darf erfunden werden.**

**Bestehender Test faengt sie NICHT:** `test/gap-15-legal-pages-no-placeholder-en-routes.test.js:37`
sucht nach `Platzhalter|ergaenzt der finale|liefert der Owner|liefert Sundartha` - `[OFFEN:` steht
nicht in diesem Muster. Der heutige Rot-Zustand von GAP-15 kommt aus der zweiten Assertion
(fehlende `<slug>.en.json`), nicht aus den Platzhaltern. Das Gate misst also nicht, was P0-3
behauptet.

---

## 5. Was am Bestand RICHTIG ist und bleibt

Damit die Umsetzung nicht aus Eifer Funktionierendes umschreibt:

- Die Mechanik traegt: EINE Textquelle (`apps/web/src/data/legal/*.json`), von Seiten und
  Startseiten-Rechtsblatt gleichermassen gelesen (`apps/web/src/pages/datenschutz.astro:7`),
  Pflichtfeld-Pruefung mit Build-Abbruch (`apps/web/src/lib/legal.js:40-73`), DE als verbindliche
  Fassung (`:9`), keine stillen Sprach-Rueckfaelle (`:117-119`).
- Telnyx, WorkOS, Stripe, Render, Brevo sind sachlich richtig beschrieben, inklusive
  Frankfurt-Residenz und der Aussage, dass bei uns nur Stripe-Kennungen liegen.
- Der Abschnitt "Gespraechspartner" (`privacy.de.json:34`) beschreibt die Offenlegung korrekt und
  beruehrt absolute Regel 2 - er wird NICHT angefasst.
- Cookies/lokale Speicherung (`:46`) ist code-nah und bleibt.

---

## 6. Nicht am Code entscheidbar - OWNER-EINGABE

Der Implementierer traegt hier **nichts** ein. Jede Zeile bleibt als benannte Leerstelle stehen,
bis der Owner liefert.

| ID | Leerstelle | Warum nicht am Code |
|---|---|---|
| OE-1 | Firmenname, Rechtsform, ladungsfaehige Anschrift, Vertretung, Telefonnummer, Register, USt-IdNr. | unternehmerische Tatsachen |
| OE-2 | Datenschutzbeauftragter benannt ja/nein | organisatorische Tatsache |
| OE-3 | Je Anbieter: AVV abgeschlossen? Welche Drittland-Garantie (Angemessenheitsbeschluss / Standardvertragsklauseln)? | Vertragslage, nicht Code |
| OE-4 | **DeepSeek: Vertragspartner, Sitz, Verarbeitungsort, Drittland-Garantie, Trainings-Ausschluss.** Der Code belegt nur den Endpunkt `api.deepseek.com` | Vertragslage; hier ist die Luecke am groessten, weil der Anbieter neu im Text ist |
| OE-5 | Ob der SMTP-Ersatzweg weiterhin bei Zoho liegt (`SMTP_HOST` ist env-gesetzt) | Betriebs-Tatsache |
| OE-6 | Aufbewahrungsdauer der Server-Protokolle im gebuchten Render-Plan | Anbieter-Vertragsdetail |
| OE-7 | Entscheidung zum vorzeitigen Leistungsbeginn in der Widerrufsfrist | Produkt-/Rechtsentscheidung |
| OE-8 | Zustaendige Aufsichtsbehoerde, falls sie genannt werden soll | folgt aus OE-1 |
| OE-9 | Englische Fassung der Rechtstexte (`<slug>.en.json`) | Uebersetzungs-Lieferung (O13); heute existiert keine, die EN-Routen liefern 404 |

**Zwei MESSUNGEN, die kein Owner-Text ersetzt** (sie entscheiden ueber den Wortlaut, nicht ueber
Stilfragen) - **beide am 20.09.2026 gemessen, GET am Live-Agenten + `npm run elevenlabs:drift`,
rein lesend**:

| ID | Zu messen | Wie | Ergebnis / Folge fuer den Text |
|---|---|---|---|
| M-1 | `platform_settings.privacy.record_voice` am Live-Agenten | `npm run elevenlabs:drift`, GEMESSEN 20.09.2026 | `false` - deckt sich mit der Vorlage; die Zusage "keine Tonaufzeichnungen" ist bestaetigt richtig und bleibt unveraendert im Text |
| M-2 | `platform_settings.privacy.retention_days` am Live-Agenten | dito, GEMESSEN 20.09.2026 | `-1` (unbegrenzt), vom Drift-Lauf als Abweichung gegen die Vorlage `0` gemeldet, deckt sich mit der Besitz-Ausnahme vom 2026-08-15; die fehlende Aufbewahrungsfrist beim Anbieter bleibt ein zu behebender Punkt - der Text muss `-1` (unbegrenzt) als Beleg nennen |

---

## 7. Entscheidungen fuer die Umsetzung

**D1 - Empfaenger werden BEDINGUNGSLOS genannt, nicht unter Schaltervorbehalt.**
Der heutige Satz "derzeit abgeschaltet ... nicht aktiv" ist eine Tatsachenbehauptung ueber eine
dashboard-verwaltete Umgebungsvariable. Sie dreht sich ohne Codeaenderung, ohne Deploy und ohne
dass irgendjemand den Rechtstext anfasst - der Text wird in genau dem Moment still falsch, in dem
die Funktion Daten sendet. Statt dessen: Empfaenger nennen und den Zweck an die Funktion binden
("wenn die Nachschlage-Funktion fuer dein Konto aktiv ist, geht die im Gespraech entstandene Frage
an ..."). Das ist praezise statt ueberschiessend, deckt beide Schalterstaende und macht die
Veroeffentlichung von F-h unabhaengig.

**D2 - ElevenLabs wird als Gespraechs-Plattform beschrieben, nicht als Sprachsynthese.**
Der Code laesst nichts anderes zu (E3/E4). Der Anbieter bekommt das Audio beider Seiten, erkennt
es, laesst ein Sprachmodell antworten und spricht die Antwort. Das ist die eingriffsintensivste
Strecke im ganzen System und steht heute als harmlosester Punkt im Text.

**D3 - Beide eigenen Sprachmodell-Anbieter werden genannt.**
`LLM_PROVIDER` ist ein Env-Flip zwischen zwei gebauten Adaptern (`src/llm/adapters/`). Ein Text,
der nur einen nennt, ist nach jedem Flip falsch - und genau das ist heute passiert. Genannt werden
beide mit ihrem Einsatzzweck; welcher aktuell traegt, sagt der Text als datierte Angabe.

**D4 - Zusagen, die nicht gemessen sind, werden nicht behauptet.**
"Keine Tonaufzeichnungen" bleibt nur, wenn M-1 sie belegt. Ist M-1 offen, faellt die Zusage
ersatzlos aus dem Text (sie wird NICHT ins Gegenteil verkehrt - auch das waere eine ungedeckte
Behauptung). Dasselbe fuer die Aufbewahrung beim Anbieter (M-2).

**D5 - Das Loeschversprechen wird auf den Code-Umfang zurueckgeschnitten.**
Der Text beschreibt, was tatsaechlich geloescht wird, und was auf Anfrage zusaetzlich manuell
geschieht. Der FEHLENDE Loeschweg (kein Netz-Endpunkt, kein Audit-Eintrag, Anbieterseite nicht
erfasst, P1-39/P1-40) ist ein Code-Befund und gehoert als offener Punkt in `PLAN-SECURITY.md` -
nicht in die Datenschutzerklaerung als Versprechen. Dass ein Text nur zurechtgerueckt wird, waehrend
der Code die Luecke behaelt, ist eine bewusst benannte Zwischenetappe, kein Abschluss.

**D6 - Die Assistenten-Anbindung (MCP) bekommt einen eigenen Abschnitt.**
Sie ist ein Empfaenger von Gespraechsinhalt (E13) und der Gegenstand der Einreichung. Ohne sie
erfuellt die Policy O-6 nicht, und das faellt einem Reviewer sofort auf.

**D7 - Kein Wort erfundene Rechtsangabe.**
Alle `[OFFEN]`-Marken, fuer die der Owner nicht geliefert hat, bleiben unveraendert stehen. Eine
geratene Anschrift ist schlimmer als eine sichtbare Luecke: die Luecke ist ehrlich, die Angabe ist
eine Falschauskunft nach Paragraph 5 DDG.

**D8 - Die Anbieter-Nennung wird an den Code GENAEHT, nicht per Konvention gepflegt.**
Ein neuer Adapter unter `src/llm/adapters/` oder `src/research/adapters/` muss den Rechtstext rot
machen. Sonst wiederholt sich exakt der heutige Befund beim naechsten Anbieterwechsel - und
niemand merkt es, weil kein Test die Frage stellt.

---

## 8. Pre-Mortem (ein Jahr spaeter, die Entscheidung war falsch)

1. **"Der Text nennt DeepSeek, aber der Owner hatte nie einen AVV."** Dann hat die
   Veroeffentlichung die Luecke dokumentiert statt sie zu schliessen. Gegenmittel: OE-4 ist als
   Leerstelle IM TEXT sichtbar, nicht als stille Annahme; die Veroeffentlichung ist ein
   Owner-Handgriff, kein Merge.
2. **"Wir haben Empfaenger genannt, die gar nicht aktiv waren - ein Aufsichtsverfahren hat das als
   irrefuehrend gewertet."** Gegenmittel D1: die Nennung ist an die Funktion gebunden ("wenn ...
   aktiv ist"), nicht als laufende Verarbeitung behauptet.
3. **"Der Test band den Rechtstext an Adapter-Dateinamen, und ein Refactoring hat ihn rot
   gemacht, obwohl sich nichts geaendert hat."** Akzeptiert: ein rotes Gate bei Anbieter-Umbau ist
   genau die gewollte Wirkung. Der Fix ist eine Textzeile, nicht eine Abschaltung des Tests.
4. **"Die Loesch-Aussage wurde abgeschwaecht, und der Loeschweg wurde nie gebaut."** Das ist das
   echte Risiko von D5. Gegenmittel: der Eintrag in `PLAN-SECURITY.md` ist Teil der Abnahme von
   E9, nicht ein Vorsatz.
5. **"Die Messung M-1 blieb offen, die Seite ging live, und der Anbieter schnitt Audio mit."**
   Gegenmittel D4: ohne M-1 steht die Zusage nicht im Text. Was nicht behauptet wird, kann nicht
   falsch sein.

---

## 9. UNKNOWN (bleibt offen, mit Grund)

| ID | Offen | Grund |
|---|---|---|
| U-1 | Live-Werte von `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `CONSULT_ENABLED`, `IN_CALL_CONSULT_ENABLED` | dashboard-verwaltet; nur teilweise aus einem `/mcp`-Handshake ablesbar. **Durch D1 nicht mehr veroeffentlichungs-blockierend** |
| U-3 | Welches Modell der Anbieter-Agent live fuehrt | Vorlagen-SOLL ist `claude-sonnet-5`; der Live-Wert steht beim Anbieter |
| U-4 | Ob Microsoft/Azure-Stimmen noch irgendwo in der Strecke liegen | nicht am Code belegbar, Anbieter-Unterauftragsliste |
| U-5 | Ob OpenAI eine deutschsprachige Privacy-URL fuer das Listing akzeptiert | O-7 sagt nur "oeffentlich und passend"; EN-Fassung ist OE-9 |
