-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('uploader', 'analyst', 'supervisor', 'admin');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('uploaded', 'processing_ai', 'clean', 'flagged_ai', 'under_review', 'confirmed_human', 'rejected_human', 'approved', 'rejected_supervisor');

-- CreateEnum
CREATE TYPE "RetentionStatus" AS ENUM ('retention_standard', 'retention_extended', 'permanent_retention', 'archived');

-- CreateEnum
CREATE TYPE "VisitorType" AS ENUM ('ATENDIMENTO_JURIDICO', 'VISITA_SOCIAL_PRESENCIAL', 'VISITA_SOCIAL_VIRTUAL');

-- CreateEnum
CREATE TYPE "AnalystDecision" AS ENUM ('COM_ALTERACAO', 'SEM_ALTERACAO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "UserRole"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL,
    "detaineeName" TEXT NOT NULL,
    "detaineeCode" TEXT,
    "detaineeCell" TEXT,
    "visitorName" TEXT NOT NULL,
    "visitorType" "VisitorType" NOT NULL,
    "unit" TEXT NOT NULL,
    "vivencia" TEXT,
    "equipment" TEXT NOT NULL,
    "blobUrl" TEXT,
    "mediaAvailable" BOOLEAN NOT NULL DEFAULT false,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'uploaded',
    "retentionStatus" "RetentionStatus" NOT NULL DEFAULT 'retention_standard',
    "aiScore" DOUBLE PRECISION,
    "analystId" TEXT,
    "analystDecision" "AnalystDecision",
    "analystJustification" TEXT,
    "analysisConfirmedAt" TIMESTAMP(3),
    "supervisorId" TEXT,
    "supervisorDecision" TEXT,
    "supervisorJustification" TEXT,
    "supervisorDecidedAt" TIMESTAMP(3),
    "transcription" JSONB,
    "canonicalAnalysis" JSONB,
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "recordId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" "AnalysisStatus",
    "nextStatus" "AnalysisStatus",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
