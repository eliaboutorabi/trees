<script lang="ts">
  /**
   * The exact controls, kept out of the card. Inside the dock, this hands its
   * contents to the dock, which opens them in a panel beside the card when the
   * card's Fine-tune button is pressed — so a card never grows, never scrolls,
   * and the pictures stay the first thing you see. Anywhere else, it simply
   * shows its contents.
   */
  import { getContext, onMount, type Snippet } from 'svelte';
  import { MORE, type MoreHost } from './more';

  interface Props {
    label?: string;
    children: Snippet;
  }

  let { label = 'Fine-tune', children }: Props = $props();
  const host = getContext<MoreHost | undefined>(MORE);
  onMount(() => host?.offer(label, children));
</script>

{#if !host}
  {@render children()}
{/if}
