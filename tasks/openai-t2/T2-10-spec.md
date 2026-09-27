# T2-10 Spec - Abgleich Usage Policies, Faktenblatt Datenschutz (O-18)

Stand: 2026-09-24. Basis: master `0cdb817`. Worktree:
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-10`,
Branch `phase/openai-t2-10-policy-abgleich-doku`. Diese Spec bleibt ungetrackt im Haupt-Arbeitsbaum.

Umfang: GENAU O-18. Dokument-Phase. `src/` wird NICHT geaendert (keine Zeile, auch kein
Kommentar). Gebaut werden: ein Dokument `docs/OPENAI-POLICY-ABGLEICH.md` und ein Test, der das
Dokument an Code und Draht festhaelt.

## Vorab gemessene Fakten (Planer, am Worktree, 2026-09-24)

- Primaerquelle Usage Policies: `https://openai.com/policies/usage-policies/` liefert per curl
  weiter HTTP 403. Ueber den Crawler-Dienst (Exa `web_fetch_exa`) kam der Volltext, Kopf
  "Effective: October 29, 2025". App Guidelines: `https://developers.openai.com/plugins/app-guidelines`
  ebenfalls per Exa vollstaendig abrufbar. Der Bau-Agent ruft BEIDE Seiten selbst neu ab (Exa,
  sonst WebFetch) und kopiert Zitate aus DIESEM Abruf, Zeichen fuer Zeichen (typografische
  Apostrophe `’` und Gedankenstriche `—`/`–` bleiben, wie sie im Abruf stehen). Das Dokument nennt
  Abrufdatum und Abrufweg ("ueber einen Crawler-Dienst abgerufen, openai.com direkt liefert 403").
- Echter `tools/list` ueber stdio ohne Tenant (10 Werkzeuge, ohne Consult-Werkzeuge):
  gesichert unter `.../scratchpad/logs-t2-10/stdio-tools-list.json` und lesbar
  `tools-readable.txt` (nur Referenz des Planers; der Bau-Agent misst selbst, s. Schritt 2).
- Werkzeug-Registrierungen (Zeile des Namensliterals in `src/mcp-tools.js`): place_call 1147,
  get_call_status 1482, get_transcript 1504, cancel_call 1552, get_my_number 1568, list_calls 1596,
  check_inbox 1627, list_action_items 1652, get_agent_status 1725. await_call_event, answer_consult,
  get_calendar liegen in anderem Format - Zeilen selbst per grep finden.
- Mandat: `decide_freely` Schema `src/mcp-tools.js:1202`, `on_out_of_scope`-Beschreibung
  `src/mcp-tools.js:1218`; Enum-Quelle `src/store/defaults.js:414-419` (`ACCEPT_BEST: "accept_best"`
  Zeile 417); Laengengrenze `src/routes/_validation.js:50` (`"mandate.decide_freely": 1000`),
  Feldliste `:152`; Budget-/Telnyx-Weg rendert das Mandat in `src/claude.js:269` und `:299`,
  Ausgangssaetze EN `src/i18n/prompts/en.js:218-225` (ACCEPT_BEST `:223-224`).
  Vorab-Briefing-Modell darf sich accept_best NICHT selbst ausstellen:
  `src/precall-briefing.js:47-54` (Enum ohne ACCEPT_BEST) und `:196-204`
  (`withoutSelfGrantedAcceptBest`).
