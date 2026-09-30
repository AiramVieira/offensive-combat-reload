// Character editor (Perfil → Personalizar): body (height, build, skin), hair, the eight clothing slots with
// colors and the PCD mode, with a live 3D preview and what each choice does in the game.
import * as THREE from 'three';
import {
  ARM_LOSSES,
  BUILDS,
  CATALOG,
  defaultAppearance,
  HAIR,
  HAIR_COLORS,
  HEIGHTS,
  LEG_LOSSES,
  SKIN_TONES,
  SLOTS,
  bodyStats,
  hitboxSize,
  type Appearance,
  type Slot,
} from '@shared/appearance';
import { MOVE } from '@shared/constants';
import type { Sex } from '@shared/protocol';
import { Avatar } from '../entities/avatar';
import { api } from '../net/api';
import { errorText } from './auth';
import { getLang } from './strings';

/** Labels in pt-BR and en (the editor has many; they live here instead of strings.ts). */
const L: Record<string, [string, string]> = {
  title: ['Personalizar personagem', 'Customize character'],
  body: ['Corpo', 'Body'],
  height: ['Altura', 'Height'],
  build: ['Biotipo', 'Build'],
  skin: ['Cor da pele', 'Skin color'],
  hair: ['Cabelo', 'Hair'],
  hairColor: ['Cor do cabelo', 'Hair color'],
  clothes: ['Roupas', 'Clothes'],
  pcd: ['Modo PCD', 'PCD mode'],
  pcdHint: ['Personagem sem um braço, uma mão ou uma perna. Hitbox menor; sem mão ou braço recarrega 30% mais devagar, sem perna anda 25% mais devagar.', 'A character missing an arm, a hand or a leg. Smaller hitbox; no hand or arm reloads 30% slower, no leg moves 25% slower.'],
  arm: ['Braço ou mão', 'Arm or hand'],
  leg: ['Perna', 'Leg'],
  save: ['SALVAR', 'SAVE'],
  cancel: ['Cancelar', 'Cancel'],
  reset: ['Restaurar padrão', 'Reset to default'],
  saved: ['Personagem salvo.', 'Character saved.'],
  effects: ['No jogo', 'In the game'],
  health: ['Vida', 'Health'],
  eye: ['Altura da visão', 'Eye height'],
  reload: ['Recarga', 'Reload'],
  speed: ['Velocidade', 'Speed'],
  hitbox: ['Hitbox', 'Hitbox'],
  dragHint: ['Arraste para girar', 'Drag to rotate'],
  none: ['Nenhum', 'None'],
  noneF: ['Nenhuma', 'None'],
  pants: ['Calças', 'Pants'],
  shorts: ['Bermudas', 'Shorts'],
  skirts: ['Saias', 'Skirts'],
  // Body
  pequeno: ['Pequeno', 'Short'],
  medio: ['Médio', 'Medium'],
  alto: ['Alto', 'Tall'],
  magro: ['Magro', 'Slim'],
  gordo: ['Gordo', 'Heavy'],
  // Slots
  camiseta: ['Camiseta', 'Shirt'],
  baixo: ['Calça, bermuda ou saia', 'Pants, shorts or skirt'],
  sapatos: ['Sapatos', 'Shoes'],
  chapeu: ['Chapéu', 'Hat'],
  oculos: ['Óculos', 'Glasses'],
  pulseira: ['Pulseira', 'Bracelet'],
  // Pieces
  basica: ['Básica', 'Basic tee'],
  regata: ['Regata', 'Tank top'],
  polo: ['Polo', 'Polo'],
  calcaJeans: ['Calça jeans', 'Jeans'],
  calcaCargo: ['Calça cargo', 'Cargo pants'],
  calcaMoletom: ['Calça de moletom', 'Sweatpants'],
  bermudaPraia: ['Bermuda de praia', 'Board shorts'],
  bermudaJeans: ['Bermuda jeans', 'Denim shorts'],
  bermudaEsportiva: ['Bermuda esportiva', 'Sport shorts'],
  saiaLapis: ['Saia lápis', 'Pencil skirt'],
  saiaRodada: ['Saia rodada', 'Circle skirt'],
  saiaPregas: ['Saia de pregas', 'Pleated skirt'],
  tenis: ['Tênis', 'Sneakers'],
  bota: ['Bota', 'Boots'],
  chinelo: ['Chinelo', 'Flip-flops'],
  bone: ['Boné', 'Cap'],
  palha: ['Chapéu de palha', 'Straw hat'],
  gorro: ['Gorro', 'Beanie'],
  escuros: ['Escuros', 'Sunglasses'],
  redondos: ['Redondos', 'Round'],
  aviador: ['Aviador', 'Aviators'],
  couro: ['Couro', 'Leather'],
  micangas: ['Miçangas', 'Beads'],
  relogio: ['Relógio', 'Watch'],
  // Hair
  curto: ['Curto', 'Short'],
  topete: ['Topete', 'Quiff'],
  blackPower: ['Black power', 'Afro'],
  rabo: ['Rabo de cavalo', 'Ponytail'],
  longo: ['Longo solto', 'Long'],
  coque: ['Coque', 'Bun'],
  // PCD
  bracoEsq: ['Sem o braço esquerdo', 'No left arm'],
  bracoDir: ['Sem o braço direito', 'No right arm'],
  maoEsq: ['Sem a mão esquerda', 'No left hand'],
  maoDir: ['Sem a mão direita', 'No right hand'],
  pernaEsq: ['Sem a perna esquerda', 'No left leg'],
  pernaDir: ['Sem a perna direita', 'No right leg'],
};
const l = (key: string) => (L[key] ?? [key, key])[getLang() === 'en' ? 1 : 0];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clone = (a: Appearance): Appearance => JSON.parse(JSON.stringify(a));

