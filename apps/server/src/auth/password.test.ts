import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

describe('empreinte du mot de passe', () => {
  it('reconnaît le bon mot de passe et refuse les autres', async () => {
    const stored = await hashPassword('un mot de passe solide');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain('solide');
    expect(await verifyPassword('un mot de passe solide', stored)).toBe(true);
    expect(await verifyPassword('un mot de passe solidE', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('utilise un sel différent à chaque fois', async () => {
    expect(await hashPassword('identique-123')).not.toBe(await hashPassword('identique-123'));
  });

  it('refuse une empreinte mal formée', async () => {
    for (const stored of ['', 'bcrypt$x', 'scrypt$0$8$1$a$b', 'scrypt$abc$8$1$a$b']) {
      expect(await verifyPassword('x', stored)).toBe(false);
    }
  });
});
