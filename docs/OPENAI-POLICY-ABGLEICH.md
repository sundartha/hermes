# Hermes: Abgleich mit den OpenAI Usage Policies und Plugin Guidelines, Faktenblatt Datenschutz

Stand: 2026-09-24. Sprache: nur Deutsch (eine englische Fassung gibt es bewusst nicht; wer
spaeter daraus zitiert, darf keine Einschraenkung und keinen Vorbehalt dieses Textes weglassen).

Zweck: jede einschlaegige Klausel der OpenAI Usage Policies und der OpenAI Plugin Guidelines
woertlich neben den Mechanismus stellen, den Hermes dafuer im Code hat - oder neben die Luecke,
die es gibt. Teil B ist die Faktengrundlage fuer Datenschutzerklaerung und AGB (Rechtstexte
schreibt der Betreiber, nicht dieses Dokument). Teil C listet die Luecken.

Dieses Dokument ist KEINE Attestation. Es beschreibt den Code-Stand; Produktionswerte
(Umgebungsvariablen im Hosting-Dashboard, Einstellungen bei Anbietern) sind hier nie genannt und
nie gemessen.

## Lesart

- Jede Aussage ueber Hermes nennt eine Code-Stelle `datei:zeile`. Ein Test
  (`test/openai-policy-abgleich-doku.test.js`) prueft, dass an jeder genannten Stelle der
  Anker-Text steht (Block "Anker" am Ende).
- Jedes Zitat aus einer Werkzeugbeschreibung steht in der Form `Werkzeugtext (<werkzeug>): "..."`.
  Derselbe Test prueft jedes solche Zitat gegen den ECHTEN `tools/list`-Output, ueber HTTP `/mcp`
  und ueber stdio - nie gegen ein Registrierungsobjekt.
- Status-Werte: `erfuellt` (Mechanismus steht im Code UND deckt die Klausel vollstaendig),
  `teilweise`, `Luecke`, `nicht einschlaegig` (mit Grund), `offen` (klaert nur ein Rechtstext
  oder eine Einstellung beim Anbieter bzw. im Hosting).

## Quellen

- OpenAI Usage Policies: https://openai.com/policies/usage-policies/ - Kopfzeile der Seite
  "Effective: October 29, 2025". Eine einfache HTTP-Anfrage an diese Adresse erhaelt 403; die
  Seite wurde deshalb am 2026-09-24 in einem gewoehnlichen Browser direkt von der
  Primaerquelle geladen. Die Seite leitet je nach Spracheinstellung auf eine uebersetzte
  Fassung um; zitiert wird ausschliesslich die englische Fassung unter der obigen Adresse
  (HTTP 200). Jedes Zitat aus dieser Seite wurde Zeichen fuer Zeichen, mit Gross- und
  Kleinschreibung und typografischen Apostrophen, gegen den Seitentext geprueft, ebenso der
  jeweils genannte Abschnitt ("Protect people", "Respect privacy", "Keep minors safe",
  "Empower people") und die Bereichsliste unter "automation of high-stakes decisions".
  Gegenprobe: das Wort "telemarketing" steht NICHT in den Usage Policies und wurde als fehlend
  erkannt - es stammt aus den Plugin Guidelines und ist unten auch nur dort zugeordnet.
- OpenAI Plugin Guidelines: https://developers.openai.com/plugins/app-guidelines - Seitentitel
  "Plugin guidelines"; die Seite spricht durchgehend von "plugins". Am 2026-09-24 direkt von
  der Primaerquelle abgerufen (HTTP 200). Jedes Zitat aus dieser Seite und jeder genannte
  Abschnittstitel wurde Zeichen fuer Zeichen gegen den Seitentext geprueft (mit
  Gegenprobe: ein erfundener Satz wird als fehlend erkannt).
- Werkzeugtexte: echter `tools/list` ueber HTTP `/mcp` im Legacy-Token-Modus mit Consult und
  Kalender (12 Werkzeuge) und ueber stdio (10 Werkzeuge, ohne die beiden Consult-Werkzeuge).
  Dass Werkzeugmenge und Texte im OAuth-Modus dieselben sind, belegt nicht dieses Dokument,
  sondern `docs/OPENAI-TOOL-INVENTORY.md`.
- Die Zitate sind Zeichen fuer Zeichen aus dem Abruf kopiert (typografische Apostrophe und
  Striche wie im Abruf). Vor einer Attestation muessen die Live-Seiten erneut gegengelesen
  werden: beide Seiten aendern sich.

## Uebersicht

| Klausel (Kurzname) | Status |
|---|---|
| Allgemeine Pflicht, Usage Policies einzuhalten | teilweise (Summe der Zeilen darunter) |
| Telemarketing, Spam, Betrug | teilweise |
| Drohung, Einschuechterung, Belaestigung | teilweise |
| Identitaetsanmassung (Impersonation) | teilweise |
| Stimme einer realen Person | teilweise (Rest offen: Anbieter-Einstellung) |
| Privatsphaere Dritter | teilweise |
| Beratung, die eine Zulassung erfordert | teilweise |
| Umgehung von OpenAI-Schutzmassnahmen | nicht einschlaegig |
| Politische Kampagnen, Lobbying | Luecke |
| Automatisierte Entscheidungen mit hoher Tragweite ohne menschliche Pruefung | teilweise (Teil A2) |
| Minderjaehrige, Zielgruppe 13-17 | offen (Rechtstext) |
| Datenschutzerklaerung | offen (Rechtstext; Grundlage Teil B) |
| Minimale Eingaben, kein voller Chatverlauf | teilweise |
| Grenzen: kein Rekonstruieren des Chatverlaufs | teilweise |
| Eingeschraenkte und besonders schutzwuerdige Daten | Luecke |
| Minimale Antworten | teilweise |
| Datenabfluss muss aus der Werkzeugdefinition hervorgehen | teilweise |
| Datenpraktiken, Metadaten | offen (Rechtstext) |
| Commerce: keine Abo-/Upgrade-Anzeige | teilweise |

## Teil A: Klausel -> Mechanismus

### Allgemeine Pflicht

> "Do not engage in or facilitate activities prohibited under OpenAI usage policies. Plugins must avoid high-risk behaviors that could expose users to harm, fraud, or misuse." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Usage policies")

> "Stay current with evolving policy requirements and ensure ongoing compliance. Previously approved plugins that are later found in violation may be removed." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Usage policies")

- Einschlaegig: ja, Oberbegriff fuer alle Zeilen unten.
- Mechanismus: kein eigener. Dieses Dokument ist ein Abgleich, keine Durchsetzung: es stellt
  jede Klausel neben das, was der Code tut, und benennt, was er nicht tut. Serverseitig
  durchgesetzt ist nur, was unten mit Code-Stelle als Mechanismus steht; alles andere ist
  Luecke (Teil C).
- Laufende Einhaltung: der Test zu diesem Dokument schlaegt fehl, wenn eine genannte Code-Stelle
  oder ein zitierter Werkzeugtext sich aendert. Aenderungen an den OpenAI-Seiten selbst erkennt
  er NICHT; die muessen vor jeder Einreichung von Hand gegengelesen werden (siehe "Quellen").
- Status: `teilweise`. Die Luecken aus Teil C bestehen; "ongoing compliance" heisst, dass dieses
  Dokument nach jeder Aenderung an Werkzeugtexten, Prompts oder Gates nachgezogen werden muss.

### Telemarketing, Spam, Betrug

> "Negative-option billing, telemarketing, or consent-bypass schemes" - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Prohibited fraudulent, deceptive, or high-risk services")

> "deceit, fraud, scams, spam, or impersonation" - https://openai.com/policies/usage-policies/ (Abschnitt "Empower people")

- Einschlaegig: ja. Hermes fuehrt echte ausgehende Anrufe an Dritte.
- Mechanismen im Code (Kette der Ausgangs-Gates, serverseitig, vor dem Waehlen):
  - Globaler Notaus: Gate `outbound_frozen` (`src/telephony/outbound-gates.js:687`).
  - Verifikation des Kontos: Gate `kyc` (`src/telephony/outbound-gates.js:758`), Mindeststufe
    `KYC_OUTBOUND_MIN = KYC_LEVEL.CARD` (`src/store/defaults.js:524`).
  - Sperrliste und Land-Gate: `deniedPrefix` bzw. `countryGateAllowed` in `numberGateError`
    (`src/telephony/outbound-gates.js:504-506`, `src/telephony/outbound-gates.js:359-363`),
    ausgefuehrt im Gate `number_gate` (`src/telephony/outbound-gates.js:800`).
  - Stundenlimit pro Mandant und Wiederholungs-Grenze je Ziel im Zeitfenster:
    `callQuotaError` (`src/telephony/outbound-gates.js:478-483`), Grenzwert pro Mandant
    (`src/telephony/outbound-gates.js:380-382`), Ziel-Grenze `perTargetCapReached`
    (`src/telephony/outbound-gates.js:389`).
  - Kostendecke pro Mandant: Gates `budget` und `minutes`
    (`src/telephony/outbound-gates.js:900`, `src/telephony/outbound-gates.js:913`).
  - Offenlegungssatz als erster gesprochener Satz (siehe "Identitaetsanmassung").
  - Die Werkzeugbeschreibung sagt dem Modell, dass der Server entscheidet:
    Werkzeugtext (place_call): "Which destinations are allowed is decided by the server through its safety gates"
- Was fehlt: keine Zweckbindung. Weder die Werkzeugbeschreibung von `place_call` noch die
  Server-Instructions (`src/mcp-server-info.js:97`) schliessen Werbe-, Verkaufs- oder
  Kaltakquise-Anrufe aus. Beleg: `grep -ciE 'telemarket|advertis|cold.?call|sales|political|campaign|marketing' src/mcp-server-info.js`
  liefert 0; derselbe Suchausdruck ueber `src/mcp-tools.js`, `src/i18n/prompts`,
  `src/routes/mcp.js`, `src/mcp-server.js`, `src/elevenlabs/outbound.js` liefert ebenfalls keinen
  Treffer (Gegenprobe desselben Aufrufs: `grep -ciE 'safety gates' src/mcp-tools.js` liefert 2).
  Die Mengen-Gates bremsen Masse, aber sie verhindern keinen einzelnen Werbeanruf.
- Status: `teilweise`. Luecke 1 in Teil C.

### Drohung, Einschuechterung, Belaestigung

> "threats, intimidation, harassment, or defamation" - https://openai.com/policies/usage-policies/ (Abschnitt "Protect people")

