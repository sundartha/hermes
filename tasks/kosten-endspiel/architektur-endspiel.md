# Messprotokoll Architekt - Ist-Kosten-Endspiel

Stand 2026-07-21. READ-ONLY. Kein Telnyx-API-Aufruf durch diese Session (Auftragsverbot,
das Rate-Limit ist heute schon einmal gesprengt worden). Alle hier gefuehrten API-Zahlen
stammen aus den Berichten `telnyx-api-vermessung.md` / `doku-recherche-telnyx.md` und sind
als solche gekennzeichnet; alle Code-Zahlen habe ich selbst nachgelesen.

## A. Eigene Messungen (Code, dieser Session)

### A1 Repo-Stand

Befehl:

    git log --oneline -1

Ausgabe:

    d3cecd2 docs: Session-Prompt Ist-Kosten-Endspiel + Sweep-Hilfsskript

Anmerkung: Der Auftrag nennt master=3516c31 als deployten Stand; HEAD traegt einen
Doku-Commit darueber. Kein Widerspruch am Code.

### A2 Der Abruf ist anrufs-AGNOSTISCH (Kern-Fund fuer die Architektur)

Befehl:

    sed -n '300,345p' src/telephony/adapters/telnyx/voice.js

Ausgabe (Auszug):

    async function fetchCostRecordPage(recordType) {
      const q = new URLSearchParams();
      q.set("filter[record_type]", recordType);
      q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));

Befund BELEGT: Die Query traegt AUSSCHLIESSLICH `filter[record_type]` und `page[size]`.
Sie enthaelt weder `legId` noch `startedAt`/`endedAt`. Der Abruf liefert fuer JEDEN Call
byte-identisch dieselbe Antwort. Die Zuordnung passiert vollstaendig client-seitig
(`anchoredSessionIds` / `assignmentOutcome` / `toCostRecord`, Zeilen 220-300).

Konsequenz: die 7 Anfragen je Anruf sind nicht "etwas zu viel", sie sind zu 100 %
redundant. Der geteilte Einzug ist deshalb KEIN Umbau der Zuordnungslogik, sondern das
Herausziehen eines schleifeninvarianten Ausdrucks aus der Kandidatenschleife.

### A3 D3 - die tote fail-closed-Sicherung

Befehl:

    sed -n '42,45p;327,336p' src/telephony/adapters/telnyx/voice.js

Ausgabe:

    const COST_RECORDS_PAGE_SIZE = 250;
    ...
    async function fetchAllCostRecords() {
      const rawRecords = [];
      for (const recordType of COST_RECORD_TYPES) {
        const page = await fetchCostRecordPage(recordType);
        if (!page.ok) return page;
        if (page.raw.length === COST_RECORDS_PAGE_SIZE) return { ok: false, reason: "page_truncated" };
        rawRecords.push(...page.raw);
      }
      return { ok: true, raw: rawRecords };
    }

Befund BELEGT: verglichen wird gegen die ANGEFORDERTE Groesse 250. Laut Sonde S3a deckelt
Telnyx bei 50 (meta.page_size=50 auch bei requested=250). `page.raw.length === 250` kann
auf einer echten Antwort nie wahr werden. Die Sicherung ist tot; `meta` wird nirgends
gelesen (A4).

### A4 D2 - Paginierung fehlt vollstaendig

Befehl:

    grep -n 'page\[number\]\|total_pages\|meta' src/telephony/adapters/telnyx/voice.js

Ausgabe: keine Treffer im Kosten-Abschnitt. `parseTelnyxResource` (Zeile ~93) gibt
`json.data || json` zurueck - das `meta`-Objekt wird strukturell weggeworfen, bevor der
Aufrufer es sehen koennte.

    async function parseTelnyxResource(res) {
      const json = await res.json().catch(() => ({}));
      return json.data || json;
    }

Befund BELEGT: Seite 1 wird als vollstaendig behandelt. Die Information, dass es 5 Seiten
gibt (Sonde: meta.total_pages=5, total_results=212), erreicht den Code nie.

### A5 D4 - der Fehlerpfad kann die Ursache nicht einmal sehen

Befehl:

    sed -n '316,321p' src/telephony/adapters/telnyx/voice.js

Ausgabe:

      } catch {
        return { ok: false, reason: "provider_error" };
      }

Befund BELEGT, praeziser als die Auftragsformulierung: der catch-Block bindet gar keine
Fehlervariable (`catch {`). `assertTelnyxOk(res, ..., ATTACH_STATUS)` haengt zwar
`err.providerStatus` an, aber niemand kann darauf zugreifen. Der HTTP-429 und der
Telnyx-Code 10011 sind im Code nicht nur ungeloggt, sie sind unerreichbar.

