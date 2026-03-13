import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * A single per-line user comment/tag on a transcription.
 *
 * `lineIndex` maps 1-to-1 with the transcription lines array.
 * `tagged` means the user marked (highlighted) the line but may or may not
 * have written a textual comment.
 */
export class UserCommentEntry {
  @ApiProperty({ description: 'Zero-based index of the transcription line.', example: 3 })
  @IsInt()
  @Min(0)
  lineIndex!: number;

  @ApiProperty({ description: 'Whether the user tagged/highlighted this line.', example: true })
  @IsBoolean()
  tagged!: boolean;

  @ApiProperty({
    description: 'Optional textual comment from the user.',
    required: false,
    example: 'Possível referência a entrega de substância.',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateUserCommentsDto {
  @ApiProperty({ description: 'Array of per-line user comments.', type: [UserCommentEntry] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserCommentEntry)
  comments!: UserCommentEntry[];
}
