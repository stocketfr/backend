# Stocket MCP server

This module exposes a first-party Model Context Protocol (MCP) endpoint for
AI-assisted Stocket actions. The first slice covers product CRUD while keeping
the domain rules in `ProductsService`; the MCP layer is another application
boundary, not a second implementation of product behavior.

The platform-wide target contract, safety model, tool catalog, and rollout
sequence are defined in [`API_DESIGN.md`](./API_DESIGN.md). Treat that document
as the design authority for new domains; this README describes the currently
implemented product slice.

## Endpoint and request lifecycle

The Streamable HTTP endpoint is:

```text
/api/v1/mcp
```

It uses the official TypeScript MCP SDK's Web Standard Streamable HTTP
transport. A client starts a session with an MCP `initialize` request in a
`POST` without an `Mcp-Session-Id` header. The response supplies the session
ID; the client sends that ID on later requests. Sessions expire after 30
minutes without a request.

The installed `@effect/ai` version also includes `McpServer.layerHttp`, but its
native server currently negotiates protocol versions only through 2025-06-18.
This module keeps Effect `Tool`, Schema, services, and runtime as the
application model while using the official SDK bridge for MCP 2025-11-25,
request-scoped authentication, session binding, output schemas, safety
metadata, and confirmation elicitation. Re-evaluate the bridge when Effect's
native transport provides the same protocol and security controls.

This endpoint is currently for the signed-in Stocket application, not a public
remote MCP integration:

- The normal Better Auth and tenant middleware authenticate every HTTP request
  before it reaches MCP.
- The middleware captures a verified `CurrentRequestActor`. User and tenant
  IDs are never accepted as tool arguments.
- Each MCP session is bound to the authenticated user and tenant that created
  it. Later requests are authenticated again and are rejected if the user or
  tenant differs.
- Browser requests must have an HTTP(S) Origin whose host exactly matches the
  workspace request host. The normalized destination host and effective Origin
  are bound to the session and must remain unchanged on every request. Requests
  without an Origin, such as native clients and some same-origin streams, use
  the destination origin. This prevents a sibling tenant site from reusing a
  session.
- The shared registry filters `tools/list` by the actor's current permissions
  and enforces the same access policy again on every call. Confirmed commands
  recheck access after elicitation. Holding a valid MCP session does not bypass
  authorization changes.
- The real Better Auth session token is not copied into MCP SDK metadata.

Supporting arbitrary remote MCP clients will require a proper OAuth-protected
resource flow, client registration policy, scopes, token validation, and
security review. That is future work; do not expose this endpoint publicly as
though the embedded Better Auth cookie model were remote MCP authorization.

The embedded browser must reach MCP through the workspace's own origin. In
development, proxy `/api/v1/mcp` through the same frontend origin instead of
calling a different backend port directly. At the edge, preserve the public
`Host` header and set the correct `X-Forwarded-Proto`; the current transport
intentionally fails closed if the Web request URL does not represent the public
destination. Keep these headers stable for every request in an MCP session.

Sessions and active transports currently live in the API process's memory.
The bridge limits sessions to five per user/workspace and 500 per process,
rejects excess initialization with `429`, and closes sessions after 30 idle
minutes using both a periodic sweep and request-driven cleanup. Client
cancellation interrupts the running Effect tool fiber.
Horizontal scaling therefore requires sticky routing by `Mcp-Session-Id`, and
sessions are lost on process restart. Before running without sticky routing,
replace this with a shared session/transport design or redesign the endpoint
to be stateless. Copying only the session ID map to Redis is insufficient
because the SDK server, transport, and any open request streams are also
process-local.

## Architecture

The module deliberately separates protocol concerns from business logic:

| File                   | Responsibility                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `products/schemas.ts`  | JSON-native Effect Schema inputs and structured outputs                                             |
| `products/tools.ts`    | Co-located Tool, access policy, safety policy, and handler registration for each product capability |
| `products/handlers.ts` | Service orchestration, audit requests, confirmation plans, and undo instructions                    |
| `tool.ts`              | Typed factories, access enforcement, output validation, contract validation, and registry           |
| `registry.ts`          | Root feature composition; its required Effect environment is inferred                               |
| `server.ts`            | MCP SDK server, bounded Streamable HTTP sessions, principal binding, and elicitation                |
| `router.ts`            | Restores verified request scope and bridges SDK cancellation into the application runtime           |

