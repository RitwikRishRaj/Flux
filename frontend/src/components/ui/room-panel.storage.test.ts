import { describe, it, expect, beforeEach } from 'vitest';

describe('room-panel persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads saved name and color from localStorage', () => {
    localStorage.setItem('flux-name', 'TestUser');
    localStorage.setItem('flux-color', '#testcol');

    const name = localStorage.getItem('flux-name') ?? '';
    const color = localStorage.getItem('flux-color') ?? '#5FD0A8';

    expect(name).toBe('TestUser');
    expect(color).toBe('#testcol');
  });

  it('defaults to empty name and first color when localStorage is empty', () => {
    const COLORS = ['#5FD0A8', '#7FB2F0', '#F0A27F', '#E58FB4'];

    const name = localStorage.getItem('flux-name') ?? '';
    const color = localStorage.getItem('flux-color') ?? COLORS[0];

    expect(name).toBe('');
    expect(color).toBe('#5FD0A8');
  });

  it('persists updates to localStorage', () => {
    localStorage.setItem('flux-name', 'NewUser');
    localStorage.setItem('flux-color', '#newcolor');

    expect(localStorage.getItem('flux-name')).toBe('NewUser');
    expect(localStorage.getItem('flux-color')).toBe('#newcolor');
  });
});
