import { describe, expect, it } from 'vitest';
import { signStash, parseSignedStash, type StashPayload } from './impersonation-stash';

const payload: StashPayload = {
  access: 'header.payload.sig',
  refresh: null,
  targetSessionId: '0b595a69-9d5e-4add-9f22-f5cd4bfb9900',
  targetUserId: 'af31c56e-f1ce-4136-b4fa-f5949fa63966',
};

describe('impersonation stash — unforgeable exit credential', () => {
  it('a server-signed stash parses back identically', () => {
    const signed = JSON.stringify({
      ...payload,
      sig: signStash(payload),
    });
    const parsed = parseSignedStash(signed);
    expect(parsed).not.toBeNull();
    expect(parsed?.targetSessionId).toBe(payload.targetSessionId);
    expect(parsed?.targetUserId).toBe(payload.targetUserId);
  });

  it('a FORGED stash with no signature is treated as absent', () => {
    // The live attack: hand-crafted stash naming an arbitrary victim session.
    const forged = JSON.stringify(payload);
    expect(parseSignedStash(forged)).toBeNull();
  });

  it('a tampered stash (field swapped) fails verification', () => {
    // Swap the target — the signature no longer covers the new value set.
    const tampered = JSON.stringify({
      ...payload,
      targetUserId: '00000000-0000-0000-0000-000000000001',
      sig: signStash(payload),
    });
    expect(parseSignedStash(tampered)).toBeNull();
  });

  it('a stash signed for a DIFFERENT target cannot be replayed for this one', () => {
    const other: StashPayload = {
      ...payload,
      targetUserId: '11111111-1111-1111-1111-111111111111',
    };
    const replayed = JSON.stringify({ ...payload, sig: signStash(other) });
    expect(parseSignedStash(replayed)).toBeNull();
  });

  it('malformed JSON and missing fields are absent, never a throw', () => {
    expect(parseSignedStash(undefined)).toBeNull();
    expect(parseSignedStash('not json')).toBeNull();
    expect(parseSignedStash('{"access":"x"}')).toBeNull();
  });
});
