# Sortly Import Improvements Plan

## Why

The current product CSV importer can ingest normalized product CSVs and Sortly item exports, but it still treats the import as a direct one-shot write. The next iteration should make larger Sortly migrations reviewable before they mutate tenant data, add supplier support, and model locations/inventory more accurately for shelf-level exports.

## Current State

- Maintained importer: `src/effect/modules/products/import/*`.
- Sortly entrypoint: API/UI flow only; `src/scripts/import-products.ts` is limited to normalized product CSVs.
- API entrypoint: `POST /api/v1/products/import`.
- Supported formats:
  - `normalized-products`
  - `sortly-items`
  - `auto`
- Current Sortly behavior:
  - imports only `Entry Type = Item`;
  - maps `SID` or `Sortly ID (SID)` to product SKU;
  - maps `Primary Folder` through `Subfolder-level4` to category path;
  - maps `Location` to a root location;
  - maps `Quantity` to root inventory at `product_id + location_id`;
  - maps `Price`, `Min Level`, `Unit`, barcode, notes, and expiry date;
  - ignores folders, photos, suppliers, item groups, tags, and attributes.

## Sortly CSV Findings

Downloads inspected:

- `/Users/max-vev/Downloads/B3C04AD5-1734-44C8-AFDC-6A7EAA036833.csv`
- `/Users/max-vev/Downloads/87DD964F-DFCA-488A-858E-714FDE6E5066.csv`
- `/Users/max-vev/Downloads/inventory_restructured_operational_v2.csv`

Observed shape:

- Columns are stable across these exports: `Entry Name`, `Entry Type`, `SID`, `Item Group Name`, attributes, `Quantity`, `Unit`, `Min Level`, `Price`, `Value`, `Notes`, `Tags`, folder path columns, `Photo1` through `Photo8`, barcode columns, `Location`, and `Expiry Date`.
- `Item Group Name`, attributes, and `Tags` are empty in the inspected files.
- Photos are widely populated, but the importer currently ignores them.
- No explicit supplier/vendor column exists.
- Supplier-like values appear mostly as brand/category names in folders or item names, so supplier creation should be proposed and reviewed, not inferred silently.

Data quality notes:

- `B3C04AD5...`: 1,074 item rows, 11 non-empty locations, 365 items missing location, 328 missing price, 29 duplicate `SID`s with conflicting product definitions.
- `87DD...`: 976 item rows, 50 non-empty locations, 55 items missing location, all prices missing, 16 duplicate `SID`s with conflicting product definitions.
- `inventory_restructured_operational_v2.csv`: better top-level operational category structure, 976 item rows, 50 non-empty locations, 55 missing locations, 16 conflicting duplicate `SID`s.

## Main Product Decisions

### Product Identity

Current behavior uses Sortly `SID` as SKU. That is risky for the inspected exports because some rows reuse a `SID` for different product names.

Proposed rule:

- Keep `SID` as the preferred SKU when it is unique for a product definition.
- In preview, flag conflicting duplicate SIDs as blocking issues.
- Allow an explicit import option for conflict handling:
  - `reject` default: safest; skips conflicting rows.
  - `derive-sku`: creates a deterministic SKU such as `<SID>-<short-row-hash>` for conflicts.
  - `name-suffix`: only if the user wants readable SKUs; more fragile.
- Do not silently merge different item names under one product.

### Categories

Current folder-path mapping is reasonable. Keep it deterministic.

Proposed additions:

- Preview the category tree before import.
- Report missing folders and rows defaulting to `Uncategorized`.
- Support an optional mapping file or review payload that remaps folder paths to existing category ids.

### Suppliers

There is no direct supplier field in the Sortly CSVs. Supplier support should be added to normalized rows first, then AI or user mapping can populate those fields.

Normalized row additions:

- `supplier_name`
- `supplier_sku`
- `supplier_cost`

Write behavior:

- Find supplier by tenant + normalized name.
- Create supplier only when the approved import plan says creation is allowed.
- Set `products.primary_supplier_id`.
- Set `products.supplier_sku`.
- Optionally create/update `supplier_products` later if the app starts using that relationship in product workflows.

Supplier inference should be preview-only:

