// PLANUNGS-WORKFLOW (einmalig): Etappen-Dokument gegen den Outbound-Totalausfall vom
// 2026-08-27 — Wurzel (freigegebene Plattform-Absendernummer) + Folgebefunde F1-F4.
// NUR Doku-Artefakte (PLAN-Dokument, Entscheidungsliste), KEINE Code-Aenderungen.
// Struktur-Vorlage: inbox-plan.js (Planungs-Variante, Lead bleibt duenn).

export const meta = {
  name: "outbound-resilienz-plan",
  description:
    "Outbound-Ausfall 27.08.: Bestandsaufnahme (5 parallele Opus-Leser) -> Entwurf PLAN-OUTBOUND-RESILIENZ.md -> Pre-Mortem + Clean-Code + Skalen-Kritiker -> Revision + Entscheidungsliste.",
  phases: [
    { title: "Bestandsaufnahme", detail: "5 parallele Opus-Leser: Nummern-Lebenszyklus, EL-Fehlerpfad, Beobachtbarkeit, Absender-Wahrheit, Anbieter-Wirklichkeit", model: "opus" },
    { title: "Entwurf", detail: "Etappen-Dokument PLAN-OUTBOUND-RESILIENZ.md entwerfen", model: "opus" },
    { title: "Pruefung", detail: "Pre-Mortem + Clean-Code-Reviewer + Skalen-/Betriebs-Kritiker (parallel)", model: "opus" },
    { title: "Revision", detail: "Befunde einarbeiten, Entscheidungsliste tasks/entscheidungen-outbound-resilienz.md", model: "opus" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const BEFUND = "tasks/befund-outbound-ausfall-2026-08-27.md";
const PLAN_DOC = "PLAN-OUTBOUND-RESILIENZ.md";
const DECISIONS_DOC = "tasks/entscheidungen-outbound-resilienz.md";

// MODELL-POLITIK: Urteilen = Opus, Pins pro agent() (Memory [[workflow-model-policy]]).
const READER_AGENT = { model: "opus", effort: "high" };
const DESIGN_AGENT = { model: "opus", effort: "xhigh" };
const PREMORTEM_AGENT = { model: "opus", effort: "xhigh" };
const CC_AGENT = { model: "opus", effort: "high" };
const SCALE_AGENT = { model: "opus", effort: "xhigh" };
const REVISION_AGENT = { model: "opus", effort: "high" };

const AUFTRAG = `DER AUFTRAG (Owner-Vorgabe 2026-08-27, bindend):

AUSGANGSLAGE: Am 27.08.2026 schlugen ALLE Outbound-Anrufe fehl. Der gemessene Befund liegt in
"${REPO}/${BEFUND}" — LIES IHN ZUERST UND VOLLSTAENDIG. Kurzfassung: eine Rufnummer diente
gleichzeitig als DID eines Test-Tenants UND als Absendernummer (ANI) des gesamten
Produkt-Outbounds. Der DSGVO-Loeschweg dieses Test-Kontos gab die Nummer frei
(audit_log: system:erase-release, 2026-08-24), womit Telnyx jedes SIP-INVITE mit
403 "Unverified origination number" ablehnt. Drei Tage lang bemerkte das niemand.

ZU LOESEN IST (alles, nicht in Teilen):
1. WURZEL: Es darf strukturell unmoeglich werden, dass eine Nummer, die als Plattform-/
   Absendernummer in Benutzung ist, durch irgendeinen Lebenszyklus-Weg (Konto-Loeschung,
   Aufraeumen, Kuendigung, manuelles Release) freigegeben oder umgewidmet wird. "Strukturell"
   heisst: erzwungen im Code/Datenmodell, NICHT per Konvention, Kommentar oder Betriebsdisziplin.
2. F1: Der Anbieter-Fehler muss ausgelesen, klassifiziert und gespeichert werden. Ein Anruf,
   der wegen Konfiguration/Anbieterablehnung nie zustande kam, darf NIE wie "niemand hat
   abgenommen" aussehen — weder im Store, noch in der API, noch fuer den anrufenden Assistenten.
3. F2: Ein fehlgeschlagener Anruf muss BEMERKT werden. Zwei Ebenen: (a) der betroffene Nutzer
   erfaehrt, dass sein Auftrag nicht ausgefuehrt wurde und warum (in einer Sprache, die er
   versteht); (b) der Betreiber erfaehrt von einem SYSTEMATISCHEN Ausfall (mehrere/alle
   Anrufe scheitern, oder eine ganze Klasse scheitert) — ohne dass jemand zufaellig anrufen muss.
4. F3: Die gespeicherte Absendernummer muss die tatsaechlich gesendete sein — oder das System
   muss ehrlich sagen, dass es sie nicht kennt. Zusaetzlich zu entscheiden: ob EINE globale
   Absendernummer fuer ALLE Tenants ueberhaupt das Zielmodell ist (Rueckrufbarkeit!).
5. F4: Drift zwischen unserer Konfiguration und der Wirklichkeit beim Anbieter muss erkannt
   werden, BEVOR ein Kunde es merkt.
6. WIEDERHERSTELLUNG: Der Live-Pfad muss wieder anrufen koennen. Der Plan beschreibt den
   exakten Weg (Anbieter-Konfiguration + Env), fuehrt ihn aber NICHT aus — das ist eine
   Owner-Aktion mit echten Kosten.

QUALITAETSANSPRUCH (woertlich vom Owner): "kein Provisorium, keine Abkuerzung, sondern so
fixen, dass es fuer Millionen von Usern in Ordnung ist." Jede Loesung, die nur fuer den
aktuellen Ein-Nummer-Spike-Aufbau funktioniert, ist damit ausgeschlossen. Wo eine vollstaendige
Loesung heute nicht bezahlbar/baubar ist, wird die Zwischenstufe als solche benannt UND der
Zielzustand beschrieben — nicht stillschweigend als Endzustand ausgegeben.`;

const REGELN = `RAHMENREGELN (CLAUDE.md, unantastbar):
- SAFETY-GATES: per-Tenant-Verifikation als Outbound-Permit, OUTBOUND_FROZEN, Denylist/
  Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Provider-Signaturpruefung
  (Telnyx Ed25519, fail-closed) — nie entfernen, aufweichen oder per Default umgehen. Neue
  Endpunkte, die Calls/SMS ausloesen koennen, brauchen dieselben Gates.
- OFFENLEGUNG: der Offenlegungssatz bei Outbound bleibt fest verdrahtet (Ausnahme nur
  callee_is_owner, eng und fail-closed — s. CLAUDE.md).
- AUTH FAIL-CLOSED: neue Endpunkte standardmaessig hinter authentifizierter Identitaet; jede
  Ausnahme braucht Begruendung + Eintrag in src/route-policy.js (test/route-auth-inventory.test.js).
- SECRETS/PII: niemals loggen, niemals in API-Responses oder MCP-Ausgaben leaken. Rufnummern
  und Gespraechsinhalte sind PII. Beispiel-/Testdaten IMMER erkennbar fiktiv.
- AUDIO laeuft NIEMALS durch MCP.
- SCOPE: nur was der Auftrag verlangt. Beide Store-Backends (json + pg) muessen tragen; pg macht
  DDL beim Boot, Backfill NICHT automatisch (additiv-nullable braucht IMMER einen Backfill-Plan).
- KEINE echten Anrufe/SMS, KEINE Provider-SCHREIBzugriffe, KEIN Deploy in diesem Workflow.
  Lesende GET-Abfragen gegen Telnyx/ElevenLabs sind erlaubt und erwuenscht (Schluessel aus
  "${REPO}/.env"); Schluessel NIE ausgeben, NIE in Dateien schreiben, NIE ins Dokument.
- Konventionen: ESM, kein Build-Step, Kommentare/Doku deutsch OHNE Umlaute; gesprochene und
  nutzer-sichtbare DE-Strings MIT echten Umlauten; Env-Vars in src/config.js + .env.example
  (+ render.yaml pruefen) + test/helpers.js BASE_ENV.`;

// ---------- Phase 1: Bestandsaufnahme (parallel; Barriere gerechtfertigt: der Entwurf
// braucht ALLE fuenf Befunde gemeinsam) ----------
phase("Bestandsaufnahme");
const READER_COMMON = `Du bist ein Bestandsaufnahme-Leser im Repo "${REPO}" (Basis: master, NICHTS aendern).
${AUFTRAG}
${REGELN}
Liefere einen KOMPAKTEN Befund (max ~130 Zeilen) mit file:line-Belegen fuer JEDE Aussage. KEINE
Vermutungen — was du nicht belegt hast, kennzeichnest du als OFFEN. Deine Rueckgabe ist
Arbeitsmaterial fuer den Entwurfs-Agenten, kein Bericht an einen Menschen.`;

const [nummernLebenszyklus, elFehlerpfad, beobachtbarkeit, absenderWahrheit, anbieterWirklichkeit] =
  await parallel([
    () =>
      agent(
        `${READER_COMMON}
DEIN AUSSCHNITT: Nummern-Lebenszyklus und Loeschwege (die WURZEL).
1. Vollstaendiger Lebenszyklus einer Rufnummer im Code: Kauf/Provisionierung
   (src/worker/provisioning.js, src/queue/*, src/onboarding.js), Zuweisung an einen Tenant
   (store number/number_assignment), Freigabe/Release. Wer genau kann eine Nummer freigeben —
   ALLE Aufrufer suchen (grep nach release, erase, delete, did_released, MAX_NUMBERS).
2. Der Weg, der den Ausfall ausgeloest hat: actor "system:erase-release" im audit_log. Finde
   den Code dazu. Was loescht er, in welcher Reihenfolge, welche Vorpruefungen gibt es heute?
   Ist er idempotent, transaktional, wiederholbar?
3. Kennt das Datenmodell heute ueberhaupt den Unterschied zwischen "DID eines Tenants" und
   "Nummer mit Plattform-Rolle (Absender/ANI/Trunk)"? Belege am Schema (src/store/*, Migration/
   DDL in pg.js) und am JSON-Backend. Wenn nein: welche Stellen muessten es lernen?
4. Welche Invarianten gibt es heute rund um Nummern (Boot-Guard, MAX_NUMBERS,
   MAX_NUMBERS_PER_TENANT, Eindeutigkeit) und WO werden sie erzwungen (DB-Constraint? Code?
   Konvention?) — das ist die Messlatte fuer "strukturell erzwungen".
5. Was passiert heute, wenn ein Tenant mit aktiver Nummer geloescht wird, waehrend Anrufe
   laufen? Und was passiert mit einer Nummer, die kein Tenant mehr hat?`,
        { label: "lese-nummern-lebenszyklus", phase: "Bestandsaufnahme", ...READER_AGENT },
      ),
    () =>
      agent(
        `${READER_COMMON}
DEIN AUSSCHNITT: ElevenLabs-Outbound-Fehlerpfad (F1).
1. src/elevenlabs/outbound.js und src/elevenlabs/convai.js VOLLSTAENDIG verstehen: wie ein
   Anruf startet (startCallBody, POST /v1/convai/sip-trunk/outbound-call), was die Antwort
   liefert, wie die Poll-Schleife das Ergebnis abholt, welche Zustaende/Gruende existieren
   (ANSWERED_*-Konstanten, PERMANENT_FETCH_STATUS, classifyCallTime, recordAnsweredUnclearReason).
2. Wo genau wird status=failed gesetzt, wo failure_reason (und warum blieb es hier NULL)?
   Welche Felder des Anbieter-Objekts metadata.* lesen wir heute, welche ignorieren wir?
   Belege, an welcher Stelle metadata.error verfuegbar WAERE.
3. Fehlerklassen: welche Fehlerarten kann dieser Pfad ueberhaupt produzieren (Start-Fehler
   HTTP, SIP-Ablehnung, Zeitueberschreitung, Abbruch mitten im Gespraech, Anbieter nicht
   erreichbar)? Wie unterscheidet der Code sie heute — und wo fallen mehrere Sachverhalte auf
   EIN Label (Repo-Lehre "nie zwei Sachverhalte auf ein Label")?
4. Wer LIEST diese Zustaende: get_call_status/await_call_event/get_transcript in
   src/mcp-tools.js, die REST-Sicht (src/store/views.js publicCall), das Dashboard. Was
   bekommt ein anrufender Assistent heute zu sehen, wenn ein Anruf so scheitert wie am 27.08.?
5. Gibt es denselben Fehlerpfad auch fuer die anderen Engines (Budget/TeXML,
   src/telephony/adapters/telnyx/*, Realtime-Bridge)? Wie klassifizieren DIE einen
   nicht zustande gekommenen Anruf (hangup_cause)? Wo liegt der gemeinsame Nenner fuer eine
   EINHEITLICHE Fehlerklassifikation?`,
        { label: "lese-el-fehlerpfad", phase: "Bestandsaufnahme", ...READER_AGENT },
      ),
    () =>
      agent(
        `${READER_COMMON}
DEIN AUSSCHNITT: Beobachtbarkeit und Benachrichtigung (F2) — Doppelbau vermeiden!
1. Welche Benachrichtigungswege existieren HEUTE im Code? Suche systematisch: notification-
   Tabelle/Store-Konzept, E-Mail-Versand, SMS (src/telephony/adapters/telnyx/messaging.js),
   summary_mail_sent_at/summary_sms_sent_at am Call, Dashboard-Anzeigen, MCP check_inbox /
   list_action_items / get_agent_status. Wer wird heute wann worueber informiert?
2. Was davon traegt "dein Auftrag ist gescheitert"? Gibt es ein Bestands-Konzept fuer
   Nutzer-sichtbare Fehler, oder nur fuer erfolgreiche Gespraeche?
3. BETREIBER-Sicht: was existiert an Health/Monitoring (src/boot-guard.js,
   src/process-guards.js, /healthz, [metrics]-Logzeilen, Render-Log)? Gibt es irgendeine Form
   von Schwellenwert-Alarm im Bestand (Budget-Warnschwelle KS-P9?) — als Vorbild fuer einen
   Ausfall-Alarm. Wie wuerde ein Alarm heute technisch RAUS (E-Mail? Webhook? Nur Log?).
4. Zeitgesteuerte Arbeit: gibt es Cron/Jobs/Worker (src/queue/*, render.yaml, pg-boss)? Render
   Free-Tier-Einschraenkungen im Repo dokumentiert? Das entscheidet, ob ein periodischer Check
   ueberhaupt laufen kann und wo er hingehoert.
5. Urteil am Ende: welcher Bestandsmechanismus kann "Anruf gescheitert" und "systematischer
   Ausfall" tragen, was fehlt wirklich? Nenne konkret die Naht, an der es andocken muesste.`,
        { label: "lese-beobachtbarkeit", phase: "Bestandsaufnahme", ...READER_AGENT },
      ),
    () =>
      agent(
        `${READER_COMMON}
DEIN AUSSCHNITT: Absender-Wahrheit und Telefonie-Naht (F3).
1. Wo wird from_e164 beim Outbound gesetzt? ALLE Schreibwege suchen (grep from_e164, fromE164,
   from:) — fuer JEDE Engine (EL-Pfad, Budget/TeXML-Pfad, Realtime). Welcher Wert steht drin,
   woher stammt er, und deckt er sich mit dem, was der Anbieter tatsaechlich sendet?
2. Die Provider-Abstraktion: src/telephony/ports.js, registry.js, adapters/telnyx/* — welche
   Rolle spielt sie im EL-Pfad UEBERHAUPT (der EL-Pfad ruft ElevenLabs, nicht Telnyx direkt)?
   Laeuft der EL-Outbound an den Ports vorbei? Belege es. Das ist eine Architektur-Aussage,
   die der Entwurf braucht.
3. Wie waehlt das System heute die Absendernummer eines Tenants (Memory-Wissen: Absender MUSS
   eine Provider-DID sein, sonst 403; store.tenantPrivateNumber ist die EIGENE Nummer des
   Nutzers, NICHT der Absender)? Wo liegt der Code, der s.numbers/Tenant-DID zum Absender macht?
4. Multi-Tenant-Zielbild: was muesste passieren, damit JEDER Tenant mit SEINER DID rausgeht
   (Rueckrufbarkeit)? Was haengt daran (EL-Nummernregistrierung pro Tenant? Telnyx-ANI pro
   Anruf? Kosten pro registrierter Nummer?). Nur belegbare Aussagen; Rest als OFFEN markieren.
5. Welche Tests decken die Absenderwahl heute ab (test/*.test.js grepen)? Gibt es einen Test,
   der behauptet, from_e164 sei die gesendete Nummer?`,
        { label: "lese-absender-wahrheit", phase: "Bestandsaufnahme", ...READER_AGENT },
      ),
    () =>
      agent(
        `${READER_COMMON}
DEIN AUSSCHNITT: Anbieter-Wirklichkeit (F4 + Wiederherstellungsweg). NUR LESENDE Abfragen —
niemals POST/PATCH/PUT/DELETE gegen Telnyx oder ElevenLabs, kein Anruf, kein Nummernkauf.
Schluessel aus "${REPO}/.env" (TELNYX_API_KEY, ELEVENLABS_API_KEY) laden, NIE ausgeben.
1. Ist-Zustand bestaetigen (der Befund ${BEFUND} nennt ihn — pruefe ihn nach, er ist die Basis
   des ganzen Plans): GET /v2/phone_numbers, GET /v2/verified_numbers, GET /v2/balance,
   GET /v2/connections + das Detail der FQDN-Connection 3026479542865757220 (ani_override!),
   GET /v1/convai/phone-numbers, GET /v1/convai/agents/<agent-id> falls noetig.
2. WIEDERHERSTELLUNG: welcher exakte Weg macht den Outbound wieder funktionsfaehig? Kann die
   Rufnummer einer registrierten EL-SIP-Nummer geaendert werden (PATCH-Endpunkt vorhanden?)
   oder braucht es eine NEUE Registrierung (POST) + Env-Umstellung
   (ELEVENLABS_AGENT_PHONE_NUMBER_ID)? Pruefe die offizielle Doku via WebFetch/WebSearch
   (docs.elevenlabs.io, developers.telnyx.com) — und sage klar, was belegt ist und was nicht.
   Beschreibe den Weg als Schrittfolge mit den konkreten Endpunkten/Feldern, OHNE ihn auszufuehren.
3. Prueft Telnyx die ANI vor oder nach ani_override? Was bedeutet der Fehlercode "D51"
   ("Unverified origination number") laut Telnyx-Doku genau, und welche Bedingungen erfuellt
   eine zulaessige Absendernummer? Gibt es einen lesenden Endpunkt, mit dem sich VORAB pruefen
   laesst, ob eine Nummer als Origination zulaessig ist (Kandidat fuer den Drift-Check)?
4. DRIFT-CHECK: welche GET-Abfragen zusammen beweisen "unsere Absenderkonfiguration ist noch
   gueltig"? Was kosten sie (Rate-Limits, Preis)? Wie oft duerfte man sie fahren?
5. Kostenlage: Telnyx-Guthaben, Preis einer US-DID vs +49-DID/Monat, was eine EL-Nummern-
   registrierung kostet (falls belegbar). Ausserdem: was ist zur Zustellbarkeit US-ANI -> DE
   belegt (Repo: tasks/*, Memory-Lehre US-DID->DE intermittierend)?`,
        { label: "lese-anbieter-wirklichkeit", phase: "Bestandsaufnahme", ...READER_AGENT },
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
          adressiert: { type: "string", description: "Welchen Befund (WURZEL/F1/F2/F3/F4/WIEDERHERSTELLUNG) diese Etappe schliesst" },
        },
        required: ["id", "titel", "ziel", "adressiert"],
      },
    },
    kernentscheidungen: { type: "array", items: { type: "string" } },
    offeneFragenAnAntonio: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["docPath", "etappen", "kernentscheidungen", "offeneFragenAnAntonio", "summary"],
};
const entwurf = await agent(
  `Du entwirfst das ETAPPEN-DOKUMENT gegen den Outbound-Ausfall im Repo "${REPO}" und schreibst
es nach "${REPO}/${PLAN_DOC}" (Markdown, deutsch OHNE Umlaute, da Doku). KEINE Code-Aenderungen.
${AUFTRAG}
${REGELN}
=== BEFUND 1: NUMMERN-LEBENSZYKLUS ===
${nummernLebenszyklus || "(fehlt)"}
=== BEFUND 2: EL-FEHLERPFAD ===
${elFehlerpfad || "(fehlt)"}
=== BEFUND 3: BEOBACHTBARKEIT ===
${beobachtbarkeit || "(fehlt)"}
=== BEFUND 4: ABSENDER-WAHRHEIT ===
${absenderWahrheit || "(fehlt)"}
=== BEFUND 5: ANBIETER-WIRKLICHKEIT ===
${anbieterWirklichkeit || "(fehlt)"}
=== ENDE BEFUNDE ===
Befunde sind Arbeitsmaterial: bei Zweifel oder Widerspruch liest du die genannten Stellen
SELBST nach, bevor du entscheidest. Der gemessene Ausgangsbefund steht in "${REPO}/${BEFUND}".

ENTWURFS-PFLICHTEN:
1. **Die Wurzel strukturell schliessen.** Entwirf, wie eine Nummer mit Plattform-Rolle im
   Datenmodell erkennbar wird und wie ihre Freigabe UNMOEGLICH wird — nicht "wir passen auf".
   Nenne die Ebene der Durchsetzung (DB-Constraint / Fremdschluessel / fail-closed Vorpruefung
   im einzigen Release-Pfad) und begruende, warum genau DIESE Ebene reicht. Pruefe explizit:
   gibt es MEHRERE Release-Pfade? Dann ist die Durchsetzung an einer Stelle nicht genug —
   entweder alle Pfade fuehren durch EINEN Engpass, oder die Durchsetzung sitzt in der DB.
2. **Fehlerklassifikation vereinheitlichen (F1).** Entwirf EIN Vokabular fuer "warum kam dieser
   Anruf nicht zustande" ueber alle Engines hinweg (nicht nur EL). Anforderungen: Anbieter-
   Fehlercode und -Grund werden gespeichert; "nicht angenommen" und "nie zustande gekommen"
   sind unterscheidbar; der Grund ist maschinen- UND menschenlesbar; PII bleibt draussen.
   Achte auf die Kostenbuchung: ein nie zustande gekommener Anruf darf nichts kosten und nichts
   Erfundenes buchen (bestehende Anker-Logik NICHT brechen).
3. **Benachrichtigung (F2) in zwei Ebenen entwerfen:** (a) Nutzer-Ebene — der anrufende
   Assistent/Nutzer erfaehrt Scheitern UND Grund; entscheide begruendet, ob das ueber den
   bestehenden Rueckgabeweg (get_call_status/await_call_event/Inbox) laeuft oder etwas Neues
   braucht (Single Source of Truth!). (b) Betreiber-Ebene — SYSTEMATISCHER Ausfall wird erkannt
   und gemeldet. Entwirf die Erkennungsregel konkret (woran erkennt man "kaputt" statt
   "unglueckliche Serie"?), den Meldeweg, und die Daempfung gegen Alarm-Rauschen bei Skala
   (Millionen Nutzer = staendig scheitern irgendwo Anrufe; ein Alarm pro Fehlanruf ist Muell).
   Der Ausfall muss auffallen, OHNE dass jemand zufaellig anruft — also auch dann, wenn gar
   keine Anrufe mehr stattfinden.
4. **Absender-Wahrheit (F3):** entscheide, ob from_e164 kuenftig die real gesendete Nummer
   traegt (und woher sie kommt) oder ehrlich als unbekannt gefuehrt wird. Beschreibe zusaetzlich
   das ZIELMODELL fuer Millionen Tenants (jeder mit eigener, rueckrufbarer Absendernummer) und
   was der Weg dorthin kostet — auch wenn nicht alles in diesen Etappen gebaut wird.
5. **Drift-Erkennung (F4):** entwirf die Vorab-Pruefung(en). Kandidaten: Boot-Guard,
   periodischer Check, Pruefung unmittelbar vor dem Waehlen. Entscheide begruendet WELCHE und
   WIE OFT (Kosten/Rate-Limits aus Befund 5), und was bei negativem Ergebnis passiert —
   fail-closed heisst hier NICHT zwingend "keine Anrufe mehr", sondern muss abgewogen werden
   (ein falsch-positiver Check darf nicht das Produkt abschalten). Begruende die Wahl.
6. **Wiederherstellung als eigene Etappe 0:** exakte Schrittfolge (Anbieter-Endpunkte, Felder,
   Env-Variablen, Reihenfolge, Rueckbau), klar markiert als OWNER-AKTION mit Kosten. Sie wird
   in diesem Plan NICHT ausgefuehrt. Nenne das Verifikationskriterium ("woran sieht man, dass es
   wieder geht") OHNE einen echten Anruf vorauszusetzen, plus den echten Testanruf als
   abschliessende Bestaetigung.
7. **Etappen schneiden:** je Etappe unabhaengig mergebar, mit EIGENEM deterministischen
   Abnahmekriterium + Verifikationskommando (workflow.md Regel 7). Richtwert 4-6 Etappen. Je
   Etappe: Ziel, betroffene Dateien, neue Tests, Abnahmepunkte (Kommando + erwartete Ausgabe),
   Rueckbau-Risiko. Reihenfolge so, dass der Kunde frueh geschuetzt ist.
8. **Kein Provisorium:** wo du eine Zwischenstufe vorschlaegst, benenne sie als solche und
   beschreibe den Zielzustand. Der Owner hat ausdruecklich Abkuerzungen verboten.
9. Fragen, die NUR der Owner entscheiden kann (Geld, Rufnummern-Strategie, Alarm-Kanal,
   Produktverhalten), sammelst du unter offeneFragenAnAntonio MIT deiner Empfehlung — sie
   blockieren die Etappen NICHT: du triffst die empfohlene Annahme und vermerkst sie im Dokument.

DOKUMENT-AUFBAU: Kontext/Ausfall-Hergang (kurz, mit Verweis auf ${BEFUND}); Ist-Befund je
Baustelle (mit file:line); Entwurfsentscheidungen mit Begruendung; Zielmodell fuer Skala;
Etappenplan; Abnahmekatalog je Etappe; Testkonzept (node:test offline, beide Store-Backends,
Spawn-Muster, KEINE echten Anrufe); Pre-Mortem-Platzhalter-Abschnitt (fuellt die Revision);
offene Fragen an Antonio (mit Empfehlung + getroffener Annahme).
Fuelle das Schema EHRLICH; docPath ist der geschriebene Pfad.`,
  { label: "entwurf-etappen-dokument", phase: "Entwurf", schema: DESIGN_SCHEMA, ...DESIGN_AGENT },
);

// ---------- Phase 3: Pre-Mortem + Clean-Code + Skalen-Kritiker (parallel; die Revision
// braucht alle drei) ----------
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
const SCALE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    provisorien: { type: "array", items: { type: "string" }, description: "Stellen, die nur fuer den heutigen Ein-Nummer-Aufbau funktionieren" },
    skalenbrueche: { type: "array", items: { type: "string" }, description: "Was bei 1000 / 1 Mio Tenants bricht (mit Begruendung)" },
    luecken: { type: "array", items: { type: "string" }, description: "Vom Auftrag verlangt, im Plan nicht geloest" },
    planAenderungenNoetig: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["provisorien", "skalenbrueche", "luecken", "planAenderungenNoetig", "verdict"],
};
const [premortem, ccPlan, skalen] = await parallel([
  () =>
    agent(
      `PRE-MORTEM (CLAUDE.md-Pflicht) fuer das Etappen-Dokument "${REPO}/${PLAN_DOC}". Versetz
dich EIN JAHR in die Zukunft: der Umbau ist gescheitert oder hat Schaden angerichtet. Frage
rueckwaerts: was ist passiert?
Lies das Dokument VOLLSTAENDIG, dazu "${REPO}/${BEFUND}"; bei Bedarf Code-Stellen selbst
nachlesen (Repo "${REPO}", nichts aendern).
${AUFTRAG}
Pflicht-Blickwinkel (mindestens):
(a) Der Ausfall wiederholt sich in anderer Form — eine andere geteilte Ressource
    (Trunk, Connection, Agent-ID, Schluessel, Webhook-URL) wird durch einen Aufraeumweg
    zerstoert. Deckt der Plan die KLASSE oder nur diesen einen Fall?
(b) Der neue Drift-Check schaltet faelschlich das Produkt ab (falsch-positiv, Anbieter-
    Ausfall, Rate-Limit) — oder er schweigt genau dann, wenn es zaehlt (falsch-negativ).
(c) Der neue Alarm ertrinkt im Rauschen oder erreicht niemanden; oder er leakt PII
    (Rufnummern, Gespraechsinhalte) in einen Kanal, der nicht dafuer gedacht ist.
(d) Die Fehlerklassifikation bricht die Kostenbuchung (erfundene Minuten, doppelte Buchung,
    nicht gebuchte echte Gespraeche) oder die bestehenden Safety-Gates.
(e) Datenmigration: neues Feld/neue Tabelle, json vs pg divergieren, Backfill vergessen,
    Alt-Datensaetze ohne Feld werden falsch interpretiert.
(f) Der Loesch-/Kuendigungsweg wird durch die neue Sperre unbrauchbar — ein Kunde kann sein
    Konto nicht mehr loeschen (DSGVO!), oder eine Nummer bleibt fuer immer bezahlt haengen.
(g) Rueckwaertskompatibilitaet: bestehende MCP-Clients/Dashboard brechen an geaenderten
    Statuswerten oder Antwortformaten.
(h) Die Wiederherstellungs-Etappe geht schief: falsche Nummer eingetragen, Anrufe gehen mit
    fremder/falscher CLI raus, Offenlegungspflicht oder callee_is_owner-Praedikat betroffen.
Jedes Risiko: konkreter Eintrittshergang, Massnahme (oder bewusst akzeptiert mit Begruendung),
Schwere. planAenderungenNoetig = konkrete Aenderungen am Etappen-Dokument.`,
      { label: "premortem", phase: "Pruefung", schema: PM_SCHEMA, ...PREMORTEM_AGENT },
    ),
  () =>
    agent(
      `CLEAN-CODE-REVIEWER fuer das Etappen-Dokument "${REPO}/${PLAN_DOC}" (Plan-Ebene:
verhindert Verstoesse, BEVOR Code entsteht).
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG und "${REPO}/CLAUDE.md"
   (Absolute Regeln + Konventionen + Richtwerte).
2. Lies das Etappen-Dokument VOLLSTAENDIG und "${REPO}/${BEFUND}"; stichprobenartig die
   Code-Stellen, auf die sich der Plan stuetzt (nichts aendern).
3. Pruefe insbesondere:
   - Single Source of Truth: entsteht eine ZWEITE Fehlerklassifikation / ein zweiter
     Benachrichtigungsweg / eine zweite Nummern-Buchfuehrung neben dem Bestand?
   - Naht-Sauberkeit: bleibt Telefonie hinter src/telephony/ports.js, Persistenz hinter der
     Store-Fassade? Wo der EL-Pfad heute an den Ports vorbeilaeuft: verschlimmert der Plan das,
     oder raeumt er auf?
   - Erzwungene statt konventionelle Invarianten (die Repo-Lehre "Fragilitaet =
     Invarianten-per-Konvention"): ist die Wurzel-Sperre wirklich erzwungen?
   - Testbarkeit der Abnahmekriterien: deterministisch? Kommando genannt? Ohne echte Anrufe?
     Reproduziert mindestens EIN Test den Ausfall vom 27.08. (Regressionsfang)?
   - Env-Var-Vollstaendigkeit (src/config.js, .env.example, render.yaml, test/helpers.js
     BASE_ENV) und Namespace-Konvention.
   - Umlaut-Regel (Doku/Kommentare ASCII, nutzer-sichtbare DE-Strings mit Umlauten),
     Magic Numbers, Funktionslaenge/Verschachtelung in den geplanten Bausteinen.
   - Scope-Disziplin je Etappe und route-policy/Auth-Kette fuer neue Endpunkte.
Pro Befund: "Datei/Abschnitt · Verstoss · Fix". blocker=true wenn s1 ODER s2 nicht leer.`,
      { label: "cleancode-plan-review", phase: "Pruefung", schema: CC_PLAN_SCHEMA, ...CC_AGENT },
    ),
  () =>
    agent(
      `SKALEN- UND BETRIEBS-KRITIKER fuer das Etappen-Dokument "${REPO}/${PLAN_DOC}".
Der Owner hat woertlich verlangt: "kein Provisorium, keine Abkuerzung, sondern so fixen, dass
es fuer Millionen von Usern in Ordnung ist." Du bist die Instanz, die das nachprueft.
Lies das Dokument VOLLSTAENDIG, dazu "${REPO}/${BEFUND}" und "${REPO}/CLAUDE.md" (Abschnitt
Kontext/Vision). Code-Stellen bei Bedarf selbst nachlesen (nichts aendern).
${AUFTRAG}
Pruefe schonungslos:
1. PROVISORIEN: welche Loesung funktioniert nur, weil es heute EINE ElevenLabs-Nummer, EINEN
   Trunk, EINEN aktiven Tenant gibt? Was davon ist als Zwischenstufe ehrlich benannt, was ist
   stillschweigend als Endzustand ausgegeben?
2. SKALENBRUECHE: rechne konkret durch — bei 1.000 und bei 1.000.000 Tenants. Nummern-
   Registrierung pro Tenant, Drift-Check-Abfragen (Rate-Limits!), Alarm-Volumen,
   Benachrichtigungskosten, Datenbank-Last, Betriebsaufwand pro Vorfall. Wo bricht es, und ab
   welcher Groessenordnung?
3. LUECKEN: nimm den Auftrag Punkt fuer Punkt (WURZEL, F1, F2, F3, F4, WIEDERHERSTELLUNG) und
   sage fuer JEDEN, ob der Plan ihn wirklich schliesst oder nur beschreibt. Besonders streng bei
   "der Ausfall faellt auf, ohne dass jemand zufaellig anruft" — ein System, das nur bei
   vorhandenem Verkehr Alarm schlaegt, erfuellt das NICHT.
4. BETRIEB: wer macht was, wenn der Alarm um 3 Uhr nachts kommt? Ist der Plan ohne den Owner
   handhabbar (Runbook, Selbstheilung)? Was passiert bei Anbieter-Ausfall, Guthaben-Ende,
   Schluessel-Rotation?
planAenderungenNoetig = konkrete, umsetzbare Aenderungen am Dokument. Sei konkret statt
prinzipiell: jede Kritik nennt die Stelle im Dokument und den besseren Zuschnitt.`,
      { label: "skalen-kritiker", phase: "Pruefung", schema: SCALE_SCHEMA, ...SCALE_AGENT },
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
          adressiert: { type: "string" },
          abnahme: { type: "string", description: "Deterministisches Abnahmekriterium in einem Satz" },
        },
        required: ["id", "titel", "adressiert", "abnahme"],
      },
    },
    eingearbeitet: { type: "array", items: { type: "string" } },
    bewusstAkzeptiert: { type: "array", items: { type: "string" } },
    offeneFragenAnzahl: { type: "number" },
    ownerAktionen: { type: "array", items: { type: "string" }, description: "Was NUR der Owner tun/entscheiden kann (Geld, Anbieter-Schreibzugriff)" },
    summary: { type: "string" },
  },
  required: ["docPath", "decisionsPath", "etappen", "eingearbeitet", "bewusstAkzeptiert", "offeneFragenAnzahl", "ownerAktionen", "summary"],
};
const revision = await agent(
  `Du arbeitest die Pruef-Befunde in das Etappen-Dokument "${REPO}/${PLAN_DOC}" EIN (Datei
direkt ueberarbeiten) und erstellst die Entscheidungsliste "${REPO}/${DECISIONS_DOC}".
KEINE Code-Aenderungen.
${AUFTRAG}
=== PRE-MORTEM ===
${JSON.stringify(premortem, null, 1)}
=== CLEAN-CODE-REVIEW ===
${JSON.stringify(ccPlan, null, 1)}
=== SKALEN-/BETRIEBS-KRITIKER ===
${JSON.stringify(skalen, null, 1)}
=== ENTWURFS-META ===
${JSON.stringify(entwurf, null, 1)}
=== ENDE BEFUNDE ===
PFLICHTEN:
1. JEDEN s1/s2-Befund, JEDE planAenderungNoetig (beider Kritiker) und JEDES Provisorium/jede
   Luecke einarbeiten — oder im Dokument unter "Bewusst akzeptierte Risiken" mit Begruendung
   fuehren. s3/niedrig nach Ermessen. Wo der Skalen-Kritiker ein Provisorium nachweist, muss das
   Dokument entweder die tragfaehige Loesung enthalten oder die Zwischenstufe ausdruecklich als
   solche benennen (Owner-Auflage: keine stillen Abkuerzungen).
2. Pre-Mortem-Ergebnis als eigenen Abschnitt ins Dokument (Risiko, Hergang, Massnahme,
   Schwere) — CLAUDE.md verlangt die Benennung VOR der Umsetzung.
3. "${REPO}/${DECISIONS_DOC}" schreiben: je offene Frage an Antonio ein Block mit Frage,
   Kontext in 2 Saetzen, EMPFEHLUNG mit Begruendung, GETROFFENE ANNAHME (mit der die Etappen
   weiterlaufen), Datum 2026-08-27, Status "offen". Ohne Fachchinesisch — Antonio soll ohne
   Code-Kenntnis entscheiden koennen. Kosten immer in Euro/Dollar beziffern, wenn bekannt.
4. Etappen-Abnahmen scharf ziehen: jede Etappe hat Kommando + erwartete Ausgabe; keine Abnahme
   haengt von einer offenen Frage ab. Mindestens eine Etappe muss einen Test enthalten, der den
   Ausfall vom 27.08. reproduziert (Regressionsfang) — ohne echten Anruf.
5. ownerAktionen sauber trennen: alles, was Geld kostet oder einen SCHREIBzugriff beim Anbieter
   braucht, ist Owner-Aktion und wird im Dokument als solche markiert.
6. Dokument bleibt deutsch OHNE Umlaute (Doku-Konvention dieses Repos). Keine Schluessel, keine
   echten Kundenrufnummern im Dokument.
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
  ownerAktionen: (revision && revision.ownerAktionen) || [],
  premortemVerdict: (premortem && premortem.verdict) || "",
  ccVerdict: (ccPlan && ccPlan.verdict) || "",
  skalenVerdict: (skalen && skalen.verdict) || "",
  ccBlockerOffen: !!(ccPlan && ccPlan.blocker && !(revision && revision.eingearbeitet && revision.eingearbeitet.length)),
  summary: (revision && revision.summary) || (entwurf && entwurf.summary) || "",
};
