/**
 * Make the garden's sounds with ElevenLabs.
 *
 *   node scripts/sounds/generate.ts            the first pass (tier 1), only what is missing
 *   node scripts/sounds/generate.ts --dry      what would be made, and roughly what it costs
 *   node scripts/sounds/generate.ts --only fish-plop,rain-light [--force]
 *   node scripts/sounds/generate.ts --tier all
 *   node scripts/sounds/generate.ts --process  re-level everything from the cache, no API calls
 *
 * The key comes from ELEVENLABS_API_KEY in .env.local, which git ignores; it
 * is only ever sent to api.elevenlabs.io. What comes back is kept untouched in
 * .sound-cache/ (also ignored), so re-levelling never costs a credit, and the
 * finished files go to public/sounds/:
 *
 *   - one-shots have their leading silence trimmed, so they sound the instant
 *     they are triggered, and their trailing silence too, with a few
 *     milliseconds of fade at the end;
 *   - everything is measured (EBU R128) and brought to its layer's loudness
 *     with a plain gain, never a compressor, so a loop's seam is not disturbed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, filesOf, type SoundSpec } from '../../src/render/sound/manifest.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.sound-cache');
const OUT = join(ROOT, 'public', 'sounds');
const API = 'https://api.elevenlabs.io';

/** Integrated loudness each kind is brought to, in LUFS, before its own `level`. */
const TARGET: Record<SoundSpec['kind'], number> = { bed: -27, shot: -21, music: -21 };

// ------------------------------------------------------------------ args
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = option('only')?.split(',').map((s) => s.trim());
const tier = option('tier') ?? '1';
const dry = flag('dry');
const force = flag('force');
const processOnly = flag('process');
// The Starter plan allows two requests in flight at once.
const concurrency = Number(option('concurrency') ?? 2);

function apiKey(): string {
  const env = join(ROOT, '.env.local');
  if (!existsSync(env)) throw new Error('No .env.local with ELEVENLABS_API_KEY.');
  const line = readFileSync(env, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('ELEVENLABS_API_KEY='));
  const key = line?.slice('ELEVENLABS_API_KEY='.length).trim();
  if (!key) throw new Error('ELEVENLABS_API_KEY is empty.');
  return key;
}

async function credits(key: string): Promise<number | null> {
  const res = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key } });
  if (!res.ok) return null;
  const data = (await res.json()) as { character_count?: number };
  return data.character_count ?? null;
}

// ------------------------------------------------------------- generate
async function generate(key: string, spec: SoundSpec): Promise<Buffer> {
  if (spec.kind === 'music') {
    const res = await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: spec.prompt,
        music_length_ms: Math.round(spec.seconds * 1000),
        model_id: 'music_v2_5',
        force_instrumental: true,
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const res = await fetch(`${API}/v1/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: spec.prompt,
      duration_seconds: spec.seconds,
      prompt_influence: spec.influence ?? 0.4,
      loop: spec.kind === 'bed',
      model_id: 'eleven_text_to_sound_v3',
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Too many requests at once is the plan's limit, not a fault: wait and ask again. */
async function retrying<T>(make: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await make();
    } catch (e) {
      if (attempt >= 5 || !String(e).includes('429')) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
}

// --------------------------------------------------------------- level
function loudness(file: string): number {
  // loudnorm's measuring pass prints its findings as JSON on stderr.
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(run.stderr ?? '');
  const measured = json ? Number(JSON.parse(json[0]).input_i) : NaN;
  return Number.isFinite(measured) ? measured : -30;
}

function finish(spec: SoundSpec, raw: string, out: string): void {
  const filters: string[] = [];
  if (spec.kind === 'shot') {
    filters.push('silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.02');
    // The same from the end, but listening further down, so a reverb tail stays.
    filters.push('areverse,silenceremove=start_periods=1:start_threshold=-62dB:start_silence=0.12,afade=t=in:d=0.04,areverse');
  }
  const measured = loudness(raw);
  const gain = TARGET[spec.kind] + (spec.level ?? 0) - measured;
  filters.push(`volume=${gain.toFixed(2)}dB`);
  filters.push('alimiter=limit=0.85:level=false');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', spec.kind === 'music' ? '128k' : '112k', out]);
}

// ----------------------------------------------------------------- run
async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const wanted = SOUNDS.filter((s) => (only ? only.includes(s.id) : tier === 'all' || String(s.tier) === tier));
  const jobs: { spec: SoundSpec; file: string }[] = [];
  for (const spec of wanted) for (const file of filesOf(spec)) jobs.push({ spec, file });

  const toMake = jobs.filter((j) => force || !existsSync(join(CACHE, j.file)));
  const sfxSeconds = toMake.filter((j) => j.spec.kind !== 'music').reduce((t, j) => t + j.spec.seconds, 0);
  const musicSeconds = toMake.filter((j) => j.spec.kind === 'music').reduce((t, j) => t + j.spec.seconds, 0);
  console.log(`${jobs.length} files wanted, ${processOnly ? 0 : toMake.length} to generate (${sfxSeconds.toFixed(1)} s of effects ≈ ${Math.round(sfxSeconds * 40)} credits, ${musicSeconds} s of music).`);
  if (dry) {
    for (const j of toMake) console.log(`  ${j.file.padEnd(28)} ${j.spec.kind.padEnd(5)} ${j.spec.seconds}s`);
    return;
  }

  const key = processOnly ? '' : apiKey();
  const before = processOnly ? null : await credits(key);

  if (!processOnly) {
    let next = 0;
    let made = 0;
    const failed: string[] = [];
    const worker = async () => {
      while (next < toMake.length) {
        const job = toMake[next++];
        try {
          const audio = await retrying(() => generate(key, job.spec));
          writeFileSync(join(CACHE, job.file), audio);
          made++;
          console.log(`  made ${job.file} (${made}/${toMake.length})`);
        } catch (e) {
          failed.push(job.file);
          console.error(`  FAILED ${job.file}: ${String(e).slice(0, 300)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    if (failed.length) console.error(`${failed.length} failed: ${failed.join(', ')}`);
  }

  for (const job of jobs) {
    const raw = join(CACHE, job.file);
    if (!existsSync(raw)) continue;
    finish(job.spec, raw, join(OUT, job.file));
  }
  console.log(`Levelled into public/sounds/.`);

  if (before !== null) {
    const after = await credits(key);
    if (after !== null) console.log(`Credits used: ${after - before}.`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
