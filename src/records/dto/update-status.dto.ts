import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalystDecision, AnalysisStatus } from '@/common/constants/enums';

export class UpdateStatusDto {
  @ApiProperty({
    enum: Object.values(AnalysisStatus as Record<string, string>),
    description: 'The new status to transition to.',
    example: 'under_review',
  })
  @IsEnum(AnalysisStatus as object)
  status!: AnalysisStatus;

  @ApiPropertyOptional({
    enum: Object.values(AnalystDecision as Record<string, string>),
    description:
      'Required when status is confirmed_human or rejected_human. ' +
      'com_alteracao = analyst found issues; sem_alteracao = no issues found.',
  })
  @IsOptional()
  @IsEnum(AnalystDecision as object)
  analystDecision?: AnalystDecision;

  @ApiPropertyOptional({
    description: 'Justification text for the status change.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  justification?: string;

  @ApiPropertyOptional({
    description: 'Optional notes to attach to the audit log entry.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
