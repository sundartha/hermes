import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const ERSTES_ARGUMENT = 2;
const [ziel, ...argumente] = process.argv.slice(ERSTES_ARGUMENT);
const kind = spawn(process.execPath, argumente, { stdio: "ignore" });
writeFileSync(ziel, JSON.stringify({ starter: kind.pid }));
