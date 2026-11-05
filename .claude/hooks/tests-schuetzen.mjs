import { block } from "./lib.mjs";
import { TESTDATEI, rolle, schreibziel } from "./rolle.mjs";

function main() {
  const ziel = schreibziel();
  if (ziel === null) return;
  const name = rolle();
  const istTest = TESTDATEI.test(ziel.relativ);
  if (name === "bau" && istTest) {
    block("hooks/bau-aendert-keine-tests", [
      `Bau-Agenten ändern keine Tests: ${ziel.relativ}`,
      "Hältst du den Test für falsch, brich ab und nenne den Grund.",
    ]);
  }
  if (name === "test" && !istTest) block("hooks/test-aendert-keinen-produktcode", [`Test-Agenten ändern keinen Produktcode: ${ziel.relativ}`]);
}

main();
