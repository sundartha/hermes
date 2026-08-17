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

// IN-PROGRESS: der Stand, den GET waehrend eines LAUFENDEN Gespraechs liefert. Die drei
// Felder, auf die es hier ankommt, sind GEMESSEN (tasks/spike1-messung.jsonl, Zeile "art":
// "in-progress-felder", conv_8801kzzs612ffneskmr32gmsb33t: 60 Abfragen im 5-Sekunden-Takt
// ueber 5 Minuten, 59 Vergleiche, NULL Pfad-Aenderungen): status bleibt "in-progress",
// metadata.call_duration_secs bleibt 0, transcript bleibt leer. Der Befund dort woertlich:
// "Die REST-Sicht ist waehrend des Gespraechs tot"; erst beim Uebergang auf "processing"
// erscheinen 59 Pfade auf einen Schlag.
//
// AUSGEDACHT ist alles UEBRIGE an dieser Fixture: der volle GET-Rumpf dieses Gespraechs wurde
// nicht aufgezeichnet, nur die Pfad-Vergleichsliste. `analysis: null` folgt der Form der
// beiden echten Funde oben (ohne Abschluss keine Analyse) und ist fuer DIESE Kennung nicht
// direkt gemessen; die Kennung selbst stammt aus der Messung. Kein Feld hier behauptet mehr,
// als der Fund hergibt - gebraucht wird die Fixture fuer genau eine Frage: eine 0 unter
// status "in-progress" heisst "noch nicht bekannt", nicht "niemand hat abgenommen"
// (s. elevenlabs/outbound.js#answeredAnchorOutcome).
export const CONVERSATION_IN_PROGRESS = Object.freeze({
  conversation_id: "conv_8801kzzs612ffneskmr32gmsb33t",
  status: "in-progress", // gemessen, woertlich
  transcript: Object.freeze([]), // gemessen: bleibt leer, solange das Gespraech laeuft
  analysis: null, // AUSGEDACHT, s. Kommentar oben
  metadata: Object.freeze({
    call_duration_secs: 0, // gemessen: bleibt 0 ueber die gesamte Laufzeit
  }),
});

