// LLM-Ports: Vertraege fuer anbieter-unabhaengige Sprachmodell-Aufrufe. Heute genau
// ein Anbieter (Anthropic, im bestehenden Seam src/llm.js). Reine JSDoc-Typdefs,
// keine Laufzeit-Logik.
//
// Besitzverhaeltnis: bleibt im Seam (llm.js), Begruendung bei LlmErrorClassification.
// Ein Adapter liefert Klassifikation (LlmErrorClassification) und seine eigenen Zahlen
// (limits), sonst nichts.
//
// Bewusst NICHT Teil dieses Vertrags, mit Grund:
// - Preise, Waehrung, Geldbetraege: der Port meldet Token, nie Geld. Woertlicher
//   Praezedenzfall am Nachbar-Port telephony/ports.js (VoiceCostRecord): die
//   Umrechnung ist dort ausdruecklich NICHT Teil des Ports. usdToEur bleibt die eine
//   Stellschraube in config.js.
// - Guthaben-/Kontostand-Abfrage: die Perioden-Gegenprobe ist ein geplanter
//   Betriebslauf, kein Aufruf im Gespraechspfad, und hat heute keinen Aufrufer.
// - Modell-Auswahl/Modell-Liste: die Modell-ID kommt heute direkt aus der
//   Konfiguration; welches Modell gewaehlt wird, ist eine spaetere Entscheidung.
// - Prompt-Caching-Steuerung: die cache_control-Marker setzt heute der Aufrufer
//   (claude.js) in Anthropic-Form. Ein neutraler Cache-Hinweis haette eine
//   Implementierung und einen No-op fuer jeden Anbieter ohne eigene Schreib-Rate -
//   Vorratshaltung ohne zweiten Aufrufer.
// - Embeddings, Bildeingaben, JSON-Modus, Denk-Budget, Batch-API: kein heutiger
//   Aufrufer. Jede dieser Faehigkeiten waere eine Wette auf einen Bedarf, den niemand
//   heute hat.
//
// Bewusst NICHT im Kopf, obwohl in der Spezifikation beschrieben: die Vier-Raten-Form
// der Preistabelle. Sie ist eine VertragsFOLGE (LlmTokenUsage.billingModelId macht
// sie noetig), nicht Teil dieses Vertrags selbst - die Preisstaffel-Werte gehoeren
// einer spaeteren Phase.