- Einschlaegig: ja. Ein Anruf in fremdem Auftrag kann als Belaestigung eingesetzt werden.
- Mechanismen: Wiederholungs-Grenze je Ziel und Stundenlimit (siehe oben), Sperrliste,
  Offenlegung (der Angerufene erfaehrt, dass eine KI im Auftrag von jemandem anruft).
- Was fehlt: kein Inhaltsfilter fuer `objective`, `briefing` oder `constraints`; ein einzelner
  bedrohender Anruf wird durch kein Gate erkannt.
- Status: `teilweise`. Luecke 1 in Teil C (Zweckbindung) deckt den Kern.

### Identitaetsanmassung (Impersonation)

> "Identity theft, impersonation, or identity-monitoring services that enable misuse" - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Prohibited fraudulent, deceptive, or high-risk services")

> "deceit, fraud, scams, spam, or impersonation" - https://openai.com/policies/usage-policies/ (Abschnitt "Empower people")

- Einschlaegig: ja.
- Mechanismus, Budget-/Telnyx-Weg: der erste gesprochene Satz ist der Offenlegungssatz
  (`firstSpokenSentence`, `src/claude.js:469-471`), gebaut von `disclosureSentence`
  (`src/claude.js:423`) aus dem Sprachbaustein `disclosure` (englische Fassung
  `src/i18n/locales.js:622-624`). Er nennt die KI-Eigenschaft und den Auftraggeber (den beim
  Mandanten hinterlegten Namen) und sagt, dass das Gespraech fuer den Auftraggeber
  zusammengefasst wird.
- Mechanismus, Sprach-Agenten-Weg: derselbe Satz ist `first_message` der Agenten-Vorlage
  (`elevenlabs/agent_configs/outbound-agent.template.json:810`) und wird im Code nicht
  uebersteuert (`src/elevenlabs/outbound.js:19`).
- Ohne hinterlegten Auftraggeber-Namen kein Anruf: Gate `owner_name`
  (`src/telephony/outbound-gates.js:774`).
- Eng begrenzte Ausnahme: ruft der Mandant seine EIGENE hinterlegte Nummer an, entfaellt nur der
  lange Satz zum Auftraggeber; die KI-Kennzeichnung bleibt. Voraussetzungen: exakte
  String-Gleichheit von Ziel und hinterlegter Nummer (`src/callee-is-owner.js:48-49`), ein
  ausdruecklich freigeschalteter Mandant (`src/callee-is-owner.js:68`) und ein Schalter, der
  per Code-Default aus ist (`src/config.js:1915-1917`). Budget-Weg: `src/claude.js:469-471`;
  Sprach-Agenten-Weg: `ownerFirstMessage` (`src/elevenlabs/outbound.js:1165`).
- Der hinterlegte Auftraggeber-Name wird gegen keinen Identitaetsnachweis geprueft. Beim
  Web-Login uebernimmt der Server Vor- und Nachname aus dem Profil des Login-Anbieters
  (`src/web-auth.js:461-462`) und schreibt sie an den Mandanten, wenn dort noch keiner steht
  (`src/web-auth.js:205`). Im Onboarding durch den Betreiber sind beide Felder Freitext
  (`src/routes/api-onboard.js:94-98`). Wie die Namensfelder beim Login-Anbieter entstehen,
  belegt der Code nicht. Die Pruefstufe fuer ausgehende Anrufe ist die hinterlegte Karte
  (`src/store/defaults.js:524`), keine Identitaetspruefung; die hoehere Stufe "Identitaet
  geprueft" vergibt der Code nur beim Start an den Mandanten des Betreibers, ohne
  Pruefverfahren (`src/store/state-ops.js:2216`). Ein Konto mit fremdem Namen im
  Login-Profil liesse die KI "im Auftrag von" dieser Person anrufen.
- Status: `teilweise`. Luecke 10 in Teil C.

### Stimme einer realen Person

> "use of someone’s likeness, including their photorealistic image or voice, without their consent in ways that could confuse authenticity" - https://openai.com/policies/usage-policies/ (Abschnitt "Respect privacy")

- Einschlaegig: ja, Hermes spricht mit synthetischer Stimme.
- Mechanismus: im Code gibt es keine Funktion, die eine Stimme klont oder anlegt. Beleg:
  `grep -rloiE 'voice[_-]?clon|clone[_-]?voice|voices/add|instant voice|professional voice' src`
  liefert 0 Dateien; Gegenprobe `grep -rloiE 'voice[_-]?id' src` liefert 13 Dateien (die Suche
  greift). Dazu der Offenlegungssatz (siehe oben).
- Offen: welche Stimme tatsaechlich spricht, ist eine Einstellung beim Sprach-Anbieter bzw. im
  Hosting. Ob dort eine Stimme einer realen Person hinterlegt ist, belegt der Code nicht.
- Status: `teilweise`; der Rest ist `offen` (Anbieter-Einstellung).

### Privatsphaere Dritter

> "we don’t allow attempts to compromise the privacy of others, including to aggregate, monitor, profile, or distribute individuals’ private or sensitive information without their authorization" - https://openai.com/policies/usage-policies/ (Abschnitt "Respect privacy")

- Einschlaegig: ja. Der Angerufene ist ein Dritter; seine Aussagen werden verarbeitet.
- Mechanismen:
  - Es gibt zwei getrennte Such-Mechanismen mit eigenen Schaltern, Anbietern und Filtern.
  - Vorab-Recherche VOR dem Anruf: Schalter `RESEARCH_ENABLED` (`src/config.js:624`,
    Code-Default aus) und Mandanten-Einstellung `allowResearch`
    (`src/precall-briefing.js:278`). Anbieter ist die serverseitige Suche des
    Sprachmodell-Anbieters Anthropic (`src/research/registry.js:26`). Das Modell sieht dabei
    nur `objective`, Auftragsnotizen und `constraints`, nie die Zielnummer
    (`src/research/sanitize.js:17`). Die Suchanfrage formuliert das Modell beim Anbieter; der
    Server sieht sie nicht und kann sie nicht filtern (`src/research/sanitize.js:2`).
    Achtung: die Auftragsnotizen SIND das `briefing` (`src/routes/api-calls.js:525`); das
    `briefing` kann also bei dieser Suche ankommen.
  - Nachschlag WAEHREND des Anrufs: das Werkzeug `look_up` des Gespraechsmodells
    (`src/research/in-call.js:18`), auf dem Budget-/Telnyx-Weg (`src/claude.js:648`) und auf
    dem Sprach-Agenten-Weg ueber einen Webhook (`src/routes/webhooks-elevenlabs.js:270`).
    Voraussetzungen: Schalter `LOOKUP_ENABLED` (`src/config.js:649`, Code-Default aus), ein
    hinterlegter Schluessel fuer Exa (`src/research/registry.js:56`) und das Profil-Recht
    `allowLookup` (`src/research/in-call.js:55`); nur ausgehende Anrufe
    (`src/research/in-call.js:51`, Sprach-Agenten-Weg `src/research/registry.js:97`); auf dem
    Budget-/Telnyx-Weg zusaetzlich der Assistenten-Kontext (`src/research/in-call.js:50`).
    Das Profil der bezahlten Tarife traegt das Recht im Code nicht (`src/plans.js:138`), das
    Profil des Betreiber-Mandanten schon (`src/store/defaults.js:1062`); welche gespeicherten
    Profile es in Produktion tragen, ist hier nicht gemessen. Anbieter ist Exa
    (`src/research/registry.js:34`), hoechstens zwei Suchen je Anruf
    (`src/research/registry.js:68`).
  - Die Suchanfrage des Nachschlags formuliert das Gespraechsmodell frei aus dem laufenden
    Gespraech, also auch aus Aussagen des Angerufenen. Der einzige serverseitige Filter
    (`src/research/lookup-guard.js:66-74`) verwirft Anfragen mit Ziffernfolgen ab fuenf
    Stellen (`src/research/lookup-guard.js:25`), mit E-Mail-Adressen, mit der Zielnummer oder
    mit woertlichen Zitaten aus dem Transkript, und kuerzt auf 120 Zeichen
    (`src/research/lookup-guard.js:20`). Einen Namensfilter hat er nicht (`src/plans.js:125`),
    Gesundheits- oder Geldbegriffe prueft er nicht. Umschriebene Aussagen des Angerufenen
    koennen also an Exa gehen. Auf dem Sprach-Agenten-Weg schreibt der Server das Transkript
    erst nach dem Anruf (`src/elevenlabs/outbound.js:1075`); der Zitat-Filter vergleicht nur
    mit gespeicherten Zeilen des Angerufenen (`src/utils/text.js:57-60`) und hat dort
    waehrend des Anrufs nichts zum Vergleichen.
  - Die Werkzeugbeschreibung von `look_up` auf dem Budget-/Telnyx-Weg verbietet, Namen,
    Nummern, Adressen, Gesundheits- oder Geldangaben des Gegenuebers zu suchen
    (`src/i18n/prompts/en.js:326`). Das ist eine Anweisung an das Modell; serverseitig
    durchgesetzt ist nur der Filter oben.
  - Das Roh-Transkript auf unserer Seite wird am Anrufende NUR bei einem abgeschlossenen
    Anruf geleert. Die Leerung steht in `finishCall` (`src/telephony/call-finish.js:350`) hinter
    zwei fruehen Ruecksprungstellen: hat der Anruf einen anderen Endstatus als `completed` -
    etwa `cancelled` nach `cancel_call` (`src/routes/api-calls.js:811`) oder `failed` - oder
    ist das Transkript leer, kehrt die Funktion vorher zurueck
    (`src/telephony/call-finish.js:302`, Ruecksprung `src/telephony/call-finish.js:322`);
    ebenso bei einer gescheiterten Uebergabe eines eingehenden Anrufs an den Sprach-Agenten
    (`src/telephony/call-finish.js:296`). Ein abgebrochener oder gescheiterter Anruf behaelt
    sein Roh-Transkript also bis zum Loeschlauf des Anrufs (Code-Default 30 Tage nach
    Anrufende, `src/config.js:2036`; der Wert 0 schaltet den Loeschlauf ganz aus). Der
    Sprach-Agenten-Weg endet ueber dieselbe Funktion (`src/elevenlabs/outbound.js:1458`) und
    unterliegt denselben Ruecksprungstellen. Weitere Ausnahmen bei einem abgeschlossenen
    Anruf: ein Diagnose-Anruf an die eigene hinterlegte Nummer behaelt es
    (`src/diagnostic-retention.js:72`), und scheitert die Zusammenfassung mit einem Fehler,
    bleibt es ebenfalls bis zum Loeschlauf liegen. Was der Sprach-Anbieter selbst aufbewahrt,
    ist eine Einstellung dort (Teil B, offen). Fristen siehe Teil B.
