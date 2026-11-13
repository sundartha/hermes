import * as speicher from "../../src/store.js";

await speicher.oeffneSpeicher();
process.stdout.write(JSON.stringify(speicher.load()));
