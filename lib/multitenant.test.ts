import { describe, expect, it } from 'vitest';
import { isSubscriptionBlocked } from './subscription-guard';
import { isPlatformOwnerEmail } from './platform-owner';
import { isProtectedTenantSlug } from './superadmin-service';
import { provisionTenant } from './tenant-provision';
import { ConflictError } from './utils/errors';

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

// The allowlist authorizes on the address alone, so any account created with
// one becomes a platform operator regardless of its stored role. Provisioning
// therefore has to treat those addresses as unowned. The check runs before the
// first database touch, so these cases need no connection.
describe('provisionTenant reserves platform-owner emails', () => {
  const baseInput = {
    organizationName: 'Rogue Collective',
    adminName: 'Dana Roe',
    password: 'Mango-Trail-42!',
    trialDays: 14,
    reason: 'reserved-email check',
  };

  it('rejects an address from the comma-separated allowlist', async () => {
    process.env.SUPERADMIN_EMAILS = 'owner@example.com';
    try {
      await expect(
        provisionTenant({ ...baseInput, email: 'OWNER@example.com' })
      ).rejects.toThrow(/reserved/i);
    } finally {
      delete process.env.SUPERADMIN_EMAILS;
    }
  });

  it('rejects the legacy singular variable too, as a 409', async () => {
    // 409 is load-bearing, not incidental: the public signup route maps only
    // that status to its deliberately ambiguous wording, so the rejection does
    // not become an oracle for which addresses are platform-owned.
    process.env.SUPERADMIN_EMAIL = 'legacy-owner@example.com';
    try {
      const error = await provisionTenant({
        ...baseInput,
        email: 'legacy-owner@example.com',
      }).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).statusCode).toBe(409);
    } finally {
      delete process.env.SUPERADMIN_EMAIL;
    }
  });
});

describe('isProtectedTenantSlug', () => {
  it('protects the default tenant only', () => {
    expect(isProtectedTenantSlug('default')).toBe(true);
    expect(isProtectedTenantSlug('acme')).toBe(false);
    expect(isProtectedTenantSlug(null)).toBe(false);
  });
});
