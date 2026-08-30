// KOSTEN-V2, Nachtrag: die acht Eigentuemer-Entscheidungen vom 2026-08-30 ins Dokument
// schreiben und die zwei Restmaengel der Abnahme R9 schliessen.
// KEINE weitere Abnahme-Schleife (Lehre abnahme-schleife-konvergiert-nicht): ein
// Schreiber, ein Pruefer, fertig. Modelle an jedem agent() gepinnt.

export const meta = {
  name: "kostenv2-entscheidungen",
  description:
    "Acht getroffene Eigentuemer-Entscheidungen in PLAN-KOSTEN-V2.md eintragen, die sieben offenen Technikpunkte als uebernommene Defaults kennzeichnen, die zwei R9-Restmaengel beheben - dann eine gezielte Gegenprobe.",
  phases: [
    { title: "Eintragen", detail: "Entscheidungen + Defaults + zwei Restmaengel", model: "opus" },
    { title: "Gegenprobe", detail: "Gezielte Pruefung genau dieser Aenderungen", model: "opus" },
  ],
};

const DOK = "tasks/PLAN-KOSTEN-V2.md";
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

const SPARSAM = `KOSTEN (bindend):
- Zitiere KEINE Kommando-Ausgaben woertlich. Zahlen und Trefferzahlen genuegen.
- Keine Testsuite, kein npm test.
- Lies gezielt (grep, sed -n). Das Dokument hat ~2400 Zeilen - lies NIE alles am Stueck,
  sondern springe ueber grep an die Stellen, die du aenderst.
- Halte dich unter ~50 Turns.`;

const REGELN = `REGELN:
- Arbeitsverzeichnis ${REPO}. Am Produktivcode wird NICHTS geaendert - nur ${DOK}.
- Keine Platzhalter, kein TODO. Keine Secrets, keine Rufnummern.
- Deutsch, Fliesstext mit Umlauten.
- Wo du eine Zahl aenderst, greppst du nach JEDER anderen Fundstelle derselben Zahl und
  ziehst sie mit. Zweimal ist in diesem Dokument genau daran ein neuer Defekt entstanden
  (15->16 Katalogzeilen, 9->10 Matrixzeilen).`;

const ENTSCHEIDUNGEN = `DIE ACHT ENTSCHEIDUNGEN (Eigentuemer, 2026-08-30, alle der Empfehlung folgend).
Trage sie in Abschnitt 7 ein - nach dem Muster, das Punkt 9 dort bereits hat: Ueberschrift
um "- ENTSCHIEDEN 2026-08-30" ergaenzt, die gewaehlte Variante benannt, die verworfene
ausdruecklich als verworfen stehen lassen, und der Punkt gilt danach nicht mehr als offen.

1. Kosten-Buch oder Erloes-Buch -> EIGENES KOSTEN-BUCH (call_cost_evidence).
   usage_event bleibt das reine Erloes-Buch.
2. Positive Nachbuchung ueber einen Perioden-/Monatswechsel -> HEUTIGES VERHALTEN
   beibehalten (belastet die laufende Periode).
3. Frist bis zum Zwangs-Settlement -> 48 STUNDEN (COST_SETTLE_DEADLINE_HOURS).
4. Anruf ohne Vollbeleg nach Fristablauf -> DER TENANT TRAEGT DIE SCHAETZUNG.
   Keine Kulanz-Gutschrift ohne Beweis.
5. Tarifform -> ZWEITEILIG: Grundbetrag je Anruf plus Minutensatz.
6. Automatisches Anheben des Tarifs -> NEIN. Der Waechter misst und alarmiert, die Zahl
   setzt ein Mensch.
7. Die 12 EL-Altanrufe rueckwirkend korrigieren -> NEIN. Stattdessen ein einmaliger
   Forensik-Report.
8. Umlage der Plattform-Fixkosten auf Tenants -> NEIN. Sie bleiben Eingaben der
   Preisbildung und stehen sichtbar im Katalog.
13. Haerte des Boot-Riegels gegen den Realtime-Flip -> FATAL (Variante a): der Prozess
   startet mit VOICE_ENGINE=realtime nicht, solange openai_realtime keinen Einsammler hat.

DIE UEBRIGEN OFFENEN PUNKTE (10, 11, 12, 14, 15, 16 und jeder weitere, den du in
Abschnitt 7 findest): der Eigentuemer hat sie NICHT einzeln entschieden. Sie laufen auf
dem im Dokument bereits benannten Default. Kennzeichne jeden davon ausdruecklich als
"DEFAULT UEBERNOMMEN 2026-08-30, nicht ausdruecklich entschieden" und lass die Alternative
samt ihrer Folgestellen stehen - eine spaetere Session muss den Punkt aufmachen koennen,
ohne ihn neu herzuleiten. Erfinde fuer keinen dieser Punkte eine Entscheidung.

WICHTIG bei Punkt 13: die Entscheidung (a) fatal macht die in Punkt 10 benannte
Restluecke des Outbound-TeXML-Zweigs unerreichbar - das ist im Dokument bereits
hergeleitet. Zieh diese Folge an Punkt 10 nach, damit dort nicht weiter ein scharfes
Risiko steht, das durch 13 gerade geschlossen wurde.`;