### A6 Genau ein produktiver Aufrufer

Befehl:

    grep -rn "getVoiceCostRecords" src/ | grep -v "adapters/telnyx/voice.js"

Ausgabe:

    src/server.js:88:// ... (Kommentar)
    src/telephony/ports.js:113: * @property ... [getVoiceCostRecords]
    src/billing/cost-truing.js:278:    // ... (Kommentar)
    src/billing/cost-truing.js:283:    if (typeof control.getVoiceCostRecords !== "function" || !legId) {
    src/billing/cost-truing.js:290:      result = await control.getVoiceCostRecords({

Befund BELEGT: EIN Aufruf (cost-truing.js:290), ein Typcheck, sonst nur Kommentare/JSDoc.
Twilio implementiert die Methode nicht. Eine Signaturaenderung am Port hat genau eine
Aufrufstelle - der Umbau ist chirurgisch, nicht breit.

### A7 Fensterbreite des Einzugs (aus Code + .env.example)

Befehle:

    sed -n '36p' src/billing/cost-truing.js
    grep -n "COST_TRUING_DELAY_MINUTES\|COST_TRUING_MAX_ATTEMPTS" .env.example

Ausgaben:

    export const COST_TRUING_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
    245:COST_TRUING_DELAY_MINUTES=180
    248:COST_TRUING_MAX_ATTEMPTS=5

Befund BELEGT (Defaults; Produktivwerte auf Render UNBELEGT, s. Restliste): ein Call wird
fruehestens 180 min nach Ende Kandidat und bleibt es ueber bis zu 5 Versuche, also bis zu
5 x 6 h. Aeltester offener Kandidat = 3 h + 30 h = **33 h**. Das ist die Fensterbreite,
die ein geteilter Einzug abdecken muss.

### A8 Kandidaten-Praedikat und Idempotenz

Befehl:

    sed -n '100,110p' src/billing/cost-truing.js

Ausgabe:

      function isTruingCandidate(call, nowMs) {
        if (!isEndedOutbound(call) || call.costTruedAt !== null) return false;
        if (nextCostTruingAttempt(call) > config.billing.costTruingMaxAttempts) return false;

Befund BELEGT: gegen doppelte Korrekturbuchung riegeln ZWEI unabhaengige Mechanismen -
`costTruedAt` (persistiert, gegen sequenzielle Wiederholung) und `sweepRunning`
(prozess-lokal, gegen Verschraenkung). Der prozess-lokale Riegel gilt nur bei EINER
Instanz; das ist im Code selbst als "FAELLT BEIM ERSTEN SKALIERUNGSSCHRITT" vermerkt
(cost-truing.js Modulkommentar, Zeilen 18-21).

### A9 Praezedenz fuer eine tenant-lose Tabelle

Befehl:

    sed -n '486,530p' src/db/schema.sql

Ausgabe (Auszug):

    -- audit_log: immutable append-only. tenant_id BEWUSST KEIN FK ... Keine RLS
    -- (privilegierter Insert-Pfad). WARNUNG: audit_log NIE ueber portalStore/Kunden-Reads
    -- exponieren - ohne RLS gibt es hier kein Sicherheitsnetz gegen einen vergessenen
    -- tenant_id-Filter.

Befund BELEGT: das Muster existiert, inklusive der ausdruecklichen Warnung, was es kostet.
Der RLS-Block darunter listet 14 Tabellen; `audit_log`, `tenant`, `account` fehlen dort.

## B. Uebernommene Messungen (nicht von mir erhoben)

Nur die Werte, auf denen unten gerechnet wird. Quelle jeweils benannt.

| Groesse | Wert | Quelle | Status laut Pruefer |
| --- | --- | --- | --- |
| Rate-Limit /v2/detail_records | 40 Anfragen je 60-s-Fenster | Sonde S7a/S7c | BELEGT |
| Fenster-Mechanik | fix an volle UTC-Minute, nicht gleitend | Sonde S7-zusatz | BELEGT |
| Max. Seitengroesse | 50 (auch bei requested=250/100) | Sonde S3a | BELEGT |
| record_types je Abfrage | genau 1, kein Array/Kombi (400) | Sonde S4c | BELEGT |
| Anzahl abgefragter Typen | 7 | COST_RECORD_TYPES (A2-Datei) | BELEGT |
| Belege je Anruf | 7 / 7 / 10 (3 Anrufe) | LCT-FIX-1 Live-Smoke | BELEGT (n=3) |
| Kosten je Anruf | 0,094267 USD (57 s) | Auftrag/lct-fix-1-spec | BELEGT |
| Heutiger Ist-Sweep | 32 Kandidaten -> 224 Anfragen, 40x200 / 184x429 | Auftrag | BELEGT |
| Zeitfilter sip-trunking | filter[started_at][gte] wirkt (4 Treffer) | Sonde S4a | BELEGT |
| Zeitfilter text-to-speech | filter[created_at][gte] wirkt (2 Treffer) | Sonde S4b | BELEGT |
| Zeitfilter auf falschem Feld | 200 mit 0 Treffern, KEIN Fehler | Sonde S4a | BELEGT |
| Zeitfilter uebrige 5 Typen | ungetestet | Sonde offeneFragen | **UNBELEGT** |
| Sortierung (nur sip-trunking) | absteigend, `sort` wirkungslos | Sonde S3c/S4d | BELEGT fuer 1 Typ |
| Sortierung uebrige 6 Typen | ungetestet | abgeleitet aus S3c-Scope | **UNBELEGT** |
| Beleg-Latenz nach Anrufende | nicht gemessen (nur passiver Proxy) | Sonde S6 | **UNBELEGT** |
| Retention der Belege | in keiner Quelle genannt | Doku Q-DOC2c | **UNBELEGT** |
| Rate-Limit pro Key oder Konto | nur 1 Prozess getestet | Sonde offeneFragen | **UNBELEGT** |
| Anrufe je Nutzer und Tag | nirgends gemessen | - | **UNBELEGT** |
| Bytes je Beleg im RAM | nirgends gemessen | - | **UNBELEGT** |

Der Eintrag "Zeitfilter auf falschem Feld = 200 mit 0 Treffern" ist der wichtigste der
Tabelle. Er ist der exakt gleiche Fehlermodus wie das 297/297-Debakel: ein geratener Name
liefert eine syntaktisch einwandfreie, semantisch leere Antwort. Jede Architektur, die
einen ungemessenen Filternamen einsetzt, ist damit vorverurteilt.

## C. Rechenwege

### C1 Anfragen je Sweep, Option "per Anruf" (Bestand, repariert)

    Anfragen = 7 Typen x C Kandidaten x S Seiten
    C = V / 4   (V = Anrufe je Tag, 4 Sweeps je Tag bei 6-h-Kadenz)
    S >= 1
    => Anfragen(Sweep) = 1,75 x V  (bei S = 1)

Gegenprobe am gemessenen Ist: C = 32 -> 7 x 32 = 224. Gemessen: 224. Die Formel trifft
den beobachteten Wert exakt.

### C2 Anfragen je Sweep, Option "geteilter Einzug"

    Anfragen(Sweep) = Summe ueber die 7 Typen von ceil(n_t / 50)
    untere Schranke: 7      (jeder Typ braucht mindestens eine Anfrage, S4c)
    obere Schranke:  7 + Gesamtbelege_im_Fenster / 50

    Gesamtbelege_im_Fenster = 10 Belege/Anruf x V x (33 h / 24 h) = 13,75 x V
    => Anfragen(Sweep) <= 7 + 0,275 x V

Gegenprobe am heutigen Ist: 32 Kandidaten, ca. 320 Belege ueber 7 Typen (ca. 46 je Typ,
also je 1 Seite) -> **7 bis 14 Anfragen statt 224**. Faktor 16 bis 32.

### C3 Kapazitaet je Sweep-Intervall

    360 min x 40 Anfragen/min = 14.400 Anfragen je 6-h-Intervall
    (theoretisch; kontoweit geteilt mit jedem anderen Verbraucher des Endpunkts)

Betriebs-Schwelle: ein Sweep soll hoechstens 10 % des Intervalls belegen ->
36 min x 40 = **1.440 Anfragen je Sweep**.

## D. Was ich NICHT getan habe

- Kein Telnyx-API-Aufruf, keine Nachmessung der offenen Filternamen.
- Keine Datei unter `src/` angefasst, kein Commit, kein Deploy, kein `npm start`,
  kein `scripts/sweep-jetzt.sh`.
- Keine DB-Anweisung, weder lesend noch schreibend.
- Keine Secrets gelesen oder ausgegeben; die einzige beruehrte Env-Datei ist
  `.env.example` (enthaelt per Definition keine Geheimnisse).
