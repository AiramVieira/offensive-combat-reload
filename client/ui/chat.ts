// Session chat (online only). The last lines float over the game and fade after a while; the chat keys open
// the text box on a computer (Enter sends, Esc closes), the chat button on a phone, where one-tap phrases
// send without opening the keyboard. The server sanitizes, rate-limits and relays every line (server/
// session.ts) and the sender gets their own line back, so everyone sees the same thing. Lines are always
// written with textContent, never as HTML.
import { NET, sanitizeChat } from '@shared/protocol';
import { IS_MOBILE } from '../core/device';
import { BINDINGS, type Input } from '../core/input';
import { getLang, QUICK_CHAT, t } from './strings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Lines kept (scrollable while the chat is open). */
const KEEP = 40;
/** A line stays over the game this long with the chat closed. */
const SHOW_MS = 10_000;

export class Chat {
  private root = $('chat');
  private log = $('chat-log');
  private form = $<HTMLFormElement>('chat-form');
  private field = $<HTMLInputElement>('chat-input');
  private enabled = false;
  private opened = false;
  /** A line to send (already sanitized). */
  onSend: (text: string) => void = () => {};

  constructor(private input: Input) {
    this.field.maxLength = NET.chatMax;
    this.field.placeholder = t('chatPlaceholder');
    $('chat-send').textContent = t('chatSend');
    $('chat-close').setAttribute('aria-label', t('chatClose'));
    $('chat-hint').textContent = t('chatHint');
    // Phones: one tap sends a phrase (the keyboard would cover half the screen mid-fight).
    const quick = $('chat-quick');
    if (IS_MOBILE)
      for (const phrase of QUICK_CHAT[getLang()]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = phrase;
        b.addEventListener('click', () => this.submit(phrase));
        quick.appendChild(b);
      }
    // Computer: the chat keys (Enter or T by default) while playing open it (preventDefault: the T isn't typed
    // into the box).
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || this.opened || !this.input.locked || e.repeat) return;
      if (!BINDINGS.chat.includes(e.code)) return;
      e.preventDefault();
      this.open();
    });
    // Esc closes only the chat (the game's own Esc, the menu, must not see it). The chat let go of the mouse
    // itself, so the browser gives it back without a click; if it doesn't, the next key or click does.
    this.field.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.close(false);
      if (IS_MOBILE || !this.input.locked) return;
      void this.input.lock().then((got) => {
        if (!got) this.system(t('aimOnNextKey'));
      });
    });
    this.field.addEventListener('focus', () => this.input.setTyping(true));
    this.field.addEventListener('blur', () => {
      this.input.setTyping(false);
      // Computer: clicking the game while typing leaves the chat.
      if (!IS_MOBILE) this.close(false);
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(this.field.value);
    });
    $('chat-close').addEventListener('click', () => this.close());
  }

  /** Online only: offline and against bots there's no one to talk to. */
  enable(on: boolean) {
    this.enabled = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.close();
  }

  get isOpen() {
    return this.opened;
  }

  open() {
    if (!this.enabled || this.opened) return;
    this.opened = true;
    this.root.classList.add('open');
    this.form.classList.remove('hidden');
    this.log.scrollTop = this.log.scrollHeight;
    // Phones: the keyboard only comes up when the box itself is tapped (the phrases don't need it).
    if (IS_MOBILE) return;
    // Computer: the mouse is let go while typing, so Esc reaches the box instead of opening the menu.
    this.input.releaseMouse();
    this.field.focus();
  }

  /** `relock`: take the mouse back for the game (only works inside a key press or a click, e.g. Enter). */
  close(relock = true) {
    if (!this.opened) return;
    this.opened = false;
    this.field.value = '';
    this.field.blur();
    this.input.setTyping(false);
    this.form.classList.add('hidden');
    this.root.classList.remove('open');
    if (relock && !IS_MOBILE && this.input.locked) void this.input.lock();
  }

  toggle() {
    if (this.opened) this.close();
    else this.open();
  }

  private submit(raw: string) {
    const text = sanitizeChat(raw);
    if (text) this.onSend(text);
    this.close();
  }

  /** A player's line (`mine`: ours, as the server accepted it). */
  add(name: string, text: string, mine: boolean) {
    const line = this.line(mine ? 'mine' : '');
    const who = document.createElement('b');
    who.textContent = name;
    const what = document.createElement('span');
    what.textContent = text;
    line.append(who, what);
  }

  /** A line from the game itself (muted, too fast). */
  system(text: string) {
    this.line('system').textContent = text;
  }

  private line(kind: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `chat-line ${kind}`;
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.appendChild(el);
    while (this.log.children.length > KEEP) this.log.firstElementChild!.remove();
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => el.classList.add('old'), SHOW_MS);
    return el;
  }
}