- Was an OpenAI geht: `get_call_status` liefert die letzten Zeilen des Gespraechs
  (`src/mcp-tools.js:199`, hoechstens `LAST_TRANSCRIPT_LINES = 6`, `src/mcp-tools.js:48`), also
  woertliche Aussagen des Dritten. Der Handler prueft den Anrufstatus nicht
  (`src/mcp-tools.js:1453-1456`); die Zeilen kommen aus dem gespeicherten Transkript
  (`src/mcp-tools.js:200`). Sie gehen deshalb nicht nur waehrend des Anrufs an OpenAI/ChatGPT,
  sondern auch danach, solange das Transkript existiert: nach einem abgebrochenen oder
  gescheiterten Anruf und nach einer gescheiterten Zusammenfassung bis zum Loeschlauf des
  Anrufs (Code-Default 30 Tage), bei einem Diagnose-Anruf bis zum Ende der Diagnose-Frist
  (Code-Default 7 Tage). Ein `cancel_call` beendet also die Verbindung, beendet aber nicht die
  Herausgabe der letzten Zeilen ueber `get_call_status`.
  Werkzeugtext (get_call_status): "duration and the last transcript lines"
  `get_transcript` gibt nur Zusammenfassung und Ergebnis zurueck (`src/mcp-tools.js:1522`).
  Werkzeugtext (get_transcript): "This tool NEVER returns the raw transcript"
- Status: `teilweise`. Der Dritte willigt nicht ein; er wird nur informiert (Offenlegung).
  Luecke 8 in Teil C (Suchanfragen an Such-Anbieter), Luecke 11 (Rohzeilen nicht an den
  laufenden Anruf gebunden), Luecke 12 (Roh-Transkript nicht abgeschlossener Anrufe wird nicht
  geleert).
  Rechtsgrundlage und Information des Dritten sind Rechtstext-Fragen (Teil B).

### Beratung, die eine Zulassung erfordert

> "provision of tailored advice that requires a license, such as legal or medical advice, without appropriate involvement by a licensed professional" - https://openai.com/policies/usage-policies/ (Abschnitt "Protect people")

- Einschlaegig: mittelbar. Hermes beraet den Nutzer nicht, er fuehrt Gespraeche in seinem
  Auftrag, z.B. mit einer Arztpraxis oder Kanzlei; die Auskunft kommt dort von Menschen.
- Mechanismus: der Prompt verbietet dem Gespraechsagenten, Zusagen oder Buchungen zu erfinden
  (`src/i18n/prompts/en.js:157`).
- Was fehlt: kein Prompt-Satz verbietet dem Gespraechsagenten, dem Gegenueber selbst
  medizinische oder rechtliche Auskunft zu geben. Beleg: die einzige Gesundheits-Nennung in
  `src/i18n/prompts/en.js` betrifft den Nachschlag im Anruf (`src/i18n/prompts/en.js:326`).
- Status: `teilweise`. Luecke 9 in Teil C.

### Umgehung von Schutzmassnahmen

> "circumventing our safeguards" - https://openai.com/policies/usage-policies/ (Abschnitt "Protect people")

- Einschlaegig: nein - die Klausel meint OpenAIs Schutzmassnahmen; Hermes hat keinen Pfad, der
  sie beruehrt. Zur Einordnung: Hermes' eigene Gates liegen serverseitig in der Gate-Kette
  (Stellen oben); kein Werkzeug-Parameter schaltet ein Gate ab, der Aufrufer nennt nur das Ziel.
- Status: `nicht einschlaegig`.

### Politische Kampagnen, Lobbying

> "political campaigning, lobbying, foreign or domestic election interference, or demobilization activities" - https://openai.com/policies/usage-policies/ (Abschnitt "Empower people")

- Einschlaegig: ja. Massenanrufe sind ein klassisches Kampagnenwerkzeug.
- Mechanismus: nur die Mengen-Gates (Stundenlimit, Ziel-Grenze, Kostendecke). Keine
  Zweckbindung in Werkzeugbeschreibung oder Server-Instructions (Beleg siehe "Telemarketing").
- Status: `Luecke`. Luecke 1 in Teil C.

### Minderjaehrige

> "Children and teens deserve special protection." - https://openai.com/policies/usage-policies/ (Abschnitt "Keep minors safe")

> "Plugins must be suitable for general audiences, including users aged 13–17. Plugins may not explicitly target children under 13." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Appropriateness")

- Einschlaegig: ja (Zielgruppe).
- Mechanismus: keiner im Code (keine Altersangabe, keine Altersgrenze). Ein Anruf-Assistent
  mit Abrechnung richtet sich nicht an Kinder, aber das ist eine Produktaussage, kein Beleg.
- Status: `offen` (Rechtstext: Mindestalter in AGB/Datenschutzerklaerung).

### Datenschutzerklaerung

> "Plugin submissions must include a clear, published privacy policy explaining, at minimum, the categories of personal data collected, the purposes of use, the categories of recipients, data retention timelines, and any controls offered to your users." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Privacy policy")

- Einschlaegig: ja.
- Mechanismus: kein Code-Thema. Teil B liefert Kategorien, Zwecke, Empfaenger, Fristen (als
  Code-Default) und die Kontrollen, die der Code hat.
- Status: `offen` (Rechtstext).

### Minimale Eingaben, kein voller Chatverlauf

> "Do not request the full conversation history, raw chat transcripts, or broad contextual fields “just in case.”" - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Minimal and purpose-driven inputs")

> "Collection minimization: Gather only the minimum data required to perform the tool’s function." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Data collection")

- Einschlaegig: ja, `place_call` hat mehrere Freitextfelder.
- Mechanismus: die Beschreibungen verlangen Zusammenfassung statt Rohtext.
  Werkzeugtext (place_call): "SUMMARISE instead of copying in raw - only what counts for the conversation."
  Werkzeugtext (place_call): "What the call is about, summarised in 1-3 sentences (not a raw dump of the chat)."
- Was dagegen spricht: das Feld `briefing` fordert ausdruecklich Chat-Kontext und Vorlieben an,
  und `context` ist ein zweites optionales Sammelfeld neben dem `briefing`.
  Werkzeugtext (place_call): "Relevant context from the chat so far that the agent needs for the call"
  Werkzeugtext (place_call): "Optional structured BACKGROUND for the conversation (only for the agent's information, ADDITIONAL to the briefing)."
  Das ist das Gegenteil von "Design the input schema to limit data collection by default,
  rather than a funnel for optional context" (gleicher Abschnitt).
- Status: `teilweise`. Luecke 2 in Teil C.

### Grenzen: kein Rekonstruieren des Chatverlaufs

> "Your MCP server must not pull, reconstruct, or infer the full chat log from the client or elsewhere." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Data collection")

- Einschlaegig: ja.
- Mechanismus: der Server hat keinen Pfad, der Chatverlauf abruft; er sieht nur die
  Werkzeug-Argumente. Das `briefing` laesst allerdings das Modell den Chat zusammenfassen und
  schickt die Zusammenfassung mit (siehe oben).
- Status: `teilweise`. Luecke 2 in Teil C.

### Eingeschraenkte und besonders schutzwuerdige Daten

> "Restricted data: Do not collect, solicit, or process the following categories of Restricted Data:" - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Data collection"; genannt werden u.a. "Protected health information (PHI)" und "Government identifiers (such as social security numbers)")

> "Regulated Sensitive Data: Do not collect personal data considered “sensitive” or “special category” in the jurisdiction in which the data is collected unless collection is strictly necessary to perform the tool’s stated function; the user has provided legally adequate consent; and the collection and use is explicitly and prominently disclosed at or before the point of collection." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Data collection")

- Einschlaegig: ja. Anrufe bei Arztpraxen transportieren Gesundheitsbezug in `objective`,
  `briefing`, Transkript und Zusammenfassung.
- Mechanismus: die Beschreibungen schliessen Geheimnisse, Passwoerter und Zahlungsdaten aus.
  Werkzeugtext (place_call): "NO secrets, passwords or payment data."
  Werkzeugtext (place_call): "NO secrets/passwords/payment data."
- Was fehlt: keine Anweisung zur Minimierung von Gesundheitsangaben und keine zu amtlichen
  Kennnummern; keine Einwilligungs- oder Hinweisstelle vor der Erhebung.
- Status: `Luecke`. Luecke 3 in Teil C.

### Minimale Antworten

> "Response minimization: Tool responses must return only data that is directly relevant to the user’s request and the tool’s stated purpose." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Data collection")

- Einschlaegig: ja.
- Mechanismus: `get_transcript` filtert ueber eine Whitelist (`src/mcp-tools.js:1522`) und
  liefert nie das Roh-Transkript; `get_call_status` liefert hoechstens sechs letzte Zeilen
  (`src/mcp-tools.js:48`), aber unabhaengig vom Anrufstatus, also auch nach dem Anruf, solange
  ein Transkript gespeichert ist (Luecke 11 in Teil C).
- `get_agent_status` gibt den Namen des Auftraggebers zurueck (`src/mcp-tools.js:593`),
  obwohl die Beschreibung des Werkzeugs ihn nicht als Zweck nennt (Luecke 14 in Teil C).
- Teilweise geprueft: welche Felder jedes der zwoelf Werkzeuge zurueckgibt und zu welcher
  Datenkategorie sie gehoeren, steht in Teil B ("Werkzeug-Antworten Feld fuer Feld"). Ob jedes
  dieser Felder fuer die Anfrage des Nutzers erforderlich ist, ist nicht Feld fuer Feld
  bewertet.
- Status: `teilweise`.

### Datenabfluss muss aus der Werkzeugdefinition hervorgehen

> "If a tool sends data outside the current environment (for example, posting content, sending messages), this must be clear from the tool definition." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Predictable, auditable behavior")

- Einschlaegig: ja.
- Mechanismus: der Anruf selbst ist in der Beschreibung klar benannt.
  Werkzeugtext (place_call): "Starts a real phone call by the AI agent to a phone number, pursuing the given objective."
  Die Beschreibung sagt auch, dass `objective` dem Angerufenen woertlich vorgelesen wird.
  Werkzeugtext (place_call): "it is read out VERBATIM to the called party right after the disclosure"
