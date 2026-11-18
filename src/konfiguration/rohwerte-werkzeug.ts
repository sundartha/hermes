export function rohwerteWerkzeug(env: { RENDER_API_KEY?: string | undefined }) {
  return {
    renderApiKey: (env.RENDER_API_KEY ?? "").trim(),
  };
}
