import { IsArray, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum BulkActionType {
  archive = 'archive',
  restore = 'restore',
}

export class BulkActionDto {
  @ApiProperty({
    description: 'Array of record UUIDs to act upon.',
    type: [String],
    example: ['uuid1', 'uuid2'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  ids: string[];

  @ApiProperty({
    description: 'Action to perform on selected records.',
    enum: BulkActionType,
    example: BulkActionType.archive,
  })
  @IsEnum(BulkActionType)
  action: BulkActionType;
}
