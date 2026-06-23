import { Effect } from 'effect';
import { PlanKey } from '@stocket/types/features';
import { requireSession } from '../../platform/http/session';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { resolveTenantForSession } from '../../platform/tenancy/tenant-context';
import { TenantFeaturesService } from '../../platform/tenancy/tenant-features';
import { RolesService } from '../roles/service';
import {
  toCurrentUserResponse,
  toProfileResponse,
  toSessionClaimsResponse,
} from './mappers';

export class AuthService extends Effect.Service<AuthService>()(
  '@stocket/effect/auth/AuthService',
  {
    effect: Effect.gen(function* () {
      const rolesService = yield* RolesService;
      const tenantFeaturesService = yield* TenantFeaturesService;
      const trace = makeServiceTracer({
        serviceName: 'AuthService',
        module: 'auth',
        layer: 'service',
        entityType: 'user',
      });

      const me = trace.traced('me', () =>
        Effect.gen(function* () {
          const session = yield* requireSession;
          const tenant = yield* resolveTenantForSession(session);
          yield* Effect.annotateCurrentSpan({ userId: session.user.id });
          const userPermissions = yield* rolesService.getPermissionsForUser(
            session.user.id,
            tenant.tenantId,
          );
          const features = yield* tenantFeaturesService.getEffectiveFeatures(
            tenant.tenantId,
          );
          return toCurrentUserResponse(session, userPermissions, tenant, {
            planKey: PlanKey.FREE,
            features,
          });
        }),
      );

      const profile = trace.traced('profile', () =>
        Effect.gen(function* () {
          const session = yield* requireSession;
          yield* Effect.annotateCurrentSpan({ userId: session.user.id });
          return toProfileResponse(session);
        }),
      );

      const sessionClaims = trace.traced('sessionClaims', () =>
        Effect.gen(function* () {
          const session = yield* requireSession;
          yield* Effect.annotateCurrentSpan({ userId: session.user.id });
          return toSessionClaimsResponse(session);
        }),
      );

      return {
        me,
        profile,
        sessionClaims,
      };
    }),
    dependencies: [RolesService.Default, TenantFeaturesService.Default],
  },
) {}