const RESTMAENGEL = `DIE ZWEI RESTMAENGEL der Abnahme R9 - beide geldrelevant, beide am Code belegt:

(R9-1) Katalogzeile #4 (ai_token), Spalte "Weg ins Buch": der Satz "Faellt auf dem EL-Weg
NICHT an: die Turn-Schleife laeuft dort nicht" ist FALSCH. Zwei Aufrufer buchen auf dem
EL-Weg sehr wohl auf die Gate-Achse, beide AUSSERHALB der Turn-Schleife:
  - fetchPrecallBriefing, src/routes/api-calls.js:279 - das liegt VOR der EL-Weiche in
    :362, der Aufruf ist also nicht engine-abhaengig. Bedingung: Flag PRECALL_BRIEFING_ENABLED.
  - der summarizeCall-Rueckfall, src/telephony/call-finish.js:303-305 - flag-unabhaengig.
Beide laufen ueber bookEstimatedTokenUsage/bookTokenUsage (src/precall-briefing.js:263
bzw. :314) nach store.trackUsage (src/llm-usage.js:66/:77) auf genau die Achse, die
budgetExceeded liest. Pruefe diese Verweise selbst am Code nach, bevor du sie schreibst.
Mitbetroffen und nachzuziehen: Abschnitt 1 (die Aussage "ZWEI Kostentraeger je
Outbound-Anruf" ist unvollstaendig - es sind zwei FREMDE Traeger plus die eigenen Achsen)
und Abschnitt 9 (Punkt "Preisdrift der LLM-Anbieter").
Die Auftragsdatei tasks/kostenv2/AUFTRAG.md ist bereits korrigiert - dort steht die
belegte Fassung unter "KORREKTUR 2026-08-30". Nimm sie als Quelle.

(R9-2) KV2-10, Abnahmekriterium (a) und der Abschnitt "Warum ein einzelner Minutensatz
strukturell falsch ist": Folge von R9-1 und geldrelevant. Die Tarif-Stichprobe wird heute
nur aus EL- und Telnyx-Werten gebildet. Solange der Katalog behauptet, ai_token falle auf
dem EL-Weg nicht an, fehlen Briefing- und Zusammenfassungs-Token in der Stichprobe - der
hergeleitete Tarif und der neue VOICE_TARIFF_FULL_COST_FLOOR_CENTS lagen dann
systematisch UNTER den echten Vollkosten. Schreib den Vollkostenbegriff aus:
"Vollkosten je Anruf" = Summe der Belegzeilen (elevenlabs_convai, telnyx_sip bzw.
telnyx_call_records) PLUS der auf demselben Anruf/Tenant gebuchten Eigen-Achsen #4
(ai_token, inklusive Briefing) und #5 (research_fee). Kriterium (a) entsprechend
erweitern: die Fixture traegt zusaetzlich die gebuchten Eigen-Achsen.
Beachte: Entscheidung 5 ist inzwischen GETROFFEN (zweiteilig). Der Abschnitt "Warum ein
einzelner Minutensatz strukturell falsch ist" ist damit die Begruendung einer getroffenen
Entscheidung, keine Abwaegung mehr - formuliere ihn entsprechend um.`;

phase("Eintragen");
const eintrag = await agent(
  `${SPARSAM}

${REGELN}

Du traegst getroffene Eigentuemer-Entscheidungen in das fertige Strategiedokument ${DOK}
ein und behebst zwei benannte Restmaengel. Du planst NICHTS neu und schreibst das Dokument
NICHT um - jede Aenderung ist punktuell und hier beauftragt.

${ENTSCHEIDUNGEN}

${RESTMAENGEL}

ZULETZT: Abschnitt 7 traegt vermutlich eine Einleitung, die von "offenen" Entscheidungen
spricht, und andere Abschnitte verweisen auf einzelne Punkte als offen. Grep nach solchen
Verweisen und zieh sie nach. Ein Dokument, das vorne "acht offene Fragen" sagt und hinten
acht getroffene Entscheidungen fuehrt, ist die naechste Fehlerquelle.`,
  { label: "eintrag", phase: "Eintragen", model: "opus", effort: "high",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        entscheidungenEingetragen: { type: "integer" },
        defaultsGekennzeichnet: { type: "integer" },
        r9EinsBehoben: { type: "boolean" },
        r9ZweiBehoben: { type: "boolean" },
        nachgezogeneStellen: { type: "array", maxItems: 12, items: { type: "string" },
          description: "Welche weiteren Stellen du wegen der Aenderungen mitgezogen hast." },
        widersprueche: { type: "array", maxItems: 6, items: { type: "string" },
          description: "Was du im Dokument als widerspruechlich vorgefunden und wie du es aufgeloest hast." },
        summary: { type: "string", description: "Max 4 Saetze." },
      },
      required: ["entscheidungenEingetragen", "defaultsGekennzeichnet", "r9EinsBehoben", "r9ZweiBehoben", "nachgezogeneStellen", "widersprueche", "summary"],
    } },
);
log(`Eintrag: ${eintrag ? `${eintrag.entscheidungenEingetragen} Entscheidungen, ${eintrag.defaultsGekennzeichnet} Defaults, R9-1=${eintrag.r9EinsBehoben} R9-2=${eintrag.r9ZweiBehoben}` : "AUSGEFALLEN"}`);
if (!eintrag) return { abbruch: "Eintrag ausgefallen" };

