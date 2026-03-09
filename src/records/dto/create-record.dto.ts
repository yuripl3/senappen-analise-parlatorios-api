import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitorType } from '@/generated/prisma/enums';

export class CreateRecordDto {
  @ApiProperty({ description: 'Full name of the detainee.', example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  detaineeName!: string;

  @ApiPropertyOptional({
    description: 'Prison registration code of the detainee.',
    example: 'SP-2024-00123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  detaineeCode?: string;

  @ApiPropertyOptional({ description: 'Cell or housing unit of the detainee.', example: 'B2-14' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  detaineeCell?: string;

  @ApiProperty({ description: 'Full name of the visitor.', example: 'Maria Souza' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  visitorName!: string;

  @ApiProperty({
    enum: Object.values(VisitorType as Record<string, string>),
    description: 'Type of visit.',
  })
  @IsEnum(VisitorType as object)
  visitorType!: VisitorType;

  @ApiProperty({ description: 'Prison unit where the visit took place.', example: 'CDP Guarulhos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  unit!: string;

  @ApiPropertyOptional({ description: 'Wing or block within the unit.', example: 'Vivência A' })
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

  @ApiProperty({ description: 'Equipment ID used to record the visit.', example: 'CAM-01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  equipment!: string;

  @ApiPropertyOptional({
    description: 'Whether media (video file) is already available.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  mediaAvailable?: boolean;
}
