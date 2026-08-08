// Die neutrale Nachrichten-Form der Werkzeug-Schleife: die EINE Stelle, an der Erzeuger
// (claude.js agentTurn) und Leser (llm/adapters/*) sich auf eine Form einigen - keiner
// von beiden besitzt das Vokabular des anderen (G13/G22). B3a fuehrt genau die zwei
// Formen ein, die die ANTWORTSEITE braucht: die opake Ruecktrage einer Modellrunde und
// die Werkzeug-Ergebnisse dazu. Der uebrige Verlauf bleibt bis B3b in Bestandsform
// ({role, content:<String>}) und wird vom Adapter unveraendert durchgereicht.
export const TOOL_RESULTS_ROLE = "toolResults";

// Die Antwort EINER Modellrunde, unveraendert zurueck in die naechste Anfrage. Der
// Erzeuger LIEST providerTurn nie - er gehoert dem Adapter (llm/ports.js LlmTurn).
export const providerTurnMessage = (providerTurn) => ({ role: "assistant", providerTurn });

// Die Ergebnisse aller Werkzeuge EINER Runde (je Eintrag ein LlmToolResult aus
// llm/ports.js). Wie viele Anbieter-Nachrichten daraus werden, entscheidet der Adapter
// (Anthropic: eine; OpenAI-Form: eine je Ergebnis).
export const toolResultsMessage = (results) => ({ role: TOOL_RESULTS_ROLE, results });
