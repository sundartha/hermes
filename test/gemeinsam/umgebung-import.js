import path from "node:path";

function setzeUmgebung(umgebung) {
  for (const [name, wert] of Object.entries(umgebung)) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }
}

function pruefeDatenverzeichnis(config, datenverzeichnis) {
  if (path.resolve(config.server.dataDir) !== path.resolve(datenverzeichnis)) {
    throw new Error(
      `DATA_DIR ${datenverzeichnis} ist nicht gebunden: src/config.js war schon geladen und zeigt auf ${config.server.dataDir}`,
    );
  }
}

async function bindeKonfiguration(env, konfiguration) {
  setzeUmgebung(env);
  const { config } = await import("../../src/config.js");
  if (env.DATA_DIR) pruefeDatenverzeichnis(config, env.DATA_DIR);
  for (const [namensraum, werte] of Object.entries(konfiguration)) {
    for (const [schluessel, wert] of Object.entries(werte)) {
      config[namensraum][schluessel] = wert;
    }
  }
}

function ladeInReihe(lader) {
  return lader.reduce(async (geladen, lade) => [...(await geladen), await lade()], []);
}

export async function importNachUmgebung(env, ...lader) {
  await bindeKonfiguration(env, {});
  return ladeInReihe(lader);
}

export async function importNachKonfiguration(env, konfiguration, ...lader) {
  await bindeKonfiguration(env, konfiguration);
  return ladeInReihe(lader);
}
