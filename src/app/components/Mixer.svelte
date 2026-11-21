<script lang="ts" module>
  import type { GlyphName } from './glyphs';

  export type Layer = 'air' | 'weather' | 'life' | 'tree' | 'music' | 'ui';

  /** The layers as you would name them, each in its own colour and drawn as itself. */
  export const LAYERS: { id: Layer; label: string; icon: GlyphName; tone: string; ink: string }[] = [
    { id: 'air', label: 'Air & wind', icon: 'wind', tone: '#a9c4d8', ink: '#33566e' },
    { id: 'weather', label: 'Rain & snow', icon: 'weather-rain', tone: '#9fcbc3', ink: '#2b625b' },
    { id: 'life', label: 'Creatures', icon: 'wildlife', tone: '#e6bf94', ink: '#74461f' },
    { id: 'tree', label: 'The tree', icon: 'sprout', tone: '#a4bb8c', ink: '#44592f' },
    { id: 'music', label: 'Music', icon: 'music', tone: '#bba8d0', ink: '#544472' },
    { id: 'ui', label: 'Clicks', icon: 'clicks', tone: '#d6c9b1', ink: '#64553b' },
  ];

  /** Where a layer's slider rests: its place in the mix as set, with room either side. */
  export const MIX_REST = 0.7;
  /** A slider's position as a gain: silent at nothing, as set at rest, twice as loud at the top. */
  export const gainOf = (v: number) => (v / MIX_REST) ** 2;
</script>

<script lang="ts">
  /**
   * The garden's sound, opened from the speaker: on or off, how loud in all,
   * and how loud each part of it — the air, the weather, the creatures, the
   * tree, the music, the interface's own clicks. Beside each, a small meter
   * shows what that part is doing this moment, so you can hear a slider and
   * see what it is you are hearing.
   */
  import { sonic } from '../sonic';
  import Ask from './Ask.svelte';
  import Glyph from './Glyph.svelte';

  interface Props {
    on: boolean;
    /** Open the tour at the sound. */
    onhelp?: () => void;
    ontoggle: () => void;
    volume: number;
    mix: Record<Layer, number>;
    /** Shown, so the meters should run. */
    open: boolean;
    /** How much each layer is sounding now, 0–1, or null while there is no sound; `false` when no longer watching. */
    levels: (watch: boolean) => Record<Layer, number> | null;
  }

  let { on, onhelp, ontoggle, volume = $bindable(), mix = $bindable(), open, levels }: Props = $props();

  let heard = $state<Record<Layer, number>>({ air: 0, weather: 0, life: 0, tree: 0, music: 0, ui: 0 });

  $effect(() => {
    if (!open) return;
    sonic.open(11);
    let frame = 0;
    let last = 0;
    const step = (t: number) => {
      frame = requestAnimationFrame(step);
      // Twenty times a second is plenty for a meter, and spares the frame.
      if (t - last < 50) return;
      last = t;
      const now = levels(true);
      if (now) heard = now;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      levels(false);
      sonic.close();
      heard = { air: 0, weather: 0, life: 0, tree: 0, music: 0, ui: 0 };
    };
  });

  const BARS = [0.12, 0.3, 0.5, 0.7, 0.88];
</script>

