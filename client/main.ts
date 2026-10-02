// Bootstrap: loads the world, shows the home screen, then runs either offline training (dummies, local
// rules) or an online free-for-all session (remote players; the server owns health, kills and score).
// Combat code is shared: shots, knife, grenades and humiliations work on the `Target` / `Humiliable`
// interfaces, and only the "apply the result" step differs between the two modes.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { pickSafeSpawn } from './gameplay/spawnPicker';
import { GROUP, groups, HEALTH, HUMILIATION, MOVE, SCORE } from '@shared/constants';
import { clampExplosionDamage, computeDamage, explosionDamage, GRENADES, grenadeLevel, idealTtk, LETHAL_DAMAGE, type HitRegion } from '@shared/weapons';
import { eyeHeight, type MoveInput } from '@shared/movement';
import { CLOSE, FLAG, NET, ONLINE_GRENADE_LEVEL, type AwardLabel, type KillKind, type Vec3 } from '@shared/protocol';
import { startLoop } from './core/loop';
import { applyKeybinds, Input } from './core/input';
import { CAN_KEEP_ESCAPE, enterFullscreen, escapeIsKept, IS_MOBILE, isFullscreen, keepEscape } from './core/device';
import { TouchControls } from './ui/touch';
import { gamepad } from './core/gamepad';
import { PadNav } from './ui/padNav';
import { AimAssist } from './gameplay/aimAssist';
import { loadSettings, saveSettings, spatialMode } from './core/settings';
import { createRenderContext } from './render/renderer';
import { Effects } from './render/effects';
import { Viewmodel, VM_FEEL } from './render/viewmodel';
import { ANIM } from './character/animator';
import { TuningPanel } from './ui/tuning';
import { QualityManager } from './render/quality';
import { createPhysics } from './world/physics';
import { buildBlockoutMap, type SpawnPoint } from './world/blockoutMap';
import { buildDragonGardenMap } from './world/dragonGarden';
import { loadTextureOverrides } from './world/surfaces';
import { buildGltfMap } from './world/gltfMap';
import { MapBuilder } from './world/mapBuilder';
import { DummyManager, type Dummy, type HitResult } from './entities/dummy';
import { LocalPlayer } from './entities/localPlayer';
import { Avatar } from './entities/avatar';
import { bodyStats, defaultAppearance } from '@shared/appearance';
import { Weapon } from './weapons/weapon';
import { Melee, findMeleeTarget } from './weapons/melee';
import { GrenadeProjectiles, GrenadeThrower } from './weapons/grenades';
import { applySpread, traceShot } from './weapons/hitscan';
import { Taunt } from './gameplay/taunt';
import { nearestHumiliable, type HitboxRegistry, type Humiliable, type Target } from './gameplay/targets';
import { RemoteWorld, type RemotePlayer } from './net/remote';
import { NavMap } from './ai/navmesh';
import { Bot, type Combatant } from './ai/bot';
import { BotManager } from './ai/bots';
import { CharacterRig, type HitPose } from './entities/rig';
import { isBehind } from './entities/hitboxes';
import { Corpse } from './gameplay/corpse';
import { Sfx } from './audio/sfx';
import { BodySounds, OCCLUSION_WEIGHT, type Vec, type Walker } from './audio/spatial';
import { Chat } from './ui/chat';
import { Hud, type FeedIcon } from './ui/hud';
import { Screens } from './ui/menu';
import { closeReason, showHome } from './ui/home';
import { Progress } from './gameplay/progress';
import { MAX_MINES, Mines } from './weapons/mines';
import { Arsenal } from './ui/arsenal';
import { DEFAULT_LOADOUT, knifeData, levelInfo, rifleData, type KnifeSound, type Loadout, type ProgWeapon } from '@shared/progression';
import { Scoreboard } from './ui/scoreboard';
import { DEATH_MESSAGES, getLang, pick, t, type StringKey } from './ui/strings';

const DEG = Math.PI / 180;
const MOUSE_DEG_PER_COUNT = 0.022;
const VM_FOV = 58;
const UP = new THREE.Vector3(0, 1, 0);
const WORLD_ONLY = groups(GROUP.BULLET, GROUP.WORLD);
/** Grenade progression is decided later; everyone throws level 1 (non-lethal) for now. */
const GRENADE_LEVEL = ONLINE_GRENADE_LEVEL;

const vec3 = (v: THREE.Vector3): Vec3 => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
const KIND_ICON: Record<KillKind, FeedIcon> = { gun: null, head: 'head', groin: 'bird', knife: 'knife', grenade: 'grenade', fall: null, void: null, explosion: 'grenade', dog: 'dog' };
const WEAPON_LABEL: Record<ProgWeapon, StringKey> = { rifle: 'weaponRifle', faca: 'weaponKnife', granada: 'weaponGrenade' };
/** Dose Dupla: seconds between the two grenades of one throw. */
const DOUBLE_THROW_GAP = 0.3;
const AWARD_TEXT: Record<AwardLabel, StringKey> = { kill: 'kill', headshot: 'headshot', groin: 'groin', knife: 'knife', backstab: 'backstab', longShot: 'longShot', humiliation: 'humiliation' };

