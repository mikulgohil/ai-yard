import type { Breadcrumb, ErrorEvent } from '@sentry/core';

export interface ScrubPaths {
  homeDir: string;
  stateDir: string;
}

export interface SentryScrubbers {
  scrubPath(s: string): string;
  scrubEvent(event: ErrorEvent): ErrorEvent | null;
  scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null;
}

export function createSentryScrubbers(paths: ScrubPaths): SentryScrubbers {
  const { homeDir, stateDir } = paths;

  const scrubPath = (s: string): string =>
    s.split(stateDir).join('<state>').split(homeDir).join('~');

  const scrubObject = (obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (!obj) return obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'string' ? scrubPath(v) : v;
    }
    return out;
  };

  const scrubEvent = (event: ErrorEvent): ErrorEvent | null => {
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubPath(ex.value);
        if (ex.stacktrace?.frames) {
          for (const frame of ex.stacktrace.frames) {
            if (frame.filename) frame.filename = scrubPath(frame.filename);
            if (frame.abs_path) frame.abs_path = scrubPath(frame.abs_path);
          }
        }
      }
    }
    if (event.extra) event.extra = scrubObject(event.extra) as typeof event.extra;
    if (event.tags) event.tags = scrubObject(event.tags) as typeof event.tags;
    return event;
  };

  const scrubBreadcrumb = (crumb: Breadcrumb): Breadcrumb | null => {
    if (crumb.message) crumb.message = scrubPath(crumb.message);
    if (crumb.data) crumb.data = scrubObject(crumb.data) as typeof crumb.data;
    return crumb;
  };

  return { scrubPath, scrubEvent, scrubBreadcrumb };
}
