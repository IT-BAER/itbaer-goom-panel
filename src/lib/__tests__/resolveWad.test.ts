import { safeHttpUrl } from '../resolveWad';

describe('safeHttpUrl', () => {
  it('keeps absolute http(s) URLs', () => {
    expect(safeHttpUrl('https://example.com/wads/doom1.wad')).toBe('https://example.com/wads/doom1.wad');
    expect(safeHttpUrl('http://localhost:3000/a.wad')).toBe('http://localhost:3000/a.wad');
  });

  it('resolves a root-relative URL against the Grafana origin', () => {
    expect(safeHttpUrl('/public/plugins/itbaer-goom-panel/public/wads/freedoom1.wad')).toBe(
      `${window.location.origin}/public/plugins/itbaer-goom-panel/public/wads/freedoom1.wad`
    );
  });

  it.each(['javascript:alert(1)', 'data:application/octet-stream;base64,AAAA', 'file:///C:/doom1.wad'])(
    'refuses %s',
    (input) => {
      expect(() => safeHttpUrl(input)).toThrow('Refusing non-http(s) WAD URL');
    }
  );
});
