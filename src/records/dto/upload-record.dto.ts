import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitorType } from '@/common/constants/enums';

/**
 * DTO for the multipart/form-data upload endpoint (POST /records/upload).
 * All fields arrive as form text fields alongside the `video` file part.
 */
export class UploadRecordDto {
  @ApiProperty({ description: 'Full name of the detainee.', example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  detaineeName!: string;

  @ApiPropertyOptional({ description: 'Prison registration code.', example: 'SP-2026-00123' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  detaineeCode?: string;

  @ApiProperty({ description: 'Full name of the visitor.', example: 'Maria Souza' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  visitorName!: string;

  @ApiProperty({
    enum: Object.values(VisitorType as Record<string, string>),
    description: 'Visit type enum value.',
  })
  @IsEnum(VisitorType as object)
  visitorType!: VisitorType;

  @ApiProperty({ description: 'Prison unit.', example: 'CDP Guarulhos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  unit!: string;

  @ApiPropertyOptional({ description: 'Wing / block.', example: 'Vivência A' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  vivencia?: string;

  @ApiProperty({
    description: 'ISO 8601 datetime when the visit was recorded.',
    example: '2026-03-07T14:30:00Z',
  })
  @IsDateString()
  recordedAt!: string;

  @ApiProperty({ description: 'Equipment ID.', example: 'CAM-01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  equipment!: string;
}
