# Security

Security best practices for input validation, secret management, and safe coding patterns.

## Validate at Boundaries

- Validate and sanitize all external input at API boundaries using Zod schemas
- Never trust client-side validation alone; always re-validate on the server
- Reject invalid input early with clear, safe error responses

## Secret Management

- Never hardcode secrets, API keys, or credentials in source code
- Use environment variables for all secrets; load them via a validated config module
- Never log secrets or include them in error messages

## Safe Error Messages

- Return generic error messages to clients; never expose stack traces or internal details
- Log detailed error information server-side for debugging
- Use consistent error response shapes across all API endpoints

## Input Sanitization

- Sanitize user input before rendering to prevent XSS attacks
- Use parameterized queries for all database operations; never concatenate user input into SQL
- Validate file uploads for type, size, and content before processing

## Authentication and Authorization

- Check authentication on every protected route; never rely on client-side guards alone
- Apply the principle of least privilege for all authorization checks
- Use secure, httpOnly cookies for session tokens; never store tokens in localStorage

## Dependencies

- Keep dependencies up to date; monitor for known vulnerabilities
- Audit new dependencies before adding them to the project
- Prefer well-maintained libraries with active security practices
