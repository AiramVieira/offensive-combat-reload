// Floating countdown above a humiliable corpse (section 8): ring + seconds + [E], or "OPRIMIDO!".
import * as THREE from 'three';

export class CorpseTimer {
  readonly sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 200;
    this.ctx = canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthWrite: false }));
    this.sprite.scale.set(0.44, 0.55, 1);
    this.sprite.visible = false;
  }

  hide() {
    this.sprite.visible = false;
  }

  /** Redraws only when the shown second or ring segment changes. */
  countdown(left: number, total: number) {
    this.sprite.visible = true;
    const frac = Math.max(0, left / total);
    const key = `${Math.ceil(left)}|${Math.round(frac * 48)}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    g.clearRect(0, 0, 160, 200);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cx = 80;
    const cy = 72;
    g.fillStyle = 'rgba(27,21,48,0.8)';
    g.beginPath();
    g.arc(cx, cy, 62, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.arc(cx, cy, 50, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = frac > 0.5 ? '#7dff5a' : frac > 0.25 ? '#ffd23f' : '#ff4a3d';
    g.beginPath();
    g.arc(cx, cy, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '400 52px "Lilita One", system-ui, sans-serif';
    g.fillText(String(Math.ceil(left)), cx, cy + 3);
    // [E] key badge.
    g.fillStyle = '#fff8ec';
    g.strokeStyle = '#1b1530';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(cx - 26, 150, 52, 42, 10);
    g.fill();
    g.stroke();
    g.fillStyle = '#1b1530';
    g.font = '900 28px Nunito, system-ui, sans-serif';
    g.fillText('E', cx, 172);
    this.tex.needsUpdate = true;
  }

  done() {
    this.sprite.visible = true;
    if (this.key === 'done') return;
    this.key = 'done';
    const g = this.ctx;
    g.clearRect(0, 0, 160, 200);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 30px "Lilita One", system-ui, sans-serif';
    g.lineWidth = 7;
    g.strokeStyle = '#1b1530';
    g.fillStyle = '#ffd23f';
    g.save();
    g.translate(80, 100);
    g.rotate(-0.12);
    g.strokeText('OPRIMIDO!', 0, 0);
    g.fillText('OPRIMIDO!', 0, 0);
    g.restore();
    this.tex.needsUpdate = true;
  }
}
