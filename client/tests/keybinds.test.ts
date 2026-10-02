// Remappable keys (client/core/keybinds.ts): a primary and an alternate key per action, a key used elsewhere
// leaves the other action's slot empty, Ctrl and the fixed F-keys are refused, saved settings are merged with
// the defaults action by action, and key names follow the player's keyboard layout.
import { describe, expect, it } from 'bun:test';
import {
  assign,
  clearSlot,
  DEFAULT_KEYBINDS,
  forbiddenReason,
  keyLabel,
  mergeKeybinds,
  toBindings,
} from '../core/keybinds';

describe('atribuir teclas', () => {
  it('põe uma tecla livre no espaço escolhido sem mexer no original', () => {
    const r = assign(DEFAULT_KEYBINDS, 'jump', 1, 'KeyV');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.keybinds.jump).toEqual(['Space', 'KeyV']);
    expect(r.cleared).toBeNull();
    expect(DEFAULT_KEYBINDS.jump).toEqual(['Space', null]);
  });

  it('tira a tecla da outra ação e diz qual espaço ficou vazio', () => {
    const r = assign(DEFAULT_KEYBINDS, 'jump', 0, 'KeyR');
    if (!r.ok) throw new Error('devia aceitar');
    expect(r.keybinds.jump).toEqual(['KeyR', null]);
    expect(r.keybinds.reload).toEqual([null, null]);
    expect(r.cleared).toEqual({ action: 'reload', slot: 0 });
  });

  it('só esvazia o espaço que tinha a tecla, a alternativa da outra ação fica', () => {
    const start = assign(DEFAULT_KEYBINDS, 'reload', 1, 'KeyT');
    if (!start.ok) throw new Error('devia aceitar');
    const r = assign(start.keybinds, 'jump', 0, 'KeyR');
    if (!r.ok) throw new Error('devia aceitar');
    expect(r.keybinds.reload).toEqual([null, 'KeyT']);
  });

  it('mover a tecla entre os espaços da mesma ação não gera aviso', () => {
    const r = assign(DEFAULT_KEYBINDS, 'forward', 1, 'KeyW');
    if (!r.ok) throw new Error('devia aceitar');
    expect(r.keybinds.forward).toEqual([null, 'KeyW']);
    expect(r.cleared).toBeNull();
  });

  it('aceita botões do mouse, inclusive os laterais', () => {
    const r = assign(DEFAULT_KEYBINDS, 'melee', 1, 'Mouse3');
    if (!r.ok) throw new Error('devia aceitar');
    expect(r.keybinds.melee).toEqual(['KeyF', 'Mouse3']);
  });

  it('recusa Ctrl e as teclas fixas, dizendo o motivo', () => {
    const ctrl = assign(DEFAULT_KEYBINDS, 'crouch', 0, 'ControlLeft');
    expect(ctrl).toEqual({ ok: false, reason: 'ctrl' });
    const f3 = assign(DEFAULT_KEYBINDS, 'jump', 1, 'F3');
    expect(f3).toEqual({ ok: false, reason: 'fixed' });
  });
});

describe('roda do mouse', () => {
  it('vale nas ações de um toque', () => {
    const r = assign(DEFAULT_KEYBINDS, 'jump', 1, 'WheelDown');
    if (!r.ok) throw new Error('devia aceitar');
    expect(r.keybinds.jump).toEqual(['Space', 'WheelDown']);
    for (const a of ['fire', 'reload', 'melee', 'grenade', 'taunt'] as const) expect(assign(DEFAULT_KEYBINDS, a, 1, 'WheelUp').ok).toBe(true);
  });

  it('é recusada nas ações de segurar (e no chat)', () => {
    for (const a of ['forward', 'sprint', 'crouch', 'ads', 'scoreboard', 'chat'] as const)
      expect(assign(DEFAULT_KEYBINDS, a, 1, 'WheelUp')).toEqual({ ok: false, reason: 'wheel' });
  });

  it('salva numa ação de segurar, é descartada ao carregar', () => {
    const kb = mergeKeybinds({ sprint: ['ShiftLeft', 'WheelUp'], jump: ['Space', 'WheelDown'] });
    expect(kb.sprint).toEqual(['ShiftLeft', null]);
    expect(kb.jump).toEqual(['Space', 'WheelDown']);
  });

  it('tem nome nos dois idiomas', () => {
    expect(keyLabel('WheelUp', 'pt-BR')).toBe('Roda para cima');
    expect(keyLabel('WheelDown', 'en')).toBe('Wheel down');
  });
});

describe('esvaziar um espaço (o ×)', () => {
  it('esvazia só o espaço escolhido, sem mexer no original', () => {
    const kb = clearSlot(DEFAULT_KEYBINDS, 'chat', 1);
    expect(kb.chat).toEqual(['Enter', null]);
    expect(DEFAULT_KEYBINDS.chat).toEqual(['Enter', 'KeyT']);
  });

  it('a tecla liberada pode ir para outra ação sem aviso', () => {
    const r = assign(clearSlot(DEFAULT_KEYBINDS, 'chat', 1), 'reload', 1, 'KeyT');
    if (!r.ok) throw new Error('devia aceitar');
    expect(r.cleared).toBeNull();
  });
});

