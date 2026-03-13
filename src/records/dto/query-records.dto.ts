import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { AnalysisStatus, RetentionStatus, VisitorType } from '@/common/constants/enums';

export class QueryRecordsDto {
  @ApiPropertyOptional({
    enum: Object.values(AnalysisStatus as Record<string, string>),
    description: 'Filter by analysis status.',
  })
  @IsOptional()
  @IsEnum(AnalysisStatus as object)
  status?: AnalysisStatus;

  @ApiPropertyOptional({
    enum: Object.values(RetentionStatus as Record<string, string>),
    description: 'Filter by retention status.',
  })
  @IsOptional()
  @IsEnum(RetentionStatus as object)
  retentionStatus?: RetentionStatus;

  @ApiPropertyOptional({
    enum: Object.values(VisitorType as Record<string, string>),
    description: 'Filter by visitor type.',
  })
  @IsOptional()
  @IsEnum(VisitorType as object)
  visitorType?: VisitorType;

  @ApiPropertyOptional({ description: 'Filter by prison unit name (partial match).' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: 'Filter by uploader user ID.' })
  @IsOptional()
  @IsString()
  uploadedById?: string;

  @ApiPropertyOptional({ description: 'Filter records recorded on or after this ISO 8601 date.' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter records recorded on or before this ISO 8601 date.' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based).', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of records per page.',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }: { value: unknown }) => Math.min(Number(value), 100))
  limit?: number = 20;
}