- Was fehlt, in keiner Werkzeugbeschreibung erwaehnt: (1) bei eingeschalteter
  Vorab-Recherche koennen `briefing`, `objective` und `constraints` bei der Suche des
  Sprachmodell-Anbieters ankommen (`src/research/sanitize.js:17`,
  `src/routes/api-calls.js:525`); (2) bei eingeschaltetem Nachschlag im Anruf gehen vom
  Gespraechsmodell formulierte Suchanfragen aus dem laufenden Gespraech, auch aus Aussagen
  des Angerufenen, an Exa (`src/research/lookup-guard.js:66-74`).
- Status: `teilweise`. Luecke 8 in Teil C.

### Datenpraktiken, Metadaten

> "Data practices: Do not engage in surveillance, tracking, or behavioral profiling—including metadata collection such as timestamps, IP addresses, or query patterns—unless explicitly disclosed, narrowly scoped, subject to meaningful user control, and aligned with OpenAI’s usage policies." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Transparency and user control")

- Einschlaegig: ja. Hermes schreibt ein Audit-Log mit Zeitstempel, handelnder Identitaet,
  Mandant und Aktion (`src/db/schema.sql:1014`), append-only (`src/audit-store.js:1`) und ohne
  Loeschfrist im Code.
- Mechanismus: kein Profiling-Code bekannt; die Offenlegung der Metadaten ist Rechtstext.
- Status: `offen` (Rechtstext). Luecke 6 in Teil C (keine Frist).

Die Annotationen der Werkzeuge ("Accurate action labels", "Preventing data exfiltration")
behandelt `docs/OPENAI-TOOL-INVENTORY.md`, nicht dieses Dokument.

### Commerce: keine Abo-/Upgrade-Anzeige

> "Users may sign in to an existing paid account and access features already included in their subscription. Plugins must not display subscription plans, initiate new subscriptions, or promote upgrades." - https://developers.openai.com/plugins/app-guidelines (Abschnitt "Commerce and monetization")

- Einschlaegig: ja, Hermes rechnet ueber ein Abo ab.
- Befund: `grep -rliE 'upgrade|pricing|checkout|subscribe' src/ui src/mcp-tools.js src/mcp-server-info.js`
  liefert 0 Dateien (Gegenprobe `grep -rliE 'call_id' src/ui src/mcp-tools.js` liefert 2).
- Nicht geprueft: der Wortlaut aller Ablehnungstexte bei erschoepftem Guthaben.
- Status: `teilweise`.

## Teil A2: "automation of high-stakes decisions in sensitive areas without human review"

> "automation of high-stakes decisions in sensitive areas without human review" - https://openai.com/policies/usage-policies/ (Abschnitt "Empower people"; die Bereichsliste nennt u.a. housing, employment, financial activities and credit, insurance, legal, medical)

Gegenstand: das optionale Mandat von `place_call`. Mit ihm darf der Gespraechsagent im Anruf
selbst zusagen, statt jede Frage als Nachricht zurueckzugeben.

**Wer setzt das Mandat?** Das Modell im Chat, auf Grundlage dessen, was der Nutzer gesagt hat.
Die Beschreibung verbietet das Erfinden und bindet die weitreichendste Option an eine
ausdrueckliche Aussage des Nutzers:
Werkzeugtext (place_call): "Never invent one: take the frame from what the user has already said, otherwise leave the field out."
Werkzeugtext (place_call): "Set 'accept_best' ONLY when the user explicitly says that any option suits them."
Das Modell, das vor dem Anruf ein Hintergrund-Briefing erstellt, kann sich `accept_best` nicht
selbst ausstellen: das Schema bietet den Wert nicht an (`src/precall-briefing.js:52-53`), und
ein trotzdem gelieferter Wert wird abgestreift (`src/precall-briefing.js:200`,
angewendet in `src/precall-briefing.js:216`). Ob das Modell im Chat die Bedingung "explicitly
says" einhaelt, prueft der Server nicht - er kann es nicht sehen.

**Was darf der Agent?** Nur muendlich zusagen. Das Mandat oeffnet keinen Buchungs- oder
Kalenderpfad (`src/store/defaults.js:410-413`).
Werkzeugtext (place_call): "Through this the agent books NOTHING and gets NO calendar access - it only commits verbally to what the user allowed in advance."
Der Rahmen ist auf 1000 Zeichen begrenzt (`src/routes/_validation.js:50`). Die Werte fuer
Angebote ausserhalb des Rahmens stammen aus einer Quelle (`src/store/defaults.js:417`); auf dem
Budget-/Telnyx-Weg setzt der Prompt `accept_best` so um: das beste Angebot annehmen und als
Nachricht festhalten (`src/i18n/prompts/en.js:223-224`).

**Unterschied zwischen den Sprechwegen.** Welcher Weg einen Anruf fuehrt, entscheidet ein
globaler Schalter (`src/config.js:808`, Code-Default aus; ausgewertet in
`src/routes/api-calls.js:546`); der Produktionswert ist hier nicht genannt. Auf dem
Sprach-Agenten-Weg kommt `on_out_of_scope` nicht beim Agenten an: uebergeben werden nur der
Rahmen, die Ausweich-Reihenfolge und die Buchungsgrenze (`src/elevenlabs/outbound.js:615`,
`src/elevenlabs/outbound.js:622`). Die Werkzeugbeschreibung verspricht fuer `decline` und
`accept_best` aber ein bestimmtes Verhalten:
Werkzeugtext (place_call): "'decline' - politely refuse, without a counter-offer; 'accept_best' - accept and record the best offer made anyway."
Fuer die Frage "menschliche Pruefung" ist die Abweichung konservativ (`accept_best` wirkt dort
nicht). Fuer "descriptions that match behavior" ist sie eine Luecke.

**Sensible Bereiche.** Kein Code verhindert ein Mandat in den gelisteten Bereichen (Wohnen,
Arbeit, Kredit, Versicherung, Recht, Medizin), und die Beschreibung weist nicht darauf hin.

**Bewertung.** Die Entscheidung trifft der Mensch vorab (Rahmen aus seinen Worten); die Zusage
ist muendlich, nichts wird gebucht; ohne Mandat sagt der Agent nichts zu. Das ist eine
menschliche Pruefung vor dem Anruf, keine im Moment der Zusage. Eine Bereichssperre oder ein
Hinweis fehlt.

Status: `teilweise`. Luecken 4 und 5 in Teil C.

## Teil B: Faktenblatt Datenschutz

Grundlage fuer Datenschutzerklaerung und AGB. Alle Fristen sind **Code-Defaults**; jede ist per
Umgebungsvariable einstellbar, der Produktionswert steht im Hosting-Dashboard und ist hier
bewusst nicht genannt. Beide Speicher-Backends (Datei und Postgres) rufen denselben Loeschlauf
auf (`src/store/json.js:1339`, `src/store/pg.js:833`). Der Loeschlauf laeuft beim Start und
danach alle 6 Stunden (`src/boot.js:108`, `src/boot.js:1255-1256`).

### Datenkategorien

