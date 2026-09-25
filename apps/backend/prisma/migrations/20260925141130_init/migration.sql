-- CreateEnum
CREATE TYPE "PayloadKind" AS ENUM ('CATALOG', 'PROGRESS');

-- CreateEnum
CREATE TYPE "SubmissionSource" AS ENUM ('SENTENZA_EXTENSION');

-- CreateEnum
CREATE TYPE "ProcessingState" AS ENUM ('VERARBEITET', 'TEILWEISE_VERARBEITET', 'FEHLGESCHLAGEN');

-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'UNBEKANNT');

-- CreateEnum
CREATE TYPE "TargetLanguage" AS ENUM ('ES');

-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "googleSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawPayload" (
    "id" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "payloadKind" "PayloadKind" NOT NULL,
    "submissionSource" "SubmissionSource" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "processingState" "ProcessingState" NOT NULL,
    "processedAt" TIMESTAMP(3),
    "errorMessage" VARCHAR(2000),
    "persistedEntryCount" INTEGER,
    "discardedEntryCount" INTEGER,

    CONSTRAINT "RawPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarCategory" (
    "id" TEXT NOT NULL,
    "language" "TargetLanguage" NOT NULL,
    "busuuId" TEXT NOT NULL,
    "nameKey" TEXT,
    "nameDe" TEXT NOT NULL DEFAULT '',
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameDeResolved" BOOLEAN NOT NULL DEFAULT true,
    "nameEnResolved" BOOLEAN NOT NULL DEFAULT true,
    "descriptionKey" TEXT,
    "descriptionDe" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descDeResolved" BOOLEAN NOT NULL DEFAULT true,
    "descEnResolved" BOOLEAN NOT NULL DEFAULT true,
    "inCatalog" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenInCatalogAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrammarCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarTopic" (
    "id" TEXT NOT NULL,
    "language" "TargetLanguage" NOT NULL,
    "busuuId" TEXT NOT NULL,
    "categoryId" TEXT,
    "sortPosition" INTEGER,
    "cefrLevel" "CefrLevel" NOT NULL DEFAULT 'UNBEKANNT',
    "cefrLevelRaw" TEXT,
    "nameKey" TEXT,
    "nameDe" TEXT NOT NULL DEFAULT '',
    "nameEn" TEXT NOT NULL DEFAULT '',
    "nameDeResolved" BOOLEAN NOT NULL DEFAULT true,
    "nameEnResolved" BOOLEAN NOT NULL DEFAULT true,
    "descriptionKey" TEXT,
    "descriptionDe" TEXT NOT NULL DEFAULT '',
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descDeResolved" BOOLEAN NOT NULL DEFAULT true,
    "descEnResolved" BOOLEAN NOT NULL DEFAULT true,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "accessTier" TEXT NOT NULL DEFAULT '',
    "incomplete" BOOLEAN NOT NULL DEFAULT false,
    "inCatalog" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenInCatalogAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrammarTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarProgress" (
    "id" TEXT NOT NULL,
    "userAccountId" TEXT NOT NULL,
    "grammarTopicId" TEXT NOT NULL,
    "strength" INTEGER NOT NULL,
    "percentage" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "rawPayloadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrammarProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_googleSubject_key" ON "UserAccount"("googleSubject");

-- CreateIndex
CREATE INDEX "UserAccount_email_idx" ON "UserAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userAccountId_expiresAt_idx" ON "RefreshToken"("userAccountId", "expiresAt");

-- CreateIndex
CREATE INDEX "RawPayload_userAccountId_submittedAt_idx" ON "RawPayload"("userAccountId", "submittedAt" DESC);

-- CreateIndex
CREATE INDEX "RawPayload_userAccountId_payloadKind_submittedAt_idx" ON "RawPayload"("userAccountId", "payloadKind", "submittedAt" DESC);

-- CreateIndex
CREATE INDEX "RawPayload_userAccountId_processingState_submittedAt_idx" ON "RawPayload"("userAccountId", "processingState", "submittedAt" DESC);

-- CreateIndex
CREATE INDEX "RawPayload_contentHash_idx" ON "RawPayload"("contentHash");

-- CreateIndex
CREATE INDEX "GrammarCategory_language_inCatalog_idx" ON "GrammarCategory"("language", "inCatalog");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarCategory_language_busuuId_key" ON "GrammarCategory"("language", "busuuId");

-- CreateIndex
CREATE INDEX "GrammarTopic_categoryId_sortPosition_busuuId_idx" ON "GrammarTopic"("categoryId", "sortPosition", "busuuId");

-- CreateIndex
CREATE INDEX "GrammarTopic_language_cefrLevel_idx" ON "GrammarTopic"("language", "cefrLevel");

-- CreateIndex
CREATE INDEX "GrammarTopic_language_inCatalog_idx" ON "GrammarTopic"("language", "inCatalog");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarTopic_language_busuuId_key" ON "GrammarTopic"("language", "busuuId");

-- CreateIndex
CREATE INDEX "GrammarProgress_userAccountId_idx" ON "GrammarProgress"("userAccountId");

-- CreateIndex
CREATE INDEX "GrammarProgress_grammarTopicId_idx" ON "GrammarProgress"("grammarTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarProgress_userAccountId_grammarTopicId_key" ON "GrammarProgress"("userAccountId", "grammarTopicId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPayload" ADD CONSTRAINT "RawPayload_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarTopic" ADD CONSTRAINT "GrammarTopic_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GrammarCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarProgress" ADD CONSTRAINT "GrammarProgress_userAccountId_fkey" FOREIGN KEY ("userAccountId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarProgress" ADD CONSTRAINT "GrammarProgress_grammarTopicId_fkey" FOREIGN KEY ("grammarTopicId") REFERENCES "GrammarTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarProgress" ADD CONSTRAINT "GrammarProgress_rawPayloadId_fkey" FOREIGN KEY ("rawPayloadId") REFERENCES "RawPayload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