- **Befund (Luecke, nicht in dieser Phase zu beheben):** auf dem Sprach-Agenten-Weg
  (`src/elevenlabs/outbound.js:614-626`, `mandateText`) wird `on_out_of_scope` NICHT an den Agenten
  uebergeben (Kommentar :615-617: "Die Enum-Achse on_out_of_scope hat auf diesem Weg noch keinen
  Platz"). Uebergeben werden nur `decide_freely` + `fallback_order` + Buchungsgrenze. Die
  `tools/list`-Beschreibung verspricht aber fuer 'decline' und 'accept_best' ein bestimmtes
  Verhalten. Richtung fuer "high-stakes": konservativ (accept_best wirkt dort nicht, also MEHR
  menschliche Pruefung, nicht weniger). Richtung fuer "descriptions that match behavior": Luecke.
  Welcher Sprechpfad fuer einen Anruf gilt, entscheidet `src/telephony/sprechpfad.js` - der
  Bau-Agent liest dort nach und schreibt beide Pfade ehrlich hin, ohne Produktionswerte.
- Offenlegungssatz: `src/claude.js:423` (`disclosureSentence`), Identitaet an
  `tenant.ownerName` gebunden. Sprach-Agenten-Weg: Offenlegung in `first_message` (Bau-Agent sucht
  die Stelle in `src/elevenlabs/`).
- Outbound-Gates (Kette `src/telephony/outbound-gates.js`): outbound_frozen :687, normalize_target
  :730, kyc :758, owner_name :774, number_gate :800 (Denylist/Land ueber `numberGateError`),
  valid_text :819, valid_mandate :836, budget :900, minutes :913, reserve_budget :960;
  Stundenlimit pro Tenant :369-382 (`maxCallsPerHour`), Ziel-Fenster `perTargetWindowMs` :366.
- Recherche-Egress: `src/research/sanitize.js:17` `RESEARCH_EGRESS_FIELDS = ["objective",
  "ownerNotes", "constraints"]` - die Nummer `to` geht NICHT in die Suche.
- Aufbewahrung (Code-Defaults, KEINE Produktionswerte):
  `src/config.js:2036` `RETENTION_DAYS` fallback 30 (0 = aus);
  `src/config.js:2043-2047` `DIAGNOSTIC_RETENTION_DAYS` fallback 7;
  `src/config.js:2057-2060` `EVIDENCE_RETENTION_DAYS` fallback 0 (= Feature aus, Zitate werden
  nicht erhoben). Sweep beim Start und alle 6 h: `src/boot.js:108` und `:1255-1256`, Rumpf
  `src/store/state-ops.js` `pruneExpiredRecords` (~:5120, Calls/Notifications/erledigte Action
  Items; aktive Calls und OFFENE Action Items bleiben unbegrenzt), `purgeExpiredDiagnosticTranscripts`
  :5154, `purgeExpiredResultEvidence` :5172, Fassade `pruneOldData` :5186. Roh-Transkript wird am
  Anrufende geleert, ausser Diagnose-Anruf an die eigene Nummer:
  `src/telephony/call-finish.js:350` (gilt auch fuer den Sprach-Agenten-Weg, der `finishCall`
  nutzt, `src/elevenlabs/outbound.js:1364/1389`). Summary scheitert mit Exception -> Transkript
  bleibt bis zum Sweep (Kommentar :347-349).
- Ohne Loeschfrist im Code (Befund fuer das Faktenblatt, vom Bau-Agenten zu bestaetigen):
  `audit_log` (`src/db/schema.sql:1014`, append-only, `src/audit-store.js:1-2`), `account` mit
  `email` (`schema.sql:980`), OFFENE Action Items, laufende Calls. Eine Self-Service-Route zum
  Loeschen des Kontos oder Export der Daten wurde per grep NICHT gefunden (einzige DELETE-Route:
  `src/self-service-routes.js:628` Newsletter-Empfaenger) - Bau-Agent verifiziert breit
  (`grep -rn "\.delete(\|DELETE" src/routes src/*.js`) und schreibt das Ergebnis ehrlich hin.
- Externe Empfaenger laut Code (Hosts per `grep -rhoE "https://[a-zA-Z0-9.-]+\.(com|io|ai|net|org|de)" src`):
  api.telnyx.com, api.elevenlabs.io, api.deepseek.com, (Anthropic ueber SDK,
  `src/llm/adapters/anthropic.js`, `src/research/adapters/anthropic-web-search.js`), api.exa.ai,
  api.stripe.com, api.workos.com, api.brevo.com (plus SMTP `src/smtp-mail.js`), api.render.com.
  Geo: MaxMind lokal (`src/geo/`) - Bau-Agent prueft, dass KEIN externer Dienst gerufen wird.
  OpenAI/ChatGPT: Quelle der Werkzeug-Aufrufe und Empfaenger der Werkzeug-Antworten (inkl.
  Zusammenfassungen, Nummern, Inbox-Inhalte).

## Schritte

### 1 - Primaerquellen abrufen und Zitatliste festlegen
- Was: Usage Policies und App Guidelines selbst neu abrufen. Einschlaegige Klauseln (Mindestliste,
  Bau-Agent darf ergaenzen, nicht streichen ohne Begruendung "nicht einschlaegig, weil ..."):
  - App Guidelines, Abschnitt "Usage policies": "Do not engage in or facilitate activities
    prohibited under OpenAI usage policies. Plugins must avoid high-risk behaviors that could expose
    users to harm, fraud, or misuse." und "Stay current with evolving policy requirements and ensure
    ongoing compliance. Previously approved plugins that are later found in violation may be removed."
  - App Guidelines, "Prohibited fraudulent, deceptive, or high-risk services":
    "Negative-option billing, telemarketing, or consent-bypass schemes"; ausserdem
    "Identity theft, impersonation, or identity-monitoring services that enable misuse".
  - App Guidelines, "Privacy policy" (Kategorien/Zwecke/Empfaenger/Fristen/Kontrollen),
    "Data collection" (Collection minimization, Response minimization, Restricted data,
    Regulated Sensitive Data, Data boundaries - "must not pull, reconstruct, or infer the full chat
    log"), "Minimal and purpose-driven inputs" ("Do not request the full conversation history, raw
    chat transcripts, or broad contextual fields “just in case.”" - Anfuehrungszeichen wie im Abruf),
    "Predictable, auditable behavior" ("If a tool sends data outside the current environment ..."),
    "Transparency and user control" (Data practices, Accurate action labels, Preventing data
    exfiltration), "Appropriateness" (13-17), "Commerce and monetization" (nur Querverweis, keine
    Abo-/Upgrade-Anzeige).
  - Usage Policies, "Protect people": "threats, intimidation, harassment, or defamation";
    "provision of tailored advice that requires a license, such as legal or medical advice, without
    appropriate involvement by a licensed professional"; "circumventing our safeguards".
  - Usage Policies, "Respect privacy": Einleitungssatz ("we don’t allow attempts to compromise the
    privacy of others, including to aggregate, monitor, profile, or distribute individuals’ private
    or sensitive information without their authorization"); "use of someone’s likeness, including
    their photorealistic image or voice, without their consent in ways that could confuse
    authenticity".
  - Usage Policies, "Keep minors safe" (Einleitung, nur als Einordnung der Zielgruppe).
  - Usage Policies, "Empower people": "deceit, fraud, scams, spam, or impersonation";
    "political campaigning, lobbying, foreign or domestic election interference, or demobilization
    activities"; "automation of high-stakes decisions in sensitive areas without human review" samt
    der Bereichsliste (critical infrastructure ... law enforcement).
- Wo: `docs/OPENAI-POLICY-ABGLEICH.md` (neu), Abschnitt "Quellen".
- IDs: O-18. Pfade: keine (Dokument).
- Beweis: (c) Messung - jede Zitatzeile des Dokuments ist ein woertlicher Teilstring des vom
  Bau-Agenten gesicherten Abrufs (Abruf als Datei in SEINEM Scratchpad, nicht im Repo). Befehl im
  Bericht angeben, z.B. ein node-Einzeiler, der jedes `> "..."`-Zitat gegen die Abrufdatei prueft;
  erwartet: 0 Fehltreffer. Im Repo zusaetzlich (b), s. Schritt 6 (URL-Pflicht je Zitat).

### 2 - Werkzeug-Referenz am Draht messen
- Was: echten `tools/list` ziehen: HTTP `/mcp` mit Legacy-Token und einem Profil mit Consult UND
  Kalender (alle 12 Werkzeuge; Muster `test/openai-p10a-tool-inventar.test.js` K1, `startServer`,
  `seedState`, `mcpPost` aus `test/helpers.js`) sowie stdio (`src/mcp-server.js`). Jede
  Werkzeug-Aussage des Dokuments wird gegen diese Beschreibung (description + inputSchema-
  Beschreibungen) gegengelesen. Je Werkzeug: Handler-Zeile in `src/mcp-tools.js` und die REST-Route,
  an der die Wirkung passiert (per grep auf den `path` im `api(...)`-Aufruf des Handlers).
- Wo: Messung im Scratchpad; Ergebnis nur als Zitate + Zeilen ins Dokument.
- IDs: O-18. Pfade: HTTP /mcp (Token/Legacy) UND stdio. OAuth: Werkzeugmenge/Texte sind laut
  bestehendem Inventar-Test auf beiden Auth-Modi gleich - der Bau-Agent zitiert das nicht als
  eigene Messung, sondern verweist auf `docs/OPENAI-TOOL-INVENTORY.md`.
- Beweis: (b) der neue Test aus Schritt 6 prueft jedes Werkzeug-Zitat gegen den echten
  `tools/list` auf HTTP und stdio.

### 3 - Dokument Teil A: Klausel -> Mechanismus
- Was: Tabelle je Klausel aus Schritt 1: Zitat (woertlich, mit URL) | einschlaegig ja/nein mit
  Grund | Hermes-Mechanismus mit `datei:zeile` | Status: `erfuellt` / `teilweise` / `Luecke` /
  `nicht einschlaegig` / `offen (Rechtstext oder Anbieter-Einstellung)`. Status "erfuellt" nur, wenn
  der Mechanismus am Code steht UND die Klausel vollstaendig deckt. Mindestinhalte:
  - Telemarketing/Spam/Belaestigung: Abo+KYC (`kyc`-Gate), Stundenlimit pro Tenant, Ziel-Fenster,
    Denylist, Land-Gate, Kostendecke, `OUTBOUND_FROZEN`, fest verdrahteter Offenlegungssatz.
    EHRLICH: keine Zweckbindung gegen Telemarketing in Werkzeugbeschreibung/Instructions
    (bekannte Luecke) -> Status `teilweise`, Luecke in Teil C.
  - Impersonation / Stimme: Offenlegungssatz als erster Satz (Wortlaut NICHT abdrucken, nur Stelle
    und dass er die KI-Eigenschaft und den Auftraggeber nennt - Bau-Agent liest den Wortlaut in
    `LOCALES.<lang>.disclosure`); die eng begrenzte Eigen-Nummer-Ausnahme (nur Wegfall des langen
    Dritt-Satzes, KI-Kennzeichnung bleibt) ehrlich nennen, mit Stelle `src/callee-is-owner.js`.
    Stimmklon: per grep belegen, dass keine Stimmklon-Funktion existiert (Befehl + 0 Treffer).
  - Privatsphaere Dritter: `to` nicht im Recherche-Egress; Transkript-Purge am Anrufende; Fristen.
  - Politische Kampagnen: kein spezifischer Mechanismus ausser den Mengen-Gates -> `Luecke`
    (keine Zweckbindung), in Teil C.
  - Lizenzpflichtige Beratung: Hermes berat nicht, er fuehrt Gespraeche im Auftrag; belegen am
    Prompt (Stelle, die Zusagen/Buchen verbietet, z.B. `src/i18n/prompts/en.js:157`). Kein
    Mechanismus gegen medizinische Auskunft im Gespraech -> Bau-Agent prueft Prompts per grep und
    stuft ehrlich ein.
  - Restricted/Sensitive Data: Querverweis auf Beschreibung `briefing`/`key_facts` ("NO secrets,
    passwords or payment data" - woertlich aus tools/list); KEINE Minimierung fuer Gesundheitsdaten
    -> `Luecke`; Arzttermine beruehren Art. 9 -> Teil B.
  - "full conversation history": `briefing` fordert "Relevant context from the chat so far"
    (woertlich aus tools/list) -> `teilweise`, Luecke in Teil C.
  - Minderjaehrige/13-17: kein Code-Mechanismus; Altersfrage = Rechtstext -> `offen`.
  - Nicht-Umgehung: Safety-Gates serverseitig, kein Client-Flag (Beleg: Gate-Kette + CLAUDE.md-Regel
    ist KEIN Beleg, nur Code).
- Wo: `docs/OPENAI-POLICY-ABGLEICH.md`, Abschnitt "Teil A".
- IDs: O-18. Pfade: fuer jede Werkzeug-Aussage HTTP und stdio (Zitat gegen beide), fuer jede
  Anruf-Aussage BEIDE Sprechpfade (Budget-/Telnyx-Weg und Sprach-Agenten-Weg).
- Beweis: (b) Anker-Test Schritt 6 (jede `datei:zeile` traegt ihren Anker); (a) die Zeilen selbst.

### 4 - Dokument Teil A2: "high-stakes decisions ... without human review"
- Was: eigener Abschnitt. Pruefung von `mandate.decide_freely` und `on_out_of_scope=accept_best`:
  - Wer setzt das Mandat? Der Nutzer im Chat (Beschreibung: "Never invent one: take the frame from
    what the user has already said"; accept_best "ONLY when the user explicitly says that any option
    suits them" - woertlich aus tools/list). Das Vorab-Briefing-Modell kann accept_best nicht
    ausstellen (`src/precall-briefing.js:47-54`, `:196-204`).
  - Was darf der Agent? Nur muendliche Zusage im Rahmen; kein Buchungs-/Kalenderpfad
    (`src/store/defaults.js:410-413` Kommentar + Beschreibung "Through this the agent books NOTHING
    and gets NO calendar access"). Grenze 1000 Zeichen (`_validation.js:50`).
  - Pfad-Unterschied ehrlich: auf dem Sprach-Agenten-Weg kommt `on_out_of_scope` nicht an
    (`src/elevenlabs/outbound.js:614-626`).
  - Sensitive Bereiche: KEIN Code verhindert ein Mandat in den gelisteten Bereichen (housing,
    employment, financial activities and credit, insurance, legal, medical ...). Bewertung: die
    Entscheidung trifft der Mensch VORAB (menschliche Pruefung ex ante), die Zusage ist muendlich und
    nicht bindend gebucht; trotzdem keine Bereichssperre und kein Hinweis in der Beschreibung ->
    Status `teilweise`, Luecke in Teil C. Nicht als "erfuellt" formulieren.
- Wo: `docs/OPENAI-POLICY-ABGLEICH.md`, "Teil A2".
- IDs: O-18. Pfade: beide Sprechpfade; place_call ueber HTTP und stdio (dieselbe Beschreibung).
- Beweis: (b) Anker-Test + Werkzeug-Zitat-Test Schritt 6.

### 5 - Dokument Teil B: Faktenblatt Datenschutz (Grundlage fuer die Rechtstexte des Owners)
- Was: je Datenkategorie eine Zeile: Kategorie | Quelle (Tabelle/State-Feld mit `schema.sql:zeile`
  bzw. Store-Feld) | Zweck | Aufbewahrung laut CODE-DEFAULT mit Stelle (keine Produktionswerte; wo
  der Wert per Env gesetzt wird: "per Umgebungsvariable einstellbar, Produktionswert = Owner") |
  Empfaenger. Kategorien mindestens: Konto (sub, email, Rolle), Sitzung, Tenant-Einstellungen inkl.
  Name des Auftraggebers und eigene Nummer, Anruf-Datensaetze (Nummern, objective, briefing,
  constraints, mandate, context), Roh-Transkript (Purge am Ende; Diagnose-Ausnahme 7 Tage Default),
  Zusammenfassung/Ergebnis, Ergebnis-Zitate (Default aus), Action Items (offene unbefristet),
  Notifications, Inbox-Eintraege eingehender Anrufe (Anrufernummer, Anliegen), Nutzung/Kosten
  (usage, usage_event, call_cost_evidence), Audit-Log (ohne Frist), Abrechnungs-Kennungen (Stripe),
  Kalender (falls aktiv). Empfaengerliste aus dem Host-grep oben, je mit Code-Stelle, dazu
  OpenAI/ChatGPT als Quelle der Werkzeug-Aufrufe und Empfaenger der Antworten. Art.-9-Beruehrung:
  Anrufe zu Arztpraxen transportieren Gesundheitsbezug in objective/briefing/Transkript/Summary -
  benennen, nicht bewerten. Nutzerkontrollen, die der CODE hat: `diagnostic=false`,
  `cancel_call`, `check_inbox include_seen`, Einstellungen im Self-Service (nur was belegbar ist);
  fehlende Kontrollen (Konto-Loeschung/Export, falls der grep nichts findet) ehrlich als fehlend.
  Offen und NICHT als erfuellt: `retention_days` beim Sprach-Anbieter (Owner-Einstellung),
  Produktionswerte der Fristen (Dashboard), Inhalt der Datenschutzerklaerung/AGB (Rechtstext).
- Wo: `docs/OPENAI-POLICY-ABGLEICH.md`, "Teil B".
- IDs: O-18 (Grundlage fuer die Owner-Punkte zu O-6/O-15; diese IDs werden hier NICHT abgehakt).
- Pfade: Persistenz beide Backends (json + pg: `src/store/json.js:1339`, `src/store/pg.js:833`
  rufen dieselbe `pruneOldData`); Anrufende beide Sprechpfade (`call-finish.js:350`).
- Beweis: (b) Anker-Test Schritt 6 fuer jede Frist-/Tabellen-Stelle; (c) Host-grep-Befehl aus
  dieser Spec im Bericht mit Ausgabe.

### 6 - Test, der das Dokument festhaelt
- Was: neue Datei `test/openai-policy-abgleich-doku.test.js` (Testnamen OHNE Katalog-Praefix, also
  nicht mit `MCP-`, `GAP-`, `ABNAHME-` usw. beginnen - sonst falscher Lauf). Das Dokument traegt
  zwei maschinenlesbare Bloecke (HTML-Kommentar-Marker, Muster Inventar-Doku):
  1. Anker-Block: je Zeile `datei:zeile[-zeile] | Anker-Teilstring`. Test: Datei existiert, der
     Anker steht in der genannten Zeile bzw. im Bereich. JEDE `datei:zeile`-Angabe im Fliesstext
     muss im Block stehen (Test extrahiert alle `src/...:N`-Muster aus dem Dokument und vergleicht).
  2. Werkzeug-Zitat-Block: je Zeile `werkzeug | woertlicher Teilstring`. Test: der Teilstring steht
     in `description` oder einer `inputSchema`-Beschreibung dieses Werkzeugs im ECHTEN `tools/list`
     - ueber HTTP `/mcp` (Legacy-Token, Profil mit Consult + Kalender, 12 Werkzeuge) UND ueber stdio
     (fuer die dort registrierten Werkzeuge). Nie das Registrierungsobjekt pruefen.
  3. Policy-Zitate: jedes `> "..."`-Zitat hat in derselben Tabellenzeile/Absatz eine URL mit Host
     `openai.com` oder `developers.openai.com`.
  4. Hygiene: keine internen Kennungen (Regex mindestens `\bT2-\d`, `\bO-\d`, `\bOW-`, `\bH\d+\b`,
     `\bP\d+[a-z]?\b` als Phasenkennung, `phase/`, `\bN-\d`, `\bX-\d`, `\bT-\d`), keine
     E.164-artigen Nummern (`\+\d{6,}`), keine Secret-Muster (`sk_`, `whsec_`, `Bearer `).
- Wo: `test/openai-policy-abgleich-doku.test.js` (neu).
- IDs: O-18. Pfade: HTTP /mcp (Token/Legacy) + stdio.
- Beweis: (b) gruen isoliert: `NODE_ENV=test node --test test/openai-policy-abgleich-doku.test.js`;
  PLUS Positiv-Kontrolle (Pruefkommando ohne Positiv-Kontrolle beweist nichts): Bau-Agent aendert
  testweise (nicht committet) einen Anker bzw. ein Zitatzeichen im Dokument und zeigt, dass der
  Test ROT wird; Ergebnis im Bericht.

### 7 - Teil C: Luecken-Liste am Ende des Dokuments (und an den Lead)
- Was: nummerierte Liste ohne interne Kennungen, je Luecke: was fehlt, Code-Stelle, welche Klausel.
  Mindestens (Bau-Agent bestaetigt jede am Code, streicht nur mit Beleg):
  1. Keine Zweckbindung gegen Telemarketing/Werbeanrufe/politische Kampagnen in
     Werkzeugbeschreibung oder Server-Instructions.
  2. `briefing` fordert breiten Chat-Kontext ("Relevant context from the chat so far"), `context`
     ist ein zweiter Sammeltrichter.
  3. Keine Minimierungsanweisung fuer Gesundheitsangaben in briefing/key_facts/objective.
  4. `on_out_of_scope` ('decline'/'accept_best') wirkt auf dem Sprach-Agenten-Weg nicht, die
     Beschreibung verspricht es (`src/elevenlabs/outbound.js:615-617` vs. `src/mcp-tools.js:1218`).
  5. Kein Hinweis/keine Sperre fuer Mandate in sensiblen Bereichen (Wohnen, Arbeit, Kredit,
     Versicherung, Recht, Medizin).
  6. Audit-Log ohne Loeschfrist; offene Action Items unbefristet.
  7. Keine Self-Service-Loeschung/-Auskunft (falls der grep das bestaetigt).
- Wo: Dokument "Teil C" UND im Phasenbericht als eigener Abschnitt "Zusatzauftrag an den Lead
  (vor T2-16)" - dort duerfen Phasenkennungen stehen, im Dokument nicht.
- IDs: O-18. Pfade: wie genannt.
- Beweis: (a) Code-Stellen im Anker-Block (Schritt 6).

### 8 - Suite
- Was: `npm test -- -- --test-concurrency=4 > <scratchpad>/logs-t2-10/npm-test.log 2>&1`, nur
  `# pass`/`# fail` lesen; rote Tests isoliert wiederholen. Keine bestehende Datei wird geaendert,
  also bricht nach Erwartung kein bestehender Test. `node --check` nur fuer den neuen Test.
  Keine Lint-Pins anheben (`eslint-legacy-exceptions.json`), keine Mehrfach-Anweisungen je Zeile.
- Beweis: (b) `# fail 0` im Log (bzw. jeder rote Test isoliert gruen) und neuer Test gruen.

## Nicht bauen (mit Grund)
- Keine Aenderung an `src/`, Werkzeugbeschreibungen oder Prompts: die Luecken aus Teil C gehoeren
  in die Phasen, die diese Oberflaeche aendern (T2-15/T2-16/T2-11); diese Phase dokumentiert nur.
- Keine englische Fassung: der Plan fuehrt das Dokument als intern ("dokumentFuerOpenAI: nein");
  eine EN-Fassung entstuende ungeprueft und koennte glatter als die DE-Fassung werden. Die
  Einreichungsdokumente (Listing/Testfaelle) zitieren spaeter aus diesem Dokument.
- Keine Kopie der OpenAI-Seiten ins Repo (Drittinhalt; Zitate genuegen, Abruf im Scratchpad).
- Keine Aenderung an Datenschutzerklaerung/AGB/`apps/web` (Rechtstext = Owner; Website nur ueber
  Labor).
- Kein Abhaken von O-6, O-14, O-15, O-19: das Dokument ist Grundlage, nicht Erfuellung.
- Keine Aenderung an Safety-Gates oder Offenlegungssatz; der Wortlaut des Offenlegungssatzes wird
  nicht umformuliert, nur verortet.
- Keine neue Env-Variable (die vier Orte entfallen).
- Kein Aufruf von Produktion, keine Produktionswerte (Fristen nur als Code-Default).

## Pre-Mortem (geschaerft)
1. Das Dokument erklaert "no telemarketing" oder "human review" als erfuellt, der Owner attestiert
   bei der Einreichung darauf, ein Pruefer findet die fehlende Zweckbindung bzw. das Mandat ohne
   Bereichssperre -> Ablehnung oder spaetere Entfernung ("Previously approved plugins that are later
   found in violation may be removed"). Gegenmittel: Status-Spalte mit "teilweise/Luecke", Teil C,
   Anker-Test; Verifizierer zieht 5 Stichproben am Code.
2. Zitat ist Paraphrase oder aus veraltetem Stand (Usage Policies aendern sich; Effective-Datum
   Oktober 2025). Gegenmittel: Abruf neu, Effective-Datum und Abrufdatum im Dokument, Zitat-Pruefung
   gegen Abrufdatei (Schritt 1); Owner liest vor Attestation die Live-Seite (s. owner_punkte).
3. Faktenblatt nennt Fristen, die in Produktion anders gesetzt sind (Code-Default 30/7/0), und der
   Rechtstext uebernimmt sie -> Datenschutzerklaerung falsch. Gegenmittel: jede Frist als
   "Code-Default, per Umgebungsvariable einstellbar"; Owner gleicht mit Dashboard ab.
4. Empfaenger fehlt (z.B. Sprach-Anbieter mit eigener Aufbewahrung, Recherche-Anbieter, Mail-Dienst)
   -> Datenschutzerklaerung unvollstaendig (O-6). Gegenmittel: Host-grep als reproduzierbarer
   Befehl im Bericht; Sprach-Anbieter-Aufbewahrung ausdruecklich "offen".
5. Das Dokument leakt Interna (Phasen-IDs, Produktionsnummern, Secrets) in ein `docs/OPENAI-*`, das
   spaeter mit eingereicht wird. Gegenmittel: Hygiene-Test (Schritt 6.4).
6. Doku driftet nach T2-11..T2-16 (Zeilen verschieben sich, Beschreibungen aendern sich) und wird
   still falsch. Gegenmittel: Anker- und Zitat-Test brechen dann laut; spaetere Phasen muessen das
   Dokument nachziehen. Akzeptierter Preis: Wartungsaufwand in Folgephasen.
7. Kein Anruf-/Kosten-/Auth-Risiko: die Phase aendert kein Laufzeitverhalten. Der Test startet
   Server mit `PORT=0` und `DATA_DIR`-Temp; Server hinterher beenden, mit `ps` pruefen.

## Owner-Punkte
- Vor der Policy-Attestation bei der Einreichung: die Live-Seiten
  `https://openai.com/policies/usage-policies/` und `https://developers.openai.com/plugins/app-guidelines`
  im Browser oeffnen und das Effective-Datum sowie die im Dokument zitierten Zeilen gegenlesen.
  Erwartet: Effective-Datum und Wortlaut gleich wie im Dokument; sonst Dokument neu abgleichen
  lassen. (Rechtstext-/Attestations-Inhalt = Owner.)
- Rechtstexte (Datenschutzerklaerung/AGB) auf Basis von Teil B schreiben/anpassen: Empfaenger inkl.
  OpenAI/ChatGPT, Art.-9-Hinweis, Fristen mit den PRODUKTIONSwerten aus dem Render-Dashboard
  (`RETENTION_DAYS`, `DIAGNOSTIC_RETENTION_DAYS`, `EVIDENCE_RETENTION_DAYS`), fehlende Kontrollen.
  Erwartet: jede Kategorie/jeder Empfaenger aus Teil B kommt im Rechtstext vor.
- Sprach-Anbieter: `retention_days` passend zur Datenschutzerklaerung setzen. Erwartet: Wert im
  Anbieter-Dashboard entspricht der dort genannten Frist.
- Entscheidung zu Teil C (Zweckbindung, Mandat in sensiblen Bereichen) ist Produktentscheidung fuer
  den Lead/Folgephasen; Owner nur, falls eine Luecke nur per Rechtstext (AGB-Verbot) geschlossen
  werden soll.

## Widersprueche
- Plan: "dokumentFuerOpenAI: nein (intern)" - Lead-Notiz: `docs/OPENAI-*` geht an OpenAI, keine
  internen Kennungen. Aufgeloest nach der strengeren Regel: Dokument ohne interne Kennungen, deutsch,
  keine EN-Fassung in dieser Phase.
- Plan-Abschnitt nennt als ID nur O-18 (deckungsgleich mit der gepinnten Liste); das Faktenblatt
  dient O-6/O-15 (Owner/T2-16), die hier NICHT abgehakt werden.
- Anforderungsdatei (Stand 2026-09-18): Usage Policies "nicht offiziell verifiziert" (403). Heute
  ueber Crawler-Dienst im Volltext abrufbar; openai.com direkt weiterhin 403.
- Plan O-6 nennt den Retention-Sweep `src/boot.js:1255-1256` - stimmt am Worktree.
- Plan N-12/N-13 zitiert `src/mcp-tools.js:682,750` (Stand vor T2-09) - Werkzeuge liegen heute bei
  :1147 ff.; fuer diese Phase nur Hinweis.
- Werkzeugbeschreibung `on_out_of_scope` (`src/mcp-tools.js:1218`) verspricht Verhalten, das auf dem
  Sprach-Agenten-Weg nicht ankommt (`src/elevenlabs/outbound.js:615-617`).
