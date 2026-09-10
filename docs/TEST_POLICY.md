# Test Policy

This document outlines the testing policy for the vscode-aks-tools project.

## Overview

All contributions to this project should include appropriate tests to ensure code quality and prevent regressions.

## When Tests Are Required

### New Functionality
- All new features MUST include corresponding tests
- Bug fixes SHOULD include tests that demonstrate the bug is fixed
- Refactoring SHOULD include tests to maintain code coverage

### Test Types

1. **Unit Tests**: Test individual functions/methods in isolation
2. **Integration Tests**: Test interactions between components
3. **End-to-End Tests**: Test complete user workflows

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate test coverage report
npm run test:coverage
```

## Test Location

- Unit tests: `src/test/unit/`
- Integration tests: `src/test/integration/`
- E2E tests: `src/test/e2e/`

## Pull Request Requirements

All PRs must:
1. Include tests for new functionality
2. Pass all existing tests
3. Maintain or improve code coverage

## CI/CD Enforcement

- All tests run automatically on PRs
- Code coverage reports are generated
- Failing tests block merge