| Kategorie | Quelle im Code | Zweck | Aufbewahrung (Code-Default) | Empfaenger |
|---|---|---|---|---|
| Konto: Login-Kennung, E-Mail, Rolle | Tabelle `account` (`src/db/schema.sql:980`) | Anmeldung, Zuordnung zum Mandanten | keine Frist im Code; Einzelzeilen fallen nur beim Abgleich verwaister Identitaeten (`src/web-auth.js:711`) | Login-Anbieter |
| Sitzung | Tabelle `session` (`src/db/schema.sql:997`) | Browser-Sitzung | Ablaufzeitpunkt je Sitzung; kein Loeschlauf im Code gefunden | - |
| Mandant: Name des Auftraggebers, eigene Nummer, Abrechnungs-Kennungen | Tabelle `tenant` (`src/db/schema.sql:13`), Spalten `owner_name` (`src/db/schema.sql:23`), `private_number` (`src/db/schema.sql:81`), `stripe_customer_id` (`src/db/schema.sql:38`), `stripe_subscription_id` (`src/db/schema.sql:48`) | Offenlegungssatz, Eigen-Anruf, Abrechnung | keine Frist im Code | Name des Auftraggebers: OpenAI/ChatGPT ueber `get_agent_status` (Feld `owner`, `src/mcp-tools.js:593`); Sprach-Anbieter als Variable `owner_name` des Sprach-Agenten (`src/elevenlabs/outbound.js:953`); Sprachmodell-Anbieter im System-Prompt des Budget-Wegs (`src/i18n/prompts/en.js:12`); Telefonie-Anbieter als Text der ersten Ansage des Budget-Wegs (`src/claude.js:452`); jeder Angerufene hoert ihn im Offenlegungssatz (`src/i18n/locales.js:622-624`). Vorname (Spalte `first_name`, `src/db/schema.sql:27`): Sprach-Anbieter in der Eroeffnung eines Anrufs an die eigene hinterlegte Nummer (`src/elevenlabs/outbound.js:1165-1167`). Eigene Nummer: kein Werkzeugfeld gibt sie als solche zurueck; ist sie Ziel eines Anrufs, steht sie im Anruf-Datensatz und geht als Nummer der Gegenseite an OpenAI/ChatGPT (`list_calls`, Feld `counterparty`, `src/mcp-tools.js:630`). Abrechnungs-Kennungen: Zahlungsanbieter |
| Rufnummer des Assistenten (dem Mandanten zugeordnete, beim Telefonie-Anbieter gemietete Nummer) | Tabelle `number` (`src/db/schema.sql:714`), Spalte `provider` (`src/db/schema.sql:718`); Anzeige-Nummer des Mandanten (`src/routes/api-read.js:89`) | Anrufe annehmen und fuehren | der periodische Loeschlauf hat keinen Durchgang fuer diese Tabelle (`src/store/state-ops.js:5186`); was mit der Zeile nach einer Kuendigung und der Freigabe der Nummer geschieht, ist hier nicht untersucht | Telefonie-Anbieter; OpenAI/ChatGPT ueber `get_my_number` (`src/mcp-tools.js:617`) und `get_agent_status` (Feld `number`, `src/mcp-tools.js:592`) |
| Einstellungen | Tabelle `settings` (`src/db/schema.sql:163`) | Verhalten des Assistenten | keine Frist im Code | OpenAI/ChatGPT ueber `get_agent_status`: die drei Freigaben (Zusammenfassungen, persoenliche Daten, Bankdaten) als Feld `permissions` (`src/mcp-tools.js:598`); Sprachmodell-Anbieter im System-Prompt des Budget-Wegs: Name und Stil des Assistenten (`src/i18n/prompts/en.js:12`, `src/i18n/prompts/en.js:129`) und die Grenzen aus den Freigaben fuer persoenliche und Bankdaten (`src/claude.js:231-232`); Name des Assistenten in der Ergebnis-SMS an den Nutzer ueber den Telefonie-Anbieter (`src/telephony/call-finish.js:370`). Auf dem Sprach-Agenten-Weg geht laut Code keines dieser Felder an den Sprach-Anbieter (`grep -rnE "agentName|agentStyle|allowPersonalData|allowBankData" src/elevenlabs` liefert 0) |
| Anruf-Datensatz: Nummern, Anliegen, Briefing, Grenzen, Kontext, Mandat | Tabelle `call` (`src/db/schema.sql:211`): `from_e164`/`to_e164` (`src/db/schema.sql:218-219`), `goal` (`src/db/schema.sql:220`), `briefing` (`src/db/schema.sql:227`), `constraints` (`src/db/schema.sql:228`), `context` (`src/db/schema.sql:252`), `mandate` (`src/db/schema.sql:256`) | Durchfuehrung und Ergebnis des Anrufs | beendete Anrufe: 30 Tage (`src/config.js:2036`, 0 = Loeschlauf aus); laufende Anrufe unbegrenzt (`src/store/state-ops.js:5125`) | Sprachmodell-Anbieter, Sprach-Anbieter, Telefonie-Anbieter; bei eingeschalteter Vorab-Recherche die serverseitige Suche von Anthropic (`objective`, `briefing`, `constraints`, ohne Nummer); OpenAI/ChatGPT (Werkzeug-Antworten) |
| Rueckfragen des Agenten an den Nutzer und dessen Antworten (nur bei freigegebenem Rueckfrage-Kanal) | Spalte `consults` am Anruf (`src/db/schema.sql:342`) | Rueckfrage waehrend des Anrufs | mit dem Anruf-Datensatz (30 Tage) | OpenAI/ChatGPT: die Fragen des Agenten, die aus dem laufenden Gespraech stammen, ueber `await_call_event` (Feld `questions`, `src/mcp-tools.js:295`). Die Antworten kommen aus ChatGPT ueber `answer_consult` (`src/mcp-tools.js:1417`, Route `src/routes/api-calls.js:765`) und sind fuer den Agenten im laufenden Gespraech bestimmt; der Weg von dort zum Sprachmodell- bzw. Sprach-Anbieter ist in diesem Dokument nicht Zeile fuer Zeile belegt |
| Roh-Transkript | Tabelle `transcript_segment` (`src/db/schema.sql:554`) | Gespraechsfuehrung, Zusammenfassung | wird am Anrufende nur bei Endstatus `completed` geleert (`src/telephony/call-finish.js:350`); bei jedem anderen Endstatus, z.B. `cancelled` nach `cancel_call` oder `failed` (Ruecksprung vor der Leerung, `src/telephony/call-finish.js:302`), und nach einer gescheiterten Zusammenfassung bleibt es bis zum Loeschlauf des Anrufs (30 Tage) | bis zu sechs letzte Zeilen an OpenAI/ChatGPT ueber `get_call_status` (`src/mcp-tools.js:48`), waehrend des Anrufs und danach, solange das Transkript gespeichert ist, also auch nach einem abgebrochenen oder gescheiterten Anruf und nach einer gescheiterten Zusammenfassung (`src/mcp-tools.js:1453-1456`); Sprachmodell- und Sprach-Anbieter; bei eingeschaltetem Nachschlag im Anruf Exa: vom Gespraechsmodell formulierte Suchanfragen aus dem Gespraech, die Aussagen des Angerufenen umschreiben koennen (Filter siehe "Privatsphaere Dritter") |
| Roh-Transkript eines Diagnose-Anrufs an die eigene hinterlegte Nummer | wie oben, Markierung `diagnostic` | nachtraegliche Analyse | 7 Tage (`src/config.js:2043-2047`). Aufbewahrung per Default AN: ohne Angabe behaelt der Server das Transkript, nur ein ausdrueckliches `diagnostic=false` bei `place_call` verhindert es (Opt-out, `src/diagnostic-retention.js:42`, `src/diagnostic-retention.js:56`). Die eigene hinterlegte Nummer ist nur auf Format und Land geprueft, NICHT darauf, dass sie dem Nutzer gehoert (`src/diagnostic-retention.js:48`); hat ein Nutzer eine fremde Nummer hinterlegt, ist es das Roh-Transkript eines Dritten | wie oben; insbesondere bis zu sechs letzte Zeilen an OpenAI/ChatGPT ueber `get_call_status` fuer die ganze Frist (`src/mcp-tools.js:200`, `src/diagnostic-retention.js:72`) |
| Zusammenfassung, Ergebnis | `summary`, `result` am Anruf (`src/db/schema.sql:339`) | Bericht an den Nutzer | mit dem Anruf-Datensatz (30 Tage) | OpenAI/ChatGPT (Werkzeug-Antworten), Benachrichtigungswege |
| Woertliche Zitate im Ergebnis | `result.evidence` | Beleg zur Ergebnis-Karte | Code-Default 0 = Funktion aus, es wird nichts erhoben (`src/config.js:2057-2060`) | - |
| Aufgaben (Action Items) | Tabelle `action_item` (`src/db/schema.sql:564`) | Nachbereitung | erledigte: 30 Tage; OFFENE unbefristet (`src/store/state-ops.js:5127`) | OpenAI/ChatGPT: offene Aufgaben ueber `list_action_items` (`src/mcp-tools.js:1671`) und je Eingangs-Eintrag ueber `check_inbox` (Feld `action_items`, `src/store/state-ops.js:786`) |
| Benachrichtigungen | Tabelle `notification` (`src/db/schema.sql:699`) | Hinweise an den Nutzer | 30 Tage | - |
| Eingangs-Eintraege eingehender Anrufe: Anrufernummer, Anliegen | Anruf-Datensatz, `inbox_entry_at` (`src/db/schema.sql:369`), Gesehen-Markierung (`src/store/state-ops.js:835`) | Anruf-Eingang | mit dem Anruf-Datensatz (30 Tage) | OpenAI/ChatGPT (`check_inbox`) |
| Nutzung und Kosten | Tabellen `usage` (`src/db/schema.sql:589`), `usage_event` (`src/db/schema.sql:901`), `call_cost_evidence` (`src/db/schema.sql:953`) | Abrechnung, Kostendecke | keine Frist im Code | Zahlungsanbieter (Abrechnung); OpenAI/ChatGPT ueber `get_agent_status`: Zahl der Anrufe (Feld `calls`, `src/mcp-tools.js:594`) und Monatsnutzung in Prozent (Feld `planUsagePercent`, `src/mcp-tools.js:597`), kein Geldbetrag |
| Kalender (nur wenn aktiv) | Tabelle `calendar_event` (`src/db/schema.sql:576`) | Anzeige der naechsten Termine | keine Frist im Code | OpenAI/ChatGPT (`get_calendar`) |
| Audit-Log | Tabelle `audit_log` (`src/db/schema.sql:1014`), append-only (`src/audit-store.js:1`) | Nachvollziehbarkeit sicherheitsrelevanter Aktionen | keine Frist im Code | - |

### Empfaenger laut Code

Reproduzierbar mit
`grep -rhoE "https://[a-zA-Z0-9.-]+\.(com|io|ai|net|org|de)" src | sort | uniq -c | sort -rn`.

| Empfaenger | Rolle | Code-Stelle |
|---|---|---|
| Telnyx | Telefonie, SMS | `src/config.js:683` |
| ElevenLabs | Sprach-Agent und Sprachausgabe; erhaelt je Anruf u.a. den Namen des Auftraggebers als Variable `owner_name` | `src/config.js:506` |
| DeepSeek | Sprachmodell (je nach Anbieter-Schalter) | `src/llm/adapters/deepseek.js:28`, Schalter `src/config.js:514` |
| Anthropic | Sprachmodell (je nach Anbieter-Schalter), ueber das SDK; serverseitige Suche der Vorab-Recherche (nur wenn eingeschaltet) | `src/llm/adapters/anthropic.js:35` |
| Exa | Nachschlag waehrend ausgehender Anrufe (nur wenn eingeschaltet): vom Gespraechsmodell formulierte Suchanfragen aus dem laufenden Gespraech, auch aus Aussagen des Angerufenen | `src/config.js:666` |
| Stripe | Zahlungen | `src/config.js:918` |
| WorkOS | Anmeldung | `src/config.js:2090` |
| Brevo, eigenes SMTP-Postfach | E-Mail (Kuendigungsbestaetigung) | `src/brevo-mail.js:22`, `src/smtp-mail.js:22` |
| OpenAI / ChatGPT | Quelle der Werkzeug-Aufrufe und der Antworten auf Rueckfragen; Empfaenger aller Werkzeug-Antworten: Zusammenfassungen und Ergebnis-Karten, Nummern der Gegenseite, Eingangs-Eintraege, letzte Gespraechszeilen, Rueckfragen des Agenten, Aufgaben, Kalendereintraege, Name des Auftraggebers, Rufnummer des Assistenten, Zahl der Anrufe und Monatsnutzung in Prozent, Freigaben aus den Einstellungen (Zuordnung Feld fuer Feld im naechsten Abschnitt) | Werkzeuge in `src/mcp-tools.js` |

Nicht Empfaenger personenbezogener Daten des Servers: die Render-API (nur Werkzeuge nutzen sie,
`src/render-api.js:3`). Die Geo-Aufloesung laeuft lokal ueber eine MaxMind-Datenbank; in
`src/geo` gibt es keinen Netzaufruf (`grep -rnE "fetch\(|https?\.request|http\.get" src/geo`
liefert 0). Der Hosting-Dienstleister selbst ist kein Code-Befund und muss im Rechtstext
ergaenzt werden.

### Werkzeug-Antworten Feld fuer Feld

Jedes Feld, das ein Werkzeug an OpenAI/ChatGPT zurueckgibt, gehoert zu einer Kategorie der
Tabelle "Datenkategorien"; dort steht OpenAI/ChatGPT in der Empfaenger-Spalte. Grundlage ist
jeweils die Whitelist-Funktion bzw. der Antwort-Bau im Handler, nicht die Beschreibung. Geprueft
ist hier nur diese Zuordnung; ob jedes Feld fuer den Zweck des Werkzeugs erforderlich ist, ist
im Abschnitt "Minimale Antworten" behandelt.

