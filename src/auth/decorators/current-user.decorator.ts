import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '@/common/constants/enums';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  units: string[];
  iat?: number;
  exp?: number;
}

/** Injects the authenticated user payload into a controller parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    return request.user;
  },
);
