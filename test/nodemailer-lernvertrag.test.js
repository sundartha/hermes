import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import nodemailer from "nodemailer";
import { buildTransporter, makeSmtpMailer } from "../src/smtp-mail.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function smtpCommandName(line) {
  return line.split(" ")[0].toUpperCase();
}

function startSmtpOhneStarttls() {
  const seen = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.write("220 lernvertrag-fake ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line === "") continue;
        const cmd = smtpCommandName(line);
        seen.push(cmd);
        if (cmd === "EHLO") socket.write("250-lernvertrag-fake\r\n250 STARTTLS\r\n");
        else if (cmd === "STARTTLS") socket.write("502 Command not implemented\r\n");
        else if (cmd === "QUIT") socket.write("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, port: server.address().port }));
  });
}

function smtpConfig(port) {
  return withConfigNamespaces({
    brevoApiKey: "",
    smtpHost: "127.0.0.1",
    smtpPort: port,
    smtpUser: "lernvertrag-user",
    smtpPassword: "lernvertrag-pass",
    mailFrom: "absender@sundartha.example",
  });
}

test("SEC-P2: nodemailer stellt die von smtp-mail.js benutzte Aufrufform bereit", async () => {
  const { server, port } = await startSmtpOhneStarttls();
  try {
    assert.equal(typeof nodemailer.createTransport, "function");

    const transporter = buildTransporter(smtpConfig(port), nodemailer);
    assert.equal(typeof transporter.sendMail, "function");
    assert.equal(typeof transporter.verify, "function");

    const mailer = makeSmtpMailer(smtpConfig(port));
    assert.equal(typeof mailer.sendMail, "function");
  } finally {
    server.close();
  }
});

test("SEC-P2: requireTLS verhindert den Klartext-Versand - kein DATA erreicht den Server", async () => {
  const { server, seen, port } = await startSmtpOhneStarttls();
  try {
    const mailer = makeSmtpMailer(smtpConfig(port));
    await assert.rejects(
      mailer.sendMail({ to: "empfaenger@sundartha.example", subject: "s", text: "t" }),
      (err) => {
        assert.equal(err.code, "ETLS");
        return true;
      },
    );
    assert.ok(seen.includes("EHLO"));
    assert.ok(seen.includes("STARTTLS"));
    assert.ok(!seen.includes("DATA"));
  } finally {
    server.close();
  }
});
