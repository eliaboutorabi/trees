<script lang="ts">
  /** A leaf or a fruit, drawn small for a picker tile, in the species' own colours. */
  interface Props {
    kind: 'broad' | 'lance' | 'needle' | 'blossom' | 'berry' | 'apple' | 'cone';
    color: string;
    accent?: string;
  }

  let { kind, color, accent = '#f6d9e8' }: Props = $props();
</script>

<svg viewBox="0 0 48 48" aria-hidden="true">
  {#if kind === 'broad'}
    <path d="M24 6 C35 12 38 26 24 42 C10 26 13 12 24 6 Z" fill={color} />
    <path d="M24 9 L24 41 M24 18 L31 14 M24 25 L32 21 M24 32 L30 29 M24 18 L17 14 M24 25 L16 21 M24 32 L18 29" stroke="rgba(0,0,0,0.25)" stroke-width="1" fill="none" />
  {:else if kind === 'lance'}
    <g transform="rotate(-24 24 24)">
      <path d="M24 3 C29 14 29 30 24 45 C19 30 19 14 24 3 Z" fill={color} />
      <path d="M24 6 L24 43" stroke="rgba(0,0,0,0.25)" stroke-width="1" />
    </g>
  {:else if kind === 'needle'}
    <g stroke={color} stroke-width="2" stroke-linecap="round">
      {#each [-60, -40, -20, 0, 20, 40, 60] as a (a)}
        <line x1="24" y1="40" x2={24 + Math.sin((a * Math.PI) / 180) * 26} y2={40 - Math.cos((a * Math.PI) / 180) * 26} />
      {/each}
    </g>
    <circle cx="24" cy="40" r="2.5" fill="#6b4a2c" />
  {:else if kind === 'blossom'}
    {#each [0, 72, 144, 216, 288] as a (a)}
      <ellipse cx="24" cy="13" rx="7" ry="10" fill={accent} transform="rotate({a} 24 24)" />
    {/each}
    <circle cx="24" cy="24" r="4.5" fill="#f2c455" />
  {:else if kind === 'berry'}
    <path d="M24 8 C26 14 28 16 32 18" stroke="#5b4a2a" stroke-width="1.5" fill="none" />
    <circle cx="20" cy="30" r="8" fill={color} />
    <circle cx="31" cy="27" r="7" fill={color} />
    <circle cx="25" cy="21" r="6" fill={color} />
    <circle cx="18" cy="27" r="2" fill="rgba(255,255,255,0.45)" />
  {:else if kind === 'apple'}
    <path d="M24 13 C30 8 41 11 40 25 C39 38 31 42 24 39 C17 42 9 38 8 25 C7 11 18 8 24 13 Z" fill={color} />
    <path d="M24 13 C24 9 25 6 27 4" stroke="#5b4a2a" stroke-width="2" fill="none" stroke-linecap="round" />
    <path d="M26 8 C31 4 35 6 36 8 C32 10 29 10 26 8 Z" fill="#6e8f2c" />
    <ellipse cx="15" cy="22" rx="3" ry="5" fill="rgba(255,255,255,0.3)" />
  {:else}
    <path d="M24 5 C33 12 35 26 30 38 C27 44 21 44 18 38 C13 26 15 12 24 5 Z" fill={color} />
    {#each [12, 18, 24, 30, 36] as y (y)}
      <path d="M{17 + Math.abs(y - 24) * 0.2} {y} Q24 {y + 4} {31 - Math.abs(y - 24) * 0.2} {y}" stroke="rgba(0,0,0,0.3)" stroke-width="1.2" fill="none" />
    {/each}
  {/if}
</svg>

<style>
  svg {
    display: block;
    width: 72%;
    height: 72%;
  }
</style>
