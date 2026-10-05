import { register } from "node:module";
import { fileURLToPath } from "node:url";

import { verbergen } from "./verbergen.mjs";

register("./haken.mjs", import.meta.url);
verbergen(fileURLToPath(import.meta.url));
