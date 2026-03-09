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
import { UserRole } from '@/generated/prisma/enums';

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
    isArray: true,
    example: ['analyst'],
  })
  @IsArray()
  @IsEnum(UserRole as object, { each: true })
  roles!: UserRole[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
