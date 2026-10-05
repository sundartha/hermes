import { existsSync, realpathSync } from "node:fs";
import { env, execArgv } from "node:process";

const KINDPROZESS = "NODE_TEST_CONTEXT";
const VORLADEN = "--import";
const VORLADEN_MIT_WERT = `${VORLADEN}=`;
const NAMENSFILTER = "--test-name-pattern=";
const ABDECKUNG = "NODE_V8_COVERAGE";

function istDatei(eintrag, datei) {
  return eintrag !== undefined && existsSync(eintrag) && realpathSync(eintrag) === datei;
}

function eigenerEintrag(datei) {
  return (eintrag, index) =>
    (eintrag === VORLADEN && istDatei(execArgv[index + 1], datei)) ||
    (istDatei(eintrag, datei) && execArgv[index - 1] === VORLADEN) ||
    (eintrag.startsWith(VORLADEN_MIT_WERT) && istDatei(eintrag.slice(VORLADEN_MIT_WERT.length), datei));
}

export function verbergen(datei, variablen = []) {
  if (env[KINDPROZESS] === undefined) return;
  const eigen = eigenerEintrag(datei);
  const bleibt = execArgv.filter((eintrag, index) => !eigen(eintrag, index) && !eintrag.startsWith(NAMENSFILTER));
  execArgv.splice(0, execArgv.length, ...bleibt);
  for (const name of [ABDECKUNG, ...variablen]) delete env[name];
}
