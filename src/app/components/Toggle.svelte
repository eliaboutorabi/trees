<script lang="ts">
  /** An on/off switch drawn as a picture: a round icon button with its name under it. */
  import Glyph from './Glyph.svelte';
  import type { GlyphName } from './glyphs';

  interface Props {
    label: string;
    icon: GlyphName;
    checked: boolean;
    hint?: string;
  }

  let { label, icon, checked = $bindable(), hint }: Props = $props();
</script>

<button class="toggle" class:on={checked} title={hint ?? label} aria-pressed={checked} onclick={() => (checked = !checked)}>
  <span class="disc illustrated"><Glyph name={icon} size={26} weight={1.5} /></span>
  <span class="name">{label}</span>
</button>

<style>
  .toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.32rem;
    background: none;
    border: none;
    color: var(--ink-dim);
    cursor: pointer;
  }

  /* A frosted pebble that fills with the card's colour when it is on. */
  .disc {
    width: 2.5rem;
    height: 2.4rem;
    border-radius: 52% 48% 55% 45% / 47% 55% 45% 53%;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.34);
    background: rgba(255, 255, 255, 0.22);
    color: var(--ink-dim);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 3px 8px rgba(28, 20, 10, 0.08);
    transition:
      background 0.25s,
      color 0.2s,
      transform 0.32s cubic-bezier(0.25, 0.8, 0.3, 1.3);
  }

  .toggle:nth-child(even) .disc {
    border-radius: 46% 54% 49% 51% / 55% 46% 54% 45%;
  }

  .toggle:hover .disc {
    transform: translateY(-1px) rotate(-5deg);
    color: var(--ink);
  }

  .toggle.on {
    color: var(--ink);
  }

  .toggle.on .disc {
    background: color-mix(in srgb, var(--tone) 62%, rgba(255, 255, 255, 0.12));
    color: color-mix(in srgb, var(--tone-ink) 85%, #000 15%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 0 0 1.5px color-mix(in srgb, var(--tone-ink) 45%, transparent),
      0 4px 10px rgba(28, 20, 10, 0.12);
  }

  .name {
    font-size: 0.66rem;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