phase("Gegenprobe");
const probe = await agent(
  `${SPARSAM}

${REGELN}

GEZIELTE Gegenprobe - KEINE Vollabnahme des Dokuments ${DOK}. Du pruefst ausschliesslich,
ob die soeben beauftragte Aenderung sauber gelandet ist. Alles andere ist ausdruecklich
NICHT dein Auftrag; melde es hoechstens als Hinweis.

Pruefe:
1. Stehen die neun getroffenen Entscheidungen (Punkte 1-8 und 13) als ENTSCHIEDEN
   2026-08-30 mit der richtigen gewaehlten Variante da? Die Varianten:
   1=eigenes Kosten-Buch, 2=heutiges Verhalten, 3=48 Stunden, 4=Tenant traegt die
   Schaetzung, 5=zweiteiliger Tarif, 6=kein Auto-Anheben, 7=nicht nachbuchen +
   Forensik-Report, 8=nicht umlegen, 13=fatal.
2. Sind die uebrigen Punkte als "DEFAULT UEBERNOMMEN" gekennzeichnet - und wurde fuer
   KEINEN von ihnen eine Entscheidung erfunden?
3. R9-1: behauptet das Dokument noch irgendwo, ai_token falle auf dem EL-Weg nicht an?
   Grep danach. Stimmen die neuen Code-Verweise (api-calls.js:279, call-finish.js:303-305,
   precall-briefing.js:263/:314, llm-usage.js:66/:77)? Schlag sie am Code nach.
4. R9-2: ist der Vollkostenbegriff in KV2-10 ausgeschrieben und enthaelt er die
   Eigen-Achsen #4 und #5?
5. Ist durch die Aenderung ein neuer Widerspruch entstanden - insbesondere bei Zahlen,
   die an mehreren Stellen stehen (Katalog-Zeilenmenge, Matrixzeilen, Phasennummern,
   Frist-Stunden)? Grep jede geaenderte Zahl auf ihre uebrigen Fundstellen.
6. Platzhalter: 0 Treffer erwartet.

Gate ist PASS, wenn 1-4 vollstaendig zutreffen und 5-6 ohne Fund bleiben.`,
  { label: "gegenprobe", phase: "Gegenprobe", model: "opus", effort: "high",
    schema: {
      type: "object", additionalProperties: false,
      properties: {
        gate: { type: "string", enum: ["PASS", "BLOCKED"] },
        entscheidungenKorrekt: { type: "integer" },
        erfundeneEntscheidung: { type: "boolean" },
        maengel: { type: "array", maxItems: 8,
          items: { type: "object", additionalProperties: false,
            properties: { stelle: { type: "string" }, mangel: { type: "string" }, fix: { type: "string" } },
            required: ["stelle", "mangel", "fix"] } },
        urteil: { type: "string", description: "Max 3 Saetze." },
      },
      required: ["gate", "entscheidungenKorrekt", "erfundeneEntscheidung", "maengel", "urteil"],
    } },
);
log(`Gegenprobe: ${probe ? `${probe.gate}, ${probe.entscheidungenKorrekt}/9 korrekt, ${probe.maengel.length} Maengel` : "AUSGEFALLEN"}`);

return {
  dokument: DOK,
  gate: probe ? probe.gate : "UNBEKANNT",
  entscheidungenKorrekt: probe ? probe.entscheidungenKorrekt : null,
  erfundeneEntscheidung: probe ? probe.erfundeneEntscheidung : null,
  restMaengel: probe ? probe.maengel : null,
  urteil: probe ? probe.urteil : null,
  eintragSummary: eintrag.summary,
  nachgezogen: eintrag.nachgezogeneStellen,
};
