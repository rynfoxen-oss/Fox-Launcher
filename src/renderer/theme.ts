import type { Appearance } from '../shared/types';
import { getTheme, hexToRgb, lightenHex, THEME_MOTION } from '../shared/themes';

const MOTION_SCALE: Record<NonNullable<Appearance['themeMotion']>, number> = {
  calm: 0.5,
  normal: 1,
  vivid: 1.6,
};

/**
 * Electron reports macOS in the user agent. Kept here so every renderer component
 * can use the same answer without adding another IPC round trip.
 */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent);

/** Applies every visual variable for a theme. Safe to call repeatedly for live previews. */
export function applyAppearance(root: HTMLElement, appearance: Appearance | undefined) {
  if (!appearance) return;
  const theme = getTheme(appearance.theme);
  const motion = THEME_MOTION[theme.id] ?? THEME_MOTION.fox;
  const themeMotion = appearance.themeMotion ?? 'vivid';
  const scale = MOTION_SCALE[themeMotion];
  const ribbonDirection = motion.direction === 1 ? 'alternate' : 'alternate-reverse';
  const effectDuration = (base: number) => `${(base / (motion.speed * scale)).toFixed(2)}s`;
  const accent = appearance.accent || theme.accent;
  const accentRgb = hexToRgb(accent);
  const bgRgb = hexToRgb(theme.bg);
  const panelRgb = hexToRgb(theme.panel);
  const panel2Rgb = hexToRgb(theme.panel2);
  const panel3Rgb = hexToRgb(theme.panel3);
  const textRgb = hexToRgb(theme.text);

  root.dataset.theme = theme.id;
  root.dataset.platform = IS_MAC ? 'mac' : 'windows';
  root.dataset.density = appearance.density;
  root.dataset.animations = appearance.animations ? 'on' : 'off';
  root.dataset.blur = appearance.blur ? 'on' : 'off';
  root.dataset.motion = themeMotion;
  root.dataset.effect = motion.effect;

  const properties: Record<string, string> = {
    '--accent': accent,
    '--accent-rgb': accentRgb,
    '--accent-2': lightenHex(accent),
    '--bg': theme.bg,
    '--bg-soft': theme.bg,
    '--bg-rgb': bgRgb,
    '--panel': theme.panel,
    '--panel-2': theme.panel2,
    '--panel-3': theme.panel3,
    '--panel-rgb': panelRgb,
    '--panel-2-rgb': panel2Rgb,
    '--panel-3-rgb': panel3Rgb,
    '--text': theme.text,
    '--text-soft': theme.textSoft,
    '--text-rgb': textRgb,
    '--muted': theme.muted,
    '--border': theme.border,
    '--border-strong': theme.borderStrong,
    '--fill-1': `rgba(${textRgb}, .045)`,
    '--fill-2': `rgba(${textRgb}, .075)`,
    '--fill-3': `rgba(${textRgb}, .12)`,
    '--input-bg': `rgba(${bgRgb}, .78)`,
    '--shadow': `0 18px 50px rgba(0,0,0,.45), 0 8px 30px rgba(${accentRgb}, .07)`,
    '--orb-1': theme.orb1,
    '--orb-2': theme.orb2,
    '--orb-3': theme.orb3,
    '--ribbon-1': motion.ribbon1,
    '--ribbon-2': motion.ribbon2,
    '--grid-color': motion.grid,
    '--theme-speed': String(motion.speed),
    '--theme-direction': String(motion.direction),
    '--ribbon-direction': ribbonDirection,
    '--motion-scale': String(scale),
    '--wall-motion-scale': String(scale),
    '--orb-speed-a': effectDuration(16),
    '--orb-speed-b': effectDuration(19),
    '--orb-speed-c': effectDuration(22),
    '--ribbon-speed-a': effectDuration(13),
    '--ribbon-speed-b': effectDuration(17),
    '--grid-speed': effectDuration(32),
    '--effect-color': motion.effectColor,
    '--effect-color-2': motion.effectColor2,
    '--effect-speed': effectDuration(12),
    '--effect-speed-fast': effectDuration(7.5),
  };
  for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value);
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

/** CSS variables shared by the home hero, the settings crop editor and the draft overlay. */
export function customBackgroundVars(appearance?: Appearance, prefix = '--custom-bg'): Record<string, string> {
  const point = appearance?.backgroundPosition;
  const x = clamp(point?.x, 0, 100, 50);
  const y = clamp(point?.y, 0, 100, 50);
  const fit = appearance?.backgroundFit ?? 'cover';
  const size = fit === 'stretch' ? '100% 100%' : fit;
  const zoom = clamp(appearance?.backgroundZoom, 1, 3, 1);
  return {
    [`${prefix}-position`]: `${x}% ${y}%`,
    [`${prefix}-size`]: size,
    [`${prefix}-zoom`]: String(zoom),
  };
}

export function customBackgroundImage(image?: string): string {
  return `url("${(image ?? '').replace(/"/g, '\\"')}")`;
}

/** The Settings page previews a custom image before it is saved. */
export function applyDraftBackground(root: HTMLElement, appearance: Appearance | undefined) {
  const image = appearance?.backgroundImage;
  if (appearance?.background === 'custom' && image) {
    root.style.setProperty('--draft-background', customBackgroundImage(image));
    for (const [name, value] of Object.entries(customBackgroundVars(appearance, '--draft-bg'))) {
      root.style.setProperty(name, value);
    }
    root.dataset.draftBackground = 'on';
  } else {
    clearDraftBackground(root);
  }
}

export function clearDraftBackground(root: HTMLElement) {
  root.style.removeProperty('--draft-background');
  root.style.removeProperty('--draft-bg-position');
  root.style.removeProperty('--draft-bg-size');
  root.style.removeProperty('--draft-bg-zoom');
  delete root.dataset.draftBackground;
}