// AUSGEDACHT (ABNAHME-D1, TEIL 2/3): KEIN gemessener Fund - analysis.data_collection_results
// wurde bislang NIRGENDS aufgezeichnet (Modul-Kopf oben: "kein Code hier liest sie" galt VOR
// diesem Paket). Diese Fixture bildet die FORM nach, die das ElevenLabs-OpenAPI-Schema dafuer
// belegt (DataCollectionResultCommonModel: data_collection_id/value/json_schema/rationale,
// components.schemas im lokal liegenden Schema-Snapshot), mit genau den fuenf Feld-
// Kennungen, die die Vorlage deklariert (elevenlabs/agent_configs/outbound-agent.template.json,
// platform_settings.data_collection: appointment_date/appointment_time/amount/currency/
// confirmed_timezone). transcript/analysis.call_successful/metadata sind selbst erfunden
// (keine echte Aufzeichnung mit befuellten data_collection_results existiert), aber in der
// FORM identisch zu CONVERSATION_DONE_WITH_ANALYSIS oben (derselbe echte Fund). WAS HIER
// NICHT BEHAUPTET WIRD: ob der Anbieter bei einer NICHT im Gespraech vorgekommenen Angabe
// den Schluessel weglaesst, "value":"" liefert oder "value":null - das ist NICHT gemessen.
// Diese Fixture deckt deshalb nur den VOLLSTAENDIG befuellten Fall ab; den fehlenden
// Schluessel (der laut Owner-Auflage der NORMALFALL ist) deckt test/elevenlabs-data-
// collection.test.js separat und ausdruecklich ab (ein Objekt ganz ohne den jeweiligen
// Schluessel), ohne dafuer eine zweite, ebenso ungemessene Fixture-Form zu erfinden.
export const CONVERSATION_DONE_WITH_DATA_COLLECTION = Object.freeze({
  conversation_id: "conv_ausgedacht_data_collection",
  status: "done",
  transcript: Object.freeze([
    Object.freeze({
      role: "agent",
      message: "So March 3rd, 2:30 PM, sixty dollars. Thank you, goodbye.",
    }),
  ]),
  analysis: Object.freeze({
    call_successful: "success",
    transcript_summary: "Booked the brake pad replacement for March 3 at 2:30 PM for $60.00.",
    data_collection_results: Object.freeze({
      appointment_date: Object.freeze({
        data_collection_id: "appointment_date",
        value: "March 3",
        json_schema: null,
        rationale: "AUSGEDACHT - die Gegenstelle nannte das Datum im Gespraech.",
      }),
      appointment_time: Object.freeze({
        data_collection_id: "appointment_time",
        value: "2:30 PM",
        json_schema: null,
        rationale: "AUSGEDACHT - die Gegenstelle nannte die Uhrzeit im Gespraech.",
      }),
      // amount ist am Agenten als type:"number" deklariert (Vorlage) - der Wert kommt hier
      // deshalb bewusst als JS-Zahl, nicht als String, s. collectedValue (elevenlabs/
      // outbound.js), das ihn auf einen String abbildet.
      amount: Object.freeze({
        data_collection_id: "amount",
        value: 60,
        json_schema: null,
        rationale: "AUSGEDACHT - der verhandelte Preis wurde im Gespraech genannt.",
      }),
      currency: Object.freeze({
        data_collection_id: "currency",
        value: "USD",
        json_schema: null,
        rationale: "AUSGEDACHT.",
      }),
      confirmed_timezone: Object.freeze({
        data_collection_id: "confirmed_timezone",
        value: "Eastern time",
        json_schema: null,
        rationale: "AUSGEDACHT - der Angerufene bestaetigte die genannte Zone im Gespraech.",
      }),
    }),
  }),
  metadata: Object.freeze({
    call_duration_secs: 118,
    termination_reason: "Client disconnected: 1000",
    error: null,
    phone_call: Object.freeze({
      direction: "outbound",
      agent_number: "***0177#1ca0c7",
      external_number: "***9999#ausgedacht",
      call_id: "otb_ausgedacht_data_collection",
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

// ---- Teil 3: die Namensfalle des Join-Schluessels ---------------------------------------
// ANRUF 2 vom 17.08.2026 (17:45:41Z bis 17:46:09Z, unsere Kennung call_msxiyh84dwc6,
// Anbieter conv_7201m08d8gnbe7mtygb7vxbphc7y) - GEMESSEN, s. .fortschritt.md "BEFUND 4".
// KEIN Gespraechs-Datensatz, sondern die vier Werte, an denen der Defekt sichtbar wurde:
// ZWEI FELDER HEISSEN AN BEIDEN ENDEN sip_call_id UND TRAGEN VERSCHIEDENE WERTE.
//
// Nur der "otb_"-Wert findet den Telefonie-Beleg. Der "SCL_"-Wert ist ElevenLabs' call_sid -
// derselbe Anruf fuehrt ihn im Gespraechs-Datensatz woertlich unter metadata.phone_call.
// call_sid, und die Antwort des Anrufstarts gibt AUSGERECHNET IHN unter dem Namen
// sip_call_id heraus. In Anruf 1 fiel das nicht auf, weil call_sid dort leer war ("").
//
// HERKUNFT JE WERT (kein Wert ist erfunden):
//   startAntwort.sip_call_id  - nicht als Rumpf mitgeschrieben, aber am ERGEBNIS belegt:
//                               genau dieser Wert stand nach dem Anruf in unserem
//                               sipCallId-Feld, und der Anrufstart war sein einziger
//                               Schreiber (set-once, er lief zuerst).
//   phoneCall.*               - ElevenLabs-Gespraechs-Datensatz, woertlich abgelesen.
//   telnyxDetailRecord.*      - Telnyx GET /v2/detail_records, record_type sip-trunking.
export const JOIN_SCHLUESSEL_ANRUF_2 = Object.freeze({
  startAntwort: Object.freeze({ sip_call_id: "SCL_Qu4voPd3TXvD" }),
  phoneCall: Object.freeze({
    call_id: "otb_4801m08d8gnce3xs4xpka1h3773a",
    call_sid: "SCL_Qu4voPd3TXvD",
  }),
  telnyxDetailRecord: Object.freeze({ sip_call_id: "otb_4801m08d8gnce3xs4xpka1h3773a" }),
});
