import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';

describe('security hardening', () => {
  it('CORS allows only the project origins', () => {
    expect(isAllowedOrigin('https://next-planning-v3-client.vercel.app')).toBe(true);
    expect(isAllowedOrigin('https://next-planning-v3-client-git-main-abir.vercel.app')).toBe(true);
    expect(isAllowedOrigin('https://evil-app.vercel.app')).toBe(false);
    expect(isAllowedOrigin('https://next-planning-v3-client.vercel.app.evil.com')).toBe(false);
    expect(isAllowedOrigin('https://evil-localhost.com')).toBe(false);
    expect(isAllowedOrigin('not a url')).toBe(false);
  });

  it('login rejects non-string credentials before any query (NoSQL operator injection)', async () => {
    await expect(AuthService.login({ $ne: null } as unknown as string, 'x')).rejects.toThrow('Username and password are required.');
    await expect(AuthService.login('admin', { $gt: '' } as unknown as string)).rejects.toThrow('Username and password are required.');
  });
});
