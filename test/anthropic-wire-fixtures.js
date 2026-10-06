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
