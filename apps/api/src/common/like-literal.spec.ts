// likeLiteral: a search text as a LIKE pattern that matches only itself.
import { describe, it, expect } from 'vitest';
import { likeLiteral } from './like-literal';

describe('likeLiteral', () => {
  it('puts a backslash before a %, an _ and a \\', () => {
    expect(likeLiteral('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(likeLiteral('%')).toBe('\\%');
    expect(likeLiteral('_')).toBe('\\_');
    expect(likeLiteral('\\')).toBe('\\\\');
  });

  it('escapes each one of a run, and a backslash that comes before a wildcard as well as the wildcard', () => {
    expect(likeLiteral('%%__')).toBe('\\%\\%\\_\\_');
    expect(likeLiteral('\\%')).toBe('\\\\\\%');
  });

  it('leaves any other text as it is', () => {
    for (const text of ['', 'Jane Doe', '0811-0000', 'AB-123', 'a.b*c[d](e)^$+?|{}\'"', 'Café 日本語']) {
      expect(likeLiteral(text)).toBe(text);
    }
  });
});
