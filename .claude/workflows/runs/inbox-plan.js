// PLANUNGS-WORKFLOW (einmalig): Etappen-Dokument fuer die Anruf-Inbox —
// eingehende Anrufe fuer verbundene KI-Assistenten abfragbar machen.
// NUR Doku-Artefakte (PLAN-Dokument, Entscheidungsliste), KEINE Code-Aenderungen.
// Struktur-Vorlage: oc-p3.js; dies ist die Planungs-Variante (Lead bleibt duenn).

export const meta = {
  name: "inbox-plan",
  description:
    "Anruf-Inbox: Bestandsaufnahme (4 parallele Leser) -> Entwurf Etappen-Dokument -> Pre-Mortem + Clean-Code-Review -> Revision + Entscheidungsliste.",
  phases: [
    { title: "Bestandsaufnahme", detail: "4 parallele Opus-Leser: Inbound-Lebenszyklus, Auswertungs-Bestand, MCP/REST/Auth, Store", model: "opus" },
    { title: "Entwurf", detail: "Etappen-Dokument PLAN-ANRUF-INBOX.md entwerfen", model: "opus" },
    { title: "Pruefung", detail: "Pre-Mortem + Clean-Code-Reviewer (parallel)", model: "opus" },
    { title: "Revision", detail: "Befunde einarbeiten, Entscheidungsliste .fortschritt/entscheidungen.md", model: "opus" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const PLAN_DOC = "PLAN-ANRUF-INBOX.md";
const DECISIONS_DOC = ".fortschritt/entscheidungen.md";

// MODELL-POLITIK: Urteilen = Opus, Pins pro agent() (Memory [[workflow-model-policy]]).
const READER_AGENT = { model: "opus", effort: "high" };
const DESIGN_AGENT = { model: "opus", effort: "xhigh" };
const PREMORTEM_AGENT = { model: "opus", effort: "xhigh" };
const CC_AGENT = { model: "opus", effort: "high" };
const REVISION_AGENT = { model: "opus", effort: "high" };

const AUFTRAG = `DER AUFTRAG (Owner-Vorgabe, bindend):
Der MCP-Server bekommt ein neues Werkzeug. Ein verbundener KI-Assistent kann damit nachschauen:
1. Sind neue eingehende Anrufe eingegangen — seit dem letzten Nachschauen?
2. Besteht Handlungsbedarf — und wenn ja, welcher?
Die Antwort je Anruf: wer hat angerufen, was wollte er, was wurde im Gespraech zugesagt, was ist jetzt zu tun. Das ERGEBNIS des Gespraechs, nicht das rohe Transkript. Gibt es nichts Neues, ist die Antwort kurz und eindeutig leer.
Dazu die Verdrahtung im Server: wenn ein eingehender Anruf endet, entsteht daraus automatisch so ein Eintrag.
Beim Entwurf zu klaeren:
- Wann gilt ein Anruf als "neu" und ab wann als "gesehen" — auch wenn derselbe Kunde von mehreren Sitzungen aus fragt.
- Ein Anruf, der beim Empfaenger nie ankam, darf KEINEN Eintrag erzeugen. Pruefen, wie das System solche Faelle heute verbucht.
- Kundendaten und Gespraechsinhalte sind sensibel: nie in Logs, nie in Beispieldaten.`;

const REGELN = `RAHMENREGELN (CLAUDE.md, unantastbar):
- SAFETY-GATES und AUTH FAIL-CLOSED: neue Endpunkte standardmaessig hinter authentifizierter Identitaet; jede Ausnahme braucht Begruendung + route-policy-Eintrag (test/route-auth-inventory.test.js). MCP-Pfad: internalOnly/isTrustedLocalCaller-Muster beachten.
- AUDIO laeuft NIEMALS durch MCP — nur Transkripte/Status/Zusammenfassungen.
- SECRETS/PII: niemals loggen, niemals in API-Responses leaken, die nicht dafuer gedacht sind; Beispiel-/Testdaten IMMER erkennbar fiktiv.
- SCOPE: nur was der Auftrag verlangt. Beide Store-Backends (json + pg) muessen das Feature tragen; pg macht DDL beim Boot, Backfill NICHT automatisch.
- KEINE echten Anrufe/SMS, KEINE Provider-Schreibzugriffe, KEIN Deploy — alles offline belegbar.
- Konventionen: ESM, kein Build-Step, Kommentare deutsch OHNE Umlaute; gesprochene/nutzer-sichtbare DE-Strings MIT echten Umlauten; Env-Vars in src/config.js + .env.example (+ render.yaml pruefen) + test/helpers.js BASE_ENV.`;

// ---------- Phase 1: Bestandsaufnahme (parallel, Barriere gerechtfertigt:
// der Entwurf braucht ALLE vier Befunde gemeinsam) ----------
phase("Bestandsaufnahme");
const READER_COMMON = `Du bist ein Bestandsaufnahme-Leser im Repo "${REPO}" (Basis: master, NICHTS aendern).
${AUFTRAG}
Liefere einen KOMPAKTEN Befund (max ~120 Zeilen) mit file:line-Belegen fuer JEDE Aussage. KEINE Vermutungen — was du nicht belegt hast, kennzeichne als OFFEN. Deine Rueckgabe ist Arbeitsmaterial fuer den Entwurfs-Agenten.`;

const [lebenszyklus, auswertung, mcpSeam, storeBefund] = await parallel([
  () =>
    agent(
      `${READER_COMMON}
DEIN AUSSCHNITT: Inbound-Anruf-Lebenszyklus.
1. Wie entsteht und endet heute ein EINGEHENDER Anruf? Alle live relevanten Pfade: Budget-Engine (Gather/STT), Realtime-Bridge, und der ElevenLabs-/Assistant-Pfad falls er Inbound traegt (grep nach Webhooks, post-call, hangup). Startpunkte: src/routes/voice.js bzw. src/server.js, src/telephony/adapters/telnyx/*, src/bridge.js (NUR lesen, nicht anfassen).
2. Was wird pro Anruf im Store abgelegt (Felder, Statuswerte, direction, Zeitstempel, hangup_cause, Dauer)? Wo genau wird ein Anruf als beendet markiert (die exakten Hook-Punkte je Pfad)?
3. Wie verbucht das System heute Anrufe, die NIE ankamen (nicht angenommen, besetzt, failed, Anrufer legt vor Annahme auf)? Welche Status-/Feldwerte unterscheiden sie von echten Gespraechen? Das ist die Grundlage fuer die Regel "nie angekommen = kein Eintrag".
4. Entsteht heute schon eine Zusammenfassung am Gespraechsende (src/claude.js Summaries)? Fuer welche Pfade, wo gespeichert, in welcher Sprache/Struktur?`,
      { label: "lese-inbound-lebenszyklus", phase: "Bestandsaufnahme", ...READER_AGENT },
    ),
  () =>
    agent(
      `${READER_COMMON}
DEIN AUSSCHNITT: bestehende Auswertungs-/Nachrichten-Maschinerie (Doppelbau vermeiden!).
1. src/mcp-tools.js VOLLSTAENDIG: welche Werkzeuge existieren (insb. list_calls, list_action_items, get_transcript, get_agent_status, take_message-artiges)? Was geben sie zurueck, welche REST-Endpunkte rufen sie?
2. Gibt es im Store bereits ein Konzept "Action Item" / "Nachricht" / "Handlungsbedarf"? Wo entsteht es (Tool-Aufruf im Gespraech? Am Ende?), wie ist es strukturiert, ist es pro Tenant?
3. Wer schreibt heute call.summary o.ae. und was steht drin (Struktur, Sprache)? Gibt es "gesehen/ungelesen"-Zustaende irgendwo im Bestand (Dashboard, Portal-Views, views.js)?
4. Urteil am Ende: was davon kann das neue Werkzeug WIEDERVERWENDEN, was fehlt wirklich? (Single Source of Truth — keine zweite Parallel-Maschinerie bauen.)`,
      { label: "lese-auswertungs-bestand", phase: "Bestandsaufnahme", ...READER_AGENT },
    ),
  () =>
    agent(
      `${READER_COMMON}
DEIN AUSSCHNITT: MCP-/REST-/Auth-Naht (wie ein neues Werkzeug sauber andockt).
1. Wie laeuft /mcp (Streamable HTTP) heute — insbesondere: der Pfad ist STATELESS (Memory-Wissen); was heisst das fuer per-Sitzung-Zustand? Wie identifiziert sich ein MCP-Client (Legacy-Token vs OAuth/OIDC, src/auth.js), und was davon ist pro TENANT vs pro SITZUNG?
2. Wie sprechen MCP-Tools mit der REST-API (src/mcp-tools.js -> /api/*)? internalOnly/isTrustedLocalCaller-Muster? Wie wird tenantContext durchgereicht?
3. Was braucht ein NEUER REST-Endpunkt, damit test/route-auth-inventory.test.js gruen bleibt (route-policy, Middleware-Kette)? Ein Bestandsbeispiel Schritt fuer Schritt benennen (z.B. der Endpunkt hinter list_calls).
4. Wie werden MCP-Tool-Ausgaben heute gegen Leaks gehalten (was darf raus: Transkripte ja, Secrets nein)? Gibt es Groessen-/Format-Konventionen fuer Tool-Antworten (auch stdio-Variante src/mcp-server.js)?`,
      { label: "lese-mcp-rest-auth", phase: "Bestandsaufnahme", ...READER_AGENT },
    ),
  () =>
    agent(
      `${READER_COMMON}
DEIN AUSSCHNITT: Store & Persistenz (json UND pg).
1. Aufbau der Persistenz-Fassade src/store.js + src/store/ (defaults.js, state-ops.js, views.js, json.js, pg.js): wie kommt ein NEUES per-Tenant-Datum sauber rein (Defaults, Migration/DDL beim Boot, RLS app.current_tenant-Gotcha)?
2. Wie sind Anruf-Datensaetze heute gespeichert (welche Collection/Tabelle, Indexe, wie liest man "alle Inbound-Anrufe eines Tenants seit X" effizient in BEIDEN Backends)?
3. Gibt es Bestands-Muster fuer Cursor/Zaehler/Markierungen pro Tenant (usage, budget, seenAt-artiges), die als Vorbild fuer "gesehen bis"-Semantik taugen?
4. Test-Muster: wie testen Bestands-Tests Store-Verhalten gegen beide Backends? Spawn-Server-Muster mit DATA_DIR-Override; test/helpers.js BASE_ENV-Falle (neue Env-Var MUSS dort rein). Wie sehen erkennbar fiktive Fixture-Rufnummern im Bestand aus?`,
      { label: "lese-store-persistenz", phase: "Bestandsaufnahme", ...READER_AGENT },
    ),
]);

// ---------- Phase 2: Entwurf ----------
phase("Entwurf");
const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    docPath: { type: "string" },
    etappen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          titel: { type: "string" },
          ziel: { type: "string" },
        },
        required: ["id", "titel", "ziel"],
      },
    },
    kernentscheidungen: { type: "array", items: { type: "string" } },
    offeneFragenAnAntonio: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["docPath", "etappen", "kernentscheidungen", "offeneFragenAnAntonio", "summary"],
};
const entwurf = await agent(
  `Du entwirfst das ETAPPEN-DOKUMENT fuer die Anruf-Inbox im Repo "${REPO}" und schreibst es nach "${REPO}/${PLAN_DOC}" (Markdown, deutsch OHNE Umlaute, da Doku). KEINE Code-Aenderungen.
${AUFTRAG}
${REGELN}
=== BEFUND 1: INBOUND-LEBENSZYKLUS ===
${lebenszyklus || "(fehlt)"}
=== BEFUND 2: AUSWERTUNGS-BESTAND ===
${auswertung || "(fehlt)"}
=== BEFUND 3: MCP/REST/AUTH ===
${mcpSeam || "(fehlt)"}
=== BEFUND 4: STORE/PERSISTENZ ===
${storeBefund || "(fehlt)"}
=== ENDE BEFUNDE ===
Befunde sind Arbeitsmaterial: bei Zweifel oder Widerspruch liest du die genannten Stellen SELBST nach, bevor du entscheidest.
ENTWURFS-PFLICHTEN:
1. **Wiederverwenden vor Neubauen:** entscheide begruendet, ob das neue Werkzeug auf list_calls/list_action_items/Summary-Bestand aufsetzt oder etwas Neues braucht. Keine zweite Parallel-Maschinerie fuer dieselbe Frage (Single Source of Truth).
2. **"Neu vs gesehen" praezise entwerfen:** serverseitig, pro Tenant (NICHT pro MCP-Sitzung — /mcp ist stateless und derselbe Kunde fragt aus mehreren Sitzungen). Explizit entscheiden: implizites Als-gesehen-Markieren beim Abruf vs expliziter Bestaetigungs-Cursor — mit Begruendung und Verhalten bei Race (zwei Sitzungen fragen gleichzeitig).
3. **"Nie angekommen = kein Eintrag" fail-closed verdrahten:** exakte Bedingung aus den Ist-Statuswerten ableiten (Befund 1); Grenzfaelle benennen (Anrufer legt nach 1 s auf, Gespraech ohne ein einziges Nutzer-Wort, technischer Abbruch mitten im Gespraech).
4. **Datenschutz:** welche Felder verlassen den Server ueber das Werkzeug; was davon darf in Logs (Antwort: keine Inhalte, keine Klarnummern — pruefe Logging-Bestand); Fixtures erkennbar fiktiv.
5. **Etappen schneiden** (je Etappe unabhaengig mergebar, mit EIGENEM deterministischen Abnahmekriterium + Verifikationskommando, workflow.md Regel 7). Richtwert 2-4 Etappen. Je Etappe: Ziel, betroffene Dateien, neue Tests, Abnahmepunkte (Kommando + erwartete Ausgabe), Rueckbau-Risiko.
6. **Beide Engines/Pfade:** der Eintrag muss fuer JEDEN live relevanten Inbound-Pfad entstehen (Befund 1) — oder du begruendest, warum ein Pfad aussen vor bleibt.
7. Fragen, die NUR der Owner entscheiden kann (Produktverhalten, Wortlaut, Datensparsamkeit), sammelst du unter offeneFragenAnAntonio MIT deiner Empfehlung — sie blockieren die Etappen NICHT: du triffst die empfohlene Annahme und vermerkst sie im Dokument.
DOKUMENT-AUFBAU: Kontext/Auftrag; Ist-Befund (kurz, mit file:line); Entwurfsentscheidungen mit Begruendung; Etappenplan; Abnahmekatalog je Etappe; Testkonzept (node:test offline, beide Store-Backends, Spawn-Muster); offene Fragen an Antonio (mit Empfehlung + getroffener Annahme).
Fuelle das Schema EHRLICH; docPath ist der geschriebene Pfad.`,
  { label: "entwurf-etappen-dokument", phase: "Entwurf", schema: DESIGN_SCHEMA, ...DESIGN_AGENT },
);

