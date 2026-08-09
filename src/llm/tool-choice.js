// Die drei Werte von LlmRequest.toolChoice (llm/ports.js) als EINE Quelle: Erzeuger
// (precall-briefing.js briefingTooling) und Leser (llm/adapters/*) teilen ein Vokabular,
// das sonst als Roh-String an beiden Enden staende (G22/G27). Muster: llm/messages.js.
//
// DREIWERTIG, bindend aus B2: "auto" und "required" reichen NICHT - briefingTooling hat
// heute einen live erreichbaren dritten Zweig (ein NAMENTLICH erzwungenes Werkzeug).
// AUTO hat heute keinen Erzeuger: agentTurn laesst das Feld weg, damit der Draht
// byte-identisch bleibt (fehlendes Feld = Anbieter-Default). Der Wert bleibt trotzdem
// Teil des Vertrags - ein Vertrag, dessen Wertemenge nur halb existiert, laesst den
// naechsten Adapter raten.
export const LLM_TOOL_CHOICE = Object.freeze({ AUTO: "auto", REQUIRED: "required" });

// Werkzeugwahl "genau dieses eine Werkzeug". Konstruktor statt Objektliteral an der
// Aufrufstelle, damit die Form an EINER Stelle steht (dieselbe Begruendung wie
// providerTurnMessage/toolResultsMessage in llm/messages.js).
export const forcedTool = (name) => ({ tool: name });
