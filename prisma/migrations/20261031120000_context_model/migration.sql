-- Context model: concept graph, per-user depth/confidence, signal log.

CREATE TABLE IF NOT EXISTS "Concept" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "targetDepth" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Concept_slug_key" ON "Concept"("slug");
CREATE INDEX IF NOT EXISTS "Concept_updatedAt_idx" ON "Concept"("updatedAt");

CREATE TABLE IF NOT EXISTS "ConceptEdge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConceptEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConceptEdge_fromId_toId_type_key" ON "ConceptEdge"("fromId", "toId", "type");
CREATE INDEX IF NOT EXISTS "ConceptEdge_fromId_idx" ON "ConceptEdge"("fromId");
CREATE INDEX IF NOT EXISTS "ConceptEdge_toId_idx" ON "ConceptEdge"("toId");
CREATE INDEX IF NOT EXISTS "ConceptEdge_type_idx" ON "ConceptEdge"("type");

CREATE TABLE IF NOT EXISTS "UserConceptBelief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "depth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConceptBelief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserConceptBelief_userId_conceptId_key" ON "UserConceptBelief"("userId", "conceptId");
CREATE INDEX IF NOT EXISTS "UserConceptBelief_userId_idx" ON "UserConceptBelief"("userId");
CREATE INDEX IF NOT EXISTS "UserConceptBelief_userId_updatedAt_idx" ON "UserConceptBelief"("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "ContextSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContextSignal_userId_at_idx" ON "ContextSignal"("userId", "at");
CREATE INDEX IF NOT EXISTS "ContextSignal_userId_type_at_idx" ON "ContextSignal"("userId", "type", "at");
CREATE INDEX IF NOT EXISTS "ContextSignal_sessionId_idx" ON "ContextSignal"("sessionId");

CREATE TABLE IF NOT EXISTS "ContextSignalConcept" (
    "signalId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,

    CONSTRAINT "ContextSignalConcept_pkey" PRIMARY KEY ("signalId","conceptId")
);

CREATE INDEX IF NOT EXISTS "ContextSignalConcept_conceptId_idx" ON "ContextSignalConcept"("conceptId");

DO $$ BEGIN
  ALTER TABLE "ConceptEdge" ADD CONSTRAINT "ConceptEdge_fromId_fkey"
    FOREIGN KEY ("fromId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConceptEdge" ADD CONSTRAINT "ConceptEdge_toId_fkey"
    FOREIGN KEY ("toId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "UserConceptBelief" ADD CONSTRAINT "UserConceptBelief_conceptId_fkey"
    FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ContextSignalConcept" ADD CONSTRAINT "ContextSignalConcept_signalId_fkey"
    FOREIGN KEY ("signalId") REFERENCES "ContextSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ContextSignalConcept" ADD CONSTRAINT "ContextSignalConcept_conceptId_fkey"
    FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
