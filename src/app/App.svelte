<script lang="ts">
  import { onMount } from 'svelte';
  import { HugeiconsIcon } from '@hugeicons/svelte';
  import {
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Camera01Icon,
    Download01Icon,
    FocusIcon,
    CherryIcon,
    CopyLinkIcon,
    Tick02Icon,
    FlowerIcon,
    Leaf01Icon,
    PlayIcon,
    Rotate01Icon,
    ShuffleIcon,
    SourceCodeIcon,
    SunIcon,
    Tree01Icon,
    UndoIcon,
  } from '@hugeicons/core-free-icons';
  import { getPreset, type GrammarIssue } from '../engine';
  import { TreeStudio, type StudioStats } from '../render/studio';
  import { applyPreset, params, presets } from './params.svelte';
  import { shareUrl, takeIncomingState } from './share';
  import Section from './components/Section.svelte';
  import Swatch from './components/Swatch.svelte';
  import Slider from './components/Slider.svelte';

  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let studio: TreeStudio | null = null;

  let ready = $state(false);
  let unsupported = $state(false);
  let fatal = $state<string | null>(null);
  let panelOpen = $state(true);

  let growth = $state(0);
  let scrubbing = false;
  let issues = $state<GrammarIssue[]>([]);
  let stats = $state<StudioStats>({
    modules: 0,
    nodes: 0,
    leaves: 0,
    branchTriangles: 0,
    vertices: 0,
    buildMs: 0,
    fps: 0,
    truncated: false,
    renderScale: 1,
    adaptive: true,
  });

  let axiomDraft = $state(params.axiom);
  let rulesDraft = $state(params.rules);
  const grammarDirty = $derived(axiomDraft !== params.axiom || rulesDraft !== params.rules);

  const activePreset = $derived(getPreset(params.presetId));

  let skyTimer: ReturnType<typeof setTimeout> | undefined;

  /** Only these force the grammar to be re-derived — everything else is live. */
  function structureSnapshot() {
    return {
      axiom: params.axiom,
      rules: params.rules,
      iterations: params.iterations,
      angle: params.angle,
      step: params.step,
      shrink: params.shrink,
      tropism: params.tropism,
      pipeExponent: params.pipeExponent,
      seed: params.seed,
      trunkRadius: params.trunkRadius,
      leafScale: params.leafScale,
      leafShape: params.leafShape,
    };
  }

  // What the mesh currently on screen was built from.
  let built = $state<ReturnType<typeof structureSnapshot> | null>(null);

  // `trunkRadius` and `leafScale` are passed to the build as a baseline but are
  // then rescaled live against it, so changing them is not a reason to redraw.
  const REDRAW_KEYS = [
    'axiom',
    'rules',
    'iterations',
    'angle',
    'step',
    'shrink',
    'tropism',
    'pipeExponent',
    'seed',
    'leafShape',
  ] as const;

  const pending = $derived.by(() => {
    const now = structureSnapshot();
    if (!built) return false;
    return REDRAW_KEYS.some((k) => now[k] !== built![k]);
  });

  function doRebuild(replay: boolean) {
    if (!studio) return;
    const snapshot = structureSnapshot();
    const build = studio.rebuild(snapshot);
    built = snapshot;
    issues = build.issues;
    if (replay) {
      studio.frameTree();
      studio.playGrowth(0, params.growthSpeed);
    }
  }

  function redraw() {
    doRebuild(params.autoGrow);
  }

  /** Put every control on this species back where it started. */
  function resetToDefaults() {
    choosePreset(params.presetId);
  }

  function choosePreset(id: string) {
    applyPreset(id);
    axiomDraft = params.axiom;
    rulesDraft = params.rules;
    if (!studio) return;
    studio.applyPalette(getPreset(id).palette);
    doRebuild(true);
  }

  function applyGrammar() {
    params.axiom = axiomDraft;
    params.rules = rulesDraft;
  }

  function shuffleSeed() {
    params.seed = Math.floor(Math.random() * 1_000_000);
    // An explicit action, so it draws straight away rather than going pending.
    doRebuild(params.autoGrow);
  }

  function replay() {
    studio?.playGrowth(0, params.growthSpeed);
  }

  function scrub(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    growth = value;
    studio?.setGrowth(value);
  }

  let linkCopied = $state(false);
  let linkTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl(params));
    } catch {
      // Clipboard access can be refused; the link is still in the address bar
      // for anyone who wants to copy it by hand.
      window.location.hash = shareUrl(params).split('#')[1] ?? '';
      return;
    }
    linkCopied = true;
    clearTimeout(linkTimer);
    linkTimer = setTimeout(() => (linkCopied = false), 1600);
  }

  async function screenshot() {
    if (!studio) return;
    const url = await studio.capture();
    const a = document.createElement('a');
    a.href = url;
    a.download = `arbor-${activePreset.id}-${params.seed}.png`;
    a.click();
  }

  onMount(() => {
    if (!('gpu' in navigator)) {
      unsupported = true;
      return;
    }

    // A shared link wins over the default preset, and is consumed on arrival so
    // that a reload does not undo whatever the visitor changed afterwards.
    const shared = takeIncomingState();
    if (shared) Object.assign(params, shared);

    const s = new TreeStudio(canvas!);
    studio = s;
    // Handy for poking at the scene from the console while developing.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).arbor = s;
    s.onStats = (v) => (stats = v);
    s.onGrowth = (v) => {
      if (!scrubbing) growth = v;
    };

    s.init()
      .then(() => {
        s.applyPalette(activePreset.palette);
        s.applySky({ sunElevation: params.sunElevation, sunAzimuth: params.sunAzimuth, haze: params.haze });
        ready = true;
        doRebuild(true);
      })
      .catch((err: unknown) => {
        fatal = err instanceof Error ? err.message : String(err);
      });

    const observer = new ResizeObserver(() => s.resize());
    if (stage) observer.observe(stage);

    // A link pasted into the address bar of an already-open tab changes the
    // hash without reloading, and going back after copying a link should
    // return you to what you were looking at.
    const onHashChange = () => {
      const next = takeIncomingState();
      if (!next) return;
      Object.assign(params, next);
      axiomDraft = params.axiom;
      rulesDraft = params.rules;
      s.applyPalette(getPreset(params.presetId).palette);
      doRebuild(true);
    };
    window.addEventListener('hashchange', onHashChange);

    return () => {
      window.removeEventListener('hashchange', onHashChange);
      observer.disconnect();
      clearTimeout(skyTimer);
      s.dispose();
      studio = null;
    };
  });

  // Look — uniform writes only, so these land immediately, every frame if need be.
  $effect(() => {
    const look = {
      wind: params.wind,
      windSpeed: params.windSpeed,
      windDirection: params.windDirection,
      autumn: params.autumn,
      translucency: params.translucency,
      barkDetail: params.barkDetail,
      moss: params.moss,
      trunkRadius: params.trunkRadius,
      leafScale: params.leafScale,
      leafDensity: params.leafDensity,
      flowerDensity: params.flowerDensity,
      flowerSize: params.flowerSize,
      flowerColor: params.flowerColor,
      flowerCore: params.flowerCore,
      fruitDensity: params.fruitDensity,
      fruitSize: params.fruitSize,
      fruitColor: params.fruitColor,
      fruitGloss: params.fruitGloss,
      exposure: params.exposure,
      bloom: params.bloom,
      depthOfField: params.depthOfField,
      grain: params.grain,
      antialias: params.antialias,
      autoRotate: params.autoRotate,
      quality: params.quality,
    };
    if (!ready) return;
    studio?.applyLook(look);
  });

  // Sky — re-bakes a 1024×512 texture, so throttle it.
  $effect(() => {
    const sky = {
      sunElevation: params.sunElevation,
      sunAzimuth: params.sunAzimuth,
      haze: params.haze,
    };
    if (!ready) return;
    clearTimeout(skyTimer);
    skyTimer = setTimeout(() => studio?.applySky(sky), 70);
  });
