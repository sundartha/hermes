export function werkzeugRohwerte(umgebung) {
  const { env } = umgebung;
  return {
    renderApiKey: (env.RENDER_API_KEY || "").trim(),
  };
}
