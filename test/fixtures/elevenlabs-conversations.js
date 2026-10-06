export const ERROR_ENVELOPES = Object.freeze({
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
      agent_number: "***0177#1ca0c7",
      external_number: "***0000#8aacb9",
      call_id: "otb_7701m02dx3t8emg9w4wg6h4vnrek",
    }),
  }),
});

export const CONVERSATION_FAILED_UNVERIFIED_ORIGINATION = Object.freeze({
  conversation_id: "conv_konstruiert_403_unverified_origination",
  status: "failed",
  transcript: Object.freeze([]),
  analysis: null,
  metadata: Object.freeze({
    call_duration_secs: 0,
    termination_reason: "",
    error: Object.freeze({
      code: 403,
      reason: "unexpected status from INVITE response: sip status: 403: Unverified origination number D51 (SIP 403)",
      error_type: "call_initialization_error",
    }),
  }),
});

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
      external_number: "***2163#1e3c18",
      call_id: "otb_4601m02e503rek1b0vxwjvtxtgfw",
    }),
  }),
});

export const CONVERSATION_IN_PROGRESS = Object.freeze({
  conversation_id: "conv_8801kzzs612ffneskmr32gmsb33t",
  status: "in-progress",
  transcript: Object.freeze([]),
  analysis: null,
  metadata: Object.freeze({
    call_duration_secs: 0,
  }),
});

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

export const CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES = Object.freeze({
  conversation_id: "conv_5701m00ppcvjeewbat7w0nxxsxrj",
  status: "done",
  transcript: Object.freeze([]),
  analysis: null,
  metadata: Object.freeze({
    call_duration_secs: 1,
    termination_reason: "Missing required dynamic variables in first message: {'owner_name'}",
  }),
});

export const JOIN_SCHLUESSEL_ANRUF_2 = Object.freeze({
  startAntwort: Object.freeze({ sip_call_id: "SCL_Qu4voPd3TXvD" }),
  phoneCall: Object.freeze({
    call_id: "otb_4801m08d8gnce3xs4xpka1h3773a",
    call_sid: "SCL_Qu4voPd3TXvD",
  }),
  telnyxDetailRecord: Object.freeze({ sip_call_id: "otb_4801m08d8gnce3xs4xpka1h3773a" }),
});

export const CONVERSATION_MIT_KLAMMER_MARKEN = Object.freeze({
  conversation_id: "conv_6901m0az888dek8t3x1wpzj4mh3z",
  status: "done",
  transcript: Object.freeze([
    Object.freeze({
      role: "agent",
      message:
        "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Antonio Fotiadis. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
    }),
    Object.freeze({
      role: "user",
      message: "Ja, hallo. Ja, das bist du. Ja, du rufst mich an und dann sagst du nix.",
    }),
    Object.freeze({
      role: "agent",
      message:
        "[warmly] Entschuldigen Sie, es gab eine kurze Verzögerung. Ich rufe an, um für Herrn Fotiadis einen Termin für eine Bremsenprüfung zu vereinbaren, idealerweise vormittags in der kommenden Woche.",
    }),
    Object.freeze({
      role: "agent",
      message:
        "[patient] Dazu liegen mir leider keine Angaben vor, das müsste Herr Fotiadis Ihnen direkt mitteilen. Reicht es für die Terminvereinbarung, wenn er die Fahrzeugdaten beim Termin selbst angibt?",
    }),
    Object.freeze({
      role: "agent",
      message: "[Curious] Interessant, werde ich das bei ihm klären. Einen Moment, ich frage kurz nach.",
    }),
    Object.freeze({
      role: "agent",
      message:
        "[confident] Es handelt sich um einen Skoda Octavia Combi, Baujahr zweitausendneunzehn, mit zwei Liter TDI Motor. Passt das für die Terminvereinbarung?",
    }),
  ]),
  analysis: Object.freeze({
    call_successful: "failure",
    transcript_summary: "Vehicle details were retrieved via the consult tool.",
  }),
  metadata: Object.freeze({
    call_duration_secs: 84,
    termination_reason: "Client disconnected: 1000",
    error: null,
    phone_call: Object.freeze({
      direction: "outbound",
      agent_number: "***8341#1ca0c7",
      external_number: "***2163#1e3c18",
      call_id: "otb_6901m0az888dek8t3x1wpzj4mh3z",
    }),
  }),
});

