<script lang="ts">
  /**
   * A little painted tree for a picker tile.
   *
   * Drawn, not rendered: nine real renders would mean nine rebuilds and an
   * offscreen pass for a 56px picture, and a silhouette reads better at that
   * size than a photograph of a tree does anyway. But the colours come from the
   * species' own palette — its leaves, bark, blossom and fruit — so the picture
   * always matches what picking it gives you. Given a season, it draws that
   * species in that season: turned in autumn, bare and snowed on in winter,
   * flowering in spring.
   */
  import type { Preset } from '../../engine';
  import type { Season } from '../../render/season';

  interface Props {
    preset: Preset;
    season?: Season;
  }

  let { preset, season = 'summer' }: Props = $props();

  const hex = (n: number | undefined, fallback: number) => `#${(n ?? fallback).toString(16).padStart(6, '0')}`;

  const pal = $derived(preset.palette);
  const shape = $derived(preset.id);
  const bare = $derived(season === 'winter');
  // The crown's two tones, by season.
  const crownLow = $derived(
    season === 'autumn'
      ? hex(pal.leafAutumn, 0xc06a1e)
      : season === 'spring'
        ? hex(pal.leafTip, 0x86a83c)
        : hex(pal.leafBase, 0x2f5320),
  );
  const crownHigh = $derived(season === 'autumn' ? '#e8a23c' : hex(pal.leafTip, 0x86a83c));
  const bark = $derived(hex(pal.barkDark, 0x2b2018));
  const barkLight = $derived(hex(pal.barkLight, 0x8a755c));
  const dots = $derived(
    season === 'spring'
      ? hex(pal.flowerColor ?? pal.blossom, 0xffd7e4)
      : season === 'summer' || season === 'autumn'
        ? pal.fruitColor !== undefined && preset.params.fruitDensity
          ? hex(pal.fruitColor, 0xb8231f)
          : null
        : null,
  );
  const blossomy = $derived(shape === 'sakura' && season !== 'winter' && season !== 'autumn');
  const uid = $derived(`g-${shape}-${season}`);

  /** A deterministic scatter of points inside a circle, for fruit and flowers. */
  function scatter(cx: number, cy: number, r: number, n: number, seed: number) {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i * 2.399963 + seed) % (Math.PI * 2);
      const d = Math.sqrt((i + 0.5) / n) * r;
      out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8]);
    }
    return out;
  }
</script>

