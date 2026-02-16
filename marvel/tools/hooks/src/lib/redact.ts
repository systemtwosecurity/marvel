// Copyright 2026 Detections AI
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared Secret Redaction
 *
 * Centralizes sensitive content redaction for all hooks and logging.
 */

/**
 * Redact sensitive content from strings.
 * Catches API keys, tokens, passwords, env var assignments, and inline secrets.
 */
export function redactSensitive(content: string): string {
  return content
    // Long tokens/keys (32+ alphanumeric chars)
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED_TOKEN]")
    // password/secret assignments
    .replace(/password\s*[:=]\s*\S+/gi, "password: [REDACTED]")
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, "api_key: [REDACTED]")
    // Env var assignments with long values (KEY="longvalue" or KEY=longvalue)
    .replace(
      /\b[A-Z][A-Z0-9_]{2,}=["']?[^\s"']{16,}["']?/g,
      (match) => {
        const eqIdx = match.indexOf("=");
        return match.slice(0, eqIdx + 1) + "<REDACTED>";
      }
    )
    // Inline secrets in curl -H "Authorization: Bearer ..."
    .replace(
      /(Authorization:\s*Bearer\s+)\S+/gi,
      "$1[REDACTED]"
    )
    // AWS-style keys in commands (AKIA...)
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]")
    // Inline --token/--password/--secret flags
    .replace(
      /(--(?:token|password|secret|api-key|apikey|access-key)[=\s]+)\S+/gi,
      "$1[REDACTED]"
    )
    // Anthropic/OpenAI API keys (sk-ant-..., sk-...)
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/pk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]")
    // Database connection strings
    .replace(/postgres:\/\/[^@\s]+@/gi, "postgres://[REDACTED]@")
    .replace(/mysql:\/\/[^@\s]+@/gi, "mysql://[REDACTED]@")
    .replace(/mongodb:\/\/[^@\s]+@/gi, "mongodb://[REDACTED]@")
    // JWT tokens
    .replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_JWT]")
    // GitHub tokens
    .replace(/gh[poas]_[A-Za-z0-9_]{36,}/g, "[REDACTED_GH_TOKEN]")
    // Slack tokens
    .replace(/xox[bpars]-[A-Za-z0-9-]+/g, "[REDACTED_SLACK_TOKEN]")
    // Stripe keys
    .replace(/[sr]k_(live|test)_[A-Za-z0-9]+/g, "[REDACTED_STRIPE_KEY]")
    // Google Cloud API keys
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_GCP_KEY]")
    // NPM tokens
    .replace(/npm_[A-Za-z0-9]{36}/g, "[REDACTED_NPM_TOKEN]")
    // SSH Private Keys
    .replace(/-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

/**
 * Redact secrets from an object recursively.
 */
export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const sensitiveKey = /key|secret|password|token|auth/i.test(key);
    if (sensitiveKey && typeof value === "string") {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      result[key] = redactSensitive(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item: unknown) => {
        if (typeof item === "string") return redactSensitive(item);
        if (typeof item === "object" && item !== null) return redactObject(item as Record<string, unknown>);
        return item;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Truncate a string to max bytes for trace storage.
 */
export function truncateForTrace(content: string, maxBytes: number = 10240): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  if (bytes.length <= maxBytes) return content;
  const truncateAt = Math.floor(maxBytes / 2);
  return `${content.substring(0, truncateAt)}... [TRUNCATED - ${bytes.length} bytes total]`;
}