export const CONVERSATION_VORFALL_2026_09_02 = Object.freeze({
  conversation_id: "conv_0501m1hddb92f5d8hktsr4cb813m",
  status: "done",
  transcript: Object.freeze([
    Object.freeze({
      role: "agent",
      message:
        "Hallo Jonas, hier ist dein KI-Assistent. Ich möchte kurz anrufen, um zu testen, ob die Telefonverbindung deines KI-Assistenten funktioniert. Wie sieht es damit aus?",
    }),
    Object.freeze({
      role: "user",
      message:
        "Ja, die Telefonverbindung funktioniert sehr gut. Kannst du mir vielleicht 'ne zehn Sekunden Gedicht machen und erzählen?",
    }),
    Object.freeze({
      role: "agent",
      message:
        "Gut, dann erzähle ich dir ein kurzes Gedicht. [fröhlich] Klar, hier ein kurzes Gedicht:\n\nEin Anruf geht durch Draht und Wind,\ndie Stimme klar, die Worte flink.\nDer Test gelingt, die Leitung hält,\nso bleibt Jonas gut vernetzt mit der Welt.\n\nDer Test war erfolgreich, Jonas! Schönen Abend noch!",
    }),
  ]),
  analysis: Object.freeze({
    call_successful: "failure",
    transcript_summary:
      "Der KI-Assistent rief Jonas an, um die Telefonverbindung zu testen. Jonas bestätigte, dass die Verbindung gut funktionierte und bat den Assistenten, ein kurzes Gedicht vorzutragen. Der Assistent trug ein Gedicht vor, bestätigte den erfolgreichen Test und beendete das Gespräch.",
  }),
  metadata: Object.freeze({
    call_duration_secs: 42,
    termination_reason: "end_call tool was called.",
    error: null,
    phone_call: Object.freeze({
      direction: "outbound",
      agent_number: "***1188#c02909",
      external_number: "***2163#1e3c18",
      call_id: "otb_9501m1hddb93e8et4m1nx0jwy42h",
    }),
  }),
});

export const CONVERSATION_DONE_MIT_KOSTEN = Object.freeze({
  conversation_id: "conv_6301m0dha17kes9ax95jzx19cvt4",
  status: "done",
  transcript: Object.freeze([
    Object.freeze({
      role: "agent",
      message:
        "Hello, this is an AI assistant calling on behalf of Jonas Beispiel. This conversation will be summarised for the person I represent.",
    }),
    Object.freeze({ role: "user", message: "Sure, go ahead." }),
  ]),
  analysis: Object.freeze({
    call_successful: "success",
    transcript_summary: "The AI assistant completed the test call for Jonas Beispiel.",
  }),
  metadata: Object.freeze({
    cost: 526,
    cost_fiat: 0.10420301650668388,
    call_duration_secs: 53,
    termination_reason: "Client disconnected: 1000",
    error: null,
    phone_call: Object.freeze({
      direction: "outbound",
      agent_number: "***0177#1ca0c7",
      external_number: "***2163#1e3c18",
      call_id: "otb_6301m0dha17kes9ax95jzx19cvt4",
    }),
    charging: Object.freeze({
      llm_price: 0.034607,
      llm_charge: 174,
      platform_price: 0.069596,
      platform_charge: 353,
      call_charge: 353,
      tier: "starter",
      analysis: Object.freeze({ price: 0, charge: 0 }),
      llm_usage: Object.freeze({
        "claude-sonnet-5": Object.freeze({
          input: Object.freeze({ tokens: 1200, price: 0.0036 }),
          input_cache_read: Object.freeze({ tokens: 400, price: 0.00012 }),
          input_cache_write: Object.freeze({ tokens: 0, price: 0 }),
          output_total: Object.freeze({ tokens: 900, price: 0.030727 }),
        }),
      }),
      tts_usage: Object.freeze({ model: "eleven_turbo_v2", characters: 612, seconds: 41.2 }),
      asr_usage: Object.freeze({ model: "nova-3", calls: 6, seconds: 53 }),
      free_minutes_consumed: 0.0,
      free_llm_dollars_consumed: 0.0,
    }),
  }),
});

export const HERKUNFT = Object.freeze({
  CONVERSATION_IN_PROGRESS: Object.freeze({ analysis: "ausgedacht" }),
  CONVERSATION_CLOSED_MISSING_DYNAMIC_VARIABLES: Object.freeze({
    status: "ausgedacht",
    analysis: "ausgedacht",
    transcript: "abgeleitet",
  }),
  CONVERSATION_DONE_WITH_DATA_COLLECTION: "ausgedacht",
});
