<script lang="ts">
  /** An on/off switch drawn as a picture: a round icon button with its name under it. */
  import type { IconSvgElement } from '@hugeicons/svelte';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    icon: IconSvgElement;
    checked: boolean;
    hint?: string;
  }

  let { label, icon, checked = $bindable(), hint }: Props = $props();
</script>

<button class="toggle" class:on={checked} title={hint ?? label} aria-pressed={checked} onclick={() => (checked = !checked)}>
  <span class="disc"><Icon {icon} size={18} strokeWidth={1.7} /></span>
  <span class="name">{label}</span>
</button>

<style>
  .toggle {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--ink-faint);
    cursor: pointer;
  }

  .disc {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    transition:
      background 0.18s,
      color 0.18s,
      transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.5);
  }

  .toggle:hover .disc {
    transform: scale(1.07);
    color: var(--ink);
  }

  .toggle.on {
    color: var(--ink);
  }

  .toggle.on .disc {
    background: var(--accent);
    border-color: var(--accent);
    color: #21160c;
  }

  .name {
    font-size: 0.62rem;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
</style>