/**
 * @typedef {Object} LlmTokenUsage
 *   Verbrauch EINER Antwort, aufgeschluesselt nach PREISKLASSE - nicht nach
 *   Anbieter-Feldnamen. Alle Felder Pflicht.
 *
 *   Zusicherungen:
 *   - 0 heisst "keine Token dieser Preisklasse", NIE "unbekannt". Unbekanntes wird
 *     ueber estimated:true gemeldet, nicht ueber eine 0 (Praezedenz:
 *     research/ports.js, PrecallResearchProvider.searchCount - null=unbekannt).
 *   - Vollstaendigkeits-Invariante: jedes vom Anbieter gemeldete Eingabe-Token landet
 *     in GENAU EINER Sorte - keins faellt weg, keins zaehlt doppelt. Meldet der
 *     Anbieter eine Eingabe-Summe, prueft der Adapter die drei Sorten dagegen; meldet
 *     er keine, IST die Summe der drei Sorten die Definition.
 *   - Erweiterungsregel: eine neue Sorte entsteht, wenn ein Anbieter eine eigene RATE
 *     dafuer hat - nie, weil er ein weiteres Feld meldet. Denk-Token, die bereits in
 *     der Ausgabe-Zahl enthalten sind, bekommen keine eigene Sorte; ein Anbieter, der
 *     sie separat bepreist, braucht eine Vertragsaenderung und darf sie nicht in
 *     outputTokens verstecken.
 *
 *   Vom Anbieter gemeldete Felder, die bewusst KEINER Sorte zugeordnet sind, mit Grund
 *   - damit spaeter niemand meint, sie seien uebersehen worden:
 *   - DeepSeek `prompt_tokens` - ableitbar als hit+miss, dient nur als Pruefsumme
 *     gegen die Vollstaendigkeits-Invariante, nicht als Quelle.
 *   - DeepSeek `total_tokens` - ebenfalls ableitbar, eine zweite Quelle fuer dieselbe
 *     Tatsache waere Duplizierung.
 *   - DeepSeek `prompt_tokens_details.cached_tokens` (undokumentiert) - spiegelt
 *     `prompt_cache_hit_tokens` (B1: in allen Stichproben wertgleich); das
 *     undokumentierte Feld ist die schwaechere Zusage und wird deshalb NICHT gelesen.
 *   - DeepSeek `completion_tokens_details.reasoning_tokens` - in `completion_tokens`
 *     bereits enthalten, nicht additiv; siehe Erweiterungsregel oben.
 *
 * @property {number} inputUncachedTokens   - Eingabe-Token zur vollen Eingabe-Rate.
 *   Anthropic `input_tokens`, DeepSeek `prompt_cache_miss_tokens`.
 * @property {number} inputCacheWriteTokens - Eingabe-Token zur Cache-SCHREIB-Rate.
 *   Anthropic `cache_creation_input_tokens`. 0 ist die richtige Angabe fuer einen
 *   Anbieter ohne eigene Schreib-Rate (DeepSeek) - der Schreibvorgang steckt dann
 *   bereits in der Fehltreffer-Zahl (`prompt_cache_miss_tokens`) und ist dort bepreist.
 * @property {number} inputCacheReadTokens  - Eingabe-Token zur Cache-LESE-Rate.
 *   Anthropic `cache_read_input_tokens`, DeepSeek `prompt_cache_hit_tokens`.
 * @property {number} outputTokens          - Ausgabe-Token. Anthropic `output_tokens`,
 *   DeepSeek `completion_tokens` - dessen `reasoning_tokens` sind darin ENTHALTEN,
 *   nicht additiv zu lesen (siehe bewusst-ungelesen-Liste unten).
 * @property {boolean} estimated - false = vom Anbieter gemeldet, true = pessimistische
 *   Obergrenze. Notfall-Regel: verletzt eine Antwort die Vollstaendigkeits-Invariante
 *   oder fehlt eine Zahl, bildet der Adapter alle Eingabe-Token auf
 *   inputUncachedTokens ab (die UNGECACHTE Eingabeklasse) und setzt estimated:true.
 *   Bewusst nicht "die teuerste": die Cache-SCHREIB-Rate liegt bei den hinterlegten
 *   Staffeln ueber der Eingabe-Rate. Eine Schaetzung auf inputCacheWriteTokens haette
 *   eine Token-Sorte behauptet, die nie geflossen ist (Vollstaendigkeits-Invariante). Der
 *   Vertrag entscheidet NICHT, auf welche Buchungs-Achse eine Schaetzung geht, nur
 *   dass sie erkennbar ist - diese Wahl bleibt beim Aufrufer und ist heute bewusst
 *   uneinheitlich (Abriss-Schaetzung mit bereits gesprochenem Text vs. Schaetzung ohne
 *   jedes Ergebnis fuer den Kunden).
 * @property {string} billingModelId - die Modell-ID, unter deren Preisstaffel dieser
 *   Verbrauch gebucht wird. Ein Adapter darf nur eine ID melden, fuer die eine
 *   Preisstaffel existieren KANN, und begruendet seine Wahl (angeforderte vs.
 *   geantwortete ID) im eigenen Adapter-Kommentar. Der Vertrag verlangt die
 *   Begruendung, nicht eine bestimmte Wahl.
 */

/**
 * @typedef {Object} LlmToolCall
 *   Ein vom Modell angeforderter Werkzeugaufruf. Aufrufer: claude.js agentTurn
 *   (liest id/name/input), precall-briefing.js briefingInput (liest name/input).
 * @property {string} id    - Korrelations-ID, geht unveraendert als
 *   LlmToolResult.toolCallId zurueck
 * @property {string} name  - Werkzeugname
 * @property {object} input - bereits GEPARSTE Argumente als Objekt. Das Parsen
 *   gehoert in den Adapter - ein Anbieter liefert die Argumente als JSON-String, ein
 *   anderer bereits als Objekt; dieser Unterschied darf den Aufrufer nie erreichen.
 *   Offen, ausdruecklich nicht hier entschieden: was bei unparsebaren Argumenten
 *   passiert - der Fall wurde bislang nie beobachtet, eine Regel ohne Beobachtung
 *   waere geraten.
 */

/**
 * @typedef {Object} LlmToolResult
 *   Das Ergebnis EINES Werkzeugaufrufs, zurueck an das Modell. Zwei Felder genuegen -
 *   diese Kante ist entscheidbar und hier entschieden (Aufrufer: claude.js agentTurn).
 * @property {string} toolCallId - die id aus LlmToolCall
 * @property {string} text       - Ergebnistext
 */

