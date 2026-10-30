import { starteElternwaechterPerPpid } from "./elternwaechter.mjs";

const eltern = Number(new URL(import.meta.url).searchParams.get("eltern"));
if (!Number.isInteger(eltern) || eltern < 1) throw new Error("Elternprozess fehlt: der Starter hängt ?eltern=<pid> an den Vorlauf");

starteElternwaechterPerPpid(eltern);