/** What the look does in the game, in one line. */
function effectsText(a: Appearance): string {
  const b = bodyStats(a);
  const parts = [
    `${l('health')} ${b.maxHealth}`,
    `${l('eye')} ${(MOVE.eyeStand * b.scale).toFixed(2).replace('.', getLang() === 'en' ? '.' : ',')} m`,
    `${l('hitbox')} ${Math.round(hitboxSize(b) * 100)}%`,
  ];
  if (b.reloadMul !== 1) parts.push(`${l('reload')} +${Math.round((b.reloadMul - 1) * 100)}%`);
  if (b.speedMul !== 1) parts.push(`${l('speed')} −${Math.round((1 - b.speedMul) * 100)}%`);
  return parts.join(' · ');
}

/** Small 3D stage that shows the avatar turning (drag to rotate). */
class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private avatar: Avatar | null = null;
  /** 0 = facing the camera. */
  private yaw = 0.5;
  private dragging = false;
  private lastX = 0;
  private raf = 0;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 4, -3);
    this.scene.add(sun);
    // Frames the tallest body with a hat (about 2.3 m) with room to spare.
    this.camera.position.set(0, 1.15, -5.6);
    this.camera.lookAt(0, 1.05, 0);
    canvas.onpointerdown = (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    };
    canvas.onpointerup = () => (this.dragging = false);
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (!this.dragging) this.yaw += dt * 0.4;
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  show(look: Appearance, sex: Sex) {
    if (this.avatar) this.disposeAvatar(this.avatar);
    this.avatar = new Avatar(this.scene, look, sex);
    this.avatar.idle();
    this.avatar.visible = true;
  }

  private disposeAvatar(a: Avatar) {
    this.scene.remove(a.root);
    a.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }

  private draw() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.avatar) this.avatar.root.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    if (this.avatar) this.disposeAvatar(this.avatar);
    this.renderer.dispose();
  }
}

interface Options {
  look: Appearance;
  sex: Sex;
  setStatus(msg: string, error?: boolean): void;
  /** Closed (saved or not): back to the profile. */
  onClose(saved: boolean): void;
}

