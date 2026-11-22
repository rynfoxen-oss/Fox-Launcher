/** Turns semver prerelease tags into readable labels, e.g. 1.2.2-alpha.2 → 1.2.2 Alpha 2. */
export function displayVersion(value?: string): string {
  if (!value) return '';
  const [core, ...tags] = value.trim().replace(/^v/i, '').split(/[-+]/);
  if (!core) return value;
  if (tags.length === 0) return core;

  const label = tags
    .join(' ')
    .replace(/\balpha\b/gi, 'Alpha')
    .replace(/\bbeta\b/gi, 'Beta')
    .replace(/\brc\b/gi, 'RC')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${core} ${label}`;
}