- candidate from first folder segment when it looks brand-like;
- candidate from item-name prefix before a comma, when repeated across many rows;
- candidate from notes only when strong patterns exist.

### Locations And Areas

Current behavior treats every Sortly `Location` as a root location. That is too flat for shelf/bin values like `Bay I - Shelf 3`.

Proposed model:

- Import actual physical places as `locations`.
- Import shelf/bin/box substructure as `areas`.
- Attach inventory to `location_id + area_id` where a mapping exists.

MVP options:

- Keep current flat root-location behavior for existing API compatibility.
- Add optional normalized fields:
  - `location`
  - `area_path`
- In Sortly preview, propose area splits for obvious patterns:
  - `Bay I - Shelf 3` -> location `Main Store Room` or configured default, area `Bay I / Shelf 3`.
  - `Store Room - Box 6` -> location `Store Room`, area `Box 6`.
  - existing plain places like `Big garage` remain locations.

The final import should not guess the warehouse name. If the CSV only has shelf-like values, require a default location or approved mapping.

### Inventory

Current root inventory import should remain supported.

Additions:

- Support `area_path` imports.
- Reject root inventory writes when area-scoped inventory exists, preserving the existing safety check.
- For area-scoped imports, get or create areas under the selected location.
- Preview inventory writes as `create`, `update`, `skip`, or `conflict`.
- Keep `quantity` as snapshot quantity for Sortly item exports, not a stock movement stream.

### Photos

Do not include photos in the first supplier/location/inventory MVP unless explicitly prioritized.

Reason:

- Sortly photo URLs may require external download and storage.
- The app already has S3/MinIO product photo handling, but import needs idempotency, size/type checks, and failure isolation.

Plan as a later slice:

- preview rows with photos;
- optionally download and store first photo as primary;
- preserve source URL in photo metadata only if the schema supports it or a metadata extension is approved.

## AI-Assisted Importer

The AI should propose a mapping plan, not write directly.

Inputs:

- CSV headers.
- Row count and sampled rows.
- Column value distributions.
- Duplicate/conflict report.
- Existing categories, suppliers, locations, and areas for the tenant.
- User preferences such as default location, whether to create suppliers, and conflict policy.

Output schema should be deterministic and validated:

```ts
interface ImportPlanProposal {
  format: 'sortly-items' | 'normalized-products' | 'unknown';
  confidence: number;
  productIdentity: {
    sourceColumn: string;
    conflictPolicy: 'reject' | 'derive-sku';
  };
  categoryMappings: Array<{
    sourcePath: string;
    targetCategoryId?: string;
    targetPath?: string;
    action: 'use-existing' | 'create' | 'default';
  }>;
  supplierMappings: Array<{
    sourcePattern: string;
    supplierName: string;
    targetSupplierId?: string;
    action: 'use-existing' | 'create' | 'ignore';
    confidence: number;
  }>;
  locationMappings: Array<{
    sourceLocation: string;
    targetLocationId?: string;
    targetLocationName?: string;
    areaPath?: string;
    action: 'use-existing' | 'create-location' | 'create-area' | 'ignore';
    confidence: number;
  }>;
  warnings: Array<{
    row?: number;
    field?: string;
    message: string;
  }>;
}
```

Guardrails:

- Validate the AI response against an Effect schema before showing it.
- Treat low-confidence supplier/location mappings as suggestions requiring explicit approval.
- Never let AI-generated mappings bypass normal row validation.
- Keep actual import execution in the existing deterministic `ProductImportService`.

## Implementation Slices

### Slice 1: Deterministic Preview

Backend:

- Add `ProductImportPreviewService` or extend the import service with `previewCsvContent`.
- Reuse `parseCsvContent`, `detectProductImportFormat`, and row normalization.
- Return detected format, row counts, proposed categories, locations, duplicate SKU conflicts, missing fields, and inventory actions.
- Add API endpoint:
  - `POST /api/v1/products/import/preview`.

Types:

- Add `ProductImportPreviewDto`, `ProductImportWarningDto`, and mapping DTOs in `@stocket/types/products`.

Tests:

- Unit tests for preview summaries and duplicate SID conflicts.
- Integration test that preview is tenant-scoped and does not write rows.

