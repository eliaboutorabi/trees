<script lang="ts">
  /**
   * The little "?" that opens the tour at one part of the app: a warm seed of
   * a button, slightly lopsided like everything else here, that wobbles when
   * the pointer finds it.
   */
  interface Props {
    /** What it explains, for screen readers. */
    about: string;
    onclick: () => void;
    size?: 'small' | 'normal';
  }

  let { about, onclick, size = 'normal' }: Props = $props();
</script>

<button class="ask" class:small={size === 'small'} {onclick} aria-label="Show me around: {about}" title="Show me around">?</button>

<style>
  .ask {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    border: none;
    border-radius: 47% 53% 50% 50% / 52% 48% 52% 48%;
    font-family: var(--serif);
    font-size: 0.84rem;
    font-weight: 700;
    line-height: 1;
    color: #fffaf0;
    background: radial-gradient(120% 120% at 30% 25%, #e7b45c, #c98a2c);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 2px 6px rgba(120, 70, 10, 0.3);
    cursor: pointer;
    transition: transform 0.25s cubic-bezier(0.3, 1.8, 0.5, 1);
  }

  .ask.small {
    width: 1.25rem;
    height: 1.25rem;
    font-size: 0.76rem;
  }

  .ask:hover {
    transform: rotate(-12deg) scale(1.14);
  }

  .ask:focus-visible {
    outline: 2px solid #c98a2c;
    outline-offset: 2px;
  }
</style>
