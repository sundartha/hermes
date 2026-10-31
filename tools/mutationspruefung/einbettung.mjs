const VORSPANN = new URL("./einbettung-vorspann.mjs", import.meta.url).href;

export function einbettungsImport(quelle) {
  return `--import=${VORSPANN}?${new URLSearchParams({ quelle })}`;
}