Each feature's `tools.ts` is the source of truth for tool names, schemas,
descriptions, MCP annotations, access requirements, safety policy, and handler.
The shared factories derive output encoding from `tool.successSchema`, decode
unknown input once, validate structured output, apply a bounded timeout, and
present entity-neutral failures without leaking infrastructure details. They
attach versioned `fr.stocket/tool` and `fr.stocket/safety` metadata. The root
registry uses a name-indexed `Map`, validates names, duplicates, policy
invariants, and undo references at startup, and exposes a stable serializable
contract manifest. Confirmation-required registrations always run
`prepare -> elicit -> reauthorize -> execute`; a required-confirmation policy
cannot be registered through a non-confirming factory.

MCP annotations such as `readOnlyHint` and `destructiveHint` help clients plan
and present actions, but they are advisory. Authorization, confirmation, tenant
isolation, and destructive-action rules must remain server-enforced.

## Adding another tool or module

Do not mechanically expose an HTTP route as an MCP tool. HTTP and MCP should
share the owning service and shared boundary contracts, while each protocol
gets an intentional contract suitable for its caller.

For a new tool:

1. Define JSON-native input and output schemas in the feature's MCP `schemas.ts`.
   Reuse shared `@stocket/types` schemas when their wire representation fits.
   Do not reuse schemas that transform HTTP query strings into domain values.
2. In the feature's `tools.ts`, add an `@effect/ai` `Tool` with a stable,
   namespaced name, a user-oriented description, and accurate read-only,
   destructive, idempotent, and open-world hints.
3. Implement the handler against the owning feature service, never another
   module's repository. Use the existing audited-mutation boundary for
   mutations, but do not treat the fire-and-forget audit log as an undo ledger.
4. Register the capability with `defineMcpQuery`, `defineMcpCommand`, or
   `defineConfirmedMcpCommand`. Declare permissions once in `access` and what
   users will observe, reversibility, confirmation, and the undo tool in
   `policy`. Confirmed commands use a preparation step that captures immutable
   preview state; the factory supplies the post-confirmation permission check.
5. Export one `defineMcpFeature` from the domain and add it to
   `composeMcpRegistry` in `registry.ts`. Dependencies are inferred from the
   handlers; do not add parallel dependency arrays to the router or transport.
6. Add tests for schema rejection, permission-filtered discovery, tenant and
   permission isolation, mutation behavior, confirmation refusal/unavailability,
   stale confirmation state, and returned undo instructions. Contract
   validation tests must cover names and recovery references.

Keep identity and workspace scope out of tool schemas. Keep pure representation
translation in `mappers.ts`, orchestration in handlers/services, and persistence
in the owning repository. Tool results should be structured, concise, and
contain the stable resource IDs needed for a follow-up action.

## Product tools

| Tool               | Behavior                                               | Confirmation                                   | Current undo                                                               |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `products_search`  | Search and page through concise product summaries      | None; read-only                                | Not applicable                                                             |
| `products_get`     | Read one product, optionally from trash                | None; read-only                                | Not applicable                                                             |
| `products_create`  | Create one product                                     | None                                           | Move the new product to trash with `products_archive`                      |
| `products_update`  | Change selected fields on one product                  | None currently; marked destructive for clients | Call `products_update` with the captured previous values; best-effort only |
| `products_archive` | Move one product to trash; never permanently delete it | Required, server-enforced                      | Restore it with `products_restore`                                         |
| `products_restore` | Restore one product from trash                         | None                                           | Move it back to trash with `products_archive`                              |

Read tools require the product read permission. Every mutation requires the
product write permission. No permanent-delete or bulk-mutation tool is exposed
in this first slice.

## Confirmation UX

Confirmation and undo solve different problems and should be used together.
Confirmation prevents an unwanted action; undo provides recovery after a
confirmed action has an unexpected result.

`products_archive` uses MCP form elicitation with a plain-language prompt that
names the product and SKU, explains that it will disappear from normal lists,
and says it can be restored. The affirmative control is labeled “Move to
trash,” not with an implementation term or raw command. If the client declines,
dismisses, does not support elicitation, or returns invalid confirmation data,
the handler makes no change and reports that confirmation is still required.
After acceptance, it rechecks the actor's write permission. The product service
then archives with one tenant-scoped conditional `UPDATE` that requires the
previewed `updated_at` value and a non-archived row; a mismatch changes nothing
and returns a typed conflict.

Future prompts, especially for bulk actions, should always state:

- the action in the user's language;
- the affected object type and exact count;
- the important scope, filters, destination, or exceptions;
- what users will observe after it runs;
- whether and for how long it can be undone; and
- a specific affirmative label such as “Move 84 products to Lyon.”

Show representative examples and expandable details when a list is large; do
not ask a nontechnical user to approve a list of tool calls or database IDs.
The confirmed proposal must be immutable: confirmation for one count, filter,
or destination must not authorize a recomputed action with different impact.

## Current undo guarantees

