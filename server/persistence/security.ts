import crypto from 'node:crypto';

/**
 * Generates a human-friendly slug with ~64 bits of cryptographic randomness
 * so unlisted plan links cannot be enumerated by brute force.
 */
export function generateSecureSlug(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

  const randomSuffix = crypto.randomBytes(8).toString('base64url').toLowerCase();
  return base ? `${base}-${randomSuffix}` : `quedada-${randomSuffix}`;
}

/**
 * Generates an opaque 256-bit secret token (for adminToken or participantToken).
 */
export function generateSecretToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Hashes a bearer/admin/participant token with SHA-256 before storing it in PostgreSQL.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Constant-time verification of a raw token against a stored SHA-256 hex digest.
 */
export function verifyTokenHash(rawToken: string | null | undefined, expectedHash: string): boolean {
  if (!rawToken || !expectedHash) return false;
  const actualBuf = Buffer.from(hashToken(rawToken), 'utf8');
  const expectedBuf = Buffer.from(expectedHash, 'utf8');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Lightweight in-memory fixed-window rate limiter suited for single-instance PaaS deployments.
 */
export class InMemoryRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.pruneIfLarge(now);
      return {
        allowed: true,
        remaining: Math.max(0, this.maxRequests - 1),
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    if (existing.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  private pruneIfLarge(now: number): void {
    if (this.buckets.size < 2000) return;
    for (const [k, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(k);
      }
    }
  }
}
