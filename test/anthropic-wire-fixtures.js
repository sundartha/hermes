// Die neutralen Werkzeugdefinitionen (claude.js toolDefs) in der Form, in der sie nach
// der Adapter-Uebersetzung auf dem Anthropic-Draht ankommen. EINE Quelle fuer die
// Tests, die "der Werkzeugsatz ging byte-identisch zum Bestand raus" behaupten
// (vorher in zwei Dateien identisch dupliziert, G5).
//
// Bewusst KEIN Import des Adapters: die Erwartung muss unabhaengig formuliert sein,
// sonst prueft der Test den Adapter gegen sich selbst.
const CACHE_CONTROL_EPHEMERAL = { type: "ephemeral" };

export function anthropicToolsOnWire(neutralTools, { cachePrefix = true } = {}) {
  const last = neutralTools.length - 1;
  return neutralTools.map(({ name, description, parameters }, i) => {
    const tool = { name, description, input_schema: parameters };
    return cachePrefix && i === last
      ? { ...tool, cache_control: CACHE_CONTROL_EPHEMERAL }
      : tool;
  });
}