// ---------- Phase 3: Pre-Mortem + Clean-Code-Review (parallel; Revision braucht beide) ----------
phase("Pruefung");
const PM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    risiken: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          risiko: { type: "string" },
          eintritt: { type: "string", description: "Wie es passiert ist (Rueckblick aus einem Jahr)" },
          massnahme: { type: "string", description: "Entschaerfung ODER 'bewusst akzeptiert, weil ...'" },
          schwere: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
        },
        required: ["risiko", "eintritt", "massnahme", "schwere"],
      },
    },
    planAenderungenNoetig: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["risiken", "planAenderungenNoetig", "verdict"],
};
const CC_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" }, description: "Blocker: Plan verletzt Katalog/CLAUDE.md-Regel" },
    s2: { type: "array", items: { type: "string" }, description: "Schwer: fuehrt absehbar zu Katalog-Verstoss im Code" },
    s3: { type: "array", items: { type: "string" }, description: "Verbesserung" },
    blocker: { type: "boolean" },
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "blocker", "verdict"],
};
const [premortem, ccPlan] = await parallel([
  () =>
    agent(
      `PRE-MORTEM (CLAUDE.md-Pflicht) fuer das Etappen-Dokument "${REPO}/${PLAN_DOC}". Versetz dich EIN JAHR in die Zukunft: das Feature ist gescheitert oder hat Schaden angerichtet. Frage rueckwaerts: was ist passiert?
Lies das Dokument VOLLSTAENDIG; bei Bedarf Code-Stellen selbst nachlesen (Repo "${REPO}", nichts aendern).
${AUFTRAG}
Pflicht-Blickwinkel (mindestens): (a) PII/Transkript-Leak ueber das neue Werkzeug, Logs oder Fixtures; (b) Eintraege fuer nie angekommene Anrufe oder verpasste Eintraege fuer echte Gespraeche (beide Richtungen!); (c) "gesehen"-Races bei mehreren Sitzungen desselben Kunden — verlorene oder doppelt gemeldete Anrufe; (d) Kosten (zusaetzliche LLM-Zusammenfassungen? Polling-Last auf /mcp?); (e) json/pg-Divergenz und Migrations-Falle (DDL beim Boot, Backfill nicht automatisch); (f) Multi-Tenant-Leck (Tenant A sieht Eintraege von Tenant B); (g) Rueckwaertskompatibilitaet bestehender MCP-Clients.
Jedes Risiko: konkreter Eintrittshergang, Massnahme (oder bewusst akzeptiert mit Begruendung), Schwere. planAenderungenNoetig = konkrete Aenderungen am Etappen-Dokument.`,
      { label: "premortem", phase: "Pruefung", schema: PM_SCHEMA, ...PREMORTEM_AGENT },
    ),
  () =>
    agent(
      `CLEAN-CODE-REVIEWER fuer das Etappen-Dokument "${REPO}/${PLAN_DOC}" (Plan-Ebene: verhindert Verstoesse, BEVOR Code entsteht).
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG und "${REPO}/CLAUDE.md" (Regeln + Konventionen).
2. Lies das Etappen-Dokument VOLLSTAENDIG; stichprobenartig die Code-Stellen, auf die es sich stuetzt (nichts aendern).
3. Pruefe insbesondere: Single Source of Truth (keine zweite Maschinerie neben list_action_items/Summaries, keine zweite "gesehen"-Logik); Naht-Sauberkeit (Store-Fassade respektiert, Telephonie nur ueber Ports); Testbarkeit der Abnahmekriterien (deterministisch? Kommando genannt?); Env-Var-Vollstaendigkeit (config.js, .env.example, render.yaml, BASE_ENV); Umlaut-Regel (Doku/Kommentare ASCII, nutzer-sichtbare DE-Strings mit Umlauten); Scope-Disziplin der Etappen; route-policy/Auth-Kette fuer neue Endpunkte.
Pro Befund: "Datei/Abschnitt · Verstoss · Fix". blocker=true wenn s1 ODER s2 nicht leer.`,
      { label: "cleancode-plan-review", phase: "Pruefung", schema: CC_PLAN_SCHEMA, ...CC_AGENT },
    ),
]);

