import { existsSync, realpathSync } from "node:fs";
import { env, execArgv } from "node:process";

const KINDPROZESS = "NODE_TEST_CONTEXT";
const VORLADEN = "--import";
const NAMENSFILTER = "--test-name-pattern=";

function istDatei(eintrag, datei) {
  return eintrag !== undefined && existsSync(eintrag) && realpathSync(eintrag) === datei;
}

function eigenerEintrag(datei) {
  return (eintrag, index) =>
    (eintrag === VORLADEN && istDatei(execArgv[index + 1], datei)) ||
    (istDatei(eintrag, datei) && execArgv[index - 1] === VORLADEN);
}

export function verbergen(datei) {
  if (env[KINDPROZESS] === undefined) return;
  const eigen = eigenerEintrag(datei);
  const bleibt = execArgv.filter((eintrag, index) => !eigen(eintrag, index) && !eintrag.startsWith(NAMENSFILTER));
  execArgv.splice(0, execArgv.length, ...bleibt);
}
