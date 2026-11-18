export function rohwerteWerkzeug(env: { RENDER_API_KEY?: string | undefined }): { renderApiKey: string } {
  return {
    renderApiKey: (env.RENDER_API_KEY ?? "").trim(),
  };
}
