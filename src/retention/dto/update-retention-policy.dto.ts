import { IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRetentionPolicyDto {
  @ApiPropertyOptional({
    description: 'Days before deletion for standard retention records.',
    minimum: 1,
    maximum: 3650,
    example: 30,
  })
  @IsInt()
  @Min(1)
  @Max(3650)
  standardRetentionDays?: number;

  @ApiPropertyOptional({
    description: 'Days before deletion for extended retention records.',
    minimum: 1,
    maximum: 3650,
    example: 90,
  })
  @IsInt()
  @Min(1)
  @Max(3650)
  extendedRetentionDays?: number;
}