### Slice 2: Supplier Columns In Normalized Import

Backend:

- Extend `NormalizedProductImportRow`.
- Add supplier cache to import caches.
- Add repository methods:
  - `findSupplierByName`
  - `createSupplier`
- Extend product import values with `primary_supplier_id` and `supplier_sku`.
- Keep supplier creation behind an option, defaulting to `false` for API import until preview/approval exists.

Types:

- Extend result DTO with `suppliersCreated` if the UI needs stats.

Tests:

- Import creates approved supplier and links product.
- Import links to existing supplier by tenant + name.
- Import does not leak supplier matches across tenants.

### Slice 3: Area-Aware Inventory Import

Backend:

- Extend normalized row with `area_path`.
- Add area cache.
- Add repository methods:
  - `findAreaByNameParentAndLocation`
  - `createArea`
  - `findInventoryByProductLocationAndArea`
- Add validation for root-vs-area inventory conflicts.

Tests:

- Root inventory path remains unchanged.
- Area inventory creates nested areas and attaches inventory to area.
- Root import still fails if area-scoped inventory exists.
- Area import does not overwrite root inventory unless explicitly configured.

### Slice 4: Reviewable UI Flow

Frontend:

- Change import dialog from one-shot upload to:
  - choose file;
  - analyze;
  - review issues and mappings;
  - confirm import.
- Show blocking issues separately from warnings.
- Include explicit controls for duplicate SID policy, default location, supplier creation, and area handling.

Tests:

- Hook/unit coverage for preview and confirm calls.
- Component test for blocking duplicate warning display if existing UI test infrastructure supports it.

### Slice 5: AI Proposal Layer

Backend:

- Add an AI proposal service behind a feature flag/config check.
- Keep model call optional; deterministic preview works without it.
- Send only sampled rows and aggregate stats unless full-file upload is explicitly needed and acceptable.
- Validate AI proposal schema.
- Persist nothing until the user confirms.

Frontend:

- Add "Suggest mappings" action after deterministic preview.
- Display AI suggestions as editable mappings, not hidden defaults.

Tests:

- Schema validation for accepted/rejected AI proposal payloads.
- Service test with mocked AI client.
- Import execution test proving unapproved suggestions do not write data.

## API Shape Draft

Preview:

```http
POST /api/v1/products/import/preview
Content-Type: multipart/form-data

file=<csv>
import_type=auto|normalized-products|sortly-items
```

Confirm:

```http
POST /api/v1/products/import
Content-Type: multipart/form-data

file=<csv>
import_type=sortly-items
plan=<approved JSON mapping plan>
```

Alternative:

- Store preview file server-side with an import session id.
- Confirm by `import_session_id` plus approved plan.
- This is better for large files, but it introduces lifecycle cleanup and storage concerns. Use direct re-upload for MVP unless file size becomes a real issue.

## Acceptance Criteria

- Raw Sortly exports can be previewed without writes.
- Preview reports duplicate SID conflicts, missing categories/locations/prices, proposed category tree, proposed locations/areas, and supplier candidates.
- Deterministic import can create/link suppliers from approved normalized supplier fields.
- Deterministic import can create root inventory or area-scoped inventory based on approved mapping.
- Existing normalized and Sortly import behavior remains backward-compatible.
- AI suggestions are optional, validated, visible, editable, and never applied without confirmation.

## Open Questions

- Should conflicting duplicate Sortly SIDs be rejected forever, or should we support deterministic derived SKUs?
- What is the default physical location for shelf-like Sortly values in the restructured file?
- Should first folder segment be treated as category, supplier candidate, or both?
- Is importing Sortly photos part of this migration, or should it stay separate?
- Should supplier creation be available to all product import users, or require `SUPPLIERS:write` in addition to product/location/inventory permissions?
- Do we want a durable import session model now, or is re-upload on confirm acceptable for the first UI?

## Suggested First PR

Build Slice 1 only:

- backend preview service;
- shared preview DTOs;
- CLI preview mode;
- API preview endpoint;
- focused tests;
- no AI dependency;
- no write behavior changes.

This gives us immediate visibility into real Sortly files and de-risks the supplier/location/area decisions before changing import writes.
