import { fileURLToPath } from "node:url";

import { verbergen } from "./verbergen.mjs";

verbergen(fileURLToPath(import.meta.url));
