import { parseArgs } from "node:util";
import {
  changedExistingTestFiles,
  changedUnits,
  gatesByTestFile,
} from "./testschutz/aenderungen.mjs";
import { deletedFinding, mechanicalProofs } from "./testschutz/ausnahmen.mjs";
import { approval, listHint } from "./testschutz/freigabe.mjs";
import { rerunLinkedPullRequests } from "./testschutz/neustart.mjs";

const EXIT_FAILURE = 1;

function parseOptions() {
  const { values } = parseArgs({
    options: { basis: { type: "string" }, pr: { type: "string" }, issue: { type: "string" } },
  });
  if (values.issue !== undefined) return { issue: Number(values.issue) };
  if (values.basis === undefined || values.pr === undefined) {
    throw new Error(
      "Aufruf: node tools/tests-nur-ergaenzt.mjs --basis <sha> --pr <nr> oder --issue <nr>",
    );
  }
  return { basis: values.basis, pullRequest: Number(values.pr) };
}

function unitFindings(unit, names, gates) {
  if (unit.deleted) return [deletedFinding(unit)];
  const where = unit.lines.length > 0 ? `, Zeilen ${unit.lines.join(", ")}` : "";
  const findings = [];
  if (unit.name !== undefined && !names.has(unit.name)) {
    findings.push(
      `${unit.file}, Testfall „${unit.name}“${where}: geändert oder gelöscht, aber der Test steht nicht ${listHint()}.`,
    );
  }
  if (unit.name === undefined && !names.has(unit.file)) {
    findings.push(
      `${unit.file}${where} (außerhalb eines Testfalls): geändert oder gelöscht, aber die Datei steht nicht ${listHint()}.`,
    );
  }
  const missingGates = (gates.get(unit.file) ?? []).filter((gate) => !names.has(gate));
  if (missingGates.length > 0) {
    findings.push(
      `${unit.file} prüft Safety-Gates; das Gate ${missingGates.map((gate) => `„${gate}“`).join(", ")} steht nicht ${listHint()}.`,
    );
  }
  return findings;
}

async function checkPullRequest({ basis, pullRequest }) {
  const { open, proven } = mechanicalProofs(basis, changedExistingTestFiles(basis));
  for (const line of proven) console.log(line);
  const units = open.flatMap((change) => changedUnits(basis, change));
  if (units.length === 0) {
    const rest = proven.length > 0 ? "sonst " : "";
    console.log(`Testschutz: ${rest}keine bestehende Testzeile geändert oder gelöscht.`);
    return;
  }
  const { names, notes, approvedIssues } = await approval(pullRequest);
  const gates = gatesByTestFile();
  const findings = [...new Set(units.flatMap((unit) => unitFindings(unit, names, gates)))];
  if (findings.length === 0) {
    console.log(
      `Testschutz: ${units.length} geänderte Stellen in bestehenden Tests sind durch Issue ${approvedIssues.join(", ")} freigegeben.`,
    );
    return;
  }
  console.error("Testschutz: bestehende Testzeilen sind geändert oder gelöscht, ohne Freigabe.");
  for (const line of [...notes, ...findings]) console.error(line);
  process.exitCode = EXIT_FAILURE;
}

async function main() {
  const options = parseOptions();
  await (options.issue === undefined
    ? checkPullRequest(options)
    : rerunLinkedPullRequests(options));
}

try {
  await main();
} catch (error) {
  console.error(`Testschutz: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
