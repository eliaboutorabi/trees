<script lang="ts" module>
  /**
   * Tokens for the L-system grammar, in the order they are tried. Each is
   * anchored, so the scanner walks the text once.
   */
  const RULES: [RegExp, string][] = [
    [/^#[^\n]*/, 'comment'],
    [/^->/, 'arrow'],
    [/^@p\b/, 'pool'],
    [/^(&&|\|\||>=|<=|==|!=)/, 'op'],
    [/^\d+(\.\d+)?/, 'num'],
    [/^(ANG|LEN|SHRINK|N|n)\b/, 'global'],
    [/^rand\b/, 'fn'],
    [/^[[\]]/, 'branch'],
    [/^[+\-&^/\\|]/, 'turn'],
    [/^F(?=\(|\b|[^a-zA-Z])/, 'draw'],
    [/^[A-Z!][A-Za-z0-9_]*/, 'module'],
    [/^:/, 'arrow'],
  ];

  function escape(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  export function highlight(src: string): string {
    let out = '';
    let i = 0;
    let plain = '';
    while (i < src.length) {
      const rest = src.slice(i);
      let hit = false;
      for (const [re, cls] of RULES) {
        const m = re.exec(rest);
        if (m) {
          out += escape(plain);
          plain = '';
          out += `<span class="t-${cls}">${escape(m[0])}</span>`;
          i += m[0].length;
          hit = true;
          break;
        }
      }
      if (!hit) {
        plain += src[i];
        i++;
      }
    }
    return out + escape(plain);
  }
</script>

<script lang="ts">
  /**
   * The grammar editor: a plain textarea, transparent, over a coloured copy of
   * the same text. Editing, selection, undo and the caret are all the browser's
   * own; the colours are just a picture drawn underneath. Lines the parser
   * complained about are tinted red. ⌘/Ctrl+Enter applies.
   */
  interface Props {
    value: string;
    rows?: number;
    /** 1-based line numbers to mark as having a problem. */
    errorLines?: number[];
    label: string;
    onsubmit?: () => void;
  }

  import { cut } from './paper';

  let { value = $bindable(), rows = 12, errorLines = [], label, onsubmit }: Props = $props();

  const lines = $derived(value.split('\n'));
  const bad = $derived(new Set(errorLines));
  let under = $state<HTMLPreElement>();

  function sync(e: Event) {
    const t = e.currentTarget as HTMLTextAreaElement;
    if (under) {
      under.scrollTop = t.scrollTop;
      under.scrollLeft = t.scrollLeft;
    }
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onsubmit?.();
    }
  }
</script>

<div class="editor" style:--rows={rows} use:cut={{ seed: label, inset: 2, radius: [10, 20], bulge: [-0.5, 2] }}>
  <pre bind:this={under} aria-hidden="true">{#each lines as line, i (i)}<span class="line" class:bad={bad.has(i + 1)}
        >{@html highlight(line)}{'\n'}</span
      >{/each}</pre>
  <textarea bind:value spellcheck="false" aria-label={label} onscroll={sync} onkeydown={key} {rows}></textarea>
</div>

<style>
  .editor {
    position: relative;
    height: calc(var(--rows) * 1.55em + 1.2rem);
    font-family: var(--mono);
    font-size: 0.7rem;
    line-height: 1.55;
    border-radius: 16px 19px 15px 18px / 18px 15px 19px 16px;
    background: rgba(38, 31, 25, 0.8);
    border: none;
  }

  .editor:focus-within {
    background: rgba(38, 31, 25, 0.86);
  }

  /* The two layers must lay text out identically, character for character. */
  pre,
  textarea {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0.6rem 0.7rem;
    border: none;
    font: inherit;
    line-height: inherit;
    letter-spacing: 0;
    tab-size: 2;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    overflow: auto;
    box-sizing: border-box;
  }

  pre {
    color: #e9dccb;
    pointer-events: none;
    scrollbar-width: none;
  }

  pre::-webkit-scrollbar {
    display: none;
  }

  textarea {
    resize: none;
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
    outline: none;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  textarea::selection {
    background: rgba(240, 176, 100, 0.3);
    color: transparent;
  }

  .line.bad {
    background: rgba(255, 90, 70, 0.16);
    box-shadow: inset 2px 0 0 #ff6a52;
  }

  pre :global(.t-comment) {
    color: rgba(255, 246, 236, 0.32);
    font-style: italic;
  }
  pre :global(.t-arrow) {
    color: var(--accent);
    font-weight: 600;
  }
  pre :global(.t-pool) {
    color: var(--accent);
  }
  pre :global(.t-draw) {
    color: #9fd36b;
    font-weight: 600;
  }
  pre :global(.t-module) {
    color: #f0d27a;
  }
  pre :global(.t-turn) {
    color: #79b8ff;
  }
  pre :global(.t-branch) {
    color: #e9a7ff;
    font-weight: 600;
  }
  pre :global(.t-num) {
    color: #ff9e64;
  }
  pre :global(.t-global) {
    color: #7fdbca;
  }
  pre :global(.t-fn) {
    color: #82aaff;
    font-style: italic;
  }
  pre :global(.t-op) {
    color: #c3a6ff;
  }
</style>