describe('teclas proibidas', () => {
  it('Ctrl dos dois lados e F3, F4 e F6', () => {
    expect(forbiddenReason('ControlLeft')).toBe('ctrl');
    expect(forbiddenReason('ControlRight')).toBe('ctrl');
    for (const f of ['F3', 'F4', 'F6']) expect(forbiddenReason(f)).toBe('fixed');
  });

  it('o resto é permitido', () => {
    for (const c of ['KeyW', 'Space', 'ShiftLeft', 'F5', 'Mouse0', 'Mouse4']) expect(forbiddenReason(c)).toBeNull();
  });
});

describe('carregar o que foi salvo', () => {
  it('sem nada salvo, volta o padrão (uma cópia, não o próprio objeto)', () => {
    const kb = mergeKeybinds(undefined);
    expect(kb).toEqual(DEFAULT_KEYBINDS);
    expect(kb).not.toBe(DEFAULT_KEYBINDS);
    expect(kb.jump).not.toBe(DEFAULT_KEYBINDS.jump);
  });

  it('ação que não estava salva (ação nova no jogo) recebe o padrão', () => {
    const kb = mergeKeybinds({ jump: ['KeyV', null] });
    expect(kb.jump).toEqual(['KeyV', null]);
    expect(kb.reload).toEqual(DEFAULT_KEYBINDS.reload);
  });

  it('respeita um espaço que o jogador deixou vazio de propósito', () => {
    expect(mergeKeybinds({ reload: [null, null] }).reload).toEqual([null, null]);
  });

  it('descarta lixo: ação desconhecida, formato errado, tecla proibida', () => {
    const kb = mergeKeybinds({ voar: ['KeyQ', null], jump: 'Space', reload: ['ControlLeft', 42], crouch: [] });
    expect(kb).not.toHaveProperty('voar');
    expect(kb.jump).toEqual(DEFAULT_KEYBINDS.jump);
    expect(kb.reload).toEqual([null, null]);
    expect(kb.crouch).toEqual(DEFAULT_KEYBINDS.crouch);
  });

  it('se a mesma tecla aparecer duas vezes, só a primeira fica', () => {
    const kb = mergeKeybinds({ forward: ['KeyQ', null], back: ['KeyQ', 'KeyS'] });
    expect(kb.forward).toEqual(['KeyQ', null]);
    expect(kb.back).toEqual([null, 'KeyS']);
  });

  it('padrão salvo por cima de um espaço livre não duplica tecla', () => {
    // Saved before KeyE existed as the taunt default: the player had put it on jump.
    const kb = mergeKeybinds({ jump: ['KeyE', null] });
    expect(kb.jump).toEqual(['KeyE', null]);
    expect(kb.taunt[0]).toBeNull();
  });
});

describe('tabela usada pelo Input', () => {
  it('junta as duas teclas, pula os vazios e inclui as fixas', () => {
    const r = assign(DEFAULT_KEYBINDS, 'jump', 1, 'KeyV');
    if (!r.ok) throw new Error('devia aceitar');
    const b = toBindings(r.keybinds);
    expect(b.jump).toEqual(['Space', 'KeyV']);
    expect(b.forward).toEqual(['KeyW']);
    expect(b.chat).toEqual(['Enter', 'KeyT']);
    expect(b.debug).toEqual(['F3']);
    expect(b.hitboxes).toEqual(['F4']);
    expect(b.tuning).toEqual(['F6']);
  });

  it('ação sem tecla fica com a lista vazia', () => {
    expect(toBindings(mergeKeybinds({ reload: [null, null] })).reload).toEqual([]);
  });
});

describe('nome das teclas', () => {
  it('letras e números pelo código, em QWERTY', () => {
    expect(keyLabel('KeyW', 'pt-BR')).toBe('W');
    expect(keyLabel('Digit1', 'en')).toBe('1');
  });

  it('teclas com nome, nos dois idiomas', () => {
    expect(keyLabel('Space', 'pt-BR')).toBe('Espaço');
    expect(keyLabel('Space', 'en')).toBe('Space');
    expect(keyLabel('ShiftLeft', 'pt-BR')).toBe('Shift esquerdo');
    expect(keyLabel('ShiftLeft', 'en')).toBe('Left Shift');
  });

  it('botões do mouse', () => {
    expect(keyLabel('Mouse0', 'pt-BR')).toBe('Botão esquerdo');
    expect(keyLabel('Mouse2', 'en')).toBe('Right click');
    expect(keyLabel('Mouse3', 'en')).toBe('Mouse 4');
  });

  it('usa o mapa do teclado do navegador (AZERTY no Chrome/Edge)', () => {
    const azerty = new Map([['KeyW', 'z'], ['KeyQ', 'a']]);
    expect(keyLabel('KeyW', 'pt-BR', azerty)).toBe('Z');
  });

  it('sem o mapa (Firefox), usa a letra aprendida quando o jogador trocou a tecla', () => {
    expect(keyLabel('KeyQ', 'pt-BR', undefined, { KeyQ: 'a' })).toBe('A');
    expect(keyLabel('KeyW', 'pt-BR', undefined, { KeyQ: 'a' })).toBe('W');
  });

  it('código desconhecido aparece como veio', () => {
    expect(keyLabel('IntlRo', 'en')).toBe('IntlRo');
  });
});
