export function rohwerteWerkzeug(env) {
  return {
    renderApiKey: (env.RENDER_API_KEY || "").trim(),
  };
}
