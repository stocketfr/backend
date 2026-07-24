import { makeMcpToolRegistry } from '../tool';
import { productMcpFeature } from './tools';

export { productMcpFeature } from './tools';

export const productMcpRegistry = makeMcpToolRegistry(
  productMcpFeature.registrations,
);
