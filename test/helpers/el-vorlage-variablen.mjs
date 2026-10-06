import { readFileSync } from "node:fs";

const TEMPLATE_PATH = "elevenlabs/agent_configs/outbound-agent.template.json";

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function placeholderNamesIn(text) {
  const gefunden = new Set();
  for (const treffer of text.matchAll(PLACEHOLDER_PATTERN)) gefunden.add(treffer[1]);
  return gefunden;
}

function voicemailMessageOf(agent) {
  const builtInTools = agent.prompt.built_in_tools;
  const detection = builtInTools.voicemail_detection;
  return detection.params.voicemail_message;
}

const SYSTEM_VARIABLE_PREFIX = "system__";

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
