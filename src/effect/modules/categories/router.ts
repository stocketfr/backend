import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { requirePermission } from '../../platform/authorization';
import { respondJson } from '../../platform/errors';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import { makeMessageResponse } from '../../platform/messages';
import {
  CategoryIdSchema,
  CreateCategorySchema,
  UpdateCategorySchema,
} from '@stocket/types/categories';
import { CategoriesService } from './service';

const CategoryPathParams = Schema.Struct({ id: CategoryIdSchema });

export const categoriesRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const categoriesService = yield* CategoriesService;
      return yield* respondJson(categoriesService.findAll());
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateCategorySchema);
      const categoriesService = yield* CategoriesService;
      return yield* respondAuditedMutation(categoriesService.create(dto), {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.CATEGORY,
        entityId: (category) => category.id,
        responseOptions: { status: 201 },
      });
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(CategoryPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateCategorySchema);
      const categoriesService = yield* CategoriesService;
      return yield* respondAuditedMutation(categoriesService.update(id, dto), {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.CATEGORY,
        entityId: id,
      });
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(CategoryPathParams);
      const categoriesService = yield* CategoriesService;
      return yield* respondAuditedMutation(categoriesService.delete(id), {
        action: AuditAction.DELETE,
        entityType: AuditEntityType.CATEGORY,
        entityId: id,
        mapResponse: () => makeMessageResponse('categories.deleted'),
      });
    }),
  ),
  HttpRouter.prefixAll('/categories'),
);