async function boot() {
  const bootT0 = performance.now();
  const boot: Record<string, number> = {};
  const mark = (name: string) => (boot[name] = Math.round(performance.now() - bootT0));
  const screens = new Screens();
  screens.setProgress(0.1);
  // Controllers drive the menus from the start (home, editor), and the match once it begins.
  new PadNav(gamepad);
  gamepad.onDeviceChange = () => screens.showControls(gamepad);

  const physics = await createPhysics();
  mark('physics');
  screens.setProgress(0.45);

  const ctx = createRenderContext(document.getElementById('game')!);
  const quality = new QualityManager(ctx);
  const sfx = new Sfx();
  const textures = loadTextureOverrides(ctx.renderer);
  screens.setProgress(1);
  const settings = loadSettings();
  applyKeybinds(settings.keybinds);
  quality.set(settings.quality);
  if (quality.software) screens.showGpuWarning(quality.gpu);

  // --- Home: name + online session or offline training ---------------------------------------------
  screens.hideLoading();
  const choice = await showHome();
  const online = choice.mode === 'online' ? choice : null;
  const conn = online?.conn ?? null;
  const me = online?.joined.you ?? 0;
  if (online) conn!.seed(online.joined.time);

  // --- Map: the session's (online) or the one picked on the home screen ------------------------------
  screens.showLoading();
  screens.setProgress(0.3);
  const tMap = performance.now();
  // ?mapa=/maps/arquivo.glb loads a map made in Blender over whatever was picked (map makers' preview).
  const mapUrl = new URLSearchParams(location.search).get('mapa');
  const buildMap = mapUrl
    ? buildGltfMap(mapUrl, new MapBuilder(physics, ctx.scene), ctx.renderer)
    : choice.map === 'jardim'
      ? buildDragonGardenMap(physics, ctx.scene, sfx)
      : buildBlockoutMap(physics, ctx.scene, ctx.renderer, sfx);
  const [map] = await Promise.all([buildMap, textures]);
  const mapBuildMs = performance.now() - tMap;
  mark('map');
  screens.setProgress(1);
  screens.hideLoading();

  const botMode = choice.mode === 'bots' ? choice : null;
  const registry: HitboxRegistry = new Map();
  const dummies = new DummyManager(physics.world, ctx.scene, choice.mode === 'offline' ? map.dummies : [], registry);
  const net = online ? new RemoteWorld(physics.world, ctx.scene, registry, conn!, me) : null;
  const effects = new Effects(ctx.scene);
  const viewmodel = new Viewmodel(ctx.vmScene);
  // Weapon progression from the account (level 1 without one) and our land mines (grenade level 2).
  const progress = new Progress(choice.account);
  const mines = new Mines(physics, ctx.scene);
  const player = new LocalPlayer(physics, map.killY);
  player.netControlled = !!online;
  if (online) player.respawnDelay = NET.respawnDelay + 0.3;
  if (botMode) player.respawnDelay = 5;
  // The character from the profile (default look without an account) and what it does in the game: only
  // the PCD mode (reload without a hand/arm, speed without a leg, no hitbox on the missing limb). Height and
  // build are looks: the eye, the hitboxes and the health are the same for everyone (style guide).
  const look = choice.account?.aparencia ?? defaultAppearance(choice.sex);
  const body = bodyStats(look);
  player.maxHealth = body.maxHealth;
  player.health = body.maxHealth;
  viewmodel.setBody(look, choice.sex);
  const avatar = new Avatar(ctx.scene, look, choice.sex);
  const melee = new Melee(knifeData(progress.equipped('faca')));
  const grenadeData = GRENADES.granada_frag;
  const grenadeLvl = grenadeLevel(grenadeData, GRENADE_LEVEL);
  const thrower = new GrenadeThrower(grenadeData);
  const grenades = new GrenadeProjectiles(physics, ctx.scene, grenadeData, (s, at) => sfx.at(at, 'normal', (x) => x.grenadeBounce(s)));
  const taunt = new Taunt();
  const hud = new Hud();
  const scoreboard = new Scoreboard();
  const input = new Input(ctx.renderer.domElement);
  sfx.setVolume(settings.volume);
  sfx.setSpatialMode(spatialMode(settings));
  // The map's walls for the sound: room echo where it's enclosed, muffling behind walls (audio/spatial.ts).
  const soundRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const soundCast = (o: Vec, d: Vec, max: number) => {
    soundRay.origin = o;
    soundRay.dir = d;
    return physics.world.castRay(soundRay, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
  };
  const occluder = (handle: number) => OCCLUSION_WEIGHT[physics.surfaces.get(handle)?.material ?? 'concrete'];
  sfx.setWorld(
    (o, d, max) => soundCast(o, d, max)?.timeOfImpact ?? null,
    (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.8) return 0;
      // From the ears to the sound and back: the same collider both ways is one wall, two are two.
      const a = soundCast(from, { x: dx / len, y: dy / len, z: dz / len }, len - 0.3);
      if (!a) return 0;
      const back = { x: to.x - (dx / len) * 0.25, y: to.y - (dy / len) * 0.25, z: to.z - (dz / len) * 0.25 };
      const b = soundCast(back, { x: -dx / len, y: -dy / len, z: -dz / len }, len - 0.55);
      const wa = occluder(a.collider.handle);
      return !b || b.collider.handle === a.collider.handle ? wa : wa + occluder(b.collider.handle);
    },
  );
  // Other people's footsteps, landings, slides and reloads, from what their bodies are doing.
  const bodySounds = new BodySounds();
  const groundProbe = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const groundAt = (feet: Vec) => {
    groundProbe.origin = { x: feet.x, y: feet.y + 0.1, z: feet.z };
    const hit = physics.world.castRay(groundProbe, 0.5, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
    return (hit && physics.surfaces.get(hit.collider.handle)?.material) || 'concrete';
  };
  const playBody = (id: number, w: Walker, dt: number, reloadTime: () => number) => {
    const f = w.feet;
    for (const ev of bodySounds.update(id, w, dt)) {
      const at = { x: f.x, y: f.y + 0.4, z: f.z };
      if (ev.kind === 'step') sfx.at(at, 'step', (s) => s.footstep(groundAt(f), ev.loud * 2));
      else if (ev.kind === 'land') sfx.at(at, 'step', (s) => s.land(ev.hard));
      else if (ev.kind === 'slide') sfx.at(at, 'step', (s) => s.slide(groundAt(f)));
      else sfx.at({ x: f.x, y: f.y + 1.2, z: f.z }, 'normal', (s) => s.reload(reloadTime(), false));
    }
  };
  // Phones and tablets: touch controls over the HUD; the pause button leaves to the menu.
  const touch = IS_MOBILE ? new TouchControls(input, settings, document.getElementById('hud')!) : null;
  gamepad.attach(input, settings);
  input.padActive = gamepad.device === 'pad';
  // Start on a controller resumes from the pause menu.
  gamepad.onStart = () => {
    if (!document.getElementById('menu')!.classList.contains('hidden')) document.getElementById('play-btn')!.click();
  };
  if (touch) touch.onPause = () => input.unlock();
  // Session chat: online only (Enter/T on a computer, the chat button on a phone).
  const chat = new Chat(input);
  chat.enable(!!conn);
  chat.onSend = (text) => conn?.send({ t: 'chat', text });
  if (touch) {
    touch.onChat = () => chat.toggle();
    touch.setChat(!!conn);
  }
  // Phones: leaving the browser (home button, a call) pauses like Esc does on a computer.
  if (IS_MOBILE) document.addEventListener('visibilitychange', () => document.hidden && input.unlock());
  // The context prompt (humiliate a body) is tapped on phones.
  if (IS_MOBILE) {
    const prompt = document.getElementById('prompt')!;
    prompt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      input.press('taunt', true);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) prompt.addEventListener(ev, () => input.press('taunt', false));
  }

  // Bots mode: a navmesh from the map's colliders, and hitboxes on the local player so bots can hit us.
  let bots: BotManager | null = null;
  // Bots route around Amora's bite zone (a little wider than the zone itself).
  const nav = botMode ? await NavMap.build(physics, map.dog ? [map.dog.zone.clone().expandByScalar(0.3)] : []) : null;
  const playerPos = new THREE.Vector3();
  const playerTarget: Combatant & { yaw: number } = {
    id: me,
    sex: choice.sex,
    look,
    get name() {
      return choice.name;
    },
    get position() {
      return playerFeet(playerPos);
    },
    get dead() {
      return player.dead;
    },
    get health() {
      return player.health;
    },
    get yaw() {
      return player.yaw;
    },
    eye: (out) => player.eye(1, out),
    refineRegion: (pt, r) => playerRig?.refineRegion(pt, r) ?? r,
    isBehind: (pt) => isBehind(pt, playerFeet(playerPos), player.yaw),
  };
  const playerRig = botMode ? new CharacterRig(physics.world, playerTarget, registry, body.missing) : null;
  if (playerRig) player.mb.ignoreBody = playerRig.body;

  /** Everything that can currently be shot / stabbed / blown up. */
  const targets = (): Target[] => (net ? net.targets() : [...dummies.list, ...(bots?.bots ?? [])]);
  const humiliables = (): Iterable<Humiliable> => (net ? net.corpses.values() : bots ? [...dummies.list, ...bots.corpses.values()] : dummies.list);
  const nameOf = (id: number | null) =>
    id === me ? t('you') : id === null ? '' : (net?.info.get(id)?.name ?? bots?.bots.find((b) => b.id === id)?.name ?? '?');

  // Free-for-all (online and against bots) uses the neutral spawns spread over the map.
  const allSpawns = online || botMode ? map.spawnsFFA : map.spawnsA;
  let lastSpawn: SpawnPoint | null = null;
  const pickSpawn = (): SpawnPoint => {
    if (bots) return bots.pickSpawn(playerTarget);
    const options = allSpawns.filter((s) => s !== lastSpawn);
    if (!net) return pick(options);
    // Free-for-all: section 6 rules against every living remote player.
    const threats = [...net.players.values()].filter((p) => p.alive).map((p) => ({ feet: p.position, eye: p.position.clone().setY(p.position.y + MOVE.eyeStand) }));
    return pickSafeSpawn(options, threats, physics);
  };
  let spawnedAt = 0;
  const respawn = () => {
    // Mines only exist while their owner is alive: they go away as we come back.
    mines.clearOwner(null);
    lastSpawn = pickSpawn();
    player.spawn(lastSpawn);
    if (bots) bots.protect(playerTarget);
    spawnedAt = performance.now();
    conn?.send({ t: 'respawn', p: vec3(lastSpawn.position), yaw: lastSpawn.yaw });
  };
  respawn();
  physics.world.step(); // builds the query pipeline before the first ray

  // Match stats (offline; online the server's numbers are shown).
  let simTime = 0;
  let shots = 0;
  let hits = 0;
  let kills = 0;
  let points = 0;
  let lastTtk: number | null = null;
  let lastHitDist = 0;
  let killerId: number | null = null;
  let myCorpseId: number | null = null;
  let deathMessage: string | null = null;

  const aimForward = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const feet = new THREE.Vector3();

  const computeAim = (out: THREE.Vector3) => {
    // Recoil offset is part of the aim; positive recoil yaw kicks to the right.
    const p = player.pitch + weapon.recoilPitch * DEG;
    const y = player.yaw - weapon.recoilYaw * DEG;
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  };

  const award = (label: string, value: number) => {
    points += value;
    hud.popup(label, value);
  };

  const killFx = (at: THREE.Vector3) => {
    sfx.killDing();
    sfx.boing();
    effects.burst('confetti', tmp.copy(at).setY(at.y + 1.2), UP, 40);
  };

  /** Offline kill bookkeeping for every way of killing a dummy. */
  const onKill = (dummy: Dummy, res: HitResult, weaponName: string, icon: FeedIcon) => {
    kills++;
    lastTtk = res.ttk;
    killFx(dummy.position);
    award(t('kill'), SCORE.kill);
    hud.killfeed(t('you'), weaponName, dummy.name, icon);
  };

  const groinFx = (at: THREE.Vector3) => {
    hud.showBanner(t('groinBanner'), 'bird');
    sfx.bird();
    effects.burst('confetti', at, UP, 25, 0xffd23f);
  };

  const weapon: Weapon = new Weapon(rifleData(progress.equipped('rifle')), {
    shoot(spread, shotIndex) {
      shots++;
      bots?.unprotect(playerTarget);
      player.eye(1, eye);
      computeAim(aimForward);
      applySpread(aimForward, spread, shotDir);
      const { hit, through, keep, end } = traceShot(physics, registry, eye, shotDir, weapon.data.alcanceMaximo, playerRig?.body, weapon.data.penetracao);

      // Muzzle position in world space (viewmodel is camera-relative).
      viewmodel.muzzleCameraSpace(muzzle).applyMatrix4(ctx.camera.matrixWorld);
      viewmodel.flash();
      viewmodel.kick();
      gamepad.rumble(45, 0.1, 0.35);
      effects.flash(muzzle);
      sfx.gunshot();
      if (shotIndex % weapon.data.tracanteACada === 0) effects.tracer(muzzle, end);
      conn?.send({ t: 'shot', o: vec3(muzzle), e: vec3(end) });

      // Through wood and glass: entry and exit holes, splinters out the far side.
      for (const p of through) {
        effects.decal(p.point, p.normal);
        effects.decal(p.exit, p.exitNormal);
        effects.burst('debris', p.point, p.normal, 3, 0x9a6a3a);
        effects.burst('debris', p.exit, shotDir, 5, 0x9a6a3a);
        sfx.at(p.point, 'normal', (s) => s.impact(p.surface.material));
        p.surface.onShot?.(p.point);
      }
      if (!hit) return;
      if (hit.target) {
        const entity = hit.target.entity;
        const region: HitRegion = entity.refineRegion(hit.point, hit.target.region);
        const groin = region === 'virilha';
        const head = region === 'cabeca';
        tmp.copy(shotDir).negate();
        if (net) {
          // Online: report the hit, show feedback now; the server confirms damage and kills.
          if (entity.dead) return;
          conn!.send({ t: 'hit', target: (entity as RemotePlayer).id, region, dist: +hit.distance.toFixed(2), ...(keep < 1 ? { keep: +keep.toFixed(3) } : {}) });
          hits++;
          lastHitDist = hit.distance;
          effects.burst(head || groin ? 'star' : 'confetti', hit.point, tmp, head || groin ? 10 : 6);
          sfx.hitmarker(head || groin);
          hud.hit(head ? 'head' : 'hit');
          return;
        }
        if (entity instanceof Bot && bots) {
          // Against bots: same rules as online; kills and popups come back through the bot hooks.
          if (entity.dead) return;
          const kind: KillKind = head ? 'head' : groin ? 'groin' : 'gun';
          const res = bots.hit(entity, playerTarget, computeDamage(weapon.data, hit.distance, region, keep), { kind, region, dist: hit.distance });
          if (res.dealt <= 0) return;
          hits++;
          lastHitDist = hit.distance;
          effects.burst(head || groin ? 'star' : 'confetti', hit.point, tmp, head || groin ? 10 : 6);
          sfx.hitmarker(head || groin);
          if (!res.killed) hud.hit(head ? 'head' : 'hit');
          return;
        }
        const dummy = entity as Dummy;
        const res = dummy.applyHit(computeDamage(weapon.data, hit.distance, region, keep), region, simTime, shotDir, groin ? 'forward' : 'back');
        if (res.damage <= 0) return;
        hits++;
        lastHitDist = hit.distance;
        effects.burst(res.headshot || groin ? 'star' : 'confetti', hit.point, tmp, res.headshot || groin ? 10 : 6);
        sfx.hitmarker(res.headshot || groin);
        hud.hit(res.killed ? 'kill' : res.headshot ? 'head' : 'hit');
        if (res.killed) {
          onKill(dummy, res, weapon.data.nome, groin ? 'bird' : res.headshot ? 'head' : null);
          if (res.headshot) award(t('headshot'), SCORE.headshot);
          if (groin) {
            award(t('groin'), SCORE.groin);
            groinFx(hit.point);
          }
          if (hit.distance > SCORE.longShotDistance) award(t('longShot'), SCORE.longShot);
        }
      } else {
        effects.decal(hit.point, hit.normal);
        effects.burst('debris', hit.point, hit.normal, 5, 0x9a8f80);
        effects.burst('spark', hit.point, hit.normal, 3);
        const surface = hit.surface;
        if (surface) {
          sfx.at(hit.point, 'normal', (s) => s.impact(surface.material));
          surface.onShot?.(hit.point);
        }
      }
    },
    dryFire: () => sfx.dryFire(),
    reloadStart: (duration, empty) => sfx.reload(duration, empty),
    reloadEnd: () => {},
  });
  hud.setWeaponName(weapon.data.nome);

  // --- Weapon progression: each kill's points level up only the weapon that made it ------------------
  let knifeSound: KnifeSound = 'faca';
  /** Puts the equipped level of each weapon in our hands (and tells the server, which uses it too). */
  const applyLoadout = () => {
    const r = levelInfo('rifle', progress.equipped('rifle'));
    weapon.setData(rifleData(r.nivel));
    weapon.reloadMul = body.reloadMul;
    viewmodel.setRifle(r);
    hud.setWeaponName(r.nome);
    const k = levelInfo('faca', progress.equipped('faca'));
    melee.setData(knifeData(k.nivel));
    viewmodel.setKnife(k.modelo);
    knifeSound = k.som;
    const g = levelInfo('granada', progress.equipped('granada'));
    thrower.kind = g.tipo;
    viewmodel.setGrenadeKind(g.tipo);
    conn?.send({ t: 'loadout', lo: progress.loadout });
  };
  // Points only come from the server (online kills, humiliations, time alive): it pushes the new progress.
  conn?.on('progresso', (m) => {
    progress.applyServer(m.armas);
    applyLoadout();
    if (!m.subiu) return;
    if (m.subiu.tipo === 'conta') hud.showBanner(t('accountLevelUp', { level: m.subiu.nivel }), 'level');
    else {
      const info = levelInfo(m.subiu.tipo, m.subiu.nivel);
      hud.showBanner(`${info.icone} ${t('levelUp', { weapon: t(WEAPON_LABEL[m.subiu.tipo]), level: m.subiu.nivel })}: ${info.nome}!`, 'level');
    }
    sfx.levelUp();
  });
  new Arsenal(progress, () => applyLoadout());
  applyLoadout();
  const scopeEl = document.getElementById('scope')!;

  // --- Knife ----------------------------------------------------------------------------------------
  const startMelee = () => {
    player.eye(1, eye);
    const found = findMeleeTarget(physics, targets(), eye, player.yaw, melee.data.alcanceInvestida, melee.data.anguloGraus);
    if (!melee.tryStart(found?.target ?? null)) return;
    weapon.cancelReload();
    sfx.meleeSwing(knifeSound);
    conn?.send({ t: 'swing' });
  };

  const resolveMelee = () => {
    player.eye(1, eye);
    // The lunge target if it is now in reach, otherwise whatever is in front of us.
    let target = melee.target;
    const inReach = target && findMeleeTarget(physics, targets(), eye, player.yaw, melee.data.alcance + 0.4, 180)?.target === target;
    if (!inReach) target = findMeleeTarget(physics, targets(), eye, player.yaw, melee.data.alcance, melee.data.anguloGraus)?.target ?? null;
    if (!target) return;
    tmp.set(target.position.x - eye.x, 0, target.position.z - eye.z).normalize();
    const behind = target.isBehind(eye);
    sfx.knifeHit();
    effects.burst('star', new THREE.Vector3().copy(target.position).setY(target.position.y + 1.1), UP, 12);
    if (net) {
      conn!.send({ t: 'stab', target: (target as RemotePlayer).id, behind });
      hud.hit('hit');
      return;
    }
    if (target instanceof Bot && bots) {
      const res = bots.hit(target, playerTarget, melee.data.letal ? LETHAL_DAMAGE : 55, { kind: 'knife', behind });
      if (!res.killed && res.dealt > 0) hud.hit('hit');
      return;
    }
    // One-hit kill, as in the original.
    const dummy = target as Dummy;
    const res = dummy.applyHit(melee.data.letal ? LETHAL_DAMAGE : 55, 'peito', simTime, tmp, 'back');
    if (res.damage <= 0) return;
    hud.hit(res.killed ? 'kill' : 'hit');
    if (res.killed) {
      onKill(dummy, res, melee.data.nome, 'knife');
      award(t('knife'), SCORE.knife);
      if (behind) award(t('backstab'), SCORE.backstab);
    }
  };

  // --- Humiliation ----------------------------------------------------------------------------------
  const playerFeet = (out: THREE.Vector3, alpha = 1) => {
    player.eye(alpha, out);
    out.y -= eyeHeight(player.move) * player.eyeScale;
    return out;
  };

  // --- Amora: whoever steps in front of her door gets bitten (map hazard, instant kill) ----------------
  const dog = map.dog;
  const lastBite = new Map<object, number>();
  const biteOnce = (who: object, at: THREE.Vector3) => {
    const last = lastBite.get(who);
    if (last !== undefined && simTime - last < 2) return false;
    lastBite.set(who, simTime);
    dog!.bite(at);
    return true;
  };
  const dogTick = () => {
    if (!dog) return;
    if (!player.dead) {
      const f = playerFeet(new THREE.Vector3());
      if (dog.contains(f) && biteOnce(player, f)) {
        // Online the server owns deaths: report it like a fall.
        if (conn) conn.send({ t: 'selfDamage', amount: LETHAL_DAMAGE, cause: 'dog' });
        else player.damage(LETHAL_DAMAGE, simTime, 'dog');
      }
    }
    for (const b of bots?.bots ?? []) if (!b.dead && dog.contains(b.position) && biteOnce(b, b.position.clone())) bots!.kill(b, null, { kind: 'dog' });
    // Remote players report their own bite; here she just lunges at them.
    for (const p of net?.targets() ?? []) if (!p.dead && dog.contains(p.position)) biteOnce(p, p.position.clone());
  };

  const humiliationFx = (corpse: Humiliable) => {
    hud.showBanner(t('humiliatedBanner'), 'taunt');
    sfx.airHorn();
    sfx.applause();
    effects.burst('confetti', corpse.corpseCenter(tmp).setY(tmp.y + 0.5), UP, 60);
  };

  const finishTaunt = (corpse: Humiliable) => {
    humiliationFx(corpse);
    // Online the points arrive with the server's confirmation (tauntEnd); against bots, from the manager.
    if (!net && !(corpse instanceof Corpse)) {
      award(t('humiliation'), SCORE.humiliation);
      hud.killfeed(t('you'), t('danceName'), corpse.name, 'taunt');
    }
  };

  // --- Grenades -------------------------------------------------------------------------------------
  let shake = 0; // camera trauma 0..1
  let lastBeep = -1;
  let grenadeSeq = 1;
  let secondThrowIn: number | null = null;

  /** Grenade level 2: a land mine just in front of our feet (online, others see it too). */
  const plantMine = () => {
    if (mines.own >= MAX_MINES) {
      thrower.count++; // nothing planted, charge back
      hud.notice(t('mineLimit', { n: MAX_MINES }));
      return;
    }
    const f = playerFeet(new THREE.Vector3());
    const at = mines.groundAt(f.addScaledVector(new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), 0.6));
    const id = grenadeSeq++;
    mines.place(id, null, at);
    sfx.minePlant();
    conn?.send({ t: 'grenade', id, p: vec3(at), v: [0, 0, 0], fuse: 0, mine: true });
  };

  /** Distance from `from` to the closest of `samples` with a clear line (walls block the blast), or null. */
  const blastDistance = (from: THREE.Vector3, samples: THREE.Vector3[]): number | null => {
    let best: number | null = null;
    for (const p of samples) {
      const d = new THREE.Vector3().subVectors(p, from);
      const len = d.length();
      if (len < 1e-3) return 0;
      const hit = physics.world.castRay(new RAPIER.Ray(from, { x: d.x / len, y: d.y / len, z: d.z / len }), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
      if (hit && hit.timeOfImpact < len - 0.05) continue;
      if (best === null || len < best) best = len;
    }
    return best;
  };

  const bodySamples = (p: THREE.Vector3) => [new THREE.Vector3(p.x, p.y + 0.3, p.z), new THREE.Vector3(p.x, p.y + 1.1, p.z), new THREE.Vector3(p.x, p.y + 1.6, p.z)];

  /** Visual + audio part of an explosion (also used for other players' grenades). */
  const explosionFx = (at: THREE.Vector3) => {
    const center = at.clone();
    center.y += 0.1; // keep the occlusion rays off the floor it is lying on
    const groundHit = physics.world.castRayAndGetNormal(new RAPIER.Ray(center, { x: 0, y: -1, z: 0 }), 1.5, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
    const ground = groundHit
      ? { point: center.clone().setY(center.y - groundHit.timeOfImpact), normal: new THREE.Vector3(groundHit.normal.x, groundHit.normal.y, groundHit.normal.z) }
      : null;
    effects.explosion(center, ground, grenadeLvl.raioDano);
    player.eye(1, eye);
    const listener = eye.distanceTo(center);
    sfx.at(center, 'boom', (s) => s.explosion());
    shake = Math.min(1, shake + Math.max(0, 1 - listener / 18));
    return center;
  };

  /** Our own grenade went off: effects, then damage (locally offline, reported to the server online). */
  const explode = (at: THREE.Vector3, id: number) => {
    const center = explosionFx(at);
    const f = playerFeet(feet);
    const selfDist = player.dead ? null : blastDistance(center, [new THREE.Vector3(f.x, f.y + 0.3, f.z), eye.clone()]);

    if (net) {
      const reported: { target: number; dist: number }[] = [];
      for (const p of net.targets()) {
        if (p.dead) continue;
        const dist = blastDistance(center, bodySamples(p.position));
        if (dist !== null && dist <= grenadeLvl.raioDano) reported.push({ target: p.id, dist: +dist.toFixed(2) });
      }
      if (selfDist !== null && selfDist <= grenadeLvl.raioDano) reported.push({ target: me, dist: +selfDist.toFixed(2) });
      conn!.send({ t: 'boom', id, p: vec3(center), hits: reported });
      if (reported.some((r) => r.target !== me)) {
        sfx.hitmarker(false);
        hud.hit('hit');
      }
      return;
    }

    let anyHit = false;
    let anyKill = false;
    for (const d of dummies.list) {
      if (d.dead) continue;
      const p = d.position;
      const dist = blastDistance(center, bodySamples(p));
      if (dist === null) continue;
      const dmg = clampExplosionDamage(grenadeLvl, explosionDamage(grenadeLvl, dist), d.health);
      if (dmg <= 0) continue;
      const away = new THREE.Vector3(p.x - center.x, 0, p.z - center.z).normalize();
      const res = d.applyHit(dmg, 'peito', simTime, away, 'back');
      if (res.damage <= 0) continue;
      anyHit = true;
      effects.burst('confetti', tmp.copy(p).setY(p.y + 1.1), UP, 6);
      if (res.killed) {
        anyKill = true;
        onKill(d, res, levelInfo('granada', progress.equipped('granada')).nome, 'grenade');
      }
    }
    for (const b of bots?.bots ?? []) {
      if (b.dead) continue;
      const dist = blastDistance(center, bodySamples(b.position));
      if (dist === null) continue;
      const dmg = clampExplosionDamage(grenadeLvl, explosionDamage(grenadeLvl, dist), b.health);
      if (dmg <= 0) continue;
      const res = bots!.hit(b, playerTarget, dmg, { kind: 'grenade' });
      if (res.dealt > 0) anyHit = true;
      if (res.killed) anyKill = true;
    }
    if (anyHit) {
      sfx.hitmarker(false);
      hud.hit(anyKill ? 'kill' : 'hit');
    }
    // Your own grenade can always kill you: the level's "non-lethal" rule only protects others.
    if (selfDist !== null) {
      const dmg = explosionDamage(grenadeLvl, selfDist);
      const dealt = player.damage(dmg, simTime, 'explosion');
      if (dealt > 0) {
        hud.damageFlash(dealt);
        sfx.hurt();
      }
    }
  };

  /** Hand position in the world: in front of the eye, a bit right and down (never inside a wall). */
  const handPosition = (dir: THREE.Vector3, out: THREE.Vector3) => {
    player.eye(1, eye);
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const target = new THREE.Vector3().copy(eye).addScaledVector(dir, 0.45).addScaledVector(right, 0.12).addScaledVector(UP, -0.08);
    const d = new THREE.Vector3().subVectors(target, eye);
    const len = d.length();
    d.divideScalar(len);
    const hit = physics.world.castRay(new RAPIER.Ray(eye, d), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
    return out.copy(eye).addScaledVector(d, hit ? Math.max(0, hit.timeOfImpact - 0.1) : len);
  };

  /**
   * Throws one of our grenades; the id travels with the projectile and is reported with its explosion.
   * `impact`: goes off on first contact (thrown); otherwise by `fuse` (dropped while cooking).
   */
  const launch = (origin: THREE.Vector3, vel: THREE.Vector3, fuse: number, impact = false) => {
    const id = grenadeSeq++;
    const limit = impact ? grenadeData.tempoMaximoVoo : fuse;
    grenades.spawn(origin, vel, limit, undefined, id, { impact, ignore: playerRig?.body });
    conn?.send({ t: 'grenade', id, p: vec3(origin), v: vec3(vel), fuse: +limit.toFixed(3), ...(impact ? { impact } : {}) });
  };

  const throwGrenade = (fuseLeft: number) => {
    const p = player.pitch + (grenadeData.anguloExtraGraus * Math.PI) / 180;
    const dir = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(p), Math.sin(p), -Math.cos(player.yaw) * Math.cos(p));
    const origin = handPosition(dir, new THREE.Vector3());
    // Jump + throw (in the air, or jump pressed on the same tick) throws farther.
    const jumping = !player.move.grounded || input.down('jump');
    const speed = grenadeData.velocidadeLancamento * (jumping ? grenadeData.bonusPulo : 1);
    // Inherit part of the player's run (and of the jump's lift) so throws on the move feel right.
    const vel = dir.multiplyScalar(speed).add(new THREE.Vector3(player.move.vel.x * 0.6, jumping ? Math.max(0, player.move.vel.y) * 0.5 : 0, player.move.vel.z * 0.6));
    // Once thrown the fuse no longer matters: it goes off on contact.
    launch(origin, vel, fuseLeft, grenadeData.impacto);
    sfx.grenadeThrow();
  };

  /** Dying with a cooked grenade drops it at your feet, still live (offline: online you're already dead). */
  const dropCookedGrenade = () => {
    const left = thrower.fuseLeft;
    if (left === null) return;
    thrower.cancel();
    thrower.count = Math.max(0, thrower.count - 1);
    if (net) return;
    const f = playerFeet(new THREE.Vector3());
    launch(f.setY(f.y + 0.3), new THREE.Vector3(0, 1, 0), left);
  };

  // --- Bots ----------------------------------------------------------------------------------------
  /** Name of the weapon behind a kill, at the killer's levels (bots use the starting ones). */
  const weaponNameFor = (kind: KillKind, lo: Loadout = DEFAULT_LOADOUT) =>
    kind === 'knife' ? knifeData(lo.faca).nome : kind === 'grenade' || kind === 'explosion' ? levelInfo('granada', lo.granada).nome : rifleData(lo.rifle).nome;
  if (botMode && nav) {
    bots = new BotManager({
      physics,
      scene: ctx.scene,
      registry,
      nav,
      spawns: allSpawns,
      effects,
      sfx,
      player: playerTarget,
      count: botMode.count,
      skill: botMode.skill,
      hooks: {
        damagePlayer: (amount) => {
          const dealt = player.damage(amount, simTime, 'killed');
          if (dealt > 0) {
            hud.damageFlash(dealt);
            sfx.hurt();
          }
          return player.health;
        },
        kill: (victim, killer, kind, awards, corpse) => {
          const victimName = victim === playerTarget ? t('you') : victim.name;
          const killerLoadout = killer === playerTarget ? progress.loadout : DEFAULT_LOADOUT;
          if (killer) hud.killfeed(killer === playerTarget ? t('you') : killer.name, weaponNameFor(kind, killerLoadout), victimName, KIND_ICON[kind]);
          else if (kind === 'dog') hud.killfeed('Amora', t('dogBite'), victimName, 'dog');
          else hud.notice(`💀 ${victimName}`);
          if (killer === playerTarget) {
            hud.hit('kill');
            killFx(victim.position);
            for (const a of awards) hud.popup(t(AWARD_TEXT[a.label]), a.value);
            if (kind === 'groin') groinFx(victim.position.clone().setY(victim.position.y + 0.9));
          }
          if (victim === playerTarget) {
            killerId = killer?.id ?? null;
            myCorpseId = corpse.info.id;
            deathMessage = killer ? t('killedByWith', { name: killer.name, weapon: weaponNameFor(kind, killerLoadout) }) : null;
          }
        },
        tauntStarted: (dancer, corpse) => {
          if (corpse.info.victim === me && player.dead) hud.showDeath(`${dancer.name} 💃 ${t('humiliatedBanner')}`);
        },
        humiliation: (dancer, corpse, awards) => {
          const victimName = corpse.info.victim === me ? t('you') : corpse.name;
          hud.killfeed(dancer === playerTarget ? t('you') : dancer.name, t('danceName'), victimName, 'taunt');
          if (dancer === playerTarget) for (const a of awards) hud.popup(t(AWARD_TEXT[a.label]), a.value);
          else if (corpse.info.victim === me || corpse.corpseCenter(tmp).distanceTo(playerFeet(feet)) < 25) humiliationFx(corpse);
        },
      },
    });
    screens.setSubtitle(t('botsSubtitle', { n: botMode.count }));
    const navDebug = nav.debugMesh();
    ctx.scene.add(navDebug);
    Object.assign(window, { __ocNavDebug: navDebug });
  }

  // --- Online: server messages ----------------------------------------------------------------------
  if (net && online && conn) {
    for (const p of online.joined.players) net.upsertInfo(p);
    for (const c of online.joined.corpses) net.addCorpse(c);
    screens.setSubtitle(t('onlineSubtitle', { name: online.joined.session.name }));

    conn.on('snap', (m) => {
      net.snapshot(m.time, m.players);
      const mine = m.players.find((p) => p.id === me);
      if (!mine) return;
      if (!player.dead) player.health = mine.h;
      // The server didn't accept our respawn (timing): ask again.
      if (!mine.alive && !player.dead && performance.now() - spawnedAt > 1500 && lastSpawn) {
        spawnedAt = performance.now();
        conn.send({ t: 'respawn', p: vec3(lastSpawn.position), yaw: lastSpawn.yaw });
      }
    });
    conn.on('playerJoined', (m) => {
      net.upsertInfo(m.player);
      hud.notice(t('playerJoined', { name: m.player.name }));
    });
    // A player came back: the mines of their previous life go away.
    conn.on('spawned', (m) => mines.clearOwner(m.id));
    conn.on('playerLeft', (m) => {
      mines.clearOwner(m.id);
      const name = net.info.get(m.id)?.name;
      net.remove(m.id);
      if (name) hud.notice(t('playerLeft', { name }));
    });
    conn.on('scores', (m) => m.players.forEach((p) => net.upsertInfo(p)));
    conn.on('shot', (m) => {
      const rp = net.players.get(m.id);
      if (!rp) return;
      const from = rp.muzzle(new THREE.Vector3());
      rp.fire();
      effects.tracer(from, new THREE.Vector3(...m.e));
      sfx.at(from, 'gun', (s) => s.gunshot());
    });
    conn.on('swing', (m) => {
      const rp = net.players.get(m.id);
      if (rp) sfx.at({ x: rp.position.x, y: rp.position.y + 1.3, z: rp.position.z }, 'step', (s) => s.knifeSwing());
    });
    conn.on('playerLoadout', (m) => net.setLoadout(m.id, m.lo));
    conn.on('grenade', (m) => {
      // The thrower's arm swings on their avatar.
      const by = net.players.get(m.owner);
      if (!m.mine) by?.throwGrenade();
      if (!m.mine && by) sfx.at({ x: by.position.x, y: by.position.y + 1.4, z: by.position.z }, 'step', (s) => s.grenadeThrow());
      if (m.mine) {
        mines.place(m.id, m.owner, new THREE.Vector3(...m.p));
        sfx.at({ x: m.p[0], y: m.p[1] + 0.2, z: m.p[2] }, 'normal', (s) => s.minePlant());
      }
      else grenades.spawn(new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), m.fuse, `${m.owner}:${m.id}`, 0, { impact: m.impact });
    });
    conn.on('boom', (m) => {
      grenades.removeRemote(`${m.owner}:${m.id}`);
      mines.remove(m.id, m.owner);
      explosionFx(new THREE.Vector3(...m.p));
    });
    conn.on('damage', (m) => {
      if (m.target !== me) {
        // Someone else was hit: their torso jerks along the bullet's path.
        if (m.from) net.players.get(m.target)?.hitReact(new THREE.Vector3(...m.from));
        return;
      }
      player.health = m.health;
      player.lastDamageAt = simTime;
      hud.damageFlash(m.amount);
      sfx.hurt();
    });
    conn.on('kill', (m) => {
      m.players.forEach((p) => net.upsertInfo(p));
      net.addCorpse(m.corpse);
      const victimName = m.victim === me ? t('you') : m.corpse.name;
      const attackerInfo = m.attacker !== null ? net.info.get(m.attacker) : undefined;
      const weaponName = weaponNameFor(m.kind, m.attacker === me ? progress.loadout : (attackerInfo?.lo ?? DEFAULT_LOADOUT));
      if (m.attacker !== null) hud.killfeed(nameOf(m.attacker), weaponName, victimName, KIND_ICON[m.kind]);
      else if (m.kind === 'dog') hud.killfeed('Amora', t('dogBite'), victimName, 'dog');
      else hud.notice(`💀 ${victimName}`);
      if (m.attacker === me && m.victim !== me) {
        hud.hit('kill');
        killFx(new THREE.Vector3(...m.corpse.p));
        for (const a of m.awards) hud.popup(t(AWARD_TEXT[a.label]), a.value);
        if (m.kind === 'groin') groinFx(new THREE.Vector3(...m.corpse.p).setY(m.corpse.p[1] + 0.9));
      }
      if (m.victim === me) {
        killerId = m.attacker !== me ? m.attacker : null;
        myCorpseId = m.corpse.id;
        taunt.cancel(simTime);
        thrower.cancel();
        player.kill(simTime);
        sfx.sadTrombone();
        const killer = m.attacker !== null && m.attacker !== me ? nameOf(m.attacker) : null;
        const msg = killer
          ? t('killedByWith', { name: killer, weapon: weaponName })
          : pick(DEATH_MESSAGES[getLang()][m.kind === 'void' ? 'void' : m.kind === 'fall' ? 'fall' : m.kind === 'dog' ? 'dog' : 'explosion']);
        hud.showDeath(msg);
      }
    });
    conn.on('taunt', (m) => {
      const c = net.corpses.get(m.corpse);
      if (c && m.id !== me) c.claimedBy = m.id;
      // The victim watches from the death cam.
      if (c && c.info.victim === me && player.dead) hud.showDeath(`${nameOf(m.id)} 💃 ${t('humiliatedBanner')}`);
    });
    conn.on('tauntEnd', (m) => {
      m.players.forEach((p) => net.upsertInfo(p));
      const c = net.corpses.get(m.corpse);
      if (!c) return;
      if (!m.done) {
        if (c.claimedBy === m.id) c.claimedBy = null;
        return;
      }
      c.markHumiliated();
      hud.killfeed(nameOf(m.id), t('danceName'), c.info.victim === me ? t('you') : c.name, 'taunt');
      if (m.id === me) for (const a of m.awards) hud.popup(t(AWARD_TEXT[a.label]), a.value);
      else if (c.info.victim === me || c.corpseCenter(tmp).distanceTo(playerFeet(feet)) < 25) humiliationFx(c);
    });
    conn.on('prop', (m) => map.props.remote(m.id));
    conn.on('chat', (m) => chat.add(m.name, m.text, m.id === me));
    conn.on('chatRefused', (m) => chat.system(t(m.reason === 'muted' ? 'chatMuted' : 'chatSlow')));
    map.props.onLocal = (id) => conn.send({ t: 'prop', id });
    conn.onClose = (code) => hud.setNetStatus(code === CLOSE.revoked || code === CLOSE.replaced ? closeReason(code) : t('lostConnection'));
  }

  // --- Menus and pointer lock ---------------------------------------------------------------------
  screens.bindSettings(settings, (s) => {
    saveSettings(s);
    applyKeybinds(s.keybinds);
    sfx.setVolume(s.volume);
    sfx.setSpatialMode(spatialMode(s));
    if (s.quality !== quality.current) quality.set(s.quality);
    touch?.layout();
  });
  screens.onPlay(() => {
    sfx.unlock();
    sfx.ui();
    // The mouse first: the fullscreen request uses up the click, the pointer lock doesn't.
    void input.lock();
    // Phones: fullscreen and landscape (needs this tap). Computer: fullscreen keeps Esc for the game, so it
    // opens and closes the menu exactly and the mouse aims again at once.
    if (settings.fullscreen && (IS_MOBILE || CAN_KEEP_ESCAPE) && !isFullscreen()) void enterFullscreen();
  });
  // Entering fullscreen may cost the pointer lock (browser-made, so it can be retaken without a click).
  document.addEventListener('fullscreenchange', () => {
    if (IS_MOBILE || !isFullscreen()) return;
    void keepEscape();
    if (pausedAt !== null && performance.now() - pausedAt < 1500) void input.lock();
  });
  if (touch) {
    // The layout editor: the controls shown over the paused game, draggable.
    screens.onEditLayout(
      () => {
        hud.show(true);
        touch.setEditing(true);
      },
      () => {
        touch.setEditing(false);
        hud.show(false);
        saveSettings(settings);
      },
      () => touch.resetLayout(),
    );
  }
  screens.onExit(t('exitToHome'), () => {
    conn?.close();
    location.reload();
  });
  // Desktop: clicking the game takes the mouse back (on phones the menu's button resumes).
  if (!IS_MOBILE) {
    ctx.renderer.domElement.addEventListener('click', () => {
      // Playing on a controller leaves the cursor free: a click hands the game back to the mouse.
      if (!input.locked || !document.pointerLockElement) {
        input.padActive = false;
        void input.lock();
      }
    });
  }
  /** When the pause menu opened (null: not paused, or the start menu that comes before playing). */
  let pausedAt: number | null = null;
  input.onLockChange = (locked) => {
    document.documentElement.classList.toggle('playing', locked);
    if (!locked) {
      touch?.reset();
      chat.close();
    }
    if (locked) {
      pausedAt = null;
      screens.hideMenu();
      hud.show(true);
    } else {
      pausedAt = performance.now();
      screens.showMenu('pause');
    }
  };
  // Computer: Esc opens and closes the pause menu.
  // - In fullscreen the game keeps Esc (keepEscape): it pauses by letting go of the mouse itself, which the
  //   browser lets it take back without a click, so closing the menu has the mouse aiming at once.
  // - Elsewhere the browser takes the Esc that pauses and only gives the mouse back on a click or another key:
  //   the next Esc closes the menu and play resumes, the mouse coming back with the first key or click.
  // The Esc that opened the menu may be seen after it did (its time is earlier): never a second press.
  if (!IS_MOBILE)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat) return;
      if (input.locked) {
        if (escapeIsKept() && !chat.isOpen) {
          e.preventDefault();
          input.unlock();
        }
        return;
      }
      if (pausedAt === null || e.timeStamp <= pausedAt) return;
      e.preventDefault();
      sfx.ui();
      void input.lock().then((got) => {
        if (got || input.locked) return;
        input.setPlaying(true);
        hud.notice(t('aimOnNextKey'));
      });
    });

  // --- Simulation tick ------------------------------------------------------------------------------
  let lunging = false;
  let stateTimer = 0;
  const step = (dt: number) => {
    // Offline the world pauses with the menu; online it keeps going (other players don't wait).
    if (!input.locked && !net) return;
    const tSim = performance.now();
    stepInner(dt);
    simMsAvg += (performance.now() - tSim - simMsAvg) * 0.05;
  };
  const stepInner = (dt: number) => {
    simTime += dt;
    net?.update(dt);

    if (player.dead) {
      hud.setDeathTimer(player.respawnIn(simTime));
      if (player.canRespawn(simTime)) {
        respawn();
        weapon.refill();
        thrower.refill();
        hud.showDeath(null);
        killerId = null;
        myCorpseId = null;
        deathMessage = null;
      }
    } else {
      // Shots have priority over the sprint (dropped the same tick, see `move.sprint`) and over a grenade
      // in hand (the pin goes back in). They never interrupt a reload (no shooting until it ends; the knife
      // and grenades do cancel it), a knife swing (too quick: cancelling it would be an exploit) or a dance
      // (only death ends it). A slide keeps going: you can shoot while sliding.
      const canShoot = !weapon.reloading && !melee.swinging && !taunt.active;
      const fireIntent = canShoot && (input.down('fire') || input.peek('fire'));
      if (fireIntent) {
        if (thrower.cookT !== null) thrower.cancel();
        thrower.endFollowThrough();
      }

      const dancing = taunt.active;
      // Humiliation start: E while standing over a fresh corpse.
      if (input.consume('taunt') && !fireIntent && !dancing && !melee.swinging && !thrower.busy) {
        const corpse = nearestHumiliable(humiliables(), playerFeet(feet), HUMILIATION.radius, simTime);
        if (corpse) {
          weapon.cancelReload();
          taunt.start(corpse, player.yaw, simTime, (d) => sfx.danceMusic(d));
        }
      }
      if (input.consume('melee') && !fireIntent && !taunt.active && !thrower.busy) startMelee();

      // Grenade: hold G to cook, release to throw.
      const gEv = thrower.update(dt, input.down('grenade'), input.consume('grenade'), !fireIntent && !taunt.active && !melee.swinging);
      if (gEv?.type === 'pin') {
        sfx.pinPull();
        weapon.cancelReload();
        lastBeep = Math.ceil(grenadeData.pavio);
      } else if (gEv?.type === 'throw') {
        throwGrenade(gEv.fuseLeft);
        if (gEv.double) secondThrowIn = DOUBLE_THROW_GAP; // Dose Dupla: the second one follows
      } else if (gEv?.type === 'mine') {
        plantMine();
      } else if (gEv?.type === 'inHand') {
        const at = handPosition(new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), new THREE.Vector3());
        const id = grenadeSeq++;
        conn?.send({ t: 'grenade', id, p: vec3(at), v: [0, 0, 0], fuse: 0 });
        explode(at, id);
      }
      if (secondThrowIn !== null) {
        secondThrowIn -= dt;
        if (secondThrowIn <= 0) {
          secondThrowIn = null;
          if (!player.dead) {
            throwGrenade(0);
            thrower.throwT = 0;
          }
        }
      }
      // Our mines: an enemy stepping close sets one off.
      if (mines.own > 0) {
        const enemies = net ? net.targets().filter((p) => !p.dead).map((p) => p.position) : [...dummies.list, ...(bots?.bots ?? [])].filter((d) => !d.dead).map((d) => d.position);
        for (const m of mines.triggered(enemies)) explode(m.position, m.id);
      }
      const fuse = thrower.fuseLeft;
      if (fuse !== null && Math.ceil(fuse) < lastBeep) {
        lastBeep = Math.ceil(fuse);
        sfx.fuseBeep(1 - fuse / grenadeData.pavio);
      }

      const locked = taunt.active; // no moving, shooting or aiming while dancing
      let lunge: MoveInput['lunge'] = null;
      const wasLunging = lunging;
      if (melee.lunging && melee.target) {
        const p = melee.target.position;
        player.eye(1, eye);
        const dx = p.x - eye.x;
        const dz = p.z - eye.z;
        const dist = Math.hypot(dx, dz);
        // Close in until we're comfortably in reach, then stop.
        if (dist > melee.data.alcance * 0.6) {
          const v = melee.data.velocidadeInvestida;
          lunge = { x: (dx / dist) * v, z: (dz / dist) * v };
        }
      }
      lunging = lunge !== null;
      if (wasLunging && !lunging) {
        // End of the lunge: bleed off its speed so we stop at the target instead of sliding through it.
        const v = player.move.vel;
        const sp = Math.hypot(v.x, v.z);
        if (sp > 2) {
          v.x *= 2 / sp;
          v.z *= 2 / sp;
        }
      }
      const move: MoveInput = {
        forward: locked ? 0 : input.axis('forward', 'back', input.move.forward),
        right: locked ? 0 : input.axis('right', 'left', input.move.right),
        jump: !locked && (input.down('jump') || input.consume('jump')),
        crouch: !locked && input.down('crouch'),
        sprint: !locked && !melee.swinging && !fireIntent && input.down('sprint'),
        ads: !locked && !melee.swinging && !thrower.busy && input.down('ads'),
        yaw: player.yaw,
        speedMul: weapon.data.movimento * body.speedMul,
        lunge,
      };
      const ev = player.fixedStep(dt, move, simTime);
      if (ev.landed) {
        sfx.land(ev.fallHeight > 2.5);
        viewmodel.landed(ev.fallHeight);
      }
      if (ev.footstep) sfx.footstep(player.groundMaterial(), ev.footstep);
      if (player.move.slideStarted) {
        sfx.slide(player.groundMaterial());
        viewmodel.landed(1);
      }
      // Dust kicked up while sliding.
      if (player.move.sliding && Math.random() < 0.35) {
        playerFeet(feet);
        effects.burst('debris', feet.setY(feet.y + 0.05), UP, 2, 0xb8aa90);
      }
      if (ev.selfDamage) conn?.send({ t: 'selfDamage', amount: ev.selfDamage.amount, cause: ev.selfDamage.cause });
      dogTick();
      if (ev.damaged) {
        hud.damageFlash(ev.damaged);
        sfx.hurt();
      }
      if (ev.died) {
        taunt.cancel(simTime);
        dropCookedGrenade();
        sfx.sadTrombone();
        // Killed by a bot: the manager already recorded it; anything else is a death on our own.
        if (bots && ev.died !== 'killed') bots.kill(playerTarget, null, { kind: ev.died });
        const own = ev.died === 'killed' ? null : pick(DEATH_MESSAGES[getLang()][ev.died]);
        hud.showDeath(ev.died === 'killed' ? (deathMessage ?? '💀') : own!);
        hud.setDeathTimer(player.respawnIn(simTime));
      } else if (!player.dead) {
        if (melee.update(dt) === 'impact') resolveMelee();
        const done = taunt.update(dt, simTime);
        if (done) finishTaunt(done);
        const busy = taunt.active || melee.swinging || thrower.busy;
        weapon.update(dt, {
          fireHeld: !busy && input.down('fire'),
          firePressed: input.consume('fire') && !busy,
          adsHeld: !busy && input.down('ads'),
          reloadPressed: input.consume('reload') && !busy,
          sprinting: player.move.sprinting,
          grounded: player.move.grounded,
          crouched: player.move.crouched,
          speed: player.horizontalSpeed,
        });
      }
    }
    // Presses that arrived while dead shouldn't fire later.
    if (player.dead) {
      for (const a of ['fire', 'reload', 'jump', 'melee', 'taunt', 'grenade'] as const) input.consume(a);
    }

    for (const ex of grenades.fixedUpdate(dt)) explode(ex.position, ex.id);
    bots?.fixedUpdate(dt, simTime);
    if (playerRig) {
      // The hitboxes take the pose the others see (crouch, aim, reload...).
      const pose: HitPose = taunt.active
        ? { kind: 'dance', t: taunt.t }
        : {
            kind: 'armed',
            pose: {
              speed: player.horizontalSpeed,
              vel: { x: player.move.vel.x, z: player.move.vel.z },
              yaw: player.yaw,
              grounded: player.move.grounded,
              sprint: player.move.sprinting,
              crouch: player.move.crouched,
              slide: player.move.sliding,
              pitch: player.pitch,
              ads: weapon.ads > 0.5,
              reload: weapon.reloading,
              knife: melee.swinging,
              cook: thrower.cookT !== null,
            },
          };
      playerRig.follow(playerFeet(feet), player.yaw, !player.dead, pose, dt);
    }
    dummies.fixedUpdate(dt, simTime, (spot) => {
      const tr = player.mb.body.translation();
      return !player.dead && Math.hypot(tr.x - spot.x, tr.z - spot.z) < 0.9 && Math.abs(player.feet - spot.y) < 1.8;
    });
    physics.world.step();

    // Upload our state at NET.stateRate.
    if (conn && !player.dead) {
      stateTimer += dt;
      if (stateTimer >= 1 / NET.stateRate) {
        stateTimer = 0;
        const f =
          (player.move.crouched ? FLAG.crouch : 0) |
          (player.move.sprinting ? FLAG.sprint : 0) |
          (weapon.ads > 0.5 ? FLAG.ads : 0) |
          (weapon.reloading ? FLAG.reload : 0) |
          (taunt.active ? FLAG.dance : 0) |
          (thrower.cookT !== null ? FLAG.cook : 0) |
          (player.move.grounded ? FLAG.grounded : 0) |
          (melee.swinging ? FLAG.knife : 0) |
          (player.move.sliding ? FLAG.slide : 0);
        playerFeet(feet);
        conn.send({ t: 'state', s: { p: vec3(feet), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3), f } });
      }
    }
  };

  // --- Render frame ---------------------------------------------------------------------------------
  let showDebug = false;
  // F4 cycles: characters' hitboxes → characters + map colliders (and the bots' navmesh) → off.
  type DebugView = 'off' | 'chars' | 'all';
  let debugView: DebugView = 'off';
  const worldDebug = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
  worldDebug.frustumCulled = false;
  worldDebug.visible = false;
  ctx.scene.add(worldDebug);
  // What moves (characters' blockers and movement bodies, grenades, doors) is drawn every frame: a snapshot
  // a fraction of a second old trails behind a running player like a second one.
  const movingDebug = new THREE.LineSegments(new THREE.BufferGeometry(), worldDebug.material);
  movingDebug.frustumCulled = false;
  movingDebug.visible = false;
  ctx.scene.add(movingDebug);
  let worldDebugAge = Infinity;
  const fillDebug = (lines: THREE.LineSegments, { vertices, colors }: RAPIER.DebugRenderBuffers) => {
    lines.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    lines.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    lines.geometry.computeBoundingSphere();
  };
  /** Fixed map colliders from Rapier's debug renderer. */
  const refreshWorldDebug = () => {
    fillDebug(worldDebug, physics.world.debugRender(RAPIER.QueryFilterFlags.ONLY_FIXED));
    worldDebugAge = 0;
  };
  /** Moving colliders, but not character hitboxes (they have their own view) nor our own body (the camera's inside it). */
  const refreshMovingDebug = () => {
    const own = [player.mb.body.handle, playerRig?.body.handle];
    fillDebug(
      movingDebug,
      physics.world.debugRender(RAPIER.QueryFilterFlags.EXCLUDE_FIXED, (c) => ((c.collisionGroups() >>> 16) & GROUP.HITBOX) === 0 && !own.includes(c.parent()?.handle)),
    );
  };
  let hudTimer = 0;
  let fpsAvg = 60;
  let sprintVis = 0;
  let slideVis = 0;
  let renderTime = 0;
  const fpPos = new THREE.Vector3();
  const fpQuat = new THREE.Quaternion();
  const earFwd = new THREE.Vector3();
  const earUp = new THREE.Vector3();
  const tpPos = new THREE.Vector3();
  const tpQuat = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const mapFrame = { feet, listener: ctx.camera.position, launch: (vx: number, vy: number, vz: number) => player.launch(vx, vy, vz) };
  const deathCamPos = new THREE.Vector3();
  let deathFloorAt = -1;
  let deathFloorY = 0;
  const deathCamLook = new THREE.Vector3();
  const lookM = new THREE.Matrix4();

  let simMsAvg = 0;
  let renderMsAvg = 0;
  const tuning = new TuningPanel({ 'Primeira pessoa (VM_FEEL)': VM_FEEL, 'Terceira pessoa (ANIM)': ANIM }, (section) => {
    if (section.startsWith('Primeira')) viewmodel.retune();
  });
  // Aim assist (touch and controller, never the mouse; off by default): slows the look over an enemy and
  // follows them while the player is aiming (gameplay/aimAssist.ts).
  const aimAssist = new AimAssist();
  let lastAimInput = 99;
  const render = (alpha: number, frameDt: number) => {
    const tRender = performance.now();
    renderTime += frameDt;
    const [mdx, mdy] = input.takeMouse();
    if (input.consume('debug')) showDebug = !showDebug;
    // F6: live tuning of the first- and third-person feel. It stays open while playing (Esc frees the mouse
    // to move the sliders; click the game to go back and feel the change).
    if (input.consume('tuning')) tuning.toggle();
    if (input.consume('hitboxes')) {
      debugView = debugView === 'off' ? 'chars' : debugView === 'chars' ? 'all' : 'off';
      const chars = debugView !== 'off';
      dummies.setDebug(chars);
      net?.setDebug(chars);
      bots?.setDebug(chars);
      const navDebug = (window as unknown as { __ocNavDebug?: THREE.Object3D }).__ocNavDebug;
      if (navDebug) navDebug.visible = debugView === 'all';
      worldDebug.visible = movingDebug.visible = debugView === 'all';
      if (worldDebug.visible) refreshWorldDebug();
      hud.notice(t(debugView === 'chars' ? 'debugViewChars' : debugView === 'all' ? 'debugViewAll' : 'debugViewOff'));
    }
    // Map colliders can still be removed or added (props): a few times per second is enough for them.
    if (worldDebug.visible && (worldDebugAge += frameDt) > 0.2) refreshWorldDebug();
    if (movingDebug.visible) refreshMovingDebug();

    // Mouse look is applied per render frame for minimum latency; ADS scales by the zoom.
    if (input.locked && !player.dead && !taunt.active) {
      const zoomMul = 1 + (weapon.data.ads.zoom - 1) * weapon.ads;
      const adsMul = 1 + (settings.adsSensitivity - 1) * weapon.ads;
      lastAimInput = mdx || mdy || input.move.forward || input.move.right || gamepad.sinceStick < 0.05 ? 0 : lastAimInput + frameDt;
      const assist =
        settings.aimAssist && gamepad.device !== 'mouse'
          ? aimAssist.update(ctx.camera.position, player.yaw, player.pitch, targets(), frameDt, lastAimInput < 0.3)
          : { slow: 1, dYaw: 0, dPitch: 0 };
      const k = settings.sensitivity * MOUSE_DEG_PER_COUNT * DEG * zoomMul * adsMul * assist.slow;
      player.yaw -= mdx * k;
      player.pitch -= mdy * k * (settings.invertY ? -1 : 1);
      player.yaw += assist.dYaw;
      player.pitch += assist.dPitch;
      player.pitch = THREE.MathUtils.clamp(player.pitch, -89 * DEG, 89 * DEG);
    }

    sprintVis += ((player.move.sprinting ? 1 : 0) - sprintVis) * (1 - Math.exp(-8 * frameDt));
    slideVis += ((player.move.sliding ? 1 : 0) - slideVis) * (1 - Math.exp(-10 * frameDt));
    const cam = ctx.camera;
    player.eye(alpha, fpPos);
    const myCorpse = myCorpseId !== null ? (net?.corpses.get(myCorpseId) ?? bots?.corpses.get(myCorpseId)) : undefined;
    if (player.dead && myCorpse) {
      // Online death cam: behind our body, looking at whoever killed us (so we see the humiliation).
      const corpse = myCorpse.corpseCenter(new THREE.Vector3());
      const killer = killerId !== null ? (net?.players.get(killerId) ?? bots?.bots.find((b) => b.id === killerId)) : undefined;
      const focus = killer && killer.alive ? tmp.copy(killer.position).setY(killer.position.y + 1.1) : corpse;
      const away = new THREE.Vector3().subVectors(corpse, focus).setY(0);
      if (away.lengthSq() < 0.01) away.set(0, 0, 1);
      away.normalize();
      const wantPos = new THREE.Vector3().copy(corpse).addScaledVector(away, 3).setY(corpse.y + 2.2);
      const k = 1 - Math.exp(-4 * frameDt);
      if (simTime - player.deathAt < 0.05) {
        deathCamPos.copy(fpPos);
        deathCamLook.copy(focus);
      }
      deathCamPos.lerp(wantPos, k);
      deathCamLook.lerp(focus, k);
      lookM.lookAt(deathCamPos, deathCamLook, UP);
      fpPos.copy(deathCamPos);
      fpQuat.setFromRotationMatrix(lookM);
    } else {
      if (player.dead) {
        // Offline death cam: drop to the floor under the death spot (also when killed mid-air) and tilt.
        if (deathFloorAt !== player.deathAt) {
          deathFloorAt = player.deathAt;
          const hit = physics.world.castRay(new RAPIER.Ray({ x: fpPos.x, y: fpPos.y, z: fpPos.z }, { x: 0, y: -1, z: 0 }), 80, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, WORLD_ONLY);
          deathFloorY = hit ? fpPos.y - hit.timeOfImpact : fpPos.y - 1.2;
        }
        const d = Math.min(1, (simTime - player.deathAt) / 0.6);
        fpPos.y += (deathFloorY + 0.4 - fpPos.y) * d * d;
        euler.set(player.pitch * (1 - d) - d * 0.4, player.yaw, d * 0.5);
      } else {
        // Sliding rolls the camera slightly.
        euler.set(player.pitch + weapon.recoilPitch * DEG, player.yaw - weapon.recoilYaw * DEG, slideVis * 0.07);
      }
      // Explosion camera shake (trauma squared, decays quickly).
      if (shake > 0) {
        const k = shake * shake;
        const tt = renderTime * 40;
        euler.x += Math.sin(tt * 1.3) * 0.035 * k;
        euler.y += Math.sin(tt * 1.7 + 1) * 0.035 * k;
        euler.z += Math.sin(tt * 2.1 + 2) * 0.02 * k;
      }
      fpQuat.setFromEuler(euler);
    }
    shake = Math.max(0, shake - frameDt * 1.6);

    // Humiliation: blend into an orbiting third-person camera and show the dancing avatar.
    const blend = taunt.blend;
    playerFeet(feet, alpha);
    if (taunt.active) {
      taunt.cameraPose(physics, feet, tpPos, tpQuat);
      cam.position.lerpVectors(fpPos, tpPos, blend);
      cam.quaternion.slerpQuaternions(fpQuat, tpQuat, blend);
      avatar.root.position.copy(feet);
      avatar.root.rotation.y = player.yaw;
      avatar.dance(taunt.t);
    } else {
      cam.position.copy(fpPos);
      cam.quaternion.copy(fpQuat);
    }
    // The ears follow the camera.
    sfx.setListener(cam.position, earFwd.set(0, 0, -1).applyQuaternion(cam.quaternion), earUp.set(0, 1, 0).applyQuaternion(cam.quaternion), frameDt);
    avatar.visible = taunt.active && blend > 0.15;

    const zoom = 1 + (weapon.data.ads.zoom - 1) * weapon.ads;
    const fov = settings.fov * zoom * (1 + 0.05 * sprintVis + 0.08 * slideVis * (1 - weapon.ads));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const vmFov = VM_FOV * (1 - 0.1 * weapon.ads);
    if (Math.abs(ctx.vmCamera.fov - vmFov) > 0.01) {
      ctx.vmCamera.fov = vmFov;
      ctx.vmCamera.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    // Magnified scopes: fully aimed, the gun gives way to the scope view.
    const scopeView = viewmodel.scoped && weapon.ads > 0.85 && !player.dead && blend < 0.5;
    scopeEl.classList.toggle('hidden', !scopeView);
    viewmodel.root.visible = !player.dead && blend < 0.5 && !scopeView;
    mines.update(frameDt);
    viewmodel.update(frameDt, {
      ads: weapon.ads,
      sprint: sprintVis,
      grounded: player.move.grounded,
      speed: player.horizontalSpeed,
      strafe: player.strafeSpeed,
      mouseDX: mdx,
      mouseDY: mdy,
      reload: weapon.reloadProgress,
      slide: slideVis,
      melee: melee.progress,
      grenadeCook: thrower.cookT,
      grenadeThrow: thrower.throwT,
      crouch: player.move.crouchT,
    });

    // Animation LOD: far or off-screen characters pose less often.
    Avatar.setCamera(ctx.camera);
    dummies.render(alpha, frameDt, simTime);
    bots?.render(alpha, frameDt);
    net?.render(frameDt);
    for (const b of bots?.bots ?? []) {
      const m = b.move;
      playBody(-b.id, { feet: b.position, alive: !b.dead, grounded: m.grounded, sprint: m.sprinting, crouch: m.crouched, slide: m.sliding, reload: b.weapon.reloading }, frameDt, () => b.weapon.reloadDuration);
    }
    for (const p of net?.players.values() ?? []) {
      const f = p.flags;
      const w = { feet: p.position, alive: p.alive, grounded: !!(f & FLAG.grounded), sprint: !!(f & FLAG.sprint), crouch: !!(f & FLAG.crouch), slide: !!(f & FLAG.slide), reload: !!(f & FLAG.reload) };
      playBody(p.id, w, frameDt, () => rifleData((net?.info.get(p.id)?.lo ?? DEFAULT_LOADOUT).rifle).recarga.tatica);
    }
    grenades.render(alpha);
    effects.update(frameDt);
    map.update(frameDt, mapFrame);
    if (dog) {
      const near: THREE.Vector3[] = [];
      if (!player.dead) near.push(playerFeet(new THREE.Vector3(), alpha));
      for (const b of bots?.bots ?? []) if (!b.dead) near.push(b.position);
      for (const p of net?.targets() ?? []) if (!p.dead) near.push(p.position);
      dog.update(frameDt, near);
    }

    // Dynamic crosshair: the gap is the projected spread cone.
    const spread = weapon.spreadDeg({ grounded: player.move.grounded, sprinting: player.move.sprinting, speed: player.horizontalSpeed, crouched: player.move.crouched }) * DEG;
    const gap = (Math.tan(spread) / Math.tan((cam.fov * DEG) / 2)) * (window.innerHeight / 2) + 3;
    hud.setCrosshair(gap, weapon.ads < 0.6 && sprintVis < 0.5 && !player.dead && !taunt.active);

    // Context prompt: dancing progress, or "[E] Oprimir" over a fresh corpse.
    if (taunt.active && taunt.dummy) {
      hud.setPrompt(screens.keyName('taunt'), t('dancing', { name: taunt.dummy.name }), taunt.t / taunt.duration);
    } else {
      const corpse = !player.dead && input.locked ? nearestHumiliable(humiliables(), feet, HUMILIATION.radius, simTime) : null;
      if (corpse) hud.setPrompt(screens.keyName('taunt'), t('promptTaunt', { name: corpse.name }), corpse.humiliationTimeLeft(simTime) / HUMILIATION.window);
      else hud.setPrompt(null);
    }

    // Grenade HUD: fuse bar while cooking, warning pointing at any live grenade within its blast radius.
    const fuseLeft = thrower.fuseLeft;
    hud.setCook(fuseLeft === null ? null : fuseLeft / grenadeData.pavio);
    let warnAngle: number | null = null;
    let warnClose = 0;
    if (!player.dead) {
      let bestD = grenadeLvl.raioDano;
      for (const g of grenades.live) {
        const gp = g.mesh.position;
        const dist = gp.distanceTo(feet);
        if (dist > bestD) continue;
        bestD = dist;
        const dx = gp.x - feet.x;
        const dz = gp.z - feet.z;
        const fwd = -Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz;
        const side = Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz;
        warnAngle = Math.atan2(side, fwd);
        warnClose = 1 - dist / grenadeLvl.raioDano;
      }
    }
    hud.setGrenadeWarning(warnAngle, warnClose);

    // Scoreboard (Tab, online).
    const showBoard = (!!net || !!bots) && input.locked && input.down('scoreboard');
    scoreboard.visible = showBoard;
    if (showBoard && net && online) scoreboard.update(net.info.values(), me, online.joined.session.name);
    if (showBoard && bots && botMode) scoreboard.update(bots.standings(), me, t('botsSubtitle', { n: botMode.count }));

    hud.update(frameDt);
    // Every frame (the bar and the ring move): the reload, and what the touch buttons show.
    hud.setReload(weapon.reloadProgress);
    touch?.setStatus(thrower.count, weapon.reloadProgress, weapon.mag <= weapon.data.pente * 0.3 && weapon.reserve > 0);
    sfx.setMuffled(player.dead ? 0 : Math.max(0, (HEALTH.lowThreshold - player.health) / HEALTH.lowThreshold));

    quality.beforeRender();
    ctx.render();
    if (input.locked) quality.update(frameDt);
    renderMsAvg += (performance.now() - tRender - renderMsAvg) * 0.05;

    fpsAvg += (1 / Math.max(frameDt, 1e-4) - fpsAvg) * 0.05;
    hudTimer -= frameDt;
    if (hudTimer <= 0) {
      hudTimer = 1 / 15;
      hud.setHealth(player.health, player.maxHealth);
      hud.setAmmo(weapon.mag, weapon.reserve, weapon.data.pente, weapon.reloading);
      hud.setGrenades(thrower.count, grenadeData.quantidade);
      const mine = net?.info.get(me) ?? bots?.standings().find((p) => p.id === me);
      hud.setScore(mine ? mine.score : points, mine ? mine.kills : kills, shots ? hits / shots : 0);
      if (showDebug) {
        const info = ctx.renderer.info;
        const pos = cam.position;
        hud.setDebug(
          [
            `FPS ${fpsAvg.toFixed(0)}   draw calls ${info.render.calls}   tris ${(info.render.triangles / 1000).toFixed(1)}k`,
            `GPU ${quality.gpu}${quality.software ? '  ⚠ SOFTWARE' : ''}`,
            `CPU sim ${simMsAvg.toFixed(2)} ms/tick   render ${renderMsAvg.toFixed(2)} ms/frame   map build ${mapBuildMs.toFixed(0)} ms (${map.stats.meshes} meshes, ${map.stats.colliders} colliders)`,
            `quality ${quality.current}   pixel ratio ${quality.pixelRatio.toFixed(2)}   shadows ${ctx.renderer.shadowMap.enabled}`,
            ...(conn && net ? [`online: ${net.players.size + 1} jogadores   ping ${conn.rtt.toFixed(0)} ms   interp ${NET.interpDelayMs} ms`] : []),
            `pos ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}   speed ${player.horizontalSpeed.toFixed(2)} m/s`,
            `grounded ${player.move.grounded}  crouch ${player.move.crouched}  sprint ${player.move.sprinting}  slide ${player.move.sliding}`,
            `spread ${(spread / DEG).toFixed(2)}°  ads ${weapon.ads.toFixed(2)}  recoil ${weapon.recoilPitch.toFixed(2)}° / ${weapon.recoilYaw.toFixed(2)}°`,
            `last TTK ${lastTtk !== null ? `${(lastTtk * 1000).toFixed(0)} ms` : '-'}   ideal ${(idealTtk(weapon.data) * 1000).toFixed(0)} ms   last hit ${lastHitDist.toFixed(1)} m`,
            `shots ${shots}  hits ${hits}  time ${renderTime.toFixed(0)} s`,
          ].join('\n'),
        );
      } else {
        hud.setDebug(null);
      }
    }
  };

  // Dev-only handle for automated smoke tests and console poking.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __oc: {
        player, weapon, melee, taunt, thrower, grenades, input, dummies, net, conn, me, ctx, physics, quality, map, effects, bots, nav, RAPIER,
        mines, progress,
        trace: (o: THREE.Vector3, d: THREE.Vector3) => traceShot(physics, registry, o, d, weapon.data.alcanceMaximo, playerRig?.body, weapon.data.penetracao),
        stats: () => ({ shots, hits, kills, points, lastTtk }),
        perf: () => ({ boot, mapBuildMs, map: map.stats, simMsAvg, renderMsAvg, calls: ctx.renderer.info.render.calls, tris: ctx.renderer.info.render.triangles }),
      },
    });
  }

  // Render one frame behind the "click to play" card so the map is visible, then hand over to the loop.
  render(1, 0);
  mark('firstFrame');
  screens.showMenu('start');
  // Every handler exists now: messages that arrived while the map was being built go through.
  conn?.release();
  startLoop(step, render);
}

boot().catch((err) => {
  console.error(err);
  const tip = document.getElementById('loading-tip');
  if (tip) tip.textContent = `Erro ao iniciar: ${err instanceof Error ? err.message : String(err)}`;
});
