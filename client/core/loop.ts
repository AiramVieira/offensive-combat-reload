import { SIM } from '@shared/constants';

/** Fixed-step simulation with an accumulator; rendering interpolates between the last two sim states. */
export function startLoop(step: (dt: number) => void, render: (alpha: number, frameDt: number) => void) {
  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const frameDt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += frameDt;
    let steps = 0;
    while (acc >= SIM.dt && steps < SIM.maxStepsPerFrame) {
      step(SIM.dt);
      acc -= SIM.dt;
      steps++;
    }
    if (steps === SIM.maxStepsPerFrame) acc = 0; // spiral-of-death guard
    render(acc / SIM.dt, frameDt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