// ---------- Phase 4: Revision ----------
phase("Revision");
const REV_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    docPath: { type: "string" },
    decisionsPath: { type: "string" },
    etappen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          titel: { type: "string" },
          abnahme: { type: "string", description: "Deterministisches Abnahmekriterium in einem Satz" },
        },
        required: ["id", "titel", "abnahme"],
      },
    },
    eingearbeitet: { type: "array", items: { type: "string" } },
    bewusstAkzeptiert: { type: "array", items: { type: "string" } },
    offeneFragenAnzahl: { type: "number" },
    summary: { type: "string" },
  },
  required: ["docPath", "decisionsPath", "etappen", "eingearbeitet", "bewusstAkzeptiert", "offeneFragenAnzahl", "summary"],
};
const revision = await agent(
  `Du arbeitest die Pruef-Befunde in das Etappen-Dokument "${REPO}/${PLAN_DOC}" EIN (Datei direkt ueberarbeiten) und erstellst die Entscheidungsliste "${REPO}/${DECISIONS_DOC}". KEINE Code-Aenderungen.
${AUFTRAG}
=== PRE-MORTEM ===
${JSON.stringify(premortem, null, 1)}
=== CLEAN-CODE-REVIEW ===
${JSON.stringify(ccPlan, null, 1)}
=== ENTWURFS-META ===
${JSON.stringify(entwurf, null, 1)}
=== ENDE BEFUNDE ===
PFLICHTEN:
1. JEDEN s1/s2-Befund und JEDE planAenderungNoetig einarbeiten oder im Dokument unter "Bewusst akzeptierte Risiken" mit Begruendung fuehren. s3/niedrig nach Ermessen.
2. Pre-Mortem-Ergebnis als eigenen Abschnitt ins Dokument (Risiko, Hergang, Massnahme, Schwere) — CLAUDE.md verlangt die Benennung VOR der Umsetzung.
3. "${REPO}/${DECISIONS_DOC}" schreiben (Verzeichnis anlegen): je offene Frage an Antonio ein Block mit: Frage, Kontext in 2 Saetzen, EMPFEHLUNG mit Begruendung, GETROFFENE ANNAHME (mit der die Etappen weiterlaufen), Datum 2026-08-21, Status "offen". Ohne Fachchinesisch — Antonio soll ohne Code-Kenntnis entscheiden koennen.
4. Etappen-Abnahmen scharf ziehen: jede Etappe hat Kommando + erwartete Ausgabe; keine Abnahme haengt von einer offenen Frage ab.
5. Dokument bleibt deutsch OHNE Umlaute (Doku-Konvention dieses Repos).
Fuelle das Schema EHRLICH.`,
  { label: "revision-final", phase: "Revision", schema: REV_SCHEMA, ...REVISION_AGENT },
);

// ---------- POSTAGE-STAMP-RETURN ----------
return {
  docPath: (revision && revision.docPath) || PLAN_DOC,
  decisionsPath: (revision && revision.decisionsPath) || DECISIONS_DOC,
  etappen: (revision && revision.etappen) || (entwurf && entwurf.etappen) || [],
  kernentscheidungen: (entwurf && entwurf.kernentscheidungen) || [],
  eingearbeitet: (revision && revision.eingearbeitet) || [],
  bewusstAkzeptiert: (revision && revision.bewusstAkzeptiert) || [],
  offeneFragenAnzahl: revision ? revision.offeneFragenAnzahl : null,
  premortemVerdict: (premortem && premortem.verdict) || "",
  ccVerdict: (ccPlan && ccPlan.verdict) || "",
  ccBlockerOffen: !!(ccPlan && ccPlan.blocker && !(revision && revision.eingearbeitet && revision.eingearbeitet.length)),
  summary: (revision && revision.summary) || (entwurf && entwurf.summary) || "",
};
