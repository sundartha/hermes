import { register } from "node:module";
import { fileURLToPath } from "node:url";

import { verbergen } from "./verbergen.mjs";

register("./haken.mjs", import.meta.url, { data: { nachbau: new URL("attrappe.mjs", import.meta.url).href } });
verbergen(fileURLToPath(import.meta.url));
