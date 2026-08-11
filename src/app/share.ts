/**
 * Encoding the whole studio state into a link.
 *
 * The naive version — serialise every parameter — produces a URL dominated by
 * the grammar, which is a few hundred characters of production rules that the
 * recipient almost always has already, because it came from a preset. So what
 * goes in the link is the preset id plus only the fields that differ from that
 * preset's defaults. Sharing an untouched Oak is a dozen characters; sharing an
 * Oak with a different seed and more wind is a few dozen; only someone who has
 * actually rewritten the productions pays for carrying them.
 *
 * Deliberately not compressed. `CompressionStream` would shrink an edited
 * grammar considerably, but it is asynchronous, and making the *decode* path
 * async means the app cannot build its first tree until a promise settles.
 * A long URL in the rare case is a better trade than a slower start in every
 * case.
 */
import { paramsFromPreset, type AppParams } from './params.svelte';

/** Fields that are runtime state rather than a description of the tree. */
const EXCLUDED = new Set<keyof AppParams>(['quality', 'autoGrow', 'growthSpeed']);

function toBase64Url(text: string): string {
  // btoa only accepts Latin-1, and a grammar may contain non-ASCII, so the
  // string is encoded to UTF-8 bytes first and those bytes are what get based.
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The parameters that differ from the named preset's defaults. */
export function diffFromPreset(params: AppParams): Record<string, unknown> {
  const base = paramsFromPreset(params.presetId);
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(params) as (keyof AppParams)[]) {
    if (EXCLUDED.has(key) || key === 'presetId') continue;
    if (params[key] !== base[key]) diff[key] = params[key];
  }
  return diff;
}

export function encodeShareState(params: AppParams): string {
  const diff = diffFromPreset(params);
  const payload = Object.keys(diff).length ? { p: params.presetId, d: diff } : { p: params.presetId };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Rebuild a full parameter set from a share token, or `null` if the token is
 * unusable. Unknown keys are dropped rather than trusted: a link is untrusted
 * input, and a stale one from an older build must not be able to inject fields.
 */
export function decodeShareState(token: string): AppParams | null {
  try {
    const parsed = JSON.parse(fromBase64Url(token)) as { p?: unknown; d?: unknown };
    if (typeof parsed.p !== 'string') return null;

    const base = paramsFromPreset(parsed.p);
    // An unrecognised preset id falls back to the default, which would silently
    // show the wrong tree — better to treat the whole link as unusable.
    if (base.presetId !== parsed.p) return null;

    if (parsed.d && typeof parsed.d === 'object') {
      const diff = parsed.d as Record<string, unknown>;
      for (const key of Object.keys(base) as (keyof AppParams)[]) {
        if (EXCLUDED.has(key) || key === 'presetId') continue;
        const value = diff[key];
        if (value === undefined) continue;
        if (typeof value !== typeof base[key]) continue;
        (base as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return base;
  } catch {
    return null;
  }
}

export function shareUrl(params: AppParams): string {
  const url = new URL(window.location.href);
  url.hash = encodeShareState(params);
  return url.toString();
}

/** Reads and clears the incoming share token, so a reload does not re-apply it. */
export function takeIncomingState(): AppParams | null {
  const token = window.location.hash.replace(/^#/, '');
  if (!token) return null;
  const state = decodeShareState(token);
  if (state) history.replaceState(null, '', window.location.pathname + window.location.search);
  return state;
}