/**
 * @typedef {Object} LlmTurn
 *   Ergebnis EINER Modellrunde.
 * @property {string} text - zusammengesetzter Antworttext. Zusicherung: die ueber
 *   LlmStreamSink gelieferten Fragmente ergeben aneinandergereiht EXAKT diesen Text.
 *   Ein Adapter, der das bricht, laesst den Anrufer etwas anderes hoeren, als im
 *   Transkript steht.
 * @property {LlmToolCall[]} toolCalls - angeforderte Werkzeugaufrufe; leere Liste =
 *   kein Werkzeug angefordert
 * @property {LlmTokenUsage} usage - immer vollstaendig
 * @property {*} providerTurn - OPAKE Ruecktrage: der Aufrufer reicht diesen Wert
 *   unveraendert in die naechste Anfrage zurueck und LIEST IHN NIE - er gehoert dem
 *   Adapter. Heute ist das die Anthropic-content-Liste, die als
 *   {role:"assistant", content} in die naechste Anfrage zurueckgeht. Was hinter
 *   providerTurn steckt, legt dieser Vertrag bewusst nicht fest - nur dass es die
 *   Ruecktrage gibt, wem sie gehoert, und dass text/toolCalls/usage als neutrale
 *   Felder daneben stehen und vom Aufrufer gelesen werden duerfen.
 * @property {string|null} stopReason - Abbruchgrund DES ANBIETERS, reine Diagnose;
 *   null = der Anbieter meldet keinen. Kein Verhalten haengt daran, einziger Leser
 *   ist eine Logzeile - deshalb freier String ohne Enum, ein Enum ohne
 *   verhaltensrelevanten Leser waere Vorratshaltung. Ausdruecklich NICHT derselbe
 *   Begriff wie der gleichnamige Schleifen-Abbruchgrund in claude.js agentTurn - jener
 *   traegt die EIGENE Schleifen-Abbruchentscheidung und liest niemals einen
 *   Anbieter-Wert.
 */

/**
 * @typedef {Object} LlmStreamSink
 *   Der Abnehmer der Text-Fragmente, vom AUFRUFER gestellt (der Port kennt weder
 *   Saetze noch SSE-Framing). Die Satzbildung liegt beim Aufrufer (claude.js), das
 *   Draht-Framing beim Shim (telnyx-llm-shim.js).
 * @property {(delta: string) => void} pushText - jedes Text-Fragment in Reihenfolge
 * @property {() => void} toolUseStarted - ein Werkzeug-Block hat begonnen; was der
 *   Abnehmer daraus macht, entscheidet er
 */

/**
 * @typedef {Object} LlmRequest
 *   Was ein Aufrufer uebergibt. Aufrufer: claude.js agentTurn, claude.js
 *   summarizeCall, precall-briefing.js fetchPrecallBriefing.
 * @property {string} model - Modell-ID aus der Konfiguration
 * @property {number} maxTokens - harter Ausgabe-Deckel
 * @property {*} system - Systemanweisung; innere Form ist NICHT Teil dieses Vertrags
 * @property {*} messages - Gespraechsverlauf; innere Form ist NICHT Teil dieses
 *   Vertrags
 * @property {*} tools - Werkzeugangebot; innere Form ist NICHT Teil dieses Vertrags
 * @property {"auto"|"required"|{tool: string}} [toolChoice] - Steuerung der
 *   Werkzeugwahl. Drei Werte, nicht zwei: "auto" und "required" reichen fuer die
 *   Steuerung ueber ein Werkzeugangebot, aber precall-briefing.js briefingTooling hat
 *   HEUTE einen dritten, live erreichbaren Zweig - ein NAMENTLICH erzwungenes
 *   Werkzeug (kein Recherche-Anbieter verfuegbar, das Briefing-Tool ist dann das
 *   einzige Angebot). Weder "auto" noch "required" kann das ausdruecken; ein
 *   zweiwertiger Vertrag zwaenge diesen Aufrufer, entweder die Erzwingung aufzugeben
 *   oder am Vertrag vorbei zu bauen.
 * @property {string} [callId] - Bench-/Metrik-Korrelation, KEIN Anbieter-Feld: der
 *   Seam streift ihn ab, bevor die Parameter an den Anbieter gehen.
 * @property {number} [streamBudgetMs] - nur fuer completeStream: Restfrist des Turns
 *   (Wanduhr des AUFRUFERS). Bleibt Aufrufer-Parameter, waehrend der Per-Versuch-
 *   Timeout Adapter-Eigenschaft ist und nicht uebergeben wird (siehe
 *   LlmProvider.limits) - zwei Uhren, zwei Besitzer, beide existieren heute im Seam.
 *   Muster: die Klingelfrist am Telefonie-Port (telephony/ports.js,
 *   CallControlOriginateParams) ist aus demselben Grund kein Parameter, "damit kein
 *   Aufrufer sie versehentlich unterbietet".
 */