<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="{uid}-crown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color={crownHigh} />
      <stop offset="1" stop-color={crownLow} />
    </linearGradient>
  </defs>

  <!-- ground -->
  <ellipse cx="32" cy="57" rx="22" ry="3.2" fill={bare ? '#e9eef4' : 'rgba(0,0,0,0.28)'} />

  {#if shape === 'bush'}
    {#if bare}
      <path d="M32 56 L26 40 M32 56 L32 37 M32 56 L39 41 M28 46 L22 41 M36 47 L43 43" stroke={bark} stroke-width="1.6" stroke-linecap="round" fill="none" />
    {:else}
      <g fill="url(#{uid}-crown)">
        <circle cx="24" cy="47" r="10" /><circle cx="40" cy="47" r="10" /><circle cx="32" cy="41" r="12" />
      </g>
    {/if}
  {:else}
    <!-- trunk -->
    {#if shape === 'baobab'}
      <path d="M24 57 C23 44 25 33 28 27 L36 27 C39 33 41 44 40 57 Z" fill={barkLight} />
    {:else if shape === 'birch'}
      <path d="M30.5 57 L31 22 L33 22 L33.5 57 Z" fill="#e8e4dc" />
      <path d="M30.8 30 h2 M30.9 38 h2.2 M31 46 h2 M31 52 h2.2" stroke="#2a2420" stroke-width="1" />
    {:else}
      <path d="M29.5 57 C30 48 30.5 40 31 30 L33 30 C33.5 40 34 48 34.5 57 Z" fill={bark} />
    {/if}

    {#if bare}
      <!-- winter: the branches the crown was hiding, with snow along the tops -->
      <g stroke={shape === 'birch' ? '#cfc8bb' : bark} stroke-width="1.5" stroke-linecap="round" fill="none">
        {#if shape === 'pine'}
          <path d="M32 50 L18 52 M32 44 L20 45 M32 38 L22 38 M32 32 L24 31 M32 26 L27 24 M32 50 L46 52 M32 44 L44 45 M32 38 L42 38 M32 32 L40 31 M32 26 L37 24 M32 30 L32 9" />
        {:else if shape === 'willow'}
          <path d="M32 32 C26 24 19 22 15 26 M32 32 C38 24 45 22 49 26 M32 30 L32 18 M15 26 L14 44 M49 26 L50 44 M22 22 L20 40 M42 22 L44 40" />
        {:else if shape === 'baobab'}
          <path d="M28 27 L20 18 M30 27 L26 14 M34 27 L38 14 M36 27 L44 18 M32 27 L32 15" />
        {:else}
          <path d="M32 34 L20 22 M32 34 L44 21 M32 30 L32 12 M25 27 L19 30 M39 26 L46 28 M32 22 L26 14 M32 20 L38 13" />
        {/if}
      </g>
      <g fill="#f4f7fb">
        <ellipse cx="32" cy="12.5" rx="2.5" ry="1" /><ellipse cx="21" cy="21.5" rx="2.6" ry="0.9" /><ellipse cx="43" cy="20.5" rx="2.6" ry="0.9" />
      </g>
    {:else if shape === 'pine'}
      <g fill="url(#{uid}-crown)">
        <path d="M32 6 L41 22 L23 22 Z" /><path d="M32 13 L45 33 L19 33 Z" /><path d="M32 22 L48 46 L16 46 Z" />
      </g>
      {#if dots}
        {#each [[24, 42], [40, 41], [28, 30], [37, 29], [31, 44]] as [x, y]}<ellipse cx={x} cy={y} rx="1.3" ry="1.9" fill={dots} />{/each}
      {/if}
    {:else if shape === 'willow'}
      <path d="M12 30 C14 12 50 12 52 30 Z" fill="url(#{uid}-crown)" />
      <g stroke={crownLow} stroke-width="2.2" stroke-linecap="round" fill="none">
        <path d="M14 29 C13 37 14 43 15 48 M20 29 C19 38 20 44 21 50 M27 29 C26 38 27 45 27 51 M37 29 C38 38 37 45 37 51 M44 29 C45 38 44 44 43 50 M50 29 C51 37 50 43 49 48" />
      </g>
    {:else if shape === 'birch'}
      <ellipse cx="32" cy="22" rx="11" ry="16" fill="url(#{uid}-crown)" />
    {:else if shape === 'baobab'}
      <path d="M30 27 L20 19 M34 27 L44 19 M32 27 L32 17" stroke={barkLight} stroke-width="3" stroke-linecap="round" />
      <ellipse cx="32" cy="15" rx="20" ry="5.5" fill="url(#{uid}-crown)" />
    {:else}
      <!-- the broadleaf crowns: oak, sakura, apple, rowan -->
      <g fill={blossomy ? hex(pal.flowerColor ?? pal.blossom, 0xffd7e4) : `url(#${uid}-crown)`}>
        {#if shape === 'rowan'}
          <ellipse cx="32" cy="22" rx="13" ry="15" />
        {:else}
          <circle cx="22" cy="27" r="10" /><circle cx="42" cy="27" r="10" /><circle cx="32" cy="18" r="12" /><circle cx="32" cy="29" r="10" />
        {/if}
      </g>
      {#if dots}
        {#each scatter(32, 24, shape === 'rowan' ? 10 : 14, shape === 'rowan' ? 14 : 9, shape.length) as [x, y]}
          <circle cx={x} cy={y} r={shape === 'rowan' ? 1.2 : 1.7} fill={dots} />
        {/each}
      {/if}
    {/if}
  {/if}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
