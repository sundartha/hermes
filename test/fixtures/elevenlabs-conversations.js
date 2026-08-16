// ---- ECHTE Anbieter-Antworten als Fixtures ---------------------------------------------
// Phase 2, Owner-Auftrag 15.08.2026, woertlich: "Die Aufzeichnungen werden Fixtures.
// Attrappen antworten ab jetzt mit aufgezeichneten echten Antworten statt mit lokalen
// Konstanten." Jeder Wert unten ist eine TATSAECHLICH beim Anbieter (api.elevenlabs.io)
// GEMESSENE Antwort vom 15.08.2026 - keine lokale Erfindung, AUSSER wo ausdruecklich mit
// "AUSGEDACHT"/"NICHT gemessen" markiert (dann nach der sichereren Seite behandelt statt
// erfunden, s. je Fundstelle unten).
//
// MASKIERT (Absolute Regel 4/5, DSGVO): jede echte Rufnummer lief VOR dem Einchecken durch
// maskNumber (src/util.js) - die Klartext-Nummern existierten nur ausserhalb des Repos, in
// der Mess-Sitzung. Personenbezogene Inhalte in Transkript/Zusammenfassung sind ersetzt:
// der reale Name des Auftraggebers wurde durch den ohnehin in der ganzen Suite genutzten
// Test-Platzhalternamen "Jonas Beispiel" (test/helpers.js OWNER_TEST_FIRST_NAME/
// -LAST_NAME) ausgetauscht - sonst ist am behaltenen Wortlaut kein Zeichen veraendert.
//
// TRIMMED UND ABSICHTLICH SO: jeder Konversations-Datensatz traegt nur die Felder, die
// src/elevenlabs/{convai,outbound}.js tatsaechlich lesen (status, transcript[].role/
// message, analysis?.call_successful, analysis?.transcript_summary,
// metadata?.call_duration_secs) plus ein paar Felder zur Wiedererkennung/Realismus
// (conversation_id, metadata.phone_call, metadata.error, metadata.termination_reason). Die
// vollen Rohantworten (u.a. Kostenaufschluesselung, evaluation_criteria_results,
// conversation_turn_metrics, die zweite, redundante Transkript-Kopie in
// conversation_initiation_client_data.dynamic_variables.system__conversation_history)
// liegen NICHT im Repo - kein Code hier liest sie, sie waeren nur PII-/Groessen-Ballast.

// ---- Teil 1: Fehlerantworten des Ergebnisabrufs (GET /v1/convai/conversations/{id}) ----
// Rein LESEND gegen api.elevenlabs.io gemessen (15.08.2026, s. .fortschritt.md "PHASE 2
// vorgearbeitet: die ECHTEN Fehlerantworten des Ergebnisabrufs"). Form durchgaengig
// {"detail":{type,code,message,status,request_id}}. request_id ist je Anfrage einzigartig
// und wurde nicht dauerhaft mitgeschrieben - hier bewusst WEGGELASSEN statt erfunden
// (unser Code liest den Fehler-Rumpf ohnehin nie, s. convai.js#assertConvaiOk).
export const ERROR_ENVELOPES = Object.freeze({
  // 404: unbekannte/nicht mehr vorhandene Konversations-Kennung - GEMESSEN. Auch eine
  // syntaktisch unsinnige Kennung liefert 404, NICHT 422 (ein 422 auf diesem Pfad ist
  // NICHT belegt). "message" ist NICHT im Fund enthalten (nur type/code/status wurden
  // protokolliert) - hier bewusst weggelassen statt erfunden.
  notFound: Object.freeze({
    httpStatus: 404,
    body: Object.freeze({
      detail: Object.freeze({
        type: "not_found",
        code: "conversation_not_found",
        status: "conversation_history_not_found",
      }),
    }),
  }),
  // 401: unser Schluessel ist gesetzt, aber falsch - GEMESSEN, woertlich.
  unauthorizedBadKey: Object.freeze({
    httpStatus: 401,
    body: Object.freeze({
      detail: Object.freeze({
        type: "authentication_error",
        code: "unauthorized",
        message: "Invalid API key",
        status: "invalid_api_key",
      }),
    }),
  }),
  // 401: gar kein Schluessel mitgeschickt - GEMESSEN, woertlich.
  unauthorizedNoKey: Object.freeze({
    httpStatus: 401,
    body: Object.freeze({
      detail: Object.freeze({
        type: "authentication_error",
        code: "unauthorized",
        message: "Neither authorization header nor xi-api-key received, please provide one.",
        status: "needs_authorization",
      }),
    }),
  }),
});

// ---- Teil 2: vollstaendige Gespraechs-Datensaetze (GET .../conversations/{id}) --------
// Abgerufen am 15.08.2026 gegen den Live-Agenten (agent_5301kwkh9vv3ezesf100pggfj9rs,
// "Hermes"). Die vollen Rohantworten lagen kurzzeitig im Scratchpad der Mess-Sitzung
// (conv_8501m02dx3t7ed7vbbfevrdd39qj.json, conv_0001m02e503qetv8mm6jy5redk1b.json) - NIE
// im Repo, s. Modulkopf oben.

