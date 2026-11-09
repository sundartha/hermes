import { starteElternwaechter } from "../gemeinsam/elternwaechter.mjs";

starteElternwaechter({ sanft: true });

await import("../../src/server.js");
