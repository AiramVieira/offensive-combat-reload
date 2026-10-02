// Live tuning panel (F6): a slider for every number of the "feel" configs (first-person VM_FEEL, third-person
// ANIM), changed in place while playing, and a button to copy the result as JSON to paste back into code.
// A dev tool: plain DOM, no dependency.

type Tree = { [key: string]: number | number[] | Tree | string | boolean };

const STYLE = `
.tuning { position: fixed; top: 10px; right: 10px; z-index: 50; width: 340px; max-height: calc(100vh - 20px); overflow-y: auto;
  background: rgba(20, 18, 30, 0.92); color: #f3efe6; font: 12px/1.3 system-ui, sans-serif; border-radius: 10px; padding: 10px 12px; }
.tuning h4 { margin: 10px 0 4px; font-size: 12px; text-transform: uppercase; color: #ffb35c; }
.tuning h5 { margin: 6px 0 2px; font-size: 11px; color: #9fd4ff; }
.tuning label { display: grid; grid-template-columns: 110px 1fr 52px; gap: 6px; align-items: center; }
.tuning input[type=range] { width: 100%; }
.tuning .row { display: flex; gap: 6px; margin-bottom: 6px; }
.tuning button { flex: 1; padding: 4px; border-radius: 6px; border: 0; cursor: pointer; font-weight: 700; }
`;

/** Slider range for a starting value: up to 3× it (and through zero for negative values). */
function range(v: number): [number, number, number] {
  const m = Math.max(Math.abs(v) * 3, 0.01);
  const lo = v < 0 ? -m : 0;
  const hi = v < 0 ? m * 0.25 : m;
  return [lo, hi, (hi - lo) / 400];
}

export class TuningPanel {
  private el: HTMLDivElement | null = null;
  private original: Record<string, string>;

  constructor(
    private sections: Record<string, Tree>,
    /** Called after any change, with the section's name (e.g. to re-tune springs). */
    private onChange: (section: string) => void = () => {},
  ) {
    this.original = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, JSON.stringify(v)]));
  }

  get open() {
    return !!this.el;
  }

  toggle() {
    if (this.el) {
      this.el.remove();
      this.el = null;
      return;
    }
    if (!document.getElementById('tuning-style')) {
      const st = document.createElement('style');
      st.id = 'tuning-style';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'tuning';
    this.render();
    document.body.appendChild(this.el);
  }

  private render() {
    const el = this.el!;
    el.innerHTML = '';
    const buttons = document.createElement('div');
    buttons.className = 'row';
    const copy = document.createElement('button');
    copy.textContent = 'Copiar JSON';
    copy.onclick = () => void navigator.clipboard?.writeText(JSON.stringify(this.sections, null, 2)).catch(() => console.log(this.sections));
    const reset = document.createElement('button');
    reset.textContent = 'Restaurar';
    reset.onclick = () => {
      for (const [name, json] of Object.entries(this.original)) {
        restore(this.sections[name], JSON.parse(json));
        this.onChange(name);
      }
      this.render();
    };
    buttons.append(copy, reset);
    el.appendChild(buttons);
    for (const [name, tree] of Object.entries(this.sections)) {
      const h = document.createElement('h4');
      h.textContent = name;
      el.appendChild(h);
      this.renderTree(tree, name, el);
    }
  }

  private renderTree(tree: Tree, section: string, parent: HTMLElement) {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === 'number') parent.appendChild(this.slider(key, value, (v) => (tree[key] = v), section));
      else if (Array.isArray(value)) value.forEach((v, i) => parent.appendChild(this.slider(`${key}[${i}]`, v, (x) => (value[i] = x), section)));
      else if (value && typeof value === 'object') {
        const h = document.createElement('h5');
        h.textContent = key;
        parent.appendChild(h);
        this.renderTree(value, section, parent);
      }
    }
  }

  private slider(label: string, value: number, set: (v: number) => void, section: string): HTMLElement {
    const [lo, hi, step] = range(value);
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('span');
    out.textContent = value.toFixed(4);
    input.oninput = () => {
      const v = Number(input.value);
      set(v);
      out.textContent = v.toFixed(4);
      this.onChange(section);
    };
    row.append(name, input, out);
    return row;
  }
}

/** Copies the saved values back into the live config (same shape). */
function restore(target: Tree, saved: Tree) {
  for (const [k, v] of Object.entries(saved)) {
    const cur = target[k];
    if (Array.isArray(v) && Array.isArray(cur)) v.forEach((x, i) => (cur[i] = x as number));
    else if (v && typeof v === 'object' && cur && typeof cur === 'object' && !Array.isArray(cur)) restore(cur as Tree, v as Tree);
    else target[k] = v;
  }
}
