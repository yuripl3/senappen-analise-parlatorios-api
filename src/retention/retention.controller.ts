import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { UpdateRetentionPolicyDto } from './dto/update-retention-policy.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { JwtPayload } from '@/auth/decorators/current-user.decorator';
import { UserRole } from '@/common/constants/enums';

@ApiTags('retention')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('retention')
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get()
  @ApiOperation({
    summary: 'Get retention policy',
    description: 'Returns the current global retention policy settings.',
  })
  @ApiOkResponse({ description: 'Current retention policy.' })
  get() {
    return this.retentionService.get();
  }

  @Patch()
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Update retention policy',
    description:
      'Updates the global retention policy settings. Admin only. ' +
      'Pass only the fields you want to change.',
  })
  @ApiOkResponse({ description: 'Updated retention policy.' })
  update(
    @Body() dto: UpdateRetentionPolicyDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.retentionService.update(dto, actor.sub);
  }
}
