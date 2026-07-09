import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { makeMessageResponse } from '../../platform/observability/messages';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  CategoryIdSchema,
  CreateCategorySchema,
  UpdateCategorySchema,
} from '@stocket/types/categories';
import {
  emptyInput,
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { CategoriesService } from './service';

const CategoryPathParams = Schema.Struct({ id: CategoryIdSchema });

export const categoriesRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(CategoriesService, (categoriesService) =>
          categoriesService.findAll(),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: jsonBody(CreateCategorySchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(CategoriesService, (categoriesService) =>
            categoriesService.create(dto),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.CATEGORY,
            entityId: (category) => category.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(CategoryPathParams, UpdateCategorySchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(CategoriesService, (categoriesService) =>
            categoriesService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.CATEGORY,
            entityId: ({ id }) => id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: pathParams(CategoryPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(CategoriesService, (categoriesService) =>
            categoriesService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.CATEGORY,
            entityId: id,
            mapResponse: () => makeMessageResponse('categories.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/categories'),
);
