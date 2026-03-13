import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@/common/constants/enums';

export const ROLES_KEY = 'roles';

/**
 * Accepts either a single minRole (hierarchy-based) or multiple roles.
 * When a single role is passed the guard checks `hasMinRole(user.role, minRole)`.
 * When multiple roles are passed the guard checks membership.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
