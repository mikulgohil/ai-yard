export type ThemeName = 'midnight' | 'paper' | 'slate';

export const THEME_OPTIONS: { value: ThemeName; label: string; hint: string }[] = [
  { value: 'midnight', label: 'Midnight', hint: 'Warm dark — default' },
  { value: 'paper', label: 'Paper', hint: 'Warm light' },
  { value: 'slate', label: 'Slate', hint: 'Cool light' },
];

const DEFAULT_THEME: ThemeName = 'midnight';

export function resolveTheme(input: string | undefined | null): ThemeName {
  switch (input) {
    case 'midnight':
    case 'paper':
    case 'slate':
      return input;
    case 'dark':
      return 'midnight';
    case 'light':
      return 'paper';
    default:
      return DEFAULT_THEME;
  }
}

/** Whether the resolved theme uses dark surfaces. Used by xterm and any
 * other JS-driven appearance switch that needs to pair with light vs dark. */
export function isDarkTheme(name: ThemeName): boolean {
  return name === 'midnight';
}
