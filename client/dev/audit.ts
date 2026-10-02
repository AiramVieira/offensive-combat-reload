// The style guide's per-item checklist, automated (lab: ?audit=1[&category=<c>]): every ready item of the
// catalog is built for both bodies at the three levels of detail and checked for what code can check — the
// triangle budget of its category, broken geometry (NaN, degenerate faces), parts flying off the body, color
// channels the catalog doesn't offer for it, a registry entry, and that the far levels are lighter. What the
// eye must judge (silhouette, folds, thickness on the edges) stays in the grids (?items=<category>).
import * as THREE from 'three';
import { CATALOG, type CatalogItem, type Category } from '@shared/catalog';
import type { Sex } from '@shared/protocol';
import { withLod } from '../character/builder';
import { TINT } from '../character/palette';
import { buildPiece } from '../character/pieces';
import { AssetRegistry } from '../character/registry';

/** Triangle budget of each category (style guide), LOD0, per body. */
export const BUDGETS: Record<Category, [number, number]> = {
  cabelo: [100, 800],
  barba: [20, 300],
  camiseta: [200, 900],
  blusa: [300, 900],
  jaqueta: [300, 1000],
  calca: [250, 700],
  short: [150, 700],
  calcado: [0, 450],
  cabeca: [40, 450],
  acessorio: [20, 400],
  tatico: [40, 800],
};

export interface AuditRow {
  id: string;
  category: Category;
  name: string;
  /** LOD0/1/2 triangles, male body. */
  m: number[];
  f: number[];
  problems: string[];
  notes: string[];
}

const CHANNEL_OF_TINT: Record<number, 'S' | 'D'> = { [TINT.secondary]: 'S', [TINT.detail]: 'D' };

function check(it: CatalogItem): AuditRow {
  const row: AuditRow = { id: it.id, category: it.category, name: it.name.pt, m: [], f: [], problems: [], notes: [] };
  const def = AssetRegistry.get(it.id);
  if (!def) {
    row.problems.push('sem entrada no registro');
    return row;
  }
  if (def.url) {
    row.notes.push('GLB (não auditado)');
    return row;
  }
  if (!def.generator) {
    row.problems.push('sem gerador nem url');
    return row;
  }
  const [lo, hi0] = BUDGETS[it.category];
  // Items taking more slots get those slots' budget too (a hoodie with a balaclava); items that replace a body
  // part get its triangles back (full gloves replace the hands, ~130 each).
  const hi = hi0 + 300 * Math.max(0, it.slots.length - 1) + (def.hides?.includes('hand_L') ? 130 : 0) + (def.hides?.includes('hand_R') ? 130 : 0);
  const tintsUsed = new Set<number>();
  for (const sex of ['m', 'f'] as Sex[]) {
    for (const lod of [0, 1, 2]) {
      let g;
      try {
        g = withLod(lod, () => buildPiece(def.generator!, it.id, sex, false));
      } catch (e) {
        row.problems.push(`erro ao gerar (${sex}, LOD${lod}): ${(e as Error).message}`);
        continue;
      }
      let tris = 0;
      for (const [kind, geo] of [['skinned', g.skinned], ['rigid', g.rigid]] as const) {
        if (!geo) continue;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        tris += pos.count / 3;
        if (lod > 0) continue;
        let nan = 0;
        let degenerate = 0;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const box = new THREE.Box3();
        for (let i = 0; i < pos.count; i += 3) {
          a.fromBufferAttribute(pos, i);
          b.fromBufferAttribute(pos, i + 1);
          c.fromBufferAttribute(pos, i + 2);
          if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(Number.isFinite)) {
            nan++;
            continue;
          }
          box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
          if (b.clone().sub(a).cross(c.clone().sub(a)).length() < 1e-9) degenerate++;
        }
        if (nan) row.problems.push(`${nan} triângulos com NaN (${sex})`);
        if (degenerate > pos.count / 3 / 20) row.notes.push(`${degenerate} triângulos degenerados (${sex})`);
        // Skinned pieces are in character space (feet at y = 0, 1.80 m tall); rigid ones near their socket.
        const size = box.getSize(new THREE.Vector3());
        if (pos.count && kind === 'skinned' && (box.min.y < -0.06 || box.max.y > 2.2 || Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) > 1.1 || Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) > 0.9)) {
          row.problems.push(`fora do corpo (${sex}): y ${box.min.y.toFixed(2)}…${box.max.y.toFixed(2)}, x ±${Math.max(-box.min.x, box.max.x).toFixed(2)}, z ±${Math.max(-box.min.z, box.max.z).toFixed(2)}`);
        }
        if (pos.count && kind === 'rigid' && Math.max(size.x, size.y, size.z) > 1.2) row.problems.push(`peça rígida grande demais (${sex}): ${Math.max(size.x, size.y, size.z).toFixed(2)} m`);
        const tint = geo.getAttribute('_tint') as THREE.BufferAttribute | undefined;
        if (tint) for (let i = 0; i < tint.count; i++) tintsUsed.add(Math.round(tint.getX(i)));
      }
      (sex === 'm' ? row.m : row.f)[lod] = tris;
    }
  }
  const worst = Math.max(row.m[0] ?? 0, row.f[0] ?? 0);
  if (worst > hi) row.problems.push(`acima do orçamento (${worst} > ${hi})`);
  else if (worst < lo && it.id !== 'descalco') row.notes.push(`abaixo do mínimo (${worst} < ${lo})`);
  for (const arr of [row.m, row.f]) if (arr[2] !== undefined && arr[0] && arr[2] > arr[0]) row.problems.push('LOD2 mais pesado que LOD0');
  // Hair and beards have no player channels in the catalog (ties take the registry's detail on purpose).
  if (it.category !== 'cabelo' && it.category !== 'barba') for (const t of tintsUsed) {
    const ch = CHANNEL_OF_TINT[t];
    if (ch && !it.channels.includes(ch)) row.notes.push(`usa o canal ${ch} (fora do catálogo: cor padrão do registro)`);
  }
  return row;
}

