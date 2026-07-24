# Install dependencies
bootstrap:
  pnpm install

# Run development server with Infisical-injected environment variables
dev:
  pnpm start

# Build for production
build:
  pnpm build

# Run the production server with environment variables injected by the operator
start:
  pnpm start:production

# Run the compiled production artifact locally with development secrets
start-local-production-build:
  pnpm start:local:production-build

# Lint and fix code
lint:
  pnpm lint

# Format code
format:
  pnpm format

# Run tests
test:
  pnpm test

# Run tests in watch mode
test-watch:
  pnpm test:watch

# Run tests with coverage
test-coverage:
  pnpm test:cov

# Run e2e tests
test-e2e:
  pnpm test:e2e
