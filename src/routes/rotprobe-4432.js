// WEGWERF-DATEI fuer Rotprobe Issue 4432, nie mergen.
import { Router } from "express";
import fs from "node:fs";
import { createRateLimiter } from "../middleware.js";

export const rotprobeRouter = Router();
const begrenzer = createRateLimiter(30);

// Mit eigenem Begrenzer: darf NICHT gemeldet werden.
rotprobeRouter.get("/rotprobe/mit", begrenzer, (req, res) => {
  res.send(fs.readFileSync(String(req.query.datei), "utf8"));
});

// Ohne Begrenzer: MUSS weiter als js/missing-rate-limiting gemeldet werden.
rotprobeRouter.get("/rotprobe/ohne", (req, res) => {
  res.send(fs.readFileSync(String(req.query.datei), "utf8"));
});