| Werkzeug | Felder der Antwort | Kategorie |
|---|---|---|
| `place_call` | `call_id`, `status`, `duration_s`, `last_transcript_lines` (beim Start leer), `failure_reason`, `result_summary`, `objective_achieved`, `context_received`, `deduplicated` (`src/mcp-tools.js:1309`) | Anruf-Datensatz |
| `get_call_status` | `call_id`, `status`, `failure_reason`, `duration_s`, `last_transcript_lines` (`src/mcp-tools.js:194`) | Anruf-Datensatz, Roh-Transkript |
| `await_call_event` (nur bei freigegebenem Rueckfrage-Kanal) | `event`, `event_id`, `questions`, `status`, `failure_reason`, `result_summary`, `objective_achieved`, fuenf Felder der Ergebnis-Karte (`src/mcp-tools.js:289`) | Rueckfragen, Anruf-Datensatz, Zusammenfassung und Ergebnis |
| `answer_consult` (nur bei freigegebenem Rueckfrage-Kanal) | `accepted`, `merged_facts` (`src/mcp-tools.js:1431`) | keine personenbezogenen Daten in der Antwort; die Eingabe ist unter Rueckfragen erfasst |
| `get_transcript` | `call_id`, `result_summary`, `objective_achieved`, fuenf Felder der Ergebnis-Karte (`src/mcp-tools.js:236`) | Zusammenfassung und Ergebnis |
| `cancel_call` | `status`, bei einem Anruf ueber den Sprach-Agenten zusaetzlich technische Angaben zum Auflegen (`src/routes/api-calls.js:831-837`) | Anruf-Datensatz (nur Status) |
| `get_my_number` | `number` (`src/mcp-tools.js:616`) | Rufnummer des Assistenten |
| `list_calls` | je Anruf `id`, `direction`, `counterparty`, `status`, `startedAt`, `summary` (`src/mcp-tools.js:626`) | Anruf-Datensatz (Nummer der Gegenseite; bei einem Anruf an die eigene hinterlegte Nummer ist es diese), Zusammenfassung |
| `check_inbox` | je Eintrag `call_id`, `caller`, `at`, `summary`, `summary_unavailable`, fuenf Felder der Ergebnis-Karte, `action_items`, `action_required`; dazu `remaining` (`src/store/state-ops.js:786`) | Eingangs-Eintraege, Zusammenfassung und Ergebnis, Aufgaben |
| `list_action_items` | Text je offener Aufgabe (`src/mcp-tools.js:1671`) | Aufgaben |
| `get_calendar` (nur wenn der Kalender aktiv ist) | je Eintrag `title`, `start`, `end` (`src/mcp-tools.js:723`) | Kalender |
| `get_agent_status` | `number`, `owner`, `calls`, `planUsagePercent`, `permissions` (`src/mcp-tools.js:590-599`) | Rufnummer des Assistenten, Mandant (Name des Auftraggebers), Nutzung und Kosten, Einstellungen |

Zwei Werkzeugbeschreibungen nennen nicht alles, was die Antwort traegt. `get_agent_status`
liefert den Namen des Auftraggebers (Feld `owner`), die Beschreibung nennt ihn nicht:
Werkzeugtext (get_agent_status): "Status of the phone agent: phone number, monthly usage, permissions."
`get_my_number` liefert genau die Nummer, die die Beschreibung nennt:
Werkzeugtext (get_my_number): "Returns the phone number of the phone agent."
Luecke 14 in Teil C.

### Beruehrung besonderer Kategorien (Art. 9 DSGVO)

Anrufe bei Arztpraxen, Therapeuten oder Apotheken transportieren Gesundheitsbezug in
`objective`, `briefing`, Transkript und Zusammenfassung - zum Sprachmodell-, Sprach- und
Telefonie-Anbieter, bei eingeschalteter Vorab-Recherche zur Suche von Anthropic, beim
Nachschlag im Anruf als Suchanfrage an Exa (der Filter prueft keine Gesundheitsbegriffe), und
ueber die Werkzeug-Antworten an OpenAI/ChatGPT. Dieses Dokument benennt das; die rechtliche Bewertung ist
Sache des Rechtstextes.

### Kontrollen, die der Code dem Nutzer gibt

- Diagnose-Transkript abschalten: `diagnostic=false` bei `place_call`.
  Werkzeugtext (place_call): "Set it to false ONLY when the user explicitly does not want that transcript kept."
- Laufenden Anruf abbrechen: `cancel_call` (`src/mcp-tools.js:1552`). Das beendet die
  Verbindung und setzt den Status `cancelled` (`src/routes/api-calls.js:811`); es loescht das
  bis dahin entstandene Roh-Transkript NICHT. Das bleibt bis zum Loeschlauf des Anrufs
  gespeichert, und `get_call_status` liefert weiter dessen letzte Zeilen (Luecken 11 und 12 in
  Teil C).
- Eingangs-Eintraege erneut lesen, ohne Markierungen zu aendern: `check_inbox` mit
  `include_seen` (`src/mcp-tools.js:1627`).
  Werkzeugtext (check_inbox): "Re-read entries that were already marked as seen. Changes NO marker."
- Einstellungen im Self-Service (`src/self-service-routes.js:467`): frei setzbar sind nur Name,
  Sprache und Stil des Assistenten (`src/self-service.js:20`), dazu zwei Freigaben fuer
  persoenliche und Bankdaten, und diese nur restriktiver (`src/self-service.js:24`). Die eigene
  Nummer hat eine eigene Route (`src/self-service-routes.js:501`).

### Kontrollen, die fehlen

- Zusammenfassungen abschalten: die Einstellung `allowSummaries` existiert (Default an,
  `src/store/defaults.js:610`), der Nutzer kann sie aber nicht setzen. Die Self-Service-Route
  (`src/self-service-routes.js:482`) weist das Feld ab (`src/self-service.js:68`); die Route
  antwortet trotzdem mit den gespeicherten Einstellungen (`src/self-service-routes.js:488`) und
  nennt die Ablehnung nur im Audit-Log (`src/self-service-routes.js:483-487`). Umstellen kann es
  nur der Betreiber durch einen Eingriff im Datenbestand.
- Konto loeschen: keine Route. Die einzige DELETE-Route im Self-Service betrifft
  Newsletter-Empfaenger (`src/self-service-routes.js:628`). Der Code sagt selbst, dass die
  Loeschung keinen Endpunkt hat (`src/routes/api-read.js:116-118`); es gibt dafuer nur ein
  Betreiber-Skript (`scripts/erase-tenant.js`).
- Datenexport: `GET /api/tenant-data/export` existiert, ist aber nur fuer den lokalen,
  vertrauenswuerdigen Aufrufer erreichbar, nicht fuer den Nutzer im Browser und nicht als
  Werkzeug (`src/routes/api-read.js:119`).

### Offen, nicht als erfuellt zu lesen

- Aufbewahrung beim Sprach-Anbieter (dort eigene Einstellung, Betreiber).
- Produktionswerte aller Fristen (Hosting-Dashboard, Betreiber).
- Inhalt von Datenschutzerklaerung und AGB (Rechtstext, Betreiber).

## Teil C: Luecken

Jede Luecke traegt ein Ziel. Die Ziel-Werte bedeuten: "planned: ..." - die Arbeit ist
vorgesehen, aber nicht gebaut; bis sie gebaut ist, gilt die Luecke unveraendert. "open, not yet
assigned to a work package" - die Luecke ist mit Arbeit an Werkzeugbeschreibung, Prompt oder
Code zu schliessen, die noch keinem Arbeitspaket zugeordnet ist; sie wartet auf keine
Entscheidung des Betreibers. "open, no owner decision yet" - die Luecke haengt an einer
Entscheidung des Betreibers (etwa Rechtstext, Fristen, Einwilligung, Identitaetspruefung), die
noch nicht gefallen ist. Kein Ziel-Wert behauptet eine bestehende Durchsetzung.

1. **Keine Zweckbindung** gegen Telemarketing, Werbe- oder Verkaufsanrufe und politische
   Kampagnen - weder in der Beschreibung von `place_call` (`src/mcp-tools.js:1147`) noch in den
   Server-Instructions (`src/mcp-server-info.js:97`); der Server prueft den Zweck eines Anrufs
   nicht. Klauseln: "telemarketing", "spam", "political campaigning".
   Ziel (Zweckbindung und Zweck-Beschreibung in Werkzeugbeschreibung und Server-Instructions):
   planned: tool description/instructions work. Eine solche Anweisung richtet sich an das
   Modell und ist keine serverseitige Pruefung; ob es darueber hinaus eine serverseitige
   Pruefung geben soll: open, no owner decision yet.
2. **Breiter Kontext-Trichter**: `briefing` fordert Chat-Kontext an
   (`src/mcp-tools.js:1182`), `context` ist ein zweites Sammelfeld. Klauseln: "full
   conversation history ... broad contextual fields", "Collection minimization",
   "Data boundaries".
   Ziel: planned: minimization of the `place_call` descriptions and input fields.
3. **Keine Minimierung fuer Gesundheitsangaben** (und amtliche Kennnummern) in `briefing`,
   `key_facts`, `objective` (`src/mcp-tools.js:1182`); keine Einwilligungs- oder Hinweisstelle
   vor der Erhebung. Klauseln: "Restricted data", "Regulated Sensitive Data".
   Ziel fuer die Werkzeugtexte: planned: minimization of the `place_call` descriptions and
   input fields. Ziel fuer Einwilligung und Hinweis vor der Erhebung: open, no owner decision
   yet.
4. **`on_out_of_scope` wirkt auf dem Sprach-Agenten-Weg nicht**
   (`src/elevenlabs/outbound.js:615`), die Beschreibung verspricht das Verhalten
   (`src/mcp-tools.js:1218`). Klausel: "Descriptions that match behavior".
   Ziel: open, not yet assigned to a work package.
5. **Kein Hinweis und keine Sperre fuer Mandate in sensiblen Bereichen** (Wohnen, Arbeit,
   Kredit, Versicherung, Recht, Medizin) (`src/mcp-tools.js:1202`). Klausel: "automation of
   high-stakes decisions in sensitive areas without human review".
   Ziel: open, not yet assigned to a work package.
