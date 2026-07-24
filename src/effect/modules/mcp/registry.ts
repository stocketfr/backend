import { productMcpFeature } from './products';
import { composeMcpRegistry, type McpToolRegistryRequirements } from './tool';

// Feature modules export registrations rather than protocol servers. New
// domains compose here and automatically share the same decoding, output,
// confirmation, authentication, and transport behavior.
export const mcpRegistry = composeMcpRegistry(productMcpFeature);

export type McpRegistryServices = McpToolRegistryRequirements<
  typeof mcpRegistry
>;
