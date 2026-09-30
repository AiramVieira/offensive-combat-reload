// Graphics presets and dynamic resolution (sections 3 and 5). Also detects when the browser renders
// WebGL on the CPU (hardware acceleration off or GPU blocklisted), which caps the game at ~5-10 FPS.
import * as THREE from 'three';
import type { RenderContext } from './renderer';

export type Quality = 'auto' | 'baixa' | 'media' | 'alta';

interface Preset {
  /** Cap on devicePixelRatio. */
  maxDpr: number;
  shadows: boolean;
  shadowSize: number;
  /** Re-render the shadow map every N frames (the map is static; only characters move). */
  shadowEvery: number;
}

const PRESETS: Record<Exclude<Quality, 'auto'>, Preset> = {
  baixa: { maxDpr: 0.75, shadows: false, shadowSize: 512, shadowEvery: 4 },
  media: { maxDpr: 1, shadows: true, shadowSize: 1024, shadowEvery: 2 },
  alta: { maxDpr: 1.5, shadows: true, shadowSize: 2048, shadowEvery: 1 },
};

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
const MIN_SCALE = 0.5;

export class QualityManager {
  /** Unmasked GPU name, e.g. "ANGLE (NVIDIA, GeForce RTX 3070 Ti ...)". */
  readonly gpu: string;
  readonly software: boolean;
  private quality: Quality = 'auto';
  private preset: Preset = PRESETS.media;
  /** Dynamic resolution multiplier (auto only). */
  scale = 1;
  private acc = 0;
  private frames = 0;
  private goodSeconds = 0;
  private frame = 0;

  constructor(private ctx: RenderContext) {
    ctx.renderer.shadowMap.autoUpdate = false;
    const gl = ctx.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.software = SOFTWARE_RENDERERS.test(this.gpu);
  }

  get current(): Quality {
    return this.quality;
  }

  get pixelRatio(): number {
    return this.ctx.renderer.getPixelRatio();
  }

  set(q: Quality) {
    this.quality = q;
    this.preset = q === 'auto' ? (this.software ? PRESETS.baixa : PRESETS.media) : PRESETS[q];
    this.scale = 1;
    this.goodSeconds = 0;
    this.applyShadows();
    this.applyResolution();
  }

  /** Call before rendering: schedules the shadow map refresh for this frame. */
  beforeRender() {
    this.frame++;
    // A missing shadow map (first frame, or just resized) must be rendered now: sampling an unallocated
    // one is a GL error.
    const missing = this.ctx.renderer.shadowMap.enabled && !this.ctx.sun.shadow.map;
    if (missing || this.frame % this.preset.shadowEvery === 0) this.ctx.renderer.shadowMap.needsUpdate = true;
  }

  /** Call every frame; in auto mode trades resolution (then shadows) for frame rate. */
  update(frameDt: number) {
    if (this.quality !== 'auto') return;
    this.acc += frameDt;
    this.frames++;
    if (this.acc < 1) return;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (fps < 45) {
      this.goodSeconds = 0;
      if (this.scale > MIN_SCALE + 0.01) {
        this.scale = Math.max(MIN_SCALE, this.scale - 0.15);
        this.applyResolution();
      } else if (this.preset.shadows) {
        this.preset = { ...this.preset, shadows: false };
        this.applyShadows();
      }
    } else if (fps > 57 && this.scale < 1) {
      // Only climb back after a few stable seconds to avoid oscillating.
      if (++this.goodSeconds >= 3) {
        this.goodSeconds = 0;
        this.scale = Math.min(1, this.scale + 0.1);
        this.applyResolution();
      }
    }
  }

  private applyResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.maxDpr) * this.scale;
    if (Math.abs(this.ctx.renderer.getPixelRatio() - dpr) > 0.001) this.ctx.renderer.setPixelRatio(dpr);
  }

  private applyShadows() {
    const { renderer, scene, sun } = this.ctx;
    const was = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = this.preset.shadows;
    if (sun.shadow.mapSize.x !== this.preset.shadowSize) {
      sun.shadow.mapSize.set(this.preset.shadowSize, this.preset.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    // Toggling shadows changes shader defines: every lit material must recompile once.
    if (was !== this.preset.shadows) {
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
  }
}