6. **Keine Loeschfrist** fuer Audit-Log (`src/db/schema.sql:1014`), Nutzungs- und
   Kostendaten (`src/db/schema.sql:901`), Konten (`src/db/schema.sql:980`); offene Aufgaben
   unbefristet (`src/store/state-ops.js:5127`). Klauseln: "data retention timelines",
   "Data practices".
   Ziel: open, no owner decision yet.
7. **Keine Loeschung und keine Auskunft im Self-Service** (`src/routes/api-read.js:116-118`,
   `src/routes/api-read.js:119`). Klausel: "any controls offered to your users".
   Ziel: open, not yet assigned to a work package.
8. **Datenabfluss an Such-Anbieter nicht in der Werkzeugdefinition**, zwei Mechanismen:
   (a) Vorab-Recherche: bei eingeschalteter Recherche gehen `briefing`, `objective` und
   `constraints` an die Suche von Anthropic (`src/research/sanitize.js:17`,
   `src/routes/api-calls.js:525`); (b) Nachschlag im Anruf: bei eingeschaltetem Nachschlag
   gehen vom Gespraechsmodell formulierte Suchanfragen aus dem Gespraech mit dem Angerufenen an
   Exa, gefiltert nur nach Ziffernfolgen, E-Mail, Zielnummer und woertlichem Zitat, ohne
   Namensfilter (`src/research/lookup-guard.js:66-74`, `src/plans.js:125`).
   Klausel: "If a tool sends data outside the current environment ..., this must be clear
   from the tool definition."
   Ziel fuer die Werkzeugdefinition: open, not yet assigned to a work package. Ob die
   Datenschutzerklaerung den Nachschlag und den Angerufenen als Betroffenen nennt, ist Teil
   von Luecke 13.
9. **Kein Beratungsverbot im Gespraechsprompt** fuer medizinische oder rechtliche Auskunft an
   das Gegenueber (`src/i18n/prompts/en.js:157`). Klausel: "tailored advice that requires a
   license".
   Ziel: open, not yet assigned to a work package.
10. **Auftraggeber-Name nicht identitaetsgeprueft**: der Name im Offenlegungssatz stammt aus
    dem Profil des Login-Anbieters (`src/web-auth.js:461-462`) bzw. aus Freitext im
    Betreiber-Onboarding (`src/routes/api-onboard.js:94-98`); die Pruefstufe fuer ausgehende
    Anrufe ist die Karte (`src/store/defaults.js:524`). Klauseln: "impersonation",
    "Identity theft, impersonation".
    Ziel: open, no owner decision yet.
11. **Rohzeilen nicht an den laufenden Anruf gebunden**: `get_call_status` gibt die letzten
    sechs Zeilen des gespeicherten Transkripts fuer jeden Anrufstatus zurueck
    (`src/mcp-tools.js:1453-1456`, `src/mcp-tools.js:200`), also auch nach dem Anruf -
    nach einem abgebrochenen oder gescheiterten Anruf und nach einer gescheiterten
    Zusammenfassung bis zum Loeschlauf, bei Diagnose-Anrufen fuer die ganze Diagnose-Frist
    (`src/diagnostic-retention.js:72`). Der Code nennt das selbst einen offenen Befund
    (`src/mcp-tools.js:189-193`). Klauseln: "Response minimization", "privacy of others".
    Ziel: open, not yet assigned to a work package.
12. **Roh-Transkript nicht abgeschlossener Anrufe wird nicht geleert**: `finishCall` kehrt bei
    jedem Endstatus ausser `completed` vor der Leerung zurueck
    (`src/telephony/call-finish.js:302`); das betrifft auch jeden per `cancel_call`
    abgebrochenen Anruf. Das Roh-Transkript mit den woertlichen Aussagen des Angerufenen bleibt
    bis zum Loeschlauf des Anrufs (Code-Default 30 Tage, `src/config.js:2036`). Klauseln:
    "Collection minimization", "privacy of others", "data retention timelines".
    Ziel: open, not yet assigned to a work package.
13. **Rechtstext fehlt in diesem Dokument**: Datenschutzerklaerung und AGB, darin
    Mindestalter, Offenlegung der Metadaten, Information des Angerufenen als Betroffenem und
    die tatsaechlichen Fristen. Teil B liefert nur die Faktengrundlage. Klauseln: "Plugin
    submissions must include a clear, published privacy policy", "Children and teens deserve
    special protection.", "Data practices".
    Ziel: planned: legal text (privacy policy and terms), written by the operator.
14. **`get_agent_status` gibt den Namen des Auftraggebers heraus, ohne dass die Beschreibung
    ihn nennt**: das Feld `owner` (`src/mcp-tools.js:593`) steht in der Antwort, die
    Beschreibung nennt nur Nummer, Monatsnutzung und Berechtigungen. Klauseln: "Response
    minimization", "Descriptions that match behavior".
    Ziel: open, not yet assigned to a work package.

## Anker (maschinenlesbar)