// FAILED: SIP 404 "Invalid destination number" - ein UNGUELTIGES ZIEL, NICHT "niemand hat
// abgenommen" (dieser Fall ist NICHT belegt, s. test/el-fixtures-echte-antworten.test.js).
// analysis ist woertlich `null` (nicht bloss ein leeres Objekt) - GEMESSEN, s.
// .fortschritt.md "KORREKTUR und Vertiefung: was der 'failed'-Datensatz WIRKLICH ist".
export const CONVERSATION_FAILED_INVALID_DESTINATION = Object.freeze({
  conversation_id: "conv_8501m02dx3t7ed7vbbfevrdd39qj",
  status: "failed",
  transcript: Object.freeze([]),
  analysis: null,
  metadata: Object.freeze({
    call_duration_secs: 0,
    termination_reason: "",
    error: Object.freeze({
      code: 404,
      reason: "INVITE failed: sip status: 404: Invalid destination number D11 (SIP 404)",
    }),
    phone_call: Object.freeze({
      direction: "outbound",
      agent_number: "***0177#1ca0c7", // maskNumber() der gewaehlten DID, s. Modulkopf
      external_number: "***0000#8aacb9", // maskNumber() des gewaehlten Ziels (ElevenLabs-Testbereich +1555...)
      call_id: "otb_7701m02dx3t8emg9w4wg6h4vnrek",
    }),
  }),
});

// DONE: ein vollstaendiges, TECHNISCH erfolgreiches Gespraech (149 s). call_successful ist
// woertlich "failure" (GEMESSEN) - der Anbieter bewertet das AUFTRAGSZIEL des Anrufs, nicht
// ob das Telefonat zustande kam (es kam zustande: 149 s, volles Transkript).
// transcript_summary steht bis auf den maskierten Namen UNVERAENDERT (echte Anbieter-
// Antwort, kein Test-Text). transcript ist eine gekuerzte Teilmenge des echten Verlaufs
// (urspruenglich 7 Zeilen, hier 2) - Wortlaut der behaltenen Zeilen unveraendert bis auf
// denselben maskierten Namen.
export const CONVERSATION_DONE_WITH_ANALYSIS = Object.freeze({
  conversation_id: "conv_0001m02e503qetv8mm6jy5redk1b",
  status: "done",
  transcript: Object.freeze([
    Object.freeze({
      role: "agent",
      message:
        "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.",
    }),
    Object.freeze({ role: "user", message: "Okay, cool. What do you want?" }),
  ]),
  analysis: Object.freeze({
    call_successful: "failure",
    transcript_summary:
      'The AI assistant conducted a test call for Jonas Beispiel. The user provided feedback, noting clear audio but slightly off quality, slow pace, and an "American" sounding voice. The user also asked if the AI could perform internet lookups (e.g., weather), to which the AI replied it currently lacks browsing capabilities, its role being limited to the test. The user considered the test a success, finding this version an improvement over the live one, specifically praising the ability to converse indefinitely without interruption. Future enhancements, such as internet browsing tools, were suggested for upcoming tests.',
  }),
  metadata: Object.freeze({
    call_duration_secs: 149,
    termination_reason: "Client disconnected: 1000",
    error: null,
    phone_call: Object.freeze({
      direction: "outbound",
      agent_number: "***0177#1ca0c7",
      external_number: "***2163#1e3c18", // maskNumber() des echten Ziels
      call_id: "otb_4601m02e503rek1b0vxwjvtxtgfw",
    }),
  }),
});

// CLOSE-1008: der Anbieter beendet das WebSocket sofort nach Rufannahme, weil eine
// Pflicht-dynamische-Variable fehlt (hier: owner_name) - tasks/spike2-messung.jsonl,
// testanruf nr.1, conv_5701m00ppcvjeewbat7w0nxxsxrj. call_duration_secs und
// termination_reason sind WOERTLICH GEMESSENE Felder aus dieser Aufzeichnung
// (dortige Felder gespraechsdauer_s bzw. termination_reason).
//
// status IST NICHT GEMESSEN fuer diese Kennung - der volle GET-Rumpf wurde fuer diesen
// Anruf nicht aufgezeichnet, nur die Telnyx-/WebSocket-Ereignisfelder. "done" ist eine
// ANNAHME (Telnyx meldet hangup_cause=NORMAL_CLEARING/telnyx_error_code=D00, also eine
// geordnete Beendigung, kein Anbieter-Fehlschlag auf Telefonie-Ebene) - AUSGEDACHT, kein
// Fund. analysis:null ist ebenfalls NICHT direkt gemessen, aber plausibel (agent_redet:
// false, gemessen - ohne gesprochenen Inhalt kann keine Analyse gelaufen sein), dieselbe
// Form wie der FAILED-Fund oben.
export const CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES = Object.freeze({
  conversation_id: "conv_5701m00ppcvjeewbat7w0nxxsxrj",
  status: "done", // AUSGEDACHT, s. Kommentar oben - fuer DIESE Kennung nicht gemessen
  transcript: Object.freeze([]), // agent_redet:false (gemessen) - der Agent kam nie zu Wort
  analysis: null, // plausibel abgeleitet, NICHT direkt gemessen (s. Kommentar oben)
  metadata: Object.freeze({
    call_duration_secs: 1, // gemessen: gespraechsdauer_s
    termination_reason: "Missing required dynamic variables in first message: {'owner_name'}", // gemessen, woertlich
  }),
});