</script>

<svelte:window
  onkeydown={(e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      replay();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      redraw();
    }
  }}
/>

<div class="app">
  <div class="stage" bind:this={stage}>
    <canvas bind:this={canvas}></canvas>

    {#if unsupported}
      <div class="overlay">
        <div class="card">
          <h2>WebGPU not available</h2>
          <p>
            Arbor renders with the WebGPU backend of three.js. Open this in a recent Chrome, Edge or
            Safari build — or enable <code>chrome://flags/#enable-unsafe-webgpu</code>.
          </p>
        </div>
      </div>
    {:else if fatal}
      <div class="overlay">
        <div class="card">
          <h2>Renderer failed to start</h2>
          <p class="mono">{fatal}</p>
        </div>
      </div>
    {:else if !ready}
      <div class="overlay">
        <div class="card loading"><span class="pulse"></span> warming up the GPU…</div>
      </div>
    {/if}

    {#if ready}
      <div class="readout">
        <span><b>{stats.fps}</b> fps</span>
        <span><b>{stats.modules.toLocaleString()}</b> modules</span>
        <span><b>{stats.branchTriangles.toLocaleString()}</b> tris</span>
        <span><b>{stats.leaves.toLocaleString()}</b> leaves</span>
        <span><b>{stats.buildMs.toFixed(0)}</b> ms</span>
        <span><b>{stats.renderScale.toFixed(2)}</b>× {stats.adaptive ? 'auto' : 'fixed'}</span>
        {#if stats.truncated}<span class="warn">capped</span>{/if}
      </div>

      <div class="transport">
        <button
          class="redraw"
          class:pending
          onclick={redraw}
          title={pending ? 'Apply pending grammar changes (R)' : 'Rebuild the tree (R)'}
        >
          <HugeiconsIcon icon={Rotate01Icon} size={15} strokeWidth={2} />
          <span>Redraw</span>
        </button>
        <span class="divider"></span>
        <button class="icon" onclick={replay} title="Replay growth (space)" aria-label="Replay growth">
          <HugeiconsIcon icon={PlayIcon} size={16} strokeWidth={1.9} />
        </button>
        <input
          class="scrub"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={growth}
          oninput={scrub}
          onpointerdown={() => (scrubbing = true)}
          onpointerup={() => (scrubbing = false)}
          aria-label="Growth"
          style="--fill: {growth * 100}%"
        />
        <span class="pct">{Math.round(growth * 100)}%</span>
        <button class="icon" onclick={() => studio?.frameTree()} title="Reframe camera" aria-label="Reframe camera">
          <HugeiconsIcon icon={FocusIcon} size={16} strokeWidth={1.8} />
        </button>
        <button class="icon" onclick={screenshot} title="Save PNG" aria-label="Save PNG">
          <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.8} />
        </button>
        <button
          class="icon"
          class:done={linkCopied}
          onclick={copyLink}
          title="Copy a link to this tree"
          aria-label="Copy a link to this tree"
        >
          <HugeiconsIcon icon={linkCopied ? Tick02Icon : CopyLinkIcon} size={16} strokeWidth={1.8} />
        </button>
        <span class="divider"></span>
        <button class="icon" onclick={resetToDefaults} title="Reset this species to its defaults" aria-label="Reset to defaults">
          <HugeiconsIcon icon={UndoIcon} size={16} strokeWidth={1.8} />
        </button>
      </div>
    {/if}
  </div>

  <aside class="panel" class:closed={!panelOpen}>
    <!-- The panel lives on the right, so an open panel closes to the right. -->
    <button class="toggle" onclick={() => (panelOpen = !panelOpen)} aria-label={panelOpen ? 'Hide panel' : 'Show panel'}>
      <HugeiconsIcon icon={panelOpen ? ArrowRight01Icon : ArrowLeft01Icon} size={16} strokeWidth={2} />
    </button>

    <div class="panel__inner">
      <header>
        <h1>Arbor</h1>
        <p>L-system tree studio · WebGPU</p>
      </header>

      <div class="species">
        {#each presets as preset (preset.id)}
          <button
            class="chip"
            class:active={preset.id === params.presetId}
            onclick={() => choosePreset(preset.id)}
            title={preset.blurb}
          >
            {preset.name}
          </button>
        {/each}
      </div>
      <p class="blurb">{activePreset.blurb}</p>

      <Section title="Form" icon={Tree01Icon} open>
        <p class="help">Controls marked ↻ re-derive the grammar — press Redraw (or <kbd>R</kbd>) to apply. Everything else is live.</p>
        <Slider label="Generations" bind:value={params.iterations} min={1} max={30} step={1} needsRedraw />
        <Slider label="Branch angle" bind:value={params.angle} min={5} max={90} step={0.5} format={(v) => `${v.toFixed(1)}°`} needsRedraw />
        <Slider label="Internode length" bind:value={params.step} min={0.15} max={2} needsRedraw />
        <Slider label="Contraction" bind:value={params.shrink} min={0.6} max={0.99} hint="SHRINK — how fast each generation shortens" needsRedraw />
        <Slider label="Tropism" bind:value={params.tropism} min={-0.6} max={0.6} hint="Positive reaches for the sky, negative droops" needsRedraw />
        <Slider label="Taper" bind:value={params.pipeExponent} min={1.5} max={3.2} hint="Pipe-model exponent — higher is more slender" needsRedraw />
        <Slider label="Trunk radius" bind:value={params.trunkRadius} min={0.05} max={1.4} hint="Live — rescales the existing mesh" />
        <div class="row">
          <Slider label="Seed" bind:value={params.seed} min={0} max={999999} step={1} format={(v) => String(v)} needsRedraw />
          <button class="ghost" onclick={shuffleSeed} title="New random seed"><HugeiconsIcon icon={ShuffleIcon} size={13} strokeWidth={1.9} />Shuffle</button>
        </div>
      </Section>

      <Section title="Foliage" icon={Leaf01Icon}>
        <p class="help">Leaf shape ↻ needs a redraw; size and density are live.</p>
        <div class="segmented">
          {#each [{ v: 0, l: 'Broad' }, { v: 3, l: 'Lance' }, { v: 1, l: 'Needle' }, { v: 2, l: 'Blossom' }] as opt (opt.v)}
            <button
              class:active={params.leafShape === opt.v}
              onclick={() => (params.leafShape = opt.v as 0 | 1 | 2 | 3)}
            >
              {opt.l}
            </button>
          {/each}
        </div>
        <Slider label="Density" bind:value={params.leafDensity} min={0} max={1} />
        <Slider label="Leaf size" bind:value={params.leafScale} min={0.05} max={1} />
        <Slider label="Autumn" bind:value={params.autumn} min={0} max={1} />
        <Slider label="Translucency" bind:value={params.translucency} min={0} max={2.5} />
      </Section>

      <Section title="Bloom &amp; fruit" icon={FlowerIcon}>
        <p class="help">
          Flowers and fruit hang from the same twigs the leaves do, so any species can carry
          them. Everything here is live.
        </p>
        <h4 class="sub"><HugeiconsIcon icon={FlowerIcon} size={13} strokeWidth={1.6} /> Flowers</h4>
        <Slider label="Amount" bind:value={params.flowerDensity} min={0} max={1} />
        <Slider label="Size" bind:value={params.flowerSize} min={0.2} max={2.5} />
        <Swatch label="Petal" bind:value={params.flowerColor} />
        <Swatch label="Throat" bind:value={params.flowerCore} />

        <h4 class="sub"><HugeiconsIcon icon={CherryIcon} size={13} strokeWidth={1.6} /> Fruit</h4>
        <Slider label="Amount" bind:value={params.fruitDensity} min={0} max={1} />
        <Slider label="Size" bind:value={params.fruitSize} min={0.2} max={2.5} />
        <Swatch label="Skin" bind:value={params.fruitColor} />
        <Slider label="Gloss" bind:value={params.fruitGloss} min={0} max={1} />
      </Section>

      <Section title="Light &amp; air" icon={SunIcon}>
        <Slider label="Sun elevation" bind:value={params.sunElevation} min={-2} max={70} step={0.5} format={(v) => `${v.toFixed(1)}°`} />
        <Slider label="Sun azimuth" bind:value={params.sunAzimuth} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} />
        <Slider label="Haze" bind:value={params.haze} min={0} max={1} />
        <Slider label="Exposure" bind:value={params.exposure} min={0.3} max={2.2} />
        <Slider label="Wind" bind:value={params.wind} min={0} max={1.5} />
        <Slider label="Gust speed" bind:value={params.windSpeed} min={0.1} max={3} />
        <Slider label="Wind bearing" bind:value={params.windDirection} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} />
        <Slider label="Bark relief" bind:value={params.barkDetail} min={0} max={1} />
        <Slider label="Moss" bind:value={params.moss} min={0} max={1} />
      </Section>

      <Section title="Render" icon={Camera01Icon}>
        <p class="help">
          This scene is fill-rate bound, so resolution is the dial that matters. <b>Auto</b> holds 60 fps
          by scaling it — currently {stats.renderScale.toFixed(2)}×.
        </p>
        <div class="segmented">
          {#each [{ v: 'auto', l: 'Auto' }, { v: 'low', l: '1×' }, { v: 'medium', l: '1.5×' }, { v: 'high', l: '2×' }] as opt (opt.v)}
            <button class:active={params.quality === opt.v} onclick={() => (params.quality = opt.v as typeof params.quality)}>
              {opt.l}
            </button>
          {/each}
        </div>
        <Slider label="Bloom" bind:value={params.bloom} min={0} max={1.5} />
        <label class="check"><input type="checkbox" bind:checked={params.depthOfField} /> Depth of field</label>
        <label class="check"><input type="checkbox" bind:checked={params.grain} /> Film grain</label>
        <label class="check"><input type="checkbox" bind:checked={params.antialias} /> Anti-aliasing</label>
        <label class="check"><input type="checkbox" bind:checked={params.autoRotate} /> Orbit slowly</label>
        <label class="check"><input type="checkbox" bind:checked={params.autoGrow} /> Replay growth on redraw</label>
        <Slider label="Growth rate" bind:value={params.growthSpeed} min={0.05} max={1.5} />
      </Section>

      <Section title="Grammar" icon={SourceCodeIcon}>
        <p class="help">
          Globals: <code>ANG</code> angle · <code>LEN</code> length · <code>SHRINK</code> contraction ·
          <code>N</code> generations · <code>n</code> current step. Rules are tried top-down;
          <code>@p</code> pools stochastic variants.
        </p>
        <label class="field">
          <span>Axiom</span>
          <input class="mono" bind:value={axiomDraft} spellcheck="false" />
        </label>
        <label class="field">
          <span>Productions</span>
          <textarea class="mono" rows="12" bind:value={rulesDraft} spellcheck="false"></textarea>
        </label>
        <button class="apply" class:dirty={grammarDirty} onclick={applyGrammar} disabled={!grammarDirty}>
          {grammarDirty ? 'Apply grammar' : 'Grammar applied'}
        </button>
        {#if issues.length}
          <ul class="issues">
            {#each issues as issue (issue.line + issue.text)}
              <li><b>line {issue.line}</b> {issue.message}</li>
            {/each}
          </ul>
        {/if}
      </Section>

      <footer>
        <span>{stats.nodes.toLocaleString()} internodes · {stats.vertices.toLocaleString()} vertices</span>
      </footer>
    </div>
  </aside>
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    display: flex;
    overflow: hidden;
  }

  .stage {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* ---------------------------------------------------------- overlays */

  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: radial-gradient(ellipse at 50% 60%, #241a12, #0d0a08);
    padding: 2rem;
  }

  .card {
    max-width: 30rem;
    text-align: center;
    color: var(--ink);
  }

  .card h2 {
    font-size: 1.1rem;
    font-weight: 500;
    margin-bottom: 0.6rem;
    letter-spacing: 0.02em;
  }

  .card p {
    font-size: 0.85rem;
    line-height: 1.6;
    color: var(--ink-dim);
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.8rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.3s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.25; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.25); }
  }

  /* ---------------------------------------------------------- readout */

  .readout {
    position: absolute;
    top: 1rem;
    left: 1.15rem;
    display: flex;
    gap: 1rem;
    font-family: var(--mono);
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.55);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
    pointer-events: none;
    font-variant-numeric: tabular-nums;
  }

  .readout b {
    color: rgba(255, 255, 255, 0.92);
    font-weight: 500;
  }

  .readout .warn {
    color: #ffb057;
  }

  /* The copy-link button briefly becomes a tick. Confirming in place beats a
     toast: the feedback appears exactly where the user is already looking. */
  .transport .icon.done {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  /* -------------------------------------------------------- transport */

  .transport {
    position: absolute;
    left: 50%;
    bottom: 1.6rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.95rem;
    border-radius: 999px;
    background: rgba(20, 15, 11, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.09);
    backdrop-filter: blur(18px) saturate(1.3);
    -webkit-backdrop-filter: blur(18px) saturate(1.3);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  }

  .redraw {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    height: 30px;
    padding: 0 0.75rem;
    border-radius: 999px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.74rem;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .redraw :global(svg) {
    display: block;
  }

  .redraw:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  /* Something structural changed and is not on screen yet. */
  .redraw.pending {
    background: var(--accent);
    border-color: var(--accent);
    color: #21160c;
    font-weight: 500;
    animation: nudge 2.4s ease-in-out infinite;
  }

  @keyframes nudge {
    0%, 100% { box-shadow: 0 0 0 0 rgba(240, 176, 100, 0); }
    50% { box-shadow: 0 0 0 5px rgba(240, 176, 100, 0.16); }
  }

  .divider {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.14);
  }

  .icon {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .icon:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .icon :global(svg) {
    display: block;
  }

  .scrub {
    -webkit-appearance: none;
    appearance: none;
    width: 15rem;
    height: 3px;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      var(--accent) var(--fill),
      rgba(255, 255, 255, 0.16) var(--fill)
    );
    cursor: pointer;
  }

  .scrub::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.6);
  }

  .pct {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.65);
    width: 2.6rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* ------------------------------------------------------------ panel */

  .panel {
    position: relative;
    width: 21.5rem;
    flex-shrink: 0;
    background: var(--panel);
    backdrop-filter: blur(26px) saturate(1.35);
    -webkit-backdrop-filter: blur(26px) saturate(1.35);
    border-left: 1px solid var(--hairline);
    transition: margin-right 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .panel.closed {
    margin-right: -21.5rem;
  }

  .panel__inner {
    height: 100%;
    overflow-y: auto;
    padding: 1.5rem 1.35rem 2.5rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  .toggle {
    position: absolute;
    left: -30px;
    top: 1.5rem;
    width: 30px;
    height: 46px;
    border: 1px solid var(--hairline);
    border-right: none;
    border-radius: 8px 0 0 8px;
    background: var(--panel);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: var(--ink-dim);
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .toggle:hover {
    color: var(--accent);
  }


  header h1 {
    font-size: 1.35rem;
    font-weight: 300;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
    margin-bottom: 0.25rem;
  }

  header p {
    font-size: 0.64rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin-bottom: 1.15rem;
  }

  .species {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip {
    padding: 0.32rem 0.66rem;
    font-size: 0.72rem;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: rgba(255, 255, 255, 0.03);
    color: var(--ink-dim);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .chip:hover {
    color: var(--ink);
    border-color: rgba(255, 255, 255, 0.22);
  }

  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #21160c;
    font-weight: 500;
  }

  .blurb {
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--ink-faint);
    margin: 0.6rem 0 0.9rem;
    font-style: italic;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.6rem;
  }

  .row :global(.slider) {
    flex: 1;
  }

  .ghost {
    display: flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.3rem 0.6rem;
    margin-bottom: 0.7rem;
    font-size: 0.68rem;
    border-radius: 5px;
    border: 1px solid var(--hairline);
    background: transparent;
    color: var(--ink-dim);
    cursor: pointer;
    white-space: nowrap;
  }

  .ghost:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 7px;
    background: rgba(0, 0, 0, 0.28);
    margin-bottom: 0.85rem;
  }

  .segmented button {
    flex: 1;
    padding: 0.32rem 0;
    font-size: 0.7rem;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--ink-dim);
    cursor: pointer;
    transition: all 0.14s ease;
  }

  .segmented button:hover {
    color: var(--ink);
  }

  .segmented button.active {
    background: rgba(255, 255, 255, 0.1);
    color: var(--accent);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.74rem;
    color: var(--ink-dim);
    margin-bottom: 0.5rem;
    cursor: pointer;
  }

  .check input {
    accent-color: var(--accent);
    width: 13px;
    height: 13px;
    cursor: pointer;
  }

  .sub {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.9rem 0 0.6rem;
    font-size: 0.64rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .sub:first-of-type {
    margin-top: 0.2rem;
  }

  .help {
    font-size: 0.68rem;
    line-height: 1.65;
    color: var(--ink-faint);
    margin-bottom: 0.75rem;
  }

  kbd {
    font-family: var(--mono);
    font-size: 0.9em;
    padding: 0.05em 0.32em;
    border-radius: 3px;
    border: 1px solid var(--hairline);
    background: rgba(255, 255, 255, 0.06);
    color: var(--ink-dim);
  }

  .help code,
  .card code {
    font-family: var(--mono);
    font-size: 0.92em;
    color: var(--accent);
  }

  .field {
    display: block;
    margin-bottom: 0.7rem;
  }

  .field span {
    display: block;
    font-size: 0.68rem;
    letter-spacing: 0.05em;
    color: var(--ink-dim);
    margin-bottom: 0.3rem;
  }

  .field input,
  .field textarea {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid var(--hairline);
    background: rgba(0, 0, 0, 0.3);
    color: var(--ink);
    font-size: 0.7rem;
    line-height: 1.55;
    resize: vertical;
  }

  .field input:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .mono {
    font-family: var(--mono);
  }

  .apply {
    width: 100%;
    padding: 0.5rem;
    font-size: 0.72rem;
    border-radius: 6px;
    border: 1px solid var(--hairline);
    background: transparent;
    color: var(--ink-faint);
    cursor: not-allowed;
  }

  .apply.dirty {
    background: var(--accent);
    border-color: var(--accent);
    color: #21160c;
    font-weight: 500;
    cursor: pointer;
  }

  .issues {
    margin-top: 0.65rem;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    background: rgba(190, 60, 40, 0.16);
    border: 1px solid rgba(230, 110, 80, 0.34);
    list-style: none;
  }

  .issues li {
    font-size: 0.68rem;
    line-height: 1.5;
    color: #ffb59b;
  }

  .issues b {
    font-family: var(--mono);
    color: #ff8f6b;
  }

  footer {
    margin-top: 1.4rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--hairline);
    font-size: 0.65rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 780px) {
    .panel {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 5;
    }
    .scrub {
      width: 8rem;
    }
  }
</style>
