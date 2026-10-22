<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * You, on a map of the scene seen from above: a small camera on the rim of a
   * dial, looking in at the tree, with the wedge of what it sees spreading out
   * in front of it — the "you are here" of a game's minimap. It says which way
   * the picture is taken from without needing a word.
   */
  interface Props {
    /** The camera's position, in the dial's units. */
    x: number;
    y: number;
    /** How far the view reaches in towards the middle. */
    reach: number;
    /** Half the field of view, in degrees. */
    spread?: number;
    id: string;
  }

  let { x, y, reach, spread = 21, id }: Props = $props();
  const half = $derived(Math.tan((spread * Math.PI) / 180) * reach);
</script>

<defs>
  <linearGradient id="{id}-view" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#fffaf0" stop-opacity="0.7" />
    <stop offset="1" stop-color="#fffaf0" stop-opacity="0" />
  </linearGradient>
</defs>

<!-- what the camera sees -->
<path d="M{x} {y - 8}L{x - half} {y - 8 - reach}L{x + half} {y - 8 - reach}Z" fill="url(#{id}-view)" />
<path
  d="M{x - 3.8} {y - 11}L{x - half * 0.62} {y - 8 - reach * 0.62}M{x + 3.8} {y - 11}L{x + half * 0.62} {y - 8 - reach * 0.62}"
  stroke="#fffaf0"
  stroke-opacity="0.75"
  stroke-width="1.2"
  stroke-linecap="round"
  stroke-dasharray="0.5 3.2"
/>

<!-- the camera, from above: a body with its lens towards the tree -->
<g class="camera">
  <rect x={x - 5.6} y={y - 11.4} width="11.2" height="6.8" rx="2" />
  <rect x={x - 12} y={y - 5.6} width="24" height="14" rx="4.2" />
  <circle cx={x + 7} cy={y - 1.6} r="1.7" class="light" />
</g>

<style>
  .camera {
    fill: #33291f;
    stroke: #fffaf0;
    stroke-width: 1.4;
    stroke-linejoin: round;
    filter: drop-shadow(0 1.5px 2.5px rgba(20, 14, 6, 0.35));
  }

  .light {
    fill: #f4c34e;
    stroke: none;
  }
</style>
