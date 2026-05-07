import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('app identity (regression)', () => {
  it('main.ts BrowserWindow uses title "AI-yard"', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'main', 'main.ts'), 'utf-8');
    expect(source).toContain("title: 'AI-yard'");
  });

  it('package.json identity fields match AI-yard branding', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'),
    );
    expect(pkg.name).toBe('@mikulgohil/ai-yard');
    expect(pkg.build?.appId).toBe('com.aiyard.app');
    expect(pkg.build?.productName).toBe('AI-yard');
    expect(pkg.bin?.['ai-yard']).toBe('bin/ai-yard.js');
  });
});
