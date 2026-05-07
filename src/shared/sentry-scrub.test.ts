import { describe, expect, it } from 'vitest';
import { createSentryScrubbers } from './sentry-scrub';

const paths = { homeDir: '/Users/mock-user', stateDir: '/Users/mock-user/.ai-yard' };

describe('createSentryScrubbers', () => {
  it('scrubPath replaces stateDir before homeDir so state paths are tagged', () => {
    const { scrubPath } = createSentryScrubbers(paths);
    expect(scrubPath('/Users/mock-user/.ai-yard/foo.json')).toBe('<state>/foo.json');
    expect(scrubPath('/Users/mock-user/Developer/x.ts')).toBe('~/Developer/x.ts');
  });

  it('scrubPath leaves unrelated paths alone', () => {
    const { scrubPath } = createSentryScrubbers(paths);
    expect(scrubPath('/usr/local/bin/node')).toBe('/usr/local/bin/node');
  });

  it('scrubEvent walks exception frames and tag/extra strings', () => {
    const { scrubEvent } = createSentryScrubbers(paths);
    const event = {
      exception: {
        values: [
          { value: '/Users/mock-user/foo', stacktrace: { frames: [{ filename: '/Users/mock-user/.ai-yard/x', abs_path: '/Users/mock-user/y' }] } },
        ],
      },
      extra: { detail: 'opened /Users/mock-user/file' },
      tags: { path: '/Users/mock-user/.ai-yard/state' },
    };
    const out = scrubEvent(event as never) as unknown as typeof event;
    expect(out.exception.values[0].value).toBe('~/foo');
    expect(out.exception.values[0].stacktrace.frames[0].filename).toBe('<state>/x');
    expect(out.exception.values[0].stacktrace.frames[0].abs_path).toBe('~/y');
    expect(out.extra.detail).toBe('opened ~/file');
    expect(out.tags.path).toBe('<state>/state');
  });

  it('scrubBreadcrumb scrubs message and string data values', () => {
    const { scrubBreadcrumb } = createSentryScrubbers(paths);
    const crumb = { message: 'wrote /Users/mock-user/foo', data: { path: '/Users/mock-user/.ai-yard/x', count: 5 } };
    const out = scrubBreadcrumb(crumb as never) as unknown as typeof crumb;
    expect(out.message).toBe('wrote ~/foo');
    expect(out.data.path).toBe('<state>/x');
    expect(out.data.count).toBe(5);
  });

  it('scrubBreadcrumb handles missing message and data', () => {
    const { scrubBreadcrumb } = createSentryScrubbers(paths);
    const crumb = { category: 'navigation' };
    const out = scrubBreadcrumb(crumb as never) as unknown as typeof crumb;
    expect(out).toEqual({ category: 'navigation' });
  });
});
