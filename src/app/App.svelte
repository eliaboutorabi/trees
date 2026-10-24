<script lang="ts">
  import { onMount } from 'svelte';
  import { getPreset, type GrammarIssue } from '../engine';
  import { TreeStudio, type StudioStats } from '../render/studio';
  import { applyPreset, params, paramsFromPreset, presets, weatherFields, type AppParams } from './params.svelte';
  import { getSeason, SEASONS, WEATHERS, type Season, type Weather } from '../render/season';
  import { shareUrl, takeIncomingState } from './share';
  import Glyph from './components/Glyph.svelte';
  import GrowthStem from './components/GrowthStem.svelte';
  import QuickBar from './components/QuickBar.svelte';
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
  // says what the scene is doing — the season's button its colour, too.
  const SEASON_TONES = {
    spring: ['#dfaab3', '#7d3a46'],
    summer: ['#d9c47e', '#685518'],
    autumn: ['#d9a185', '#7a4228'],
    winter: ['#b4c9db', '#38566f'],
  } as const;
  const SEASON_ICONS = {
    spring: 'season-spring',
    summer: 'season-summer',
    autumn: 'season-autumn',
    winter: 'season-winter',
  } as const;
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
  const WEATHER_ICONS = { clear: 'weather-clear', rain: 'weather-rain', snow: 'weather-snow' } as const;

  let growth = $state(0);
  /** Where the camera is looking from, for the camera-relative sun dial. */
  let cameraBearing = $state(0);
  let scrubbing = $state(false);
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

  function scrub(value: number) {
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
      colour: params.colour,
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

  $effect(() => {
    const on = params.rainbow;
    if (!ready) return;
    studio?.setRainbow(on);
  });

  $effect(() => {
    const on = params.night;
    if (!ready) return;
    studio?.setNight(on);
  });

  /**
   * A rainbow wants a low sun — above 42° there is none at all — and the sky
   * opposite it. So asking for one brings the sun down if it is high, and the
   * camera round to look the right way.
   */
  function toggleRainbow() {
    params.rainbow = !params.rainbow;
    if (!params.rainbow) return;
    if (params.sunElevation > 28) glideTo({ sunElevation: 16 });
    studio?.showRainbow();
  }
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
        <h1><Glyph name="grove" size={26} weight={1.5} />Arbor</h1>
        <div class="readout">
          <span><b>{stats.fps}</b> fps</span>
          <span><b>{stats.leaves.toLocaleString()}</b> leaves</span>
          <span><b>{stats.branchTriangles.toLocaleString()}</b> tris</span>
          <span><b>{stats.renderScale.toFixed(2)}</b>× {stats.adaptive ? 'auto' : 'fixed'}</span>
          {#if stats.truncated}<span class="warn">capped</span>{/if}
        </div>
      </div>

      <div class="actions">
        <button class="round" onclick={() => studio?.frameTree(true)} title="Reframe the tree" aria-label="Reframe the tree">
          <Glyph name="reframe" size={21} />
        </button>
        <button class="round" onclick={screenshot} title="Save a picture" aria-label="Save a picture">
          <Glyph name="save" size={21} />
        </button>
        <button class="round" class:done={linkCopied} onclick={copyLink} title="Copy a link to this tree" aria-label="Copy a link to this tree">
          <Glyph name={linkCopied ? 'done' : 'link'} size={21} />
        </button>
        <button class="round" onclick={resetToDefaults} title="Start this species over" aria-label="Reset to defaults">
          <Glyph name="reset" size={21} />
        </button>
        <a
          class="round"
          href="https://github.com/eliaboutorabi/trees"
          target="_blank"
          rel="noopener noreferrer"
          title="The project on GitHub"
          aria-label="Open the project on GitHub"
        >
          <Glyph name="github" size={21} />
        </a>
      </div>

      <GrowthStem value={growth} onscrub={scrub} bind:holding={scrubbing} onreplay={replay} onregrow={redraw} />
      <QuickBar
        items={[
          { id: 'orbit', label: 'Orbit', icon: 'orbit', on: params.autoRotate, tone: '#a9c4d8', toneInk: '#33566e', toggle: () => (params.autoRotate = !params.autoRotate) },
          { id: 'focus', label: 'Focus blur', icon: 'lens', on: params.depthOfField, tone: '#bba8d0', toneInk: '#544472', toggle: () => (params.depthOfField = !params.depthOfField) },
          { id: 'rainbow', label: 'Rainbow', icon: 'rainbow', on: params.rainbow, tone: '#e6b3a0', toneInk: '#7a3a2a', toggle: toggleRainbow },
          { id: 'night', label: params.night ? 'Day' : 'Night', icon: params.night ? 'season-summer' : 'moon', on: params.night, tone: '#9aa6d6', toneInk: '#2c3566', toggle: () => (params.night = !params.night) },
        ]}
      />

      <Dock
        tools={[
          { id: 'species', label: 'Species', icon: 'grove', panel: speciesPanel, group: 0, tone: '#93c3a0', toneInk: '#2f5f43' },
          { id: 'season', label: 'Season', icon: SEASON_ICONS[params.season], panel: seasonPanel, group: 0, tone: SEASON_TONES[params.season][0], toneInk: SEASON_TONES[params.season][1] },
          { id: 'weather', label: 'Weather', icon: WEATHER_ICONS[params.weather], panel: weatherPanel, group: 0, tone: '#9fcbc3', toneInk: '#2b625b' },
          { id: 'shape', label: 'Shape', icon: 'twig', panel: shapePanel, group: 1, tone: '#a4bb8c', toneInk: '#44592f' },
          { id: 'foliage', label: 'Foliage', icon: 'leaf', panel: foliagePanel, group: 1, tone: '#c4cc8f', toneInk: '#555b22' },
          { id: 'bloom', label: 'Bloom & fruit', icon: 'bloom', panel: bloomPanel, group: 1, tone: '#d99ca6', toneInk: '#7a3a45' },
          { id: 'light', label: 'Light', icon: 'sunset', panel: lightPanel, group: 2, tone: '#dbb66f', toneInk: '#6e5216' },
          { id: 'wind', label: 'Wind', icon: 'wind', panel: windPanel, group: 2, tone: '#a9c4d8', toneInk: '#33566e' },
          { id: 'look', label: 'Look', icon: 'frame', panel: lookPanel, group: 3, tone: '#bba8d0', toneInk: '#544472' },
          { id: 'grammar', label: 'Grammar', icon: 'quill', panel: grammarPanel, group: 3, tone: '#d6c9b1', toneInk: '#64553b', wide: true },
        ]}
      />
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
        <span class="weather-art illustrated"><Glyph name={WEATHER_ICONS[w.id]} size={42} weight={1.4} /></span>
      </Tile>
    {/each}
  </div>
  {#if params.weather === 'rain'}
    <PicSlider label="How hard it rains" bind:value={params.precipitation} min={0} max={1} from="rain-light" to="rain-heavy" />
  {:else if params.weather === 'snow'}
    <PicSlider label="How hard it snows" bind:value={params.precipitation} min={0} max={1} from="snow-light" to="snow-heavy" />
  {/if}
  <PicSlider label="Clouds" bind:value={params.overcast} min={0} max={1} from="sky-clear" to="sky-overcast" hint="A clear sky, or one closed over — which takes the sun's strength and colour with it" />
  <PicSlider label="Snow on the ground" bind:value={params.snow} min={0} max={1} from="ground-grass" to="ground-snow" hint="Settles on the branches, the grass and the ground together" />
{/snippet}

{#snippet shapePanel()}
  <ShapePad
    bind:angle={params.angle}
    bind:step={params.step}
    shrink={params.shrink}
    tropism={params.tropism}
    leaf={`#${activePreset.palette.leafTip.toString(16).padStart(6, '0')}`}
  />
  <PicSlider label="Droop or reach" bind:value={params.tropism} min={-0.6} max={0.6} from="droop" to="reach" hint="Branches that hang like a willow's, or that reach for the sky" />
  <PicSlider label="Branchiness" bind:value={params.iterations} min={1} max={30} step={1} from="branch-few" to="branch-many" hint="How many times the branches divide" />
  <PicSlider label="Trunk" bind:value={params.trunkRadius} min={0.05} max={1.4} from="trunk-thin" to="trunk-stout" hint="Slender or stout" />
  <button class="another" onclick={shuffleSeed} title="The same kind of tree, grown differently">
    <Glyph name="seeds" size={20} />
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
    <h4 class="sub"><span class="illustrated"><Glyph name="trunk-stout" size={20} weight={1.5} /></span> Bark</h4>
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
  <PicSlider label="Leaves" bind:value={params.leafDensity} min={0} max={1} from="twig-bare" to="twig-leafy" hint="A bare, sparse crown, or a full one" />
  <PicSlider label="Leaf size" bind:value={params.leafScale} min={0.05} max={1} from="leaf-small" to="leaf-big" />
  <Fold>
    <Slider label="Density" bind:value={params.leafDensity} min={0} max={1} />
    <Slider label="Leaf size" bind:value={params.leafScale} min={0.05} max={1} />
    <Slider label="Autumn" bind:value={params.autumn} min={0} max={1} hint="How far the leaves have turned — the season sets this for you" />
    <Slider label="Translucency" bind:value={params.translucency} min={0} max={2.5} hint="How much sun glows through the leaves" />
  </Fold>
{/snippet}

{#snippet bloomPanel()}
  <PicSlider label="Flowers" bind:value={params.flowerDensity} min={0} max={1} from="flower-one" to="flower-many" hint="Any tree can carry them — they hang from the same twigs as the leaves" />
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
  <PicSlider label="Fruit" bind:value={params.fruitDensity} min={0} max={1} from="fruit-one" to="fruit-many" />
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
  <SunDial bind:azimuth={params.sunAzimuth} bind:elevation={params.sunElevation} bearing={cameraBearing} night={params.night} />
  <PicSlider label={params.night ? 'Moonlight' : 'Sunlight'} bind:value={params.sunIntensity} min={0} max={12} step={0.1} from="sun-soft" to="sun-strong" hint="How strong the sun's beam is" />
  <PicSlider label="Haze" bind:value={params.haze} min={0} max={1} from="hills-clear" to="hills-hazy" hint="Clear air, or a hazy sky that softens the sun and the distance" />
  <PicSlider label="Colour" bind:value={params.colour} min={0} max={2} from="colour-muted" to="colour-vivid" hint="Muted, natural or vivid colour" />
  <Fold>
    <Slider label="Elevation" bind:value={params.sunElevation} min={-2} max={70} step={0.5} format={(v) => `${v.toFixed(1)}°`} hint="Height above the horizon. Low is golden, high is midday." />
    <Slider label="Azimuth" bind:value={params.sunAzimuth} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} hint="Compass bearing — 0° is straight down +Z" />
    <Slider label="Sky light" bind:value={params.skyLight} min={0} max={2.5} hint="The ambient half — the sky is what fills the shadows" />
    <Slider label="Exposure" bind:value={params.exposure} min={0.3} max={2.2} />
  </Fold>
{/snippet}

{#snippet windPanel()}
  <WindCompass bind:direction={params.windDirection} bind:strength={params.wind} gusts={params.windSpeed} bearing={cameraBearing} />
  <PicSlider label="Gusts" bind:value={params.windSpeed} min={0.1} max={3} from="breeze" to="gale" hint="Slow swells, or quick, restless gusts" />
  <Fold>
    <Slider label="Strength" bind:value={params.wind} min={0} max={1.5} />
    <Slider label="Gust speed" bind:value={params.windSpeed} min={0.1} max={3} />
    <Slider label="Bearing" bind:value={params.windDirection} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} hint="The direction the wind pushes the tree toward" />
  </Fold>
{/snippet}

{#snippet lookPanel()}
  <div class="toggles">
    <Toggle label="Film grain" icon="grain" bind:checked={params.grain} />
    <Toggle label="Smooth edges" icon="smooth" bind:checked={params.antialias} hint="Anti-aliasing" />
    <Toggle label="Regrow" icon="sprout" bind:checked={params.autoGrow} hint="Grow the tree from seed again when it is redrawn" />
  </div>
  <PicSlider label="Glow" bind:value={params.bloom} min={0} max={1.5} from="glow-off" to="glow-on" hint="Bloom: bright light spills softly around itself" />
  <PicSlider label="Growing speed" bind:value={params.growthSpeed} min={0.05} max={1.5} from="snail" to="swift" />
  <Fold>
    <p class="help">Sharpness. <b>Auto</b> draws at your screen's full density, and gives a little up only if the frame rate stays low — currently {stats.renderScale.toFixed(2)}×.</p>
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
    background: radial-gradient(ellipse at 50% 62%, #c9cfae, #8e9a77 70%, #6f7b5c);
    padding: 2rem;
  }

  .card {
    max-width: 30rem;
    text-align: center;
    color: var(--chalk);
  }

  .card h2 {
    font-family: var(--serif);
    font-size: 1.4rem;
    font-weight: 560;
    margin-bottom: 0.6rem;
  }

  .card p {
    font-size: 0.86rem;
    line-height: 1.6;
    opacity: 0.85;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    font-family: var(--serif);
    font-style: italic;
    font-size: 1.05rem;
    color: var(--chalk);
  }

  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50% 50% 45% 55%;
    background: var(--chalk);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  /* ------------------------------------------------------------- HUD */

  /*
   * Nothing white sits on the scene. The name is written straight onto it, the
   * buttons are pebbles of frost, and every surface lets the scene through.
   */
  .brand {
    position: absolute;
    top: 1.05rem;
    left: 1.3rem;
    color: var(--chalk);
    text-shadow: 0 1px 14px rgba(20, 14, 6, 0.45), 0 1px 2px rgba(20, 14, 6, 0.3);
    pointer-events: none;
  }

  .brand h1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--serif);
    font-size: 1.6rem;
    font-weight: 540;
    font-variation-settings: 'SOFT' 100, 'opsz' 48;
    letter-spacing: -0.01em;
    line-height: 1;
  }

  .brand h1 :global(svg) {
    filter: drop-shadow(0 1px 6px rgba(20, 14, 6, 0.4));
  }

  .readout {
    display: flex;
    gap: 0.7rem;
    margin: 0.35rem 0 0 2.1rem;
    font-size: 0.68rem;
    font-weight: 500;
    color: rgba(251, 246, 236, 0.72);
    font-variant-numeric: tabular-nums;
  }

  .readout b {
    color: var(--chalk);
    font-weight: 700;
  }

  .readout .warn {
    color: #ffd2a8;
  }

  .actions {
    position: absolute;
    top: 1rem;
    right: 1.1rem;
    display: flex;
    gap: 0.5rem;
  }

  .round {
    width: 2.65rem;
    height: 2.55rem;
    display: grid;
    place-items: center;
    text-decoration: none;
    color: var(--ink);
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    border: none;
    box-shadow: var(--rim), 0 8px 18px rgba(28, 20, 10, 0.18);
    cursor: pointer;
    transition:
      transform 0.3s cubic-bezier(0.25, 0.8, 0.3, 1.3),
      background 0.25s;
  }

  .round:nth-child(1) { border-radius: 52% 48% 55% 45% / 47% 55% 45% 53%; }
  .round:nth-child(2) { border-radius: 46% 54% 49% 51% / 55% 46% 54% 45%; }
  .round:nth-child(3) { border-radius: 55% 45% 51% 49% / 50% 56% 44% 50%; }
  .round:nth-child(4) { border-radius: 49% 51% 45% 55% / 45% 50% 50% 55%; }
  .round:nth-child(5) { border-radius: 53% 47% 50% 50% / 48% 53% 47% 52%; }

  .round:hover {
    transform: translateY(-2px) rotate(-4deg);
    background: var(--sheen), linear-gradient(165deg, rgba(219, 182, 111, 0.5), rgba(219, 182, 111, 0.3));
  }

  .round.done {
    color: #2f5f43;
    background: var(--sheen), linear-gradient(165deg, rgba(147, 195, 160, 0.6), rgba(147, 195, 160, 0.38));
  }

  /* ----------------------------------------------------------- cards */

  .another {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    margin: 0.4rem 0 0.4rem;
    padding: 0.62rem;
    border-radius: 20px 26px 22px 24px / 24px 20px 26px 22px;
    border: none;
    background: color-mix(in srgb, var(--tone) 55%, rgba(255, 255, 255, 0.15));
    color: var(--tone-ink);
    font-family: var(--serif);
    font-size: 1rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100;
    cursor: pointer;
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.3, 1.3);
  }

  .another:hover {
    transform: translateY(-1px) rotate(-0.6deg);
  }

  .another:active :global(svg) {
    transform: rotate(40deg);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.8rem;
    margin: 0.1rem 0 0.8rem;
    font-size: 0.7rem;
    color: var(--ink-faint);
  }

  .legend b {
    font-family: var(--mono);
    font-weight: 700;
    margin-right: 0.15rem;
  }

  .k-draw { color: #4c7a2c; }
  .k-branch { color: #8a4aa6; }
  .k-turn { color: #3a6f9e; }
  .k-global { color: #2b7a70; }
  .k-num { color: #2b7a70; }

  .toggles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.3rem;
    margin: 0.3rem 0 1rem;
  }

  .tiles {
    display: grid;
    gap: 0.5rem;
    margin: 0.25rem 0 0.75rem;
  }

  .tiles.three {
    grid-template-columns: repeat(3, 1fr);
  }

  .tiles.four {
    grid-template-columns: repeat(4, 1fr);
  }

  .weather-art {
    filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.5));
  }

  .blurb {
    margin: 0.1rem 0 0.6rem;
    font-family: var(--serif);
    font-style: italic;
    font-size: 0.9rem;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink-dim);
    text-align: center;
  }

  .segmented {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.9rem;
    padding: 0.22rem;
    border-radius: 16px 20px 18px 14px;
    background: rgba(255, 255, 255, 0.16);
  }

  .segmented button {
    flex: 1;
    padding: 0.36rem 0;
    border-radius: 13px 16px 14px 12px;
    border: none;
    background: transparent;
    color: var(--ink-dim);
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
  }

  .segmented button:hover {
    color: var(--ink);
  }

  .segmented button.active {
    background: color-mix(in srgb, var(--tone) 65%, transparent);
    color: var(--tone-ink);
  }

  .sub {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 1rem 0 0.6rem;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink-dim);
  }

  .sub:first-of-type {
    margin-top: 0.3rem;
  }

  .help {
    margin-bottom: 0.8rem;
    font-size: 0.78rem;
    line-height: 1.55;
    color: var(--ink-dim);
  }

  .card code {
    font-family: var(--mono);
    font-size: 0.92em;
    color: var(--tone-ink);
  }

  .field {
    display: block;
    margin-bottom: 0.7rem;
  }

  .field span {
    display: block;
    margin-bottom: 0.35rem;
    font-family: var(--serif);
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--ink-dim);
  }

  .mono {
    font-family: var(--mono);
  }

  .apply {
    width: 100%;
    padding: 0.6rem;
    border-radius: 20px 26px 22px 24px / 24px 20px 26px 22px;
    border: none;
    background: rgba(255, 255, 255, 0.14);
    color: var(--ink-faint);
    font-family: var(--serif);
    font-size: 0.98rem;
    font-weight: 500;
    cursor: default;
  }

  .apply.dirty {
    background: color-mix(in srgb, var(--tone) 60%, rgba(255, 255, 255, 0.2));
    color: var(--tone-ink);
    cursor: pointer;
  }

  .issues {
    margin-top: 0.7rem;
    padding: 0.6rem 0.8rem;
    border-radius: 14px 18px 15px 17px;
    background: rgba(217, 156, 166, 0.35);
    list-style: none;
  }

  .issues li {
    font-size: 0.76rem;
    line-height: 1.5;
    color: #6e2f3a;
  }

  .issues b {
    font-weight: 700;
    margin-right: 0.3rem;
  }

  @media (max-width: 640px) {
    .readout {
      display: none;
    }
  }
</style>