<div class="mixer" class:off={!on}>
  <header>
    <span class="title illustrated"><Glyph name={on ? 'sound' : 'sound-off'} size={22} weight={1.6} /> The garden’s sound</span>
    <span class="end">
      {#if onhelp}<Ask about="Sound" onclick={onhelp} size="small" />{/if}
      <button class="switch" class:on role="switch" aria-checked={on} aria-label="Sound" onclick={ontoggle}>
        <span class="knob"></span>
        <span class="word">{on ? 'On' : 'Off'}</span>
      </button>
    </span>
  </header>

  <label class="row all" style="--tone: #e3c98a; --ink: #6b4f12; --fill: {volume * 100}%">
    <span class="icon illustrated"><Glyph name="sound-off" size={22} weight={1.5} /></span>
    <input type="range" min="0" max="1" step="0.01" bind:value={volume} aria-label="Everything" />
    <span class="icon illustrated"><Glyph name="sound" size={22} weight={1.5} /></span>
  </label>

  <div class="layers">
    {#each LAYERS as l (l.id)}
      <label class="row" style="--tone: {l.tone}; --ink: {l.ink}; --fill: {mix[l.id] * 100}%">
        <span class="icon illustrated"><Glyph name={l.icon} size={21} weight={1.5} /></span>
        <span class="name">{l.label}</span>
        <input type="range" min="0" max="1" step="0.01" bind:value={mix[l.id]} aria-label={l.label} />
        <span class="meter" aria-hidden="true">
          {#each BARS as b, i (i)}
            <i class:lit={heard[l.id] * (mix[l.id] > 0.01 ? 1 : 0) > b} style="height: {30 + i * 17}%"></i>
          {/each}
        </span>
      </label>
    {/each}
  </div>

  <p class="note">Turn the camera and listen: the pond, the meadow and the woods stay where they are.</p>
</div>

<style>
  .mixer {
    width: 18.6rem;
    padding: 0.75rem 0.85rem 0.7rem;
    border-radius: 18px 15px 19px 14px;
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 14px 34px rgba(28, 20, 10, 0.24);
    color: var(--ink);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.55rem;
  }

  .end {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--serif);
    font-size: 1.02rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100, 'opsz' 18;
    white-space: nowrap;
    --glyph-wash: #e3c98a;
  }

  /* A small seed of a switch, rolling from one end of its groove to the other. */
  .switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 3.6rem;
    height: 1.6rem;
    padding: 0;
    border: none;
    border-radius: 999px 900px 999px 950px;
    background: rgba(60, 44, 28, 0.14);
    box-shadow: inset 0 1px 2px rgba(20, 14, 6, 0.18);
    cursor: pointer;
    transition: background-color 0.3s;
  }
  .switch.on {
    background: color-mix(in srgb, #e3c98a 85%, white 15%);
  }
  .knob {
    position: absolute;
    left: 0.18rem;
    width: 1.24rem;
    height: 1.24rem;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    background: radial-gradient(circle at 35% 30%, #fffaf0, #e9dfcc 75%);
    box-shadow: 0 1px 4px rgba(20, 14, 6, 0.3);
    transition: transform 0.35s cubic-bezier(0.3, 1.5, 0.5, 1);
  }
  .switch.on .knob {
    transform: translateX(2rem) rotate(-30deg);
    background: radial-gradient(circle at 35% 30%, #fff6dd, #c99a3a 80%);
  }
  .word {
    width: 100%;
    padding: 0 0.55rem 0 1.65rem;
    font-family: var(--serif);
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink-dim);
    text-align: left;
    transition: padding 0.3s;
  }
  .switch.on .word {
    padding: 0 1.65rem 0 0.6rem;
    color: #6b4f12;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.18rem 0;
    cursor: pointer;
  }

  .row.all {
    padding: 0.2rem 0 0.45rem;
    margin-bottom: 0.35rem;
    border-bottom: 1px solid rgba(60, 44, 28, 0.1);
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.6rem;
    color: var(--ink-dim);
    --glyph-wash: var(--tone);
    --glyph-wash-opacity: 0.6;
  }

  .name {
    flex: none;
    width: 5.6rem;
    font-family: var(--serif);
    font-size: 0.84rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink-dim);
    white-space: nowrap;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--tone) 75%, var(--ink) 25%) 0%,
      var(--tone) var(--fill),
      rgba(60, 44, 28, 0.13) var(--fill),
      rgba(60, 44, 28, 0.13) 100%
    );
    outline: none;
    cursor: pointer;
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--ink) 55%, white 45%), var(--ink) 75%);
    border: 2px solid rgba(255, 252, 246, 0.95);
    box-shadow: 0 1px 4px rgba(20, 14, 6, 0.28);
    transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }
  .row:hover input[type='range']::-webkit-slider-thumb,
  input[type='range']:focus-visible::-webkit-slider-thumb {
    transform: scale(1.2) rotate(-12deg);
  }
  input[type='range']::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--ink);
    border: 2px solid rgba(255, 255, 255, 0.8);
  }

  /* Five small stems that light up with what the layer is doing now. */
  .meter {
    flex: none;
    display: flex;
    align-items: flex-end;
    gap: 2px;
    width: 1.4rem;
    height: 0.95rem;
  }
  .meter i {
    flex: 1;
    border-radius: 2px 2px 1px 1px;
    background: rgba(60, 44, 28, 0.12);
    transition: background-color 0.12s;
  }
  .meter i.lit {
    background: color-mix(in srgb, var(--tone) 70%, var(--ink) 30%);
  }

  .note {
    margin: 0.55rem 0 0;
    font-family: var(--serif);
    font-style: italic;
    font-size: 0.76rem;
    line-height: 1.35;
    color: var(--ink-dim);
  }

  /* Off: everything can still be set, quietly, for when it comes back on. */
  .off .layers,
  .off .row.all {
    opacity: 0.55;
  }
</style>
