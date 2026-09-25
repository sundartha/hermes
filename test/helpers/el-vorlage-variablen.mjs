// ---- Die verbrauchten Variablen der echten Agenten-Vorlage --------------------------
// Reine Verschiebung aus test/el-vorlage-variablen-abgleich.test.js (IEL-B6): die Init-Antwort
// des Inbound-Wegs (test/iel-init-webhook.test.js) muss gegen DIESELBE Menge gehalten werden
// wie der Anrufstart - zwei Extraktoren koennten gegeneinander driften (G5).
//
// Die Menge wird ECHT aus dem Vorlagentext gewonnen, keine von Hand gepflegte Liste:
// {{name}}-Vorkommen aus prompt + first_message, dazu die zwei Quellen ohne {{name}}, die
// trotzdem eine dynamische Variable verbrauchen: der Anrufbeantworter-Text (DE1) und die
// dynamic_variable-Verweise der WERKZEUGE (SEC-P4).
import { readFileSync } from "node:fs";

const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";

// ---- Seite A: {{name}} aus dem WIRKLICHEN Vorlagentext --------------------------------
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function placeholderNamesIn(text) {
  const gefunden = new Set();
  for (const treffer of text.matchAll(PLACEHOLDER_PATTERN)) gefunden.add(treffer[1]);
  return gefunden;
}

// DRITTE QUELLE seit DE1: der Anrufbeantworter-Text. Bis dahin las diese Seite nur
// prompt + first_message - eine Variable, die NUR dort unten steht, war damit
// unsichtbar, und genau das ist der Close-1008-Fall, den diese Datei faengt.
// In Stufen gelesen statt in einer Kette (G36/Demeter, Bestandsmuster el-stimme-abnahme).
function voicemailMessageOf(agent) {
  const builtInTools = agent.prompt.built_in_tools;
  const detection = builtInTools.voicemail_detection;
  return detection.params.voicemail_message;
}

// VIERTE QUELLE seit SEC-P4: die dynamic_variable-Verweise der WERKZEUGE. Eine Variable,
// die NUR ein Werkzeug liest, trug bisher kein {{name}} und war damit unsichtbar - dieselbe
// Luecke, die DE1 fuer den Anrufbeantworter-Text geschlossen hat. Ausgenommen sind die
// Anbieter-SYSTEMVARIABLEN (system__conversation_id): die fuellt der Anbieter selbst, wir
// schicken sie nie mit, und eine Forderung nach ihr waere der umgekehrte Fehlalarm.
const SYSTEM_VARIABLE_PREFIX = "system__";

// Der Name, den EINE Parameter-Deklaration verbraucht - oder null. Eigenstaendig, weil
// die Schleife darunter sonst ueber der Komplexitaetsgrenze steht (eslint complexity 10)
// und weil "was ist eine verbrauchte Variable" genau eine Frage ist (G30).
function verbrauchteVariableVon(eigenschaft) {
  const name = eigenschaft.dynamic_variable;
  if (typeof name !== "string" || !name) return null;
  return name.startsWith(SYSTEM_VARIABLE_PREFIX) ? null : name;
}

function toolVariableNamesIn(tools) {
  const gefunden = new Set();
  for (const werkzeug of Object.values(tools ?? {})) {
    const schema = werkzeug.tool_config?.api_schema?.request_body_schema;
    for (const eigenschaft of Object.values(schema?.properties ?? {})) {
      const name = verbrauchteVariableVon(eigenschaft);
      if (name) gefunden.add(name);
    }
  }
  return gefunden;
}

export function templatePlaceholderNames() {
  const vorlage = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const agent = vorlage.agent.conversation_config.agent;
  return new Set([
    ...placeholderNamesIn(agent.prompt.prompt),
    ...placeholderNamesIn(agent.first_message),
    ...placeholderNamesIn(voicemailMessageOf(agent)),
    ...toolVariableNamesIn(vorlage.tools),
  ]);
}
