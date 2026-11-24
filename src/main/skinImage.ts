import { PNG } from 'pngjs';
import { runBackground } from './background';
import type { SkinModel } from '../shared/types';

export type TextureKind = 'skin' | 'cape';

export interface NormalizedTexture {
  buffer: Buffer;
  model: SkinModel;
}

function isSizeValid(png: PNG, kind: TextureKind): boolean {
  if (kind === 'cape') {
    return (png.width === 64 && png.height === 32)
      || (png.width === 128 && png.height === 64);
  }
  return (png.width === 64 && (png.height === 32 || png.height === 64))
    || (png.width === 128 && (png.height === 64 || png.height === 128));
}

/** Re-encodes a PNG to strip metadata and rejects unsupported texture sizes. */
export function normalizePngLocal(buffer: Buffer, kind: TextureKind = 'skin'): Buffer | null {
  try {
    const png = PNG.sync.read(buffer);
    if (!isSizeValid(png, kind)) return null;
    return PNG.sync.write(png);
  } catch {
    return null;
  }
}

/** Detects slim/Alex arms from the transparent arm pixel, including HD skins. */
export function inferSkinModelLocal(buffer: Buffer): SkinModel {
  try {
    const png = PNG.sync.read(buffer);
    const scaleX = png.width / 64;
    const scaleY = png.height / 64;
    if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY) || png.height < 64) return 'steve';
    const x = Math.min(png.width - 1, Math.floor(54 * scaleX));
    const y = Math.min(png.height - 1, Math.floor(20 * scaleY));
    const alpha = png.data[(y * png.width + x) * 4 + 3];
    return alpha < 128 ? 'alex' : 'steve';
  } catch {
    return 'steve';
  }
}

/**
 * PNG decoding and re-encoding runs in a worker thread so importing a skin
 * never stalls window painting or launch progress events.
 */
export async function normalizeTexture(buffer: Buffer, kind: TextureKind = 'skin'): Promise<NormalizedTexture> {
  const result = await runBackground<{ sanitized: Buffer; model: SkinModel }>(
    { type: 'png', buffer, kind },
    () => {
      const sanitized = normalizePngLocal(buffer, kind);
      return { sanitized: sanitized ?? Buffer.alloc(0), model: inferSkinModelLocal(buffer) };
    },
  );
  if (!result.sanitized?.length) {
    throw new Error(kind === 'cape'
      ? 'Cape PNG must be 64x32 or 128x64'
      : 'Skin PNG must be 64x32, 64x64, 128x64 or 128x128');
  }
  return { buffer: result.sanitized, model: result.model };
}

export function decodeDataUrl(value?: string): Buffer | null {
  const prefix = 'data:image/png;base64,';
  if (!value?.startsWith(prefix)) return null;
  return Buffer.from(value.slice(prefix.length), 'base64');
}