export function showCustomizer(root: HTMLElement, o: Options) {
  let look = clone(o.look);
  const card = root.closest('.home-card');
  card?.classList.add('wide');

  const buttons = (group: string, values: readonly string[], current: string) =>
    `<div class="seg" data-group="${group}">${values.map((v) => `<button type="button" data-v="${v}" aria-pressed="${v === current}">${esc(l(v))}</button>`).join('')}</div>`;
  const swatches = (group: string, colors: readonly string[], current: string) =>
    `<div class="swatches" data-group="${group}">${colors.map((c) => `<button type="button" class="swatch" data-v="${c}" style="background:${c}" aria-pressed="${c === current}" title="${c}"></button>`).join('')}<input type="color" data-group="${group}" value="${current}" /></div>`;
  const slotSelect = (slot: Slot) => {
    const piece = look.roupas[slot];
    const opts = (ids: readonly string[]) => ids.map((id) => `<option value="${id}" ${id === piece.id ? 'selected' : ''}>${esc(id ? l(id) : l(slot === 'pulseira' || slot === 'camiseta' ? 'noneF' : 'none'))}</option>`).join('');
    const list =
      slot === 'baixo'
        ? `<optgroup label="${l('pants')}">${opts(CATALOG.baixo.filter((x) => x.startsWith('calca')))}</optgroup><optgroup label="${l('shorts')}">${opts(CATALOG.baixo.filter((x) => x.startsWith('bermuda')))}</optgroup><optgroup label="${l('skirts')}">${opts(CATALOG.baixo.filter((x) => x.startsWith('saia')))}</optgroup>`
        : opts(CATALOG[slot]);
    return `<label class="slot"><span>${l(slot)}</span><select data-slot="${slot}">${list}</select><input type="color" data-slot-color="${slot}" value="${piece.cor}" ${piece.id ? '' : 'disabled'} /></label>`;
  };
  const pcdOn = () => !!(look.pcd.braco || look.pcd.perna);

  const render = () => {
    root.innerHTML = `
      <div class="customizer">
        <div class="cz-preview">
          <canvas id="cz-canvas"></canvas>
          <p class="hint">${l('dragHint')}</p>
          <p class="cz-effects"><b>${l('effects')}:</b> <span id="cz-effects">${esc(effectsText(look))}</span></p>
        </div>
        <div class="cz-controls">
          <h3>${l('title')}</h3>
          <h4>${l('body')}</h4>
          <div class="cz-row"><span>${l('height')}</span>${buttons('altura', HEIGHTS, look.altura)}</div>
          <div class="cz-row"><span>${l('build')}</span>${buttons('biotipo', BUILDS, look.biotipo)}</div>
          <div class="cz-row"><span>${l('skin')}</span>${swatches('pele', SKIN_TONES, look.pele)}</div>
          <h4>${l('hair')}</h4>
          <div class="cz-row"><span></span>${buttons('cabelo', HAIR[o.sex], look.cabelo.id)}</div>
          <div class="cz-row"><span>${l('hairColor')}</span>${swatches('cabeloCor', HAIR_COLORS, look.cabelo.cor)}</div>
          <h4>${l('clothes')}</h4>
          ${SLOTS.map(slotSelect).join('')}
          <h4><label class="check"><input id="cz-pcd" type="checkbox" ${pcdOn() ? 'checked' : ''} /> ${l('pcd')}</label></h4>
          <p class="hint">${l('pcdHint')}</p>
          <div id="cz-pcd-options" class="${pcdOn() ? '' : 'hidden'}">
            <label class="slot"><span>${l('arm')}</span><select id="cz-arm">${ARM_LOSSES.map((v) => `<option value="${v}" ${v === look.pcd.braco ? 'selected' : ''}>${esc(v ? l(v) : l('none'))}</option>`).join('')}</select></label>
            <label class="slot"><span>${l('leg')}</span><select id="cz-leg">${LEG_LOSSES.map((v) => `<option value="${v}" ${v === look.pcd.perna ? 'selected' : ''}>${esc(v ? l(v) : l('noneF'))}</option>`).join('')}</select></label>
          </div>
          <div class="cz-actions">
            <button id="cz-save" class="small-btn">${l('save')}</button>
            <button id="cz-reset" class="link-btn">${l('reset')}</button>
            <button id="cz-cancel" class="link-btn">${l('cancel')}</button>
          </div>
        </div>
      </div>`;
  };

  render();
  let preview = new Preview(root.querySelector<HTMLCanvasElement>('#cz-canvas')!);
  const refresh = () => {
    preview.show(look, o.sex);
    root.querySelector('#cz-effects')!.textContent = effectsText(look);
  };
  refresh();

  const close = (saved: boolean) => {
    preview.dispose();
    card?.classList.remove('wide');
    o.onClose(saved);
  };

  // One delegated listener for every control (the markup is rebuilt only on reset).
  const bind = () => {
    root.querySelectorAll<HTMLElement>('.seg, .swatches').forEach((groupEl) => {
      groupEl.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
        if (!btn) return;
        const v = btn.dataset.v!;
        const g = groupEl.dataset.group!;
        if (g === 'altura') look.altura = v as Appearance['altura'];
        else if (g === 'biotipo') look.biotipo = v as Appearance['biotipo'];
        else if (g === 'pele') look.pele = v;
        else if (g === 'cabelo') look.cabelo.id = v;
        else if (g === 'cabeloCor') look.cabelo.cor = v;
        groupEl.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const picker = groupEl.querySelector<HTMLInputElement>('input[type=color]');
        if (picker) picker.value = v;
        refresh();
      };
    });
    root.querySelectorAll<HTMLInputElement>('.swatches input[type=color]').forEach((input) => {
      input.oninput = () => {
        if (input.dataset.group === 'pele') look.pele = input.value;
        else look.cabelo.cor = input.value;
        input.parentElement!.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === input.value)));
        refresh();
      };
    });
    root.querySelectorAll<HTMLSelectElement>('select[data-slot]').forEach((sel) => {
      sel.onchange = () => {
        const slot = sel.dataset.slot as Slot;
        look.roupas[slot].id = sel.value;
        root.querySelector<HTMLInputElement>(`input[data-slot-color="${slot}"]`)!.disabled = !sel.value;
        refresh();
      };
    });
    root.querySelectorAll<HTMLInputElement>('input[data-slot-color]').forEach((input) => {
      input.oninput = () => {
        look.roupas[input.dataset.slotColor as Slot].cor = input.value;
        refresh();
      };
    });
    const pcd = root.querySelector<HTMLInputElement>('#cz-pcd')!;
    const arm = root.querySelector<HTMLSelectElement>('#cz-arm')!;
    const leg = root.querySelector<HTMLSelectElement>('#cz-leg')!;
    pcd.onchange = () => {
      root.querySelector('#cz-pcd-options')!.classList.toggle('hidden', !pcd.checked);
      if (pcd.checked) {
        // Turning PCD on starts with a choice made, so the preview shows something right away.
        if (!look.pcd.braco && !look.pcd.perna) look.pcd.braco = 'maoEsq';
      } else look.pcd = { braco: '', perna: '' };
      arm.value = look.pcd.braco;
      leg.value = look.pcd.perna;
      refresh();
    };
    arm.onchange = () => {
      look.pcd.braco = arm.value as Appearance['pcd']['braco'];
      refresh();
    };
    leg.onchange = () => {
      look.pcd.perna = leg.value as Appearance['pcd']['perna'];
      refresh();
    };
    root.querySelector<HTMLButtonElement>('#cz-cancel')!.onclick = () => close(false);
    root.querySelector<HTMLButtonElement>('#cz-reset')!.onclick = () => {
      look = defaultAppearance(o.sex);
      preview.dispose();
      render();
      preview = new Preview(root.querySelector<HTMLCanvasElement>('#cz-canvas')!);
      refresh();
      bind();
    };
    const save = root.querySelector<HTMLButtonElement>('#cz-save')!;
    save.onclick = async () => {
      save.disabled = true;
      try {
        await api('PATCH', '/api/perfil', { aparencia: look });
        o.setStatus(l('saved'));
        close(true);
      } catch (err) {
        o.setStatus(errorText(err), true);
        save.disabled = false;
      }
    };
  };
  bind();
}
