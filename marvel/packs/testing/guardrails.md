# Testing

Best practices for writing reliable, maintainable tests using Vitest.

## Test Naming

- Use descriptive test names that read as sentences: `it("returns an error when the input is empty")`
- Group related tests with `describe` blocks that name the unit under test
- Name test files to match their source: `utils.ts` -> `utils.test.ts`

## Arrange-Act-Assert

- Structure every test with the Arrange-Act-Assert pattern
- Separate the three phases with blank lines for readability
- Keep the "act" phase to a single function call or operation

## Test Independence

- Each test must be fully independent; never rely on execution order
- Use `beforeEach` for shared setup rather than depending on prior test state
- Clean up side effects in `afterEach` when necessary

## Mocking

- Mock at boundaries only: network calls, file system, external services
- Prefer dependency injection over module-level mocking when possible
- Reset mocks between tests to prevent cross-test contamination

## Assertions

- Use strong, specific assertions; avoid loose checks like `toBeTruthy` for objects
- Assert on exact values when practical; test edge cases and error paths
- Prefer `toEqual` for deep object comparison over `toBe`

## Behavior Over Implementation

- Test observable behavior and outputs, not internal implementation details
- Avoid testing private methods directly; exercise them through public APIs
- Refactoring the implementation should not break tests if behavior is unchanged
