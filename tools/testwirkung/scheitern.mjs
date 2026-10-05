import { readFileSync } from "node:fs";
import { register } from "node:module";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { ZIELE, festlegen } from "./gezielt.mjs";
import { verbergen } from "./verbergen.mjs";

register("./haken.mjs", import.meta.url, { data: { nachbau: new URL("gezielt.mjs", import.meta.url).href } });
festlegen(JSON.parse(readFileSync(env[ZIELE], "utf8")));
verbergen(fileURLToPath(import.meta.url), [ZIELE]);