<!-- ANKER-BEGIN
src/telephony/outbound-gates.js:687 | name: "outbound_frozen"
src/telephony/outbound-gates.js:758 | name: "kyc"
src/store/defaults.js:524 | KYC_OUTBOUND_MIN = KYC_LEVEL.CARD
src/telephony/outbound-gates.js:504-506 | deniedPrefix(to)
src/telephony/outbound-gates.js:359-363 | function countryGateAllowed
src/telephony/outbound-gates.js:800 | name: "number_gate"
src/telephony/outbound-gates.js:478-483 | function callQuotaError
src/telephony/outbound-gates.js:380-382 | maxCallsPerHour
src/telephony/outbound-gates.js:389 | function perTargetCapReached
src/telephony/outbound-gates.js:900 | name: "budget"
src/telephony/outbound-gates.js:913 | name: "minutes"
src/telephony/outbound-gates.js:774 | name: "owner_name"
src/mcp-server-info.js:97 | export const MCP_BASE_INSTRUCTIONS
src/claude.js:469-471 | ownerOpeningFor(call) || disclosureSentence(call)
src/claude.js:423 | export function disclosureSentence(call)
src/i18n/locales.js:622-624 | this is an AI assistant calling on behalf of
elevenlabs/agent_configs/outbound-agent.template.json:810 | "first_message": "Hello, this is an AI assistant calling on behalf of {{owner_name}}.
src/elevenlabs/outbound.js:19 | der Satz ist first_message der AGENTEN-Konfiguration
src/callee-is-owner.js:48-49 | to === ownNumber
src/callee-is-owner.js:68 | export function ownerSelfCallGranted
src/config.js:1915-1917 | fallback: false
src/elevenlabs/outbound.js:1165 | function ownerFirstMessage
src/research/sanitize.js:17 | RESEARCH_EGRESS_FIELDS = Object.freeze(["objective", "ownerNotes", "constraints"])
src/routes/api-calls.js:525 | ownerNotes: b.briefing
src/config.js:624 | researchEnabled: boolEnv("RESEARCH_ENABLED", process.env.RESEARCH_ENABLED, { fallback: false })
src/i18n/prompts/en.js:326 | NEVER search for names, phone numbers, addresses, health or money details
src/telephony/call-finish.js:350 | if (!keepsTranscriptForDiagnosis(call, config.privacy)) store.purgeTranscript(call.id);
src/telephony/call-finish.js:302 | if (call.status !== "completed" || !call.transcript.length) {
src/telephony/call-finish.js:322 | return;
src/telephony/call-finish.js:296 | if (uebergabeGescheitert(call)) {
src/routes/api-calls.js:811 | status: "cancelled"
src/elevenlabs/outbound.js:1458 | billThunk(finishCall, store, callId)
src/mcp-tools.js:199 | last_transcript_lines: c.transcript
src/mcp-tools.js:200 | .slice(-LAST_TRANSCRIPT_LINES)
src/mcp-tools.js:1453-1456 | pickCallStatus(call_id, c, loc.mcp)
src/mcp-tools.js:189-193 | bewusst offener Befund
src/diagnostic-retention.js:72 | export function keepsTranscriptForDiagnosis(call, privacy)
src/diagnostic-retention.js:42 | ein OPT-OUT: nur ein ausdruecklicher
src/diagnostic-retention.js:56 | if (callerDeclined(requested)) return false;
src/diagnostic-retention.js:48 | ausdruecklich NICHT, dass dem Tenant
src/self-service.js:20 | SELF_SERVICE_FREE_FIELDS = ["agentName", "language", "agentStyle"]
src/self-service.js:24 | SELF_SERVICE_RESTRICT_ONLY_FIELDS = ["allowPersonalData", "allowBankData"]
src/self-service.js:68 | alles andere (allowSummaries
src/self-service-routes.js:482 | store.updateSettings(tenant, clean)
src/self-service-routes.js:488 | res.json(settings);
src/self-service-routes.js:483-487 | rejected=
src/mcp-tools.js:48 | const LAST_TRANSCRIPT_LINES = 6;
src/mcp-tools.js:1522 | pickTranscript(call_id, c, loc.mcp)
src/i18n/prompts/en.js:157 | never claim something is done or booked
src/db/schema.sql:1014 | CREATE TABLE IF NOT EXISTS audit_log
src/audit-store.js:1 | Append-only Audit-Log-Schreiber
src/precall-briefing.js:52-53 | MANDATE_OUT_OF_SCOPE.ACCEPT_BEST
src/precall-briefing.js:200 | function withoutSelfGrantedAcceptBest(mandate)
src/precall-briefing.js:216 | withoutSelfGrantedAcceptBest(mandate.value)
src/store/defaults.js:410-413 | keinen Kalender- oder Buchungspfad
src/routes/_validation.js:50 | "mandate.decide_freely": 1000
src/store/defaults.js:417 | ACCEPT_BEST: "accept_best"
src/i18n/prompts/en.js:223-224 | Accept the best option offered instead of asking back
src/config.js:808 | boolEnv("ELEVENLABS_OUTBOUND_ENABLED"
src/routes/api-calls.js:546 | if (config.voice.elevenLabsOutbound.enabled)
src/elevenlabs/outbound.js:615 | Die Enum-Achse on_out_of_scope hat auf diesem Weg noch keinen Platz
src/elevenlabs/outbound.js:622 | function mandateText(mandate)
src/store/json.js:1339 | export function pruneOldData(
src/store/pg.js:833 | pruneOldData(
src/boot.js:108 | const RETENTION_SWEEP_INTERVAL_HOURS = 6;
src/boot.js:1255-1256 | runRetention(store, config)
src/db/schema.sql:980 | CREATE TABLE IF NOT EXISTS account
src/web-auth.js:711 | async dropAccount(sub)
src/db/schema.sql:997 | CREATE TABLE IF NOT EXISTS session
src/db/schema.sql:13 | CREATE TABLE IF NOT EXISTS tenant
src/db/schema.sql:23 | owner_name
src/db/schema.sql:81 | private_number
src/db/schema.sql:38 | stripe_customer_id
src/db/schema.sql:48 | stripe_subscription_id
src/db/schema.sql:163 | CREATE TABLE IF NOT EXISTS settings
src/db/schema.sql:211 | CREATE TABLE IF NOT EXISTS call
src/db/schema.sql:218-219 | to_e164
src/db/schema.sql:220 | goal
src/db/schema.sql:227 | briefing
src/db/schema.sql:228 | constraints
src/db/schema.sql:252 | context JSONB
src/db/schema.sql:256 | mandate JSONB
src/config.js:2036 | retentionDays: numEnv("RETENTION_DAYS", process.env.RETENTION_DAYS, { fallback: 30, min: 0 })
src/store/state-ops.js:5125 | const keepCall = (c) => c.status === "active" || !c.endedAt || c.endedAt >= cutoff;
src/db/schema.sql:554 | CREATE TABLE IF NOT EXISTS transcript_segment
src/config.js:2043-2047 | fallback: 7
src/db/schema.sql:339 | result JSONB
src/config.js:2057-2060 | fallback: 0
src/db/schema.sql:564 | CREATE TABLE IF NOT EXISTS action_item
src/store/state-ops.js:5127 | const keepActionItem = (a) => !a.done || a.createdAt >= cutoff;
src/db/schema.sql:699 | CREATE TABLE IF NOT EXISTS notification
src/db/schema.sql:369 | inbox_entry_at
src/store/state-ops.js:835 | includeSeen || !call.inboxSeenAt
src/db/schema.sql:589 | CREATE TABLE IF NOT EXISTS usage
src/db/schema.sql:901 | CREATE TABLE IF NOT EXISTS usage_event
src/db/schema.sql:953 | CREATE TABLE IF NOT EXISTS call_cost_evidence
src/db/schema.sql:576 | CREATE TABLE IF NOT EXISTS calendar_event
src/config.js:683 | https://api.telnyx.com
src/config.js:506 | https://api.elevenlabs.io
src/llm/adapters/deepseek.js:28 | https://api.deepseek.com
src/config.js:514 | llmProvider: enumEnv("LLM_PROVIDER"
src/llm/adapters/anthropic.js:35 | import Anthropic from "@anthropic-ai/sdk";
src/config.js:666 | https://api.exa.ai
src/config.js:918 | https://api.stripe.com
src/config.js:2090 | https://api.workos.com
src/brevo-mail.js:22 | https://api.brevo.com
src/smtp-mail.js:22 | import nodemailer from "nodemailer";
src/render-api.js:3 | der Server spricht nie mit Render
src/mcp-tools.js:1552 | "cancel_call"
src/mcp-tools.js:1627 | "check_inbox"
src/self-service-routes.js:467 | router.post("/api/self-service/settings", webAuthMw
src/self-service-routes.js:501 | router.post("/api/self-service/private-number", webAuthMw
src/store/defaults.js:610 | allowSummaries: true
src/self-service-routes.js:628 | router.delete("/api/self-service/newsletter-recipients"
src/routes/api-read.js:116-118 | Loeschung (Art. 17) hat KEINEN Endpunkt
src/routes/api-read.js:119 | router.get("/api/tenant-data/export", internalOnly
src/mcp-tools.js:1147 | "place_call"
src/mcp-tools.js:1182 | Relevant context from the chat so far
src/mcp-tools.js:1218 | Set 'accept_best' ONLY when the user explicitly says
src/mcp-tools.js:1202 | decide_freely: z
src/research/sanitize.js:2 | wir sehen die Query nicht, bevor sie rausgeht
src/precall-briefing.js:278 | settings.allowResearch === true
src/research/registry.js:26 | PRECALL_PROVIDER = RESEARCH_PROVIDER.ANTHROPIC_WEB_SEARCH
src/research/in-call.js:18 | export const LOOK_UP_TOOL_NAME = "look_up";
src/claude.js:648 | name: LOOK_UP_TOOL_NAME
src/routes/webhooks-elevenlabs.js:270 | const sanitized = sanitizeLookupQuery(query, call);
src/config.js:649 | lookupEnabled: boolEnv("LOOKUP_ENABLED", process.env.LOOKUP_ENABLED, { fallback: false })
src/research/registry.js:56 | if (!config.research.exaApiKey) return null;
src/research/in-call.js:55 | allowLookup === true
src/research/in-call.js:51 | if (call.direction !== "outbound") return null;
src/research/registry.js:97 | if (call?.direction !== "outbound") return null;
src/research/in-call.js:50 | assistantContextEnabled !== true
src/plans.js:138 | allowLookup: false,
src/store/defaults.js:1062 | allowLookup: true
src/research/registry.js:34 | IN_CALL_PROVIDER = RESEARCH_PROVIDER.EXA_SEARCH
src/research/registry.js:68 | export const LOOKUP_MAX_PER_CALL = 2;
src/research/lookup-guard.js:66-74 | export function sanitizeLookupQuery(query, call)
src/research/lookup-guard.js:25 | LOOKUP_DIGIT_RUN_MAX = 4
src/research/lookup-guard.js:20 | LOOKUP_QUERY_MAX_CHARS = 120
src/plans.js:125 | hat aber KEINEN Namensfilter
src/elevenlabs/outbound.js:1075 | store.addTranscript(callId, roleOf(zeile.role), zeile.message)
src/utils/text.js:57-60 | entry?.role === "caller"
src/web-auth.js:461-462 | firstName: user.first_name
src/web-auth.js:205 | await applyTenantIdentity(tenantId, { firstName, lastName })
src/routes/api-onboard.js:94-98 | Freitext
src/store/state-ops.js:2216 | setKycLevel(s, tenantId, KYC_LEVEL.ID_VERIFIED);
src/mcp-tools.js:590-599 | function pickAgentStatus(s, texts)
src/mcp-tools.js:592 | number: s.agent.number ?? null
src/mcp-tools.js:593 | owner: s.agent.owner ?? null
src/mcp-tools.js:594 | calls: s.usage.calls
src/mcp-tools.js:597 | planUsagePercent: s.usage.planUsagePercent ?? null
src/mcp-tools.js:598 | permissions: permissionsSummary(s.settings, texts.permissionLabels)
src/mcp-tools.js:616 | function pickMyNumber(s)
src/mcp-tools.js:617 | return { number: s.agent.number ?? null };
src/mcp-tools.js:626 | function pickCall(c, formatDate)
src/mcp-tools.js:630 | counterparty: (c.direction === "outbound" ? c.to : c.from) ?? null
src/mcp-tools.js:194 | function pickCallStatus(callId, c, texts)
src/mcp-tools.js:236 | export function pickTranscript(callId, c, texts = null)
src/mcp-tools.js:289 | function awaitEventView({ callId, event, finished, texts })
src/mcp-tools.js:295 | questions: Array.isArray(event.questions) ? event.questions : []
src/mcp-tools.js:723 | function pickCalendarEntry(e, formatDate)
src/mcp-tools.js:1309 | const data = {
src/mcp-tools.js:1417 | /consult/answer
src/mcp-tools.js:1431 | structuredContent: { accepted: true, merged_facts: mergedFacts }
src/mcp-tools.js:1671 | ${item.text}
src/routes/api-calls.js:765 | const { event_id: eventId, answers, status } = req.body
src/routes/api-calls.js:831-837 | status: "cancelled"
src/routes/api-read.js:89 | number: activeNumberFor(s, tenantId)
src/store/state-ops.js:786 | export function inboxEntryView(call, actionItemTexts)
src/store/state-ops.js:5186 | export function pruneOldData(s, { retentionDays, diagnosticRetentionDays, evidenceRetentionDays })
src/db/schema.sql:27 | first_name TEXT
src/db/schema.sql:342 | consults JSONB
src/db/schema.sql:714 | CREATE TABLE IF NOT EXISTS number (
src/db/schema.sql:718 | provider
src/elevenlabs/outbound.js:953 | owner_name: owner,
src/elevenlabs/outbound.js:1165-1167 | const vorname = alsText(firstName);
src/i18n/prompts/en.js:12 | You are "${s.agentName}", ${owner}'s personal AI phone assistant.
src/i18n/prompts/en.js:129 | ${loc.styleClause(s.agentStyle)}
src/claude.js:452 | in EINEM Gather-Say
src/claude.js:231-232 | if (!s.allowPersonalData) lines.push(b.personalData(owner));
src/telephony/call-finish.js:370 | store.tenantContext(call.tenantId).settings.agentName
ANKER-END -->

## Werkzeug-Zitate (maschinenlesbar)

Jede Zeile ist ein woertlicher Teilstring der Beschreibung oder einer Eingabe-Beschreibung des
genannten Werkzeugs im echten `tools/list` (HTTP `/mcp` und, wo registriert, stdio).

<!-- WERKZEUGZITAT-BEGIN
place_call | Which destinations are allowed is decided by the server through its safety gates
get_call_status | duration and the last transcript lines
get_transcript | This tool NEVER returns the raw transcript
place_call | SUMMARISE instead of copying in raw - only what counts for the conversation.
place_call | What the call is about, summarised in 1-3 sentences (not a raw dump of the chat).
place_call | Relevant context from the chat so far that the agent needs for the call
place_call | Optional structured BACKGROUND for the conversation (only for the agent's information, ADDITIONAL to the briefing).
place_call | NO secrets, passwords or payment data.
place_call | NO secrets/passwords/payment data.
place_call | Starts a real phone call by the AI agent to a phone number, pursuing the given objective.
place_call | it is read out VERBATIM to the called party right after the disclosure
place_call | Never invent one: take the frame from what the user has already said, otherwise leave the field out.
place_call | Set 'accept_best' ONLY when the user explicitly says that any option suits them.
place_call | Through this the agent books NOTHING and gets NO calendar access - it only commits verbally to what the user allowed in advance.
place_call | 'decline' - politely refuse, without a counter-offer; 'accept_best' - accept and record the best offer made anyway.
place_call | Set it to false ONLY when the user explicitly does not want that transcript kept.
check_inbox | Re-read entries that were already marked as seen. Changes NO marker.
get_agent_status | Status of the phone agent: phone number, monthly usage, permissions.
get_my_number | Returns the phone number of the phone agent.
WERKZEUGZITAT-END -->