/** Audits every ready item (or one category). */
export function audit(category?: Category | null): AuditRow[] {
  return CATALOG.filter((i) => i.ready && (!category || i.category === category)).map(check);
}

/** The audit as an HTML table (problems in red, notes in amber), with a summary per category. */
export function auditHtml(rows: AuditRow[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const byCat = new Map<Category, AuditRow[]>();
  for (const r of rows) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  const summary = [...byCat].map(([c, list]) => {
    const t = list.map((r) => Math.max(r.m[0] ?? 0, r.f[0] ?? 0));
    const bad = list.filter((r) => r.problems.length).length;
    return `<tr><td>${c}</td><td>${list.length}</td><td>${Math.min(...t)}–${Math.max(...t)}</td><td>${BUDGETS[c].join('–')}</td><td style="color:${bad ? '#ff6b5c' : '#7ddc8a'}">${bad}</td></tr>`;
  });
  const body = rows.map(
    (r) =>
      `<tr><td>${r.category}</td><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${r.m.join(' / ')}</td><td>${r.f.join(' / ')}</td>` +
      `<td style="color:#ff6b5c">${r.problems.map(esc).join('<br>')}</td><td style="color:#ffc857">${r.notes.map(esc).join('<br>')}</td></tr>`,
  );
  const total = rows.filter((r) => r.problems.length).length;
  return (
    `<h2>Checklist automático: ${rows.length} itens, <span id="audit-fail">${total}</span> com problema</h2>` +
    `<table><tr><th>categoria</th><th>itens</th><th>triângulos</th><th>orçamento</th><th>com problema</th></tr>${summary.join('')}</table><br>` +
    `<table><tr><th>categoria</th><th>id</th><th>nome</th><th>m: LOD0/1/2</th><th>f: LOD0/1/2</th><th>problemas</th><th>notas</th></tr>${body.join('')}</table>`
  );
}
