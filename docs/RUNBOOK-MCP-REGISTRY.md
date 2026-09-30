# Runbook: Hermes in der offiziellen MCP Registry

Eintrag `com.sundartha/hermes` in https://registry.modelcontextprotocol.io (Plan agent-ready, Phase 2).
Andere Verzeichnisse (z. B. PulseMCP) übernehmen Einträge von dort automatisch.

## Bausteine

| Was | Wo |
|---|---|
| Server-Beschreibung | `docs/mcp-registry/server.json` (Schema 2025-12-11, Remote `streamable-http`) |
| Domain-Nachweis | `apps/web/public/.well-known/mcp-registry-auth` → `https://sundartha.com/.well-known/mcp-registry-auth` |
| Privater Schlüssel (Ed25519) | nur lokal bei Jonas: `~/Documents/Openclaw/_private/mcp-registry-key.pem` (nie ins Repo) |

sundartha.com hat keine eigene Cloudflare-Zone und die DNS liegt bei Squarespace. Darum der HTTP-Nachweis statt DNS-TXT.

## Veröffentlichen (erst wenn der Nachweis live auf sundartha.com liegt)

```bash
# 1. Nachweis prüfen (muss die Zeile "v=MCPv1; k=ed25519; p=..." liefern)
curl -s https://sundartha.com/.well-known/mcp-registry-auth

# 2. mcp-publisher installieren
brew install mcp-publisher

# 3. Anmelden mit dem privaten Schlüssel (macOS: OpenSSL 3 nötig, LibreSSL kann kein Ed25519)
OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
PRIVATE_KEY="$($OPENSSL pkey -in ~/Documents/Openclaw/_private/mcp-registry-key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login http --domain sundartha.com --private-key "$PRIVATE_KEY"

# 4. Veröffentlichen
cd docs/mcp-registry && mcp-publisher publish

# 5. Prüfen
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.sundartha"
```

## Neue Version

`version` in `server.json` hochzählen (z. B. `1.0.1`), dann Schritte 3 und 4. Eine Version lässt sich nicht zweimal veröffentlichen.

## Schlüssel verloren oder kompromittiert

Neues Paar erzeugen (`$OPENSSL genpkey -algorithm Ed25519 -out mcp-registry-key.pem`), die Zeile
`v=MCPv1; k=ed25519; p=$($OPENSSL pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)`
nach `apps/web/public/.well-known/mcp-registry-auth` schreiben und live bringen.

Quellen: https://github.com/modelcontextprotocol/registry/tree/main/docs/modelcontextprotocol-io (quickstart, authentication, remote-servers)