Mutation responses include a structured undo instruction so the client can
offer an immediate Undo action:

- create returns an archive instruction;
- archive returns a restore instruction;
- restore returns an archive instruction; and
- update returns the product's previous editable values.

Archive and restore use the product service's soft-delete lifecycle; the MCP
server never requests permanent deletion. These inverse instructions are
useful now, but they are not yet a durable undo system:

- the instruction is returned to the caller rather than stored as a committed
  change set;
- update undo is best-effort and can overwrite a later human or AI edit;
- single-product archive freshness is enforced atomically, but update undo is
  still not protected by an equivalent version check;
- the original mutation and its inverse snapshot are not committed in one
  database transaction;
- a process failure or lost chat result can lose the convenient Undo action;
  and
- the audit log is fire-and-forget and must not be used for correctness or
  reconstruction.

Do not add bulk rename, bulk move, or other high-impact MCP mutations on top of
these best-effort semantics. Implement the durable ledger below first.

## Durable transactional change-set ledger

Bulk actions should be modeled as a proposed, confirmed, applied, and undoable
change set rather than as a loop of unrelated tool calls.

### Suggested persisted model

`change_sets` records one user-visible action:

- `id`, `tenant_id`, `actor_user_id`, and optional MCP conversation/request ID;
- operation kind, human-readable summary, affected count, and sanitized preview;
- canonical proposal payload plus a hash and expiry time;
- idempotency key;
- status such as `proposed`, `confirmed`, `applying`, `applied`, `undone`,
  `failed`, or `expired`;
- confirmation actor/time and applied/undone timestamps; and
- a reference to the change set that reversed it, when applicable.

`change_set_items` records each affected entity in deterministic order:

- `change_set_id`, `tenant_id`, ordinal, resource type, resource ID, and
  operation (`create`, `update`, `archive`, `restore`, or `move`);
- schema-versioned `before` and `after` snapshots containing only fields needed
  to apply and reverse the operation;
- the expected pre-apply version or `updated_at` value and the version written
  by the change; and
- per-item outcome/error metadata for diagnostics. User-visible bulk behavior
  should still default to atomic success or failure.

Both tables must be tenant-fenced through the platform tenant abstractions.
Decode snapshot JSON through versioned Effect Schemas when it is read; never
cast stored JSON into a domain type. Define retention, encryption, and field
redaction policies because before/after snapshots may contain sensitive data.

### Apply flow

1. **Plan:** Resolve the target set with the owning services/repositories under
   the current tenant and permission. Capture deterministic IDs, before/after
   snapshots, expected versions, count, preview, and proposal hash. Store the
   change set as `proposed` with a short expiry.
2. **Confirm:** Present the stored summary to the user. Bind acceptance to the
   change-set ID and proposal hash, record who confirmed it, and fail closed if
   confirmation is unavailable. Never silently rebuild the target set after
   confirmation.
3. **Apply:** In one database transaction, lock or conditionally update the
   affected rows, verify their current versions still match the proposal,
   perform all domain writes, persist item outcomes, and mark the change set
   `applied`. A mismatch causes a typed conflict and rolls back the whole set so
   the user can review a fresh preview. The idempotency key prevents retries
   from applying the same action twice.
4. **Report:** Return the actual affected count, skipped/conflicted count (zero
   for atomic mode), a concise result, and a durable `change_set_id` that the UI
   can place in activity history with an Undo action.

For very large sets that cannot fit a practical database transaction, use
explicit batches with persisted checkpoints and a compensating workflow. That
is a different, weaker atomicity contract and must be stated in the preview and
result rather than hidden behind the same “all-or-nothing” wording.

### Undo flow

`change_sets_undo` should load an applied change set, authorize the current
actor, and create a new reversal change set. In a transaction it processes the
original items in reverse dependency order and verifies that every entity is
still at the version produced by the original action. It then:

- restores `before` values for updates and moves;
- restores the previous archive state for archive/restore operations; and
- archives entities created by the action instead of permanently deleting
  them.

If an entity has changed since the original action, default to an atomic
conflict with a plain-language explanation; do not overwrite newer work. A
future privileged conflict-resolution flow may offer a reviewed partial undo,
but it must be a separately confirmed change set. Repeated undo requests must
be idempotent, and undoing an undo is represented by another explicit change
set rather than mutating history.

The eventual MCP surface can expose a previewing domain tool (for example,
`products_bulk_move`) plus generic `change_sets_get` and `change_sets_undo`
tools. The domain tool should plan, elicit confirmation for the stored proposal,
and apply it; when elicitation is unavailable, it returns the proposed change
set without applying anything so the Stocket UI can present the same preview
and confirmation safely.

## Protocol references

- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
