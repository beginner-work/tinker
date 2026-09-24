-- Durable MCP API keys. Plaintext is shown once at mint and never stored.
-- keyHash is SHA-256 hex. revokedAt stays null until the key is revoked.
-- IF NOT EXISTS so a shared DATABASE_URL stays idempotent if the table
-- was created on first use before this migration was applied.

CREATE TABLE IF NOT EXISTS "McpApiKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "McpApiKey_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "McpApiKey" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "McpApiKey_keyHash_key" ON "McpApiKey"("keyHash");

CREATE INDEX IF NOT EXISTS "McpApiKey_userId_idx" ON "McpApiKey"("userId");
