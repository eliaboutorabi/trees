<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ApertureIcon,
    CloudBigRainIcon,
    CloudLittleRainIcon,
    CloudLittleSnowIcon,
    CloudMidSnowIcon,
    CloudyIcon,
    Leaf04Icon,
    LeafyGreenIcon,
    ArrowDown01Icon,
    ArrowExpand01Icon,
    ArrowShrink01Icon,
    ArrowUp01Icon,
    DiceFaces03Icon,
    CameraLensIcon,
    DashboardSpeed02Icon,
    FilmRollIcon,
    Plant01Icon,
    Plant02Icon,
    Rotate360Icon,
    ShrinkDotIcon,
    SparklesIcon,
    Sun01Icon,
    CloudAngledRainIcon,
    CloudSnowIcon,
    Leaf03Icon,
    SunCloud02Icon,
    Sun02Icon,
    Sun03Icon,
    SunsetIcon,
    TreesIcon,
    CloudFastWindIcon,
    CloudSlowWindIcon,
    CloudFogIcon,
    SnowIcon,
    Download01Icon,
    FocusIcon,
    CherryIcon,
    CopyLinkIcon,
    Tick02Icon,
    FlowerIcon,
    Leaf01Icon,
    PlayIcon,
    Rotate01Icon,
    SourceCodeIcon,
    Tree01Icon,
    UndoIcon,
  } from '@hugeicons/core-free-icons';
  import { getPreset, type GrammarIssue } from '../engine';
  import { TreeStudio, type StudioStats } from '../render/studio';
  import { applyPreset, params, paramsFromPreset, presets, weatherFields, type AppParams } from './params.svelte';
  import { getSeason, SEASONS, WEATHERS, type Season, type Weather } from '../render/season';
  import { shareUrl, takeIncomingState } from './share';
  import Icon from './components/Icon.svelte';
  import Dock from './components/Dock.svelte';
  import Tile from './components/Tile.svelte';
  import PicSlider from './components/PicSlider.svelte';
  import Toggle from './components/Toggle.svelte';
  import Fold from './components/Fold.svelte';
  import SunDial from './components/SunDial.svelte';
  import WindCompass from './components/WindCompass.svelte';
  import ShapePad from './components/ShapePad.svelte';
  import PartGlyph from './components/PartGlyph.svelte';
  import ColorDots from './components/ColorDots.svelte';
  import CodeEditor from './components/CodeEditor.svelte';
  import TreeGlyph from './components/TreeGlyph.svelte';
  import Swatch from './components/Swatch.svelte';
  import Slider from './components/Slider.svelte';

  let canvas = $state<HTMLCanvasElement>();
  let stage = $state<HTMLDivElement>();
  let studio: TreeStudio | null = null;

  let ready = $state(false);
  let unsupported = $state(false);
  let fatal = $state<string | null>(null);
  // The season and weather buttons wear the current choice, so the dock itself
  // says what the scene is doing.
  const SEASON_ICONS = { spring: FlowerIcon, summer: Sun03Icon, autumn: Leaf03Icon, winter: SnowIcon } as const;
  // Leaf and fruit shapes, as tiles.
  const LEAF_SHAPES = [
    { v: 0, l: 'Broad', kind: 'broad' },
    { v: 3, l: 'Lance', kind: 'lance' },
    { v: 1, l: 'Needle', kind: 'needle' },
    { v: 2, l: 'Blossom', kind: 'blossom' },
  ] as const;
  const FRUIT_SHAPES = [
    { v: 0, l: 'Berry', kind: 'berry' },
    { v: 1, l: 'Apple', kind: 'apple' },
    { v: 2, l: 'Cone', kind: 'cone' },
  ] as const;
  // Tile backdrops: the colour of the season, the colour of the sky.
  const SEASON_BACKDROPS = {
    spring: 'linear-gradient(to bottom, rgba(170, 214, 160, 0.34), rgba(64, 96, 54, 0.22))',
    summer: 'linear-gradient(to bottom, rgba(242, 204, 118, 0.32), rgba(84, 104, 44, 0.24))',
    autumn: 'linear-gradient(to bottom, rgba(234, 140, 66, 0.34), rgba(112, 62, 26, 0.24))',
    winter: 'linear-gradient(to bottom, rgba(206, 220, 240, 0.4), rgba(122, 138, 164, 0.24))',
  } as const;
  const WEATHER_BACKDROPS = {
    clear: 'linear-gradient(to bottom, rgba(126, 176, 232, 0.36), rgba(240, 190, 112, 0.24))',
    rain: 'linear-gradient(to bottom, rgba(132, 142, 152, 0.42), rgba(60, 66, 74, 0.3))',
    snow: 'linear-gradient(to bottom, rgba(226, 233, 243, 0.45), rgba(150, 160, 176, 0.3))',
  } as const;
  const WEATHER_ICONS = { clear: SunCloud02Icon, rain: CloudAngledRainIcon, snow: CloudSnowIcon } as const;

  let growth = $state(0);
  /** Where the camera is looking from, for the camera-relative sun dial. */
  let cameraBearing = $state(0);
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

  const hexOf = (n: number | undefined, fallback: number) => `#${(n ?? fallback).toString(16).padStart(6, '0')}`;
  const leafHex = $derived(hexOf(activePreset.palette.leafTip, 0x86a83c));
  const blossomHex = $derived(hexOf(activePreset.palette.blossom, 0xffd7e4));
  // A handful of colours that suit the job, the species' own first.
  const petalChoices = $derived(
    [...new Set([hexOf(activePreset.palette.flowerColor, 0xf6d9e8), '#ffffff', '#ffd1e0', '#ff8fa3', '#ffd27a', '#c9a7ff'])],
  );
  const skinChoices = $derived(
    [...new Set([hexOf(activePreset.palette.fruitColor, 0xb8231f), '#a32617', '#8e1f36', '#e1541a', '#e8b62c', '#4a2c5a', '#7a9a2e'])],
  );


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
      fruitShape: params.fruitShape,
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
    'fruitShape',
  ] as const;

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

  /*
   * Rebuilding by itself.
   *
   * Anything that changes the tree's structure used to wait for the Redraw
   * button, which meant dragging a slider, seeing nothing, and clicking —
   * every time. Now the tree is rebuilt once the structure stops changing,
   * without replaying the growth, so it simply becomes the new tree — built on
   * a worker, so a drag never stalls the scene while it waits.
   *
   * Trailing by a moment, so a drag is not rebuilt on every pixel of it; but
   * never more than half a second behind, so a long slow drag still shows the
   * tree changing under it rather than nothing until you let go. A build is
   * tens of milliseconds for most trees, so this is affordable.
   */
  const SETTLE_MS = 180;
  const MAX_LAG_MS = 500;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let changingSince = 0;

  $effect(() => {
    const now = structureSnapshot();
    if (!ready || !built) return;
    if (!REDRAW_KEYS.some((k) => now[k] !== built![k])) {
      changingSince = 0;
      return;
    }
    const t = performance.now();
    if (!changingSince) changingSince = t;
    clearTimeout(settleTimer);
    const wait = t - changingSince > MAX_LAG_MS ? 0 : SETTLE_MS;
    settleTimer = setTimeout(() => {
      changingSince = 0;
      rebuildQuietly();
    }, wait);
  });

  /** Put every control on this species back where it started. */
  function resetToDefaults() {
    choosePreset(params.presetId);
  }

  /** A season is a dressing of the same tree, so nothing is re-derived. */
  /*
   * Gliding from one set of parameters to another.
   *
   * Every number that differs is eased from where it is to where it is going
   * over a few seconds, through the same parameters the sliders are bound to —
   * so the sliders move with the scene, and nothing in the renderer has to know
   * a transition is happening. Each step is uniform writes and one small cube
   * render, which is what dragging a slider already costs. Anything that is not
   * a number switches at the start. A new glide starts from wherever the last
   * one had got to.
   */
  const GLIDE_SECONDS = 2.8;
  let glide: number | null = null;

  function glideTo(target: Partial<AppParams>) {
    if (glide !== null) cancelAnimationFrame(glide);
    const from: Record<string, unknown> = { ...params };
    const moving: string[] = [];
    for (const [k, v] of Object.entries(target)) {
      if (typeof v === 'number' && typeof from[k] === 'number') {
        if (v !== from[k]) moving.push(k);
      } else (params as unknown as Record<string, unknown>)[k] = v;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1000 / GLIDE_SECONDS);
      const e = t * t * (3 - 2 * t);
      const next: Record<string, number> = {};
      for (const k of moving) {
        const a = from[k] as number;
        const b = (target as Record<string, number>)[k];
        next[k] = a + (b - a) * e;
      }
      Object.assign(params, next);
      glide = t < 1 ? requestAnimationFrame(step) : null;
    };
    glide = requestAnimationFrame(step);
  }

  function chooseWeather(id: Weather) {
    glideTo(weatherFields(params.presetId, params.season, id));
  }

  /**
   * A season is a dressing of the same tree, so nothing is re-derived — and it
   * arrives as a change of season rather than a cut. A season that thins the
   * canopy drops the leaves it no longer has, and they turn as they fall; one
   * that fills it back in brings the leaves back, the litter shrinking away and
   * the twigs leafing out. Everything else glides.
   */
  function chooseSeason(id: Season) {
    const from = params.season;
    const target = paramsFromPreset(params.presetId, id);
    if (studio) {
      const thinning = id === 'winter' || (id === 'autumn' && from !== 'winter');
      if (thinning) studio.dropLeaves(params.leafDensity, target.leafDensity);
      else studio.regrowLeaves();
    }
    glideTo(target);
  }

  /**
   * A new species arrives as a change of tree, not a cut: the one standing
   * grows back into the ground while the new one is built off the main
   * thread, and then the new one grows out. See `TreeStudio.transitionTo`.
   */
  function choosePreset(id: string) {
    applyPreset(id);
    axiomDraft = params.axiom;
    rulesDraft = params.rules;
    if (!studio) return;
    const snapshot = structureSnapshot();
    // Claimed now, so the auto-rebuild does not see a change and race it.
    built = snapshot;
    studio.transitionTo(snapshot, getPreset(id).palette, params.growthSpeed).then((info) => {
      if (info) issues = info.issues;
    });
  }

  /** Rebuild off the main thread, no animation — for structure sliders. */
  function rebuildQuietly() {
    if (!studio) return;
    const snapshot = structureSnapshot();
    built = snapshot;
    studio.rebuildQuietly(snapshot).then((info) => {
      if (info) issues = info.issues;
    });
  }

  function applyGrammar() {
    params.axiom = axiomDraft;
    params.rules = rulesDraft;
  }

  /** Another tree of the same kind: the old one grows back and the new one grows out. */
  function shuffleSeed() {
    params.seed = Math.floor(Math.random() * 1_000_000);
    if (!studio) return;
    const snapshot = structureSnapshot();
    built = snapshot;
    studio.transitionTo(snapshot, activePreset.palette, params.growthSpeed).then((info) => {
      if (info) issues = info.issues;
    });
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
    s.onBearing = (b) => (cameraBearing = b);
    s.onGrowth = (v) => {
      if (!scrubbing) growth = v;
    };

    s.init()
      .then(() => {
        s.applyPalette(activePreset.palette);
        s.applySky({
          sunElevation: params.sunElevation,
          sunAzimuth: params.sunAzimuth,
          sunIntensity: params.sunIntensity,
          skyLight: params.skyLight,
          haze: params.haze,
          overcast: params.overcast,
        });
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
      s.dispose();
      studio = null;
    };
  });

  // Look — uniform writes only, so these land immediately, every frame if need be.
  $effect(() => {
    const look = {
      season: params.season,
      weather: params.weather,
      precipitation: params.precipitation,
      wind: params.wind,
      windSpeed: params.windSpeed,
      windDirection: params.windDirection,
      autumn: params.autumn,
      translucency: params.translucency,
      snow: params.snow,
      leafFall: params.leafFall,
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
      fruitRipeness: params.fruitRipeness,
      fruitBlush: params.fruitBlush,
      fruitWax: params.fruitWax,
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

  // Sun and atmosphere. This used to be debounced by 70ms because each change
  // re-baked a 1024×512 texture on the CPU — 128ms of blocked main thread, which
  // is what made moving the sun feel like triggering a rebuild while the sky
  // itself lagged behind its own shadows. The sky is a shader now, so this is a
  // handful of uniform writes and lands on the very next frame.
  $effect(() => {
    const sky = {
      sunElevation: params.sunElevation,
      sunAzimuth: params.sunAzimuth,
      sunIntensity: params.sunIntensity,
      skyLight: params.skyLight,
      haze: params.haze,
      overcast: params.overcast,
    };
    if (!ready) return;
    studio?.applySky(sky);
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
      <div class="brand">
        <h1>Arbor</h1>
        <div class="readout">
          <span><b>{stats.fps}</b> fps</span>
          <span><b>{stats.leaves.toLocaleString()}</b> leaves</span>
          <span><b>{stats.branchTriangles.toLocaleString()}</b> tris</span>
          <span><b>{stats.renderScale.toFixed(2)}</b>× {stats.adaptive ? 'auto' : 'fixed'}</span>
          {#if stats.truncated}<span class="warn">capped</span>{/if}
        </div>
      </div>

      <div class="actions">
        <button class="round" onclick={() => studio?.frameTree()} title="Reframe camera" aria-label="Reframe camera">
          <Icon icon={FocusIcon} size={17} strokeWidth={1.8} />
        </button>
        <button class="round" onclick={screenshot} title="Save PNG" aria-label="Save PNG">
          <Icon icon={Download01Icon} size={17} strokeWidth={1.8} />
        </button>
        <button class="round" class:done={linkCopied} onclick={copyLink} title="Copy a link to this tree" aria-label="Copy a link to this tree">
          <Icon icon={linkCopied ? Tick02Icon : CopyLinkIcon} size={17} strokeWidth={1.8} />
        </button>
        <button class="round" onclick={resetToDefaults} title="Reset this species to its defaults" aria-label="Reset to defaults">
          <Icon icon={UndoIcon} size={17} strokeWidth={1.8} />
        </button>
      </div>

      <Dock
        tools={[
          { id: 'species', label: 'Species', icon: TreesIcon, panel: speciesPanel, group: 0 },
          { id: 'season', label: 'Season', icon: SEASON_ICONS[params.season], panel: seasonPanel, group: 0 },
          { id: 'weather', label: 'Weather', icon: WEATHER_ICONS[params.weather], panel: weatherPanel, group: 0 },
          { id: 'shape', label: 'Shape', icon: Tree01Icon, panel: shapePanel, group: 1 },
          { id: 'foliage', label: 'Foliage', icon: Leaf01Icon, panel: foliagePanel, group: 1 },
          { id: 'bloom', label: 'Bloom & fruit', icon: CherryIcon, panel: bloomPanel, group: 1 },
          { id: 'light', label: 'Light', icon: SunsetIcon, panel: lightPanel, group: 2 },
          { id: 'wind', label: 'Wind', icon: CloudFastWindIcon, panel: windPanel, group: 2 },
          { id: 'look', label: 'Look', icon: ApertureIcon, panel: lookPanel, group: 3 },
          { id: 'grammar', label: 'Grammar', icon: SourceCodeIcon, panel: grammarPanel, group: 3, wide: true },
        ]}
      >
        <div class="growth">
          <button class="mini" onclick={redraw} title="Grow the tree again from seed (R)" aria-label="Grow again">
            <Icon icon={Rotate01Icon} size={15} strokeWidth={2} />
          </button>
          <button class="mini" onclick={replay} title="Replay growth (space)" aria-label="Replay growth">
            <Icon icon={PlayIcon} size={15} strokeWidth={1.9} />
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
        </div>
      </Dock>
    {/if}
  </div>
</div>

{#snippet speciesPanel()}
  <div class="tiles three">
    {#each presets as preset (preset.id)}
      <Tile label={preset.name} title={preset.blurb} active={preset.id === params.presetId} onclick={() => choosePreset(preset.id)}>
        <TreeGlyph {preset} season={params.season} />
      </Tile>
    {/each}
  </div>
  <p class="blurb">{activePreset.blurb}</p>
{/snippet}

{#snippet seasonPanel()}
  <div class="tiles four">
    {#each SEASONS as s (s.id)}
      <Tile label={s.name} title={s.blurb} active={s.id === params.season} backdrop={SEASON_BACKDROPS[s.id]} onclick={() => chooseSeason(s.id)}>
        <TreeGlyph preset={activePreset} season={s.id} />
      </Tile>
    {/each}
  </div>
  <p class="blurb">{getSeason(params.season).blurb}</p>
{/snippet}

{#snippet weatherPanel()}
  <div class="tiles three">
    {#each WEATHERS as w (w.id)}
      <Tile label={w.name} title={w.blurb || w.name} active={w.id === params.weather} backdrop={WEATHER_BACKDROPS[w.id]} onclick={() => chooseWeather(w.id)}>
        <span class="weather-art"><Icon icon={WEATHER_ICONS[w.id]} size={28} strokeWidth={1.5} /></span>
      </Tile>
    {/each}
  </div>
  {#if params.weather === 'rain'}
    <PicSlider label="How hard it rains" bind:value={params.precipitation} min={0} max={1} from={CloudLittleRainIcon} to={CloudBigRainIcon} />
  {:else if params.weather === 'snow'}
    <PicSlider label="How hard it snows" bind:value={params.precipitation} min={0} max={1} from={CloudLittleSnowIcon} to={CloudMidSnowIcon} />
  {/if}
  <PicSlider label="Clouds" bind:value={params.overcast} min={0} max={1} from={Sun02Icon} to={CloudyIcon} hint="A clear sky, or one closed over — which takes the sun's strength and colour with it" />
  <PicSlider label="Snow on the ground" bind:value={params.snow} min={0} max={1} from={Plant02Icon} to={SnowIcon} hint="Settles on the branches, the grass and the ground together" />
{/snippet}

{#snippet shapePanel()}
  <ShapePad
    bind:angle={params.angle}
    bind:step={params.step}
    shrink={params.shrink}
    tropism={params.tropism}
    leaf={`#${activePreset.palette.leafTip.toString(16).padStart(6, '0')}`}
  />
  <PicSlider label="Droop or reach" bind:value={params.tropism} min={-0.6} max={0.6} from={ArrowDown01Icon} to={ArrowUp01Icon} hint="Branches that hang like a willow's, or that reach for the sky" />
  <PicSlider label="Branchiness" bind:value={params.iterations} min={1} max={30} step={1} from={Plant01Icon} to={TreesIcon} hint="How many times the branches divide" />
  <PicSlider label="Trunk" bind:value={params.trunkRadius} min={0.05} max={1.4} from={ArrowShrink01Icon} to={ArrowExpand01Icon} hint="Slender or stout" />
  <button class="another" onclick={shuffleSeed} title="The same kind of tree, grown differently">
    <Icon icon={DiceFaces03Icon} size={17} strokeWidth={1.7} />
    Try another
  </button>
  <Fold>
    <p class="help">Controls marked ↻ rebuild the tree a moment after you stop moving them.</p>
    <Slider label="Generations" bind:value={params.iterations} min={1} max={30} step={1} needsRedraw />
    <Slider label="Branch angle" bind:value={params.angle} min={5} max={90} step={0.5} format={(v) => `${v.toFixed(1)}°`} needsRedraw />
    <Slider label="Internode length" bind:value={params.step} min={0.15} max={2} needsRedraw />
    <Slider label="Contraction" bind:value={params.shrink} min={0.6} max={0.99} hint="SHRINK — how fast each generation shortens" needsRedraw />
    <Slider label="Tropism" bind:value={params.tropism} min={-0.6} max={0.6} hint="Positive reaches for the sky, negative droops" needsRedraw />
    <Slider label="Taper" bind:value={params.pipeExponent} min={1.5} max={3.2} hint="Pipe-model exponent — higher is more slender" needsRedraw />
    <Slider label="Trunk radius" bind:value={params.trunkRadius} min={0.05} max={1.4} hint="Live — rescales the existing mesh" />
    <Slider label="Seed" bind:value={params.seed} min={0} max={999999} step={1} format={(v) => String(v)} needsRedraw />
    <h4 class="sub"><Icon icon={Tree01Icon} size={13} strokeWidth={1.6} /> Bark</h4>
    <Slider label="Relief" bind:value={params.barkDetail} min={0} max={1} hint="Depth of the furrows" />
    <Slider label="Moss" bind:value={params.moss} min={0} max={1} hint="Creeps up from the base and settles into the crevices" />
  </Fold>
{/snippet}

{#snippet foliagePanel()}
  <div class="tiles four">
    {#each LEAF_SHAPES as opt (opt.v)}
      <Tile label={opt.l} active={params.leafShape === opt.v} onclick={() => (params.leafShape = opt.v)}>
        <PartGlyph kind={opt.kind} color={leafHex} accent={blossomHex} />
      </Tile>
    {/each}
  </div>
  <PicSlider label="Leaves" bind:value={params.leafDensity} min={0} max={1} from={Leaf04Icon} to={LeafyGreenIcon} hint="A bare, sparse crown, or a full one" />
  <PicSlider label="Leaf size" bind:value={params.leafScale} min={0.05} max={1} from={Leaf01Icon} to={Leaf01Icon} />
  <Fold>
    <Slider label="Density" bind:value={params.leafDensity} min={0} max={1} />
    <Slider label="Leaf size" bind:value={params.leafScale} min={0.05} max={1} />
    <Slider label="Autumn" bind:value={params.autumn} min={0} max={1} hint="How far the leaves have turned — the season sets this for you" />
    <Slider label="Translucency" bind:value={params.translucency} min={0} max={2.5} hint="How much sun glows through the leaves" />
  </Fold>
{/snippet}

{#snippet bloomPanel()}
  <PicSlider label="Flowers" bind:value={params.flowerDensity} min={0} max={1} from={FlowerIcon} to={FlowerIcon} hint="Any tree can carry them — they hang from the same twigs as the leaves" />
  {#if params.flowerDensity > 0.01}
    <ColorDots label="Petals" bind:value={params.flowerColor} choices={petalChoices} />
  {/if}

  <div class="tiles three">
    {#each FRUIT_SHAPES as opt (opt.v)}
      <Tile label={opt.l} active={params.fruitShape === opt.v} onclick={() => (params.fruitShape = opt.v)}>
        <PartGlyph kind={opt.kind} color={opt.v === 2 ? '#7a512b' : params.fruitColor} />
      </Tile>
    {/each}
  </div>
  <PicSlider label="Fruit" bind:value={params.fruitDensity} min={0} max={1} from={CherryIcon} to={CherryIcon} />
  {#if params.fruitDensity > 0.01 && params.fruitShape !== 2}
    <ColorDots label="Skin" bind:value={params.fruitColor} choices={skinChoices} />
  {/if}

  <Fold>
    <Slider label="Flower size" bind:value={params.flowerSize} min={0.2} max={2.5} />
    <Swatch label="Throat" bind:value={params.flowerCore} />
    <Slider label="Fruit size" bind:value={params.fruitSize} min={0.15} max={2} />
    <Slider label="Ripeness" bind:value={params.fruitRipeness} min={0} max={1} hint="1 keeps the skin colour exactly; lower lets green survive on the shaded half" />
    <Slider label="Sun blush" bind:value={params.fruitBlush} min={0} max={1} hint="How far the sunward cheek turns toward orange" />
    <Slider label="Wax bloom" bind:value={params.fruitWax} min={0} max={1} hint="The pale dust on a plum, strongest around the rim" />
    <Slider label="Gloss" bind:value={params.fruitGloss} min={0} max={1} hint="How much sky the skin mirrors. High gloss is shinier but paler — that trade is real, not a bug" />
  </Fold>
{/snippet}

{#snippet lightPanel()}
  <SunDial bind:azimuth={params.sunAzimuth} bind:elevation={params.sunElevation} bearing={cameraBearing} />
  <PicSlider label="Sunlight" bind:value={params.sunIntensity} min={0} max={12} step={0.1} from={Sun01Icon} to={Sun03Icon} hint="How strong the sun's beam is" />
  <PicSlider label="Haze" bind:value={params.haze} min={0} max={1} from={SunCloud02Icon} to={CloudFogIcon} hint="Clear air, or a hazy sky that softens the sun and the distance" />
  <Fold>
    <Slider label="Elevation" bind:value={params.sunElevation} min={-2} max={70} step={0.5} format={(v) => `${v.toFixed(1)}°`} hint="Height above the horizon. Low is golden, high is midday." />
    <Slider label="Azimuth" bind:value={params.sunAzimuth} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} hint="Compass bearing — 0° is straight down +Z" />
    <Slider label="Sky light" bind:value={params.skyLight} min={0} max={2.5} hint="The ambient half — the sky is what fills the shadows" />
    <Slider label="Exposure" bind:value={params.exposure} min={0.3} max={2.2} />
  </Fold>
{/snippet}

{#snippet windPanel()}
  <WindCompass bind:direction={params.windDirection} bind:strength={params.wind} gusts={params.windSpeed} bearing={cameraBearing} />
  <PicSlider label="Gusts" bind:value={params.windSpeed} min={0.1} max={3} from={CloudSlowWindIcon} to={CloudFastWindIcon} hint="Slow swells, or quick, restless gusts" />
  <Fold>
    <Slider label="Strength" bind:value={params.wind} min={0} max={1.5} />
    <Slider label="Gust speed" bind:value={params.windSpeed} min={0.1} max={3} />
    <Slider label="Bearing" bind:value={params.windDirection} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} hint="The direction the wind pushes the tree toward" />
  </Fold>
{/snippet}

{#snippet lookPanel()}
  <div class="toggles">
    <Toggle label="Focus blur" icon={CameraLensIcon} bind:checked={params.depthOfField} hint="Depth of field: the background softens behind the tree" />
    <Toggle label="Film grain" icon={FilmRollIcon} bind:checked={params.grain} />
    <Toggle label="Smooth edges" icon={ShrinkDotIcon} bind:checked={params.antialias} hint="Anti-aliasing" />
    <Toggle label="Orbit" icon={Rotate360Icon} bind:checked={params.autoRotate} hint="The camera circles the tree slowly" />
    <Toggle label="Regrow" icon={Plant02Icon} bind:checked={params.autoGrow} hint="Grow the tree from seed again when it is redrawn" />
  </div>
  <PicSlider label="Glow" bind:value={params.bloom} min={0} max={1.5} from={Sun01Icon} to={SparklesIcon} hint="Bloom: bright light spills softly around itself" />
  <PicSlider label="Growing speed" bind:value={params.growthSpeed} min={0.05} max={1.5} from={Plant01Icon} to={DashboardSpeed02Icon} />
  <Fold>
    <p class="help">Sharpness. <b>Auto</b> holds a smooth frame rate by adjusting it — currently {stats.renderScale.toFixed(2)}×.</p>
    <div class="segmented">
      {#each [{ v: 'auto', l: 'Auto' }, { v: 'low', l: '1×' }, { v: 'medium', l: '1.5×' }, { v: 'high', l: '2×' }] as opt (opt.v)}
        <button class:active={params.quality === opt.v} onclick={() => (params.quality = opt.v as typeof params.quality)}>
          {opt.l}
        </button>
      {/each}
    </div>
  </Fold>
{/snippet}

{#snippet grammarPanel()}
  <label class="field">
    <span>Axiom</span>
    <CodeEditor bind:value={axiomDraft} rows={1} label="Axiom" onsubmit={applyGrammar} />
  </label>
  <label class="field">
    <span>Productions</span>
    <CodeEditor bind:value={rulesDraft} rows={14} label="Productions" errorLines={issues.map((i) => i.line)} onsubmit={applyGrammar} />
  </label>
  <div class="legend">
    <span><b class="k-draw">F</b> grow</span>
    <span><b class="k-branch">[ ]</b> branch</span>
    <span><b class="k-turn">+ − &amp; ^ / \</b> turn</span>
    <span><b class="k-global">ANG LEN SHRINK</b> sliders</span>
    <span><b class="k-num">n N</b> step · steps</span>
  </div>
  <button class="apply" class:dirty={grammarDirty} onclick={applyGrammar} disabled={!grammarDirty}>
    {grammarDirty ? 'Apply grammar  ⌘↵' : 'Grammar applied'}
  </button>
  {#if issues.length}
    <ul class="issues">
      {#each issues as issue (issue.line + issue.text)}
        <li><b>line {issue.line}</b> {issue.message}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

<style>
  .app {
    position: fixed;
    inset: 0;
    overflow: hidden;
    /* Only ever seen in the moment before the first frame lands; the canvas
       covers it edge to edge after that. */
    background: var(--panel-solid);
  }

  /*
   * The scene owns the whole window, and the panel floats over it.
   *
   * It used to be a flex sibling of the panel, so animating the panel's margin
   * animated the stage's width — and the ResizeObserver dutifully resized the
   * renderer on every frame of it. One click on the toggle measured 20 resizes
   * at 19 distinct widths, each one tearing down and rebuilding every
   * viewport-sized render target in the post chain. Roughly 700 GPU texture
   * reallocations to slide a sidebar. Taking the panel out of flow cut that to
   * one resize per toggle; giving the stage the full window cuts it to none.
   *
   * The reason is not really performance, though. A tree framed in two thirds
   * of the window is a tree that jumps sideways every time you reach for a
   * slider, and reframes itself under you when you put the panel back. Now the
   * camera has one viewport, the panel is glass, and the tree never moves.
   */
  .stage {
    position: absolute;
    inset: 0;
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

  /* ------------------------------------------------------------- HUD */

  /*
   * Everything floats over the scene: the name and a quiet readout top-left,
   * the camera and file actions top-right, and the tools in the dock along the
   * bottom. Nothing reserves space, so the tree has the whole window.
   */
  .brand {
    position: absolute;
    top: 1.05rem;
    left: 1.25rem;
    pointer-events: none;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.55);
  }

  .brand h1 {
    font-size: 1.05rem;
    font-weight: 300;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .readout {
    margin-top: 0.3rem;
    display: flex;
    gap: 0.85rem;
    font-family: var(--mono);
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
  }

  .readout b {
    color: rgba(255, 255, 255, 0.85);
    font-weight: 500;
  }

  .readout .warn {
    color: #ffb057;
  }

  .actions {
    position: absolute;
    top: 1rem;
    right: 1.1rem;
    display: flex;
    gap: 0.45rem;
  }

  .round {
    width: 2.35rem;
    height: 2.35rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--ink-dim);
    background: linear-gradient(to bottom, rgba(34, 27, 21, 0.62), rgba(18, 14, 11, 0.56));
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(18px) saturate(1.35);
    -webkit-backdrop-filter: blur(18px) saturate(1.35);
    box-shadow: 0 8px 26px rgba(0, 0, 0, 0.32);
    cursor: pointer;
    transition:
      transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.4),
      color 0.18s;
  }

  .round:hover {
    color: #fff;
    transform: translateY(-2px) scale(1.05);
  }

  .round.done {
    color: var(--accent);
  }

  /* Growth, at the end of the dock. */
  .growth {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-right: 0.3rem;
    flex: none;
  }

  .mini {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    color: var(--ink-dim);
    cursor: pointer;
  }

  .mini:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .scrub {
    -webkit-appearance: none;
    appearance: none;
    width: 7.5rem;
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









  .another {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    margin: 0.2rem 0 0.4rem;
    padding: 0.65rem;
    border-radius: 12px;
    border: 1px solid rgba(240, 176, 100, 0.4);
    background: rgba(240, 176, 100, 0.1);
    color: var(--ink);
    font-size: 0.78rem;
    cursor: pointer;
    transition:
      background 0.18s,
      transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.5);
  }

  .another:hover {
    background: rgba(240, 176, 100, 0.22);
    transform: translateY(-1px);
  }

  .another:active :global(svg) {
    transform: rotate(90deg);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.8rem;
    margin: 0.1rem 0 0.8rem;
    font-size: 0.62rem;
    color: var(--ink-faint);
  }

  .legend b {
    font-family: var(--mono);
    font-weight: 600;
    margin-right: 0.15rem;
  }

  .k-draw { color: #9fd36b; }
  .k-branch { color: #e9a7ff; }
  .k-turn { color: #79b8ff; }
  .k-global { color: #7fdbca; }
  .k-num { color: #7fdbca; }

  .toggles {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.3rem;
    margin: 0.3rem 0 1rem;
  }

  .tiles {
    display: grid;
    gap: 0.45rem;
    margin: 0.2rem 0 0.7rem;
  }

  .tiles.three {
    grid-template-columns: repeat(3, 1fr);
  }

  .tiles.four {
    grid-template-columns: repeat(4, 1fr);
  }

  .weather-art {
    color: rgba(255, 255, 255, 0.9);
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
  }






  .blurb {
    font-size: 0.72rem;
    line-height: 1.5;
    color: var(--ink-faint);
    margin: 0.6rem 0 0.9rem;
    font-style: italic;
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


  /* The pill has to fit the strip beside the panel, not just the window. */
  @media (max-width: 640px) {
    .scrub {
      width: 4.5rem;
    }
    .readout {
      display: none;
    }
  }

</style>
