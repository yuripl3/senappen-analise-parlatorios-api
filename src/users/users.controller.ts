import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { Roles } from '@/auth/decorators/roles.decorator';
import { UserRole } from '@/common/constants/enums';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.supervisor)
  @ApiOperation({ summary: 'List all users', description: 'Supervisor+ can list users.' })
  @ApiOkResponse({ description: 'List of users (passwordHash excluded).' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('audit-logs')
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Global audit log',
    description: 'Returns paginated global audit log entries. Admin only.',
  })
  @ApiOkResponse({ description: 'Paginated audit log.' })
  findAllAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAllAuditLogs({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
    });
  }

  @Get(':id')
  @Roles(UserRole.supervisor)
  @ApiOperation({ summary: 'Get a user by ID', description: 'Supervisor+ can view user details.' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiOkResponse({ description: 'User detail (passwordHash excluded).' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Create a user',
    description: 'Password is hashed with bcrypt before storage. Restricted to admin role.',
  })
  @ApiCreatedResponse({ description: 'Created user.' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Update a user',
    description:
      'Update name, email, role, units, or active status. Admin only. Password changes not supported here.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiOkResponse({ description: 'Updated user.' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }
}
