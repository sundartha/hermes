import { voiceRenderer } from "./registry.js";

export function makeVoiceRender() {
  const render = (directives, provider) => voiceRenderer(provider).renderDirectives(directives);
  return { render };
}
