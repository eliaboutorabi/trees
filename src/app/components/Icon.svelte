<script lang="ts">
  /**
   * `HugeiconsIcon`, but one whose `icon` prop actually takes effect.
   *
   * The upstream Svelte component builds its paths once, in `onMount`, from the
   * `icon` it was mounted with — and the `$effect` that keeps it in sync forwards
   * only size, stroke, colour and class. `icon` is not among them, so swapping it
   * changes nothing at all. Nothing errors and nothing warns; the old glyph just
   * stays. That is what made the sidebar toggle look like a direction bug: the
   * arrow was drawn once as a right chevron and then held it in both states, so
   * the code read correctly and the UI still pointed the wrong way. The tick on
   * the copy-link button never appeared either, for the same reason.
   *
   * Keying the block on `icon` remounts the component when — and only when — the
   * icon changes, which is free for the static ones and a handful of SVG nodes
   * for the rest.
   */
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import type { IconSvgElement } from '@hugeicons/svelte';

  interface Props {
    icon: IconSvgElement;
    size?: number;
    strokeWidth?: number;
  }

  let { icon, ...rest }: Props = $props();
</script>

{#key icon}
  <HugeiconsIcon {icon} {...rest} />
{/key}