/**
 * @typedef {Object} LlmErrorClassification
 *   Was der Adapter zur Fehlerbeurteilung beitraegt - mehr nicht. Breaker,
 *   Retry-Schleife, Backoff, das Praedikat "der Versuch war auf der Leitung", der
 *   Unavailable-Fehlertyp und die Degradations-Wahl bleiben im SEAM (llm.js). Ein
 *   Adapter, der einen eigenen Breaker mitbringt, dupliziert Logik, die genau einmal
 *   existieren darf.
 * @property {(err: *) => boolean} isTransient - true = retrybar. Fehlt die
 *   Klassifikation oder ist sie unsicher, ist FALSE die sichere Antwort: alles gilt
 *   als endgueltig, kein Retry, sofortige Degradation. Die Gegenrichtung waere ein
 *   Retry-Sturm mit doppeltem Token-Verbrauch.
 * @property {(err: *) => boolean} isBillingError - "uns ist beim Anbieter das Geld
 *   ausgegangen" als eigener Zustand; loest heute nur eine Alarm-Zeile aus, KEIN
 *   Gate, KEIN Retry-Verhalten. Genau hier sitzt das Anbieter-Wissen: ein Anbieter
 *   meldet einen eigenen Statuscode, ein anderer verpackt denselben Fall anders und
 *   ist nur am Meldungstext erkennbar - eine Textmarke, die im Bestand ausdruecklich
 *   als fragil dokumentiert ist.
 */

/**
 * @typedef {Object} LlmProvider
 *   Das Port-Objekt.
 *
 *   Zusicherung ueber ALLE Methoden: jede erfolgreiche Antwort - gestreamt oder
 *   nicht - traegt ein vollstaendiges LlmTokenUsage. WIE ein Adapter das erreicht,
 *   ist seine Sache; verlangt die Anbieter-Doku ein Flag dafuer, erzwingt der Adapter
 *   es AUCH DANN, wenn eine Messung zeigt, dass die Angabe auch ohne Flag kaeme -
 *   undokumentiertes Verhalten ist keine Zusage, und das Erzwingen kostet nichts.
 *
 * @property {(request: LlmRequest) => Promise<LlmTurn>} complete - eine Modellrunde
 *   mit Werkzeugen. Ein Adapter ohne complete ist kein LLM-Adapter; fehlt sie, darf
 *   er nicht registriert werden (Muster: die fail-closed werfende Adapter-Auswahl am
 *   Telefonie-Port, telephony/registry.js).
 * @property {(request: LlmRequest, sink: LlmStreamSink) => Promise<LlmTurn>}
 *   completeStream - dieselbe Runde, Text-Fragmente WAEHREND der Generierung an den
 *   Sink; Pflicht, weil daran der Live-Sprechpfad haengt (telnyx-llm-shim.js). Kann
 *   ein Adapter es wirklich nicht, deklariert er die Luecke als Faehigkeits-Flag, das
 *   BEIM BOOT gelesen wird (Muster: providerSupports am Telefonie-Port,
 *   telephony/registry.js), und der Seam faellt fuer den GANZEN Prozess auf complete
 *   zurueck - schlechtere Latenz, aber nie Stille mitten im Anruf.
 *
 *   Bindende Invariante: ein Retry ist verboten, sobald das erste Fragment den Seam
 *   verlassen hat - gestreamter Text ist nicht zurueckholbar. Der Merker dafuer und
 *   die Retry-Entscheidung bleiben im SEAM; ein Adapter bringt keine eigene
 *   Stream-Schleife mit Wiederholung mit. Bewusste, aus dem Bestand uebernommene
 *   Kehrseite: ein transienter Abriss NACH dem ersten Fragment meldet dem Breaker
 *   keinen Fehlversuch.
 * @property {LlmErrorClassification} errors
 * @property {{requestTimeoutMs: number, maxRetries: number, backoffMs: number}}
 *   limits - die Zahlen DIESES Anbieters, OHNE Vorgabewert. Ein Adapter ohne sie
 *   darf nicht in Betrieb gehen. Begruendung: der heutige Per-Versuch-Timeout ist an
 *   einem Anbieter kalibriert und fuer einen anderen Anbieter gemessen zu knapp. Ein
 *   stillschweigend geerbter falscher Wert schneidet unter Last lebende Anfragen ab -
 *   Token entstehen, Antworten kommen nie, und die Schaetzbuchung verbrennt Budget
 *   ohne eine einzige Antwort.
 */

export {};
