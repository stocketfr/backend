import { productMcpRegistrations } from './products';
import { makeMcpToolRegistry } from './tool';

// Feature modules export registrations rather than protocol servers. New
// domains compose here and automatically share the same decoding, output,
// confirmation, authentication, and transport behavior.
export const mcpRegistry = makeMcpToolRegistry([...productMcpRegistrations]);
