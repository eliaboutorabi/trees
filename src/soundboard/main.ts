/**
 * The sound board: every sound in the garden, each take on its own, with the
 * prompt that made it — for listening through them and saying which to keep.
 * Served by the dev server at /sounds.html; the build leaves it out.
 *
 * Beds loop (crossfaded, as the garden plays them) until stopped. Levels are
 * as the files are: the garden then sets each one's place in the mix.
 */
import { SOUNDS, filesOf, type SoundSpec } from '../render/sound/manifest';

const GROUPS: [string, (s: SoundSpec) => boolean][] = [
  ['The air of the place', (s) => s.id.startsWith('bed-')],
  ['Wind and the tree’s voice', (s) => s.id.startsWith('wind-') || s.id.startsWith('rustle-')],
  ['Weather', (s) => /^(rain|snow|thunder)/.test(s.id)],
  ['The pond', (s) => /^(pond|fish|duck-dabble|duck-paddle|ice)/.test(s.id)],
  ['Creatures', (s) => /^(dove|songbird|chickadee|duck-quack|drake|duckling|bee|crow|geese|owl)/.test(s.id)],
  ['The tree', (s) => /^(grow|tree|leaf|apple|berry|cone)/.test(s.id)],
  ['Music', (s) => s.kind === 'music'],
  ['Interface', (s) => s.id.startsWith('ui-')],
];

let ctx: AudioContext | null = null;
let playing: { stop(): void; button: HTMLButtonElement } | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

function audio(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function load(file: string): Promise<AudioBuffer> {
  let p = buffers.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}sounds/${file}`)
      .then((r) => r.arrayBuffer())
      .then((d) => audio().decodeAudioData(d));
    buffers.set(file, p);
  }
  return p;
}

async function play(file: string, loop: boolean, button: HTMLButtonElement): Promise<void> {
  const was = playing?.button;
  playing?.stop();
  playing = null;
  if (was === button) return;
  const c = audio();
  await c.resume();
  const b = await load(file);
  const out = c.createGain();
  out.connect(c.destination);
  const sources: AudioBufferSourceNode[] = [];
  let timer = 0;
  const start = (at: number) => {
    const src = c.createBufferSource();
    src.buffer = b;
    const env = c.createGain();
    const fade = loop ? Math.min(1.5, b.duration * 0.2) : 0;
    env.gain.setValueAtTime(fade ? 0 : 1, at);
    if (fade) env.gain.linearRampToValueAtTime(1, at + fade);
    if (fade) env.gain.setValueAtTime(1, at + b.duration - fade);
    if (fade) env.gain.linearRampToValueAtTime(0, at + b.duration);
    src.connect(env).connect(out);
    src.start(at);
    sources.push(src);
    if (loop) {
      const next = at + b.duration - fade;
      timer = window.setTimeout(() => start(next), (next - c.currentTime - 0.5) * 1000);
    } else {
      src.onended = () => {
        if (playing?.button === button) {
          button.classList.remove('on');
          playing = null;
        }
      };
    }
  };
  start(c.currentTime + 0.02);
  button.classList.add('on');
  playing = {
    button,
    stop() {
      clearTimeout(timer);
      out.gain.setTargetAtTime(0, c.currentTime, 0.05);
      for (const s of sources) s.stop(c.currentTime + 0.3);
      button.classList.remove('on');
    },
  };
}

function render(): void {
  const board = document.getElementById('board')!;
  board.innerHTML = `<h1>The garden’s sounds</h1><p class="lede">Every sound and every take, with the prompt it was made from. Beds loop until stopped; one-shots play once. Tell me the file names to change.</p>`;
  for (const [title, test] of GROUPS) {
    const specs = SOUNDS.filter(test);
    if (!specs.length) continue;
    const section = document.createElement('section');
    section.innerHTML = `<h2>${title}</h2>`;
    for (const spec of specs) {
      const row = document.createElement('div');
      row.className = 'row';
      const takes = document.createElement('div');
      takes.className = 'takes';
      for (const file of filesOf(spec)) {
        const b = document.createElement('button');
        b.textContent = file.replace('.mp3', '');
        b.title = file;
        b.onclick = () => void play(file, spec.kind === 'bed', b);
        takes.append(b);
      }
      const about = document.createElement('div');
      about.className = 'about';
      about.innerHTML = `<span class="kind ${spec.kind}">${spec.kind === 'bed' ? 'loop' : spec.kind}</span> <span class="secs">${spec.seconds}s${spec.tier === 2 ? ' · second pass' : ''}</span><p>${spec.prompt}</p>`;
      row.append(takes, about);
      section.append(row);
    }
    board.append(section);
  }
}

const style = document.createElement('style');
style.textContent = `
  body { margin: 0; background: #f4efe4; color: #2d2a22; font: 15px/1.45 Figtree, system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 2.2rem 1.4rem 4rem; }
  h1 { font: 600 2rem/1.1 Fraunces, Georgia, serif; margin: 0 0 .4rem; }
  .lede { color: #6b6455; margin: 0 0 1.8rem; }
  h2 { font: 600 1.2rem Fraunces, Georgia, serif; margin: 2rem 0 .6rem; color: #4d5a2c; }
  .row { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: 1rem; padding: .7rem 0; border-top: 1px solid #e3dccb; }
  .takes { display: flex; flex-wrap: wrap; gap: .4rem; align-content: start; }
  button { font: 500 13px Figtree, system-ui, sans-serif; border: 0; border-radius: 999px; padding: .45rem .8rem; background: #fffaf0; color: #3a3528; box-shadow: 0 1px 0 #d9cfb8, 0 2px 8px rgba(60,50,20,.08); cursor: pointer; }
  button:hover { background: #fff; }
  button.on { background: #8fb34f; color: #fff; }
  .about p { margin: .2rem 0 0; color: #5d574a; font-size: 13.5px; }
  .kind { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: .1rem .45rem; border-radius: 4px; background: #e7e0cf; }
  .kind.music { background: #e3d3ef; } .kind.shot { background: #f0dccb; } .kind.bed { background: #d5e5cf; }
  .secs { color: #8a8371; font-size: 12px; }
`;
document.head.append(style);
render();
