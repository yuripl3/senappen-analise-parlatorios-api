import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@/common/constants/enums';

export class CreateUserDto {
  @ApiProperty({ example: 'Ana Beatriz Silva' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'ana.beatriz@senappen.gov.br' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    minLength: 8,
    description: 'Plain-text password (will be hashed before storage).',
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    enum: Object.values(UserRole as Record<string, string>),
    example: 'analista',
    description: 'Single role from the 5-tier hierarchy.',
  })
  @IsEnum(UserRole as object)
  role!: UserRole;

  @ApiPropertyOptional({
    isArray: true,
    example: ['CDP Guarulhos', 'Penitenciária I de Hortolândia'],
    description: 'Prison units the user has access to. Empty = all units (admin).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  units?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
