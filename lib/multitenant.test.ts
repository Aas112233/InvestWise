import { describe, expect, it } from 'vitest';
import { isSubscriptionBlocked } from './subscription-guard';
import { isPlatformOwnerEmail } from './platform-owner';
import { isProtectedTenantSlug } from './superadmin-service';

describe('isSubscriptionBlocked', () => {
  it('never blocks trial or active', () => {
    expect(isSubscriptionBlocked('trial', null)).toBe(false);
    expect(isSubscriptionBlocked('active', null)).toBe(false);
  });

  it('hard-blocks suspended, cancelled and expired', () => {
    for (const s of ['suspended', 'cancelled', 'expired']) {
      expect(isSubscriptionBlocked(s, null)).toBe(true);
    }
  });

  it('blocks past_due only after grace lapses', () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 3600_000);
    expect(isSubscriptionBlocked('past_due', future)).toBe(false);
    expect(isSubscriptionBlocked('past_due', past)).toBe(true);
    expect(isSubscriptionBlocked('past_due', null)).toBe(true);
  });

  it('treats missing status as unblocked', () => {
    expect(isSubscriptionBlocked(null, null)).toBe(false);
    expect(isSubscriptionBlocked(undefined, null)).toBe(false);
  });
});

describe('isPlatformOwnerEmail', () => {
  it('matches allowlist case-insensitively', () => {
    process.env.SUPERADMIN_EMAILS = 'Owner@Example.com, second@example.com';
    expect(isPlatformOwnerEmail('owner@example.com')).toBe(true);
    expect(isPlatformOwnerEmail('SECOND@EXAMPLE.COM')).toBe(true);
    expect(isPlatformOwnerEmail('stranger@example.com')).toBe(false);
    expect(isPlatformOwnerEmail(null)).toBe(false);
    delete process.env.SUPERADMIN_EMAILS;
  });
});

describe('isProtectedTenantSlug', () => {
  it('protects the default tenant only', () => {
    expect(isProtectedTenantSlug('default')).toBe(true);
    expect(isProtectedTenantSlug('acme')).toBe(false);
    expect(isProtectedTenantSlug(null)).toBe(false);
  });
});
