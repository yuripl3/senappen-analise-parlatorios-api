import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../decorators/current-user.decorator';
import { UserRole } from '@/generated/prisma/enums';
import { Request } from 'express';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // No @Roles() decorator → route is open to any authenticated user
    if (!required || required.length === 0) return true;

    const { user } = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const hasRole = required.some((role) => user?.roles?.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('Acesso negado: permissão insuficiente.');
    }

    return true;
  }
}
