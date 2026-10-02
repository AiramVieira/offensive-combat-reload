import { describe, expect, it } from 'vitest';
import { BodySounds, distanceGain, Enclosure, SPATIAL_KINDS, voiceParams, type CastFn, type Walker } from '../audio/spatial';

const walker = (x: number, over: Partial<Walker> = {}): Walker => ({
  feet: { x, y: 0, z: 0 },
  alive: true,
  grounded: true,
  sprint: false,
  crouch: false,
  slide: false,
  reload: false,
  ...over,
});

/** Walks someone along x at `speed` m/s for `seconds`, collecting the sounds. */
function walk(sounds: BodySounds, speed: number, seconds: number, over: Partial<Walker> = {}) {
  const out = [];
  const dt = 1 / 60;
  for (let t = 0, x = 0; t < seconds; t += dt, x += speed * dt) out.push(...sounds.update(1, walker(x, over), dt));
  return out;
}

describe('spatial sound', () => {
  it('a wall muffles and lowers a sound without silencing it; thin paper barely does', () => {
    const clear = voiceParams(10, 0);
    const wall = voiceParams(10, 1);
    const two = voiceParams(10, 2);
    const paper = voiceParams(10, 0.25);
    expect(clear.gain).toBe(1);
    expect(wall.gain).toBeLessThan(0.7);
    expect(wall.cutoff).toBeLessThan(2000);
    expect(two.gain).toBeLessThan(wall.gain);
    expect(two.gain).toBeGreaterThan(0);
    expect(paper.gain).toBeGreaterThan(0.85);
    expect(paper.cutoff).toBeGreaterThan(wall.cutoff * 3);
  });

  it('far sounds are duller (air) and quieter', () => {
    expect(voiceParams(100, 0).cutoff).toBeLessThan(voiceParams(5, 0).cutoff);
    const gun = SPATIAL_KINDS.gun;
    expect(distanceGain(2, gun)).toBe(1);
    expect(distanceGain(60, gun)).toBeLessThan(distanceGain(20, gun));
    // A gunshot carries much farther than a footstep.
    expect(distanceGain(30, gun)).toBeGreaterThan(distanceGain(30, SPATIAL_KINDS.step) * 2);
  });

  it('a spot under a roof with walls around is enclosed; an open field is not', () => {
    const room: CastFn = () => 3;
    const field: CastFn = () => null;
    expect(new Enclosure(room).at({ x: 0, y: 0, z: 0 })).toBeGreaterThan(0.9);
    expect(new Enclosure(field).at({ x: 0, y: 0, z: 0 })).toBe(0);
    // Cached per cell: the second lookup casts no rays.
    let casts = 0;
    const counting = new Enclosure(() => (casts++, null));
    counting.at({ x: 0.5, y: 0, z: 0.5 });
    const first = casts;
    counting.at({ x: 1.2, y: 0.3, z: 1.1 });
    expect(casts).toBe(first);
  });

  it('others make footsteps walking, louder sprinting, none crouching', () => {
    const steps = (over: Partial<Walker>, speed: number) => walk(new BodySounds(), speed, 3, over).filter((e) => e.kind === 'step');
    const walking = steps({}, 4);
    const sprinting = steps({ sprint: true }, 6.5);
    expect(walking.length).toBeGreaterThanOrEqual(4);
    expect(sprinting.every((e) => e.kind === 'step' && e.loud > 1)).toBe(true);
    expect(steps({ crouch: true }, 2)).toHaveLength(0);
  });

  it('landing after a fall, starting a slide and starting a reload each make one sound', () => {
    const s = new BodySounds();
    s.update(1, walker(0), 1 / 60);
    for (let i = 0; i < 40; i++) s.update(1, walker(0, { grounded: false }), 1 / 60);
    expect(s.update(1, walker(0), 1 / 60)).toEqual([{ kind: 'land', hard: false }]);
    expect(s.update(1, walker(0, { slide: true }), 1 / 60)).toEqual([{ kind: 'slide' }]);
    expect(s.update(1, walker(0, { slide: true }), 1 / 60)).toEqual([]);
    expect(s.update(1, walker(0, { reload: true }), 1 / 60)).toEqual([{ kind: 'reload' }]);
    expect(s.update(1, walker(0, { reload: true }), 1 / 60)).toEqual([]);
  });

  it('a respawn across the map is not a footstep', () => {
    const s = new BodySounds();
    s.update(1, walker(0), 1 / 60);
    expect(s.update(1, walker(40), 1 / 60)).toEqual([]);
  });
});
