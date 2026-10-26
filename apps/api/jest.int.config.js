/**
 * Integration tests against a real PostgreSQL. They create a fresh throwaway database,
 * apply the migrations and drop it afterwards. Set TEST_DATABASE_ADMIN_URL to a server
 * connection string (default: postgresql://postgres:pg@localhost:5432/postgres).
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  testTimeout: 120000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: { '^@sanad/shared$': '<rootDir>/../../packages/shared/src' },
};
