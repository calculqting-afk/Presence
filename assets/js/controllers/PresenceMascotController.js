import { AttendanceViews } from './AttendanceViews.js';
import { EventAudiencePolicy } from './EventAudiencePolicy.js';

const states = new Set(['idle', 'welcome', 'checking', 'success', 'attention', 'goodbye']);

// This is friendly schedule guidance only; taking attendance still uses Events.
export function mascotEventMessage({ events = [], ready = false, student, role = 'student' } = {}, now = Date.now()) {
  if (!ready) return { key: '', text: 'Let’s check today’s events together!' };
  const sessions = events.filter(event => role === 'admin' || EventAudiencePolicy.canAttend(student, event));
  const current = sessions.filter(event => now >= AttendanceViews.time(event, 'openAt') && now <= AttendanceViews.time(event, 'checkOutClosesAt'))
    .sort((a, b) => AttendanceViews.time(a, 'openAt') - AttendanceViews.time(b, 'openAt'))[0];
  const upcoming = sessions.filter(event => now < AttendanceViews.time(event, 'openAt'))
    .sort((a, b) => AttendanceViews.time(a, 'openAt') - AttendanceViews.time(b, 'openAt'))[0];
  const event = current || upcoming;
  if (!event) return { key: '', text: 'No current event. Have a lovely day!' };
  const name = AttendanceViews.title(event).slice(0, 100), session = AttendanceViews.label(event);
  return { key: current ? `${event.id}:${event.date}:${session}` : '', text: current
    ? `“${name}” · ${session} is happening now. ${role === 'admin' ? 'You’ve got this!' : 'Check Events for your attendance.'}`
    : `Next up: “${name}” · ${session}. You’ve got this!` };
}

// Only fixed presentation states enter markup; attendance and authorization stay authoritative.
export function mascotMarkup(state = 'idle') {
  const safeState = states.has(state) ? state : 'idle';
  return `<span class="presence-mascot" data-mascot-state="${safeState}" aria-hidden="true"><span class="mascot-sprite"></span><span class="mascot-dots"><i></i><i></i><i></i></span></span>`;
}

export function mascotStateForFeedback(title, { attendanceSuccess = false, mascotState } = {}) {
  if (states.has(mascotState)) return mascotState;
  if (attendanceSuccess) return 'success';
  if (/logged out successfully/i.test(title)) return 'goodbye';
  if (/logged in successfully/i.test(title)) return 'welcome';
  if (/unable|unavailable|failed|error|denied|rejected|window closed|view-only|invalid|required|missing|offline|permission|needs review|session ended|not confirmed|unchanged|pending|unknown/i.test(title)) return 'attention';
  if (/checking|verifying|loading|saving|signing in|waiting for the server/i.test(title)) return 'checking';
  if (/saved|updated|created|registered|recorded|changed|approved|declined|removed|completed|reset|published|refreshed|sent|revoked/i.test(title)) return 'success';
  return 'idle';
}

export function emitMascot(document, state, { onlyIfChecking = false } = {}) {
  const Event = document?.defaultView?.CustomEvent;
  if (Event && states.has(state)) document.dispatchEvent(new Event('presence:mascot', { detail: { state, onlyIfChecking } }));
}

export function refreshMascotContext(document) {
  const Event = document?.defaultView?.CustomEvent;
  if (Event) document.dispatchEvent(new Event('presence:mascot-context'));
}

// One dashboard owner, one reaction timer. All listeners are removed at teardown.
export class PresenceMascotController {
  constructor({ document = globalThis.document, getContext = () => ({}), now = () => Date.now(), random = Math.random,
    schedule = (callback, delay = 2200) => setTimeout(callback, delay), cancel = timer => clearTimeout(timer) } = {}) {
    Object.assign(this, { document, getContext, now, random, schedule, cancel });
    this.onReaction = event => this.react(event.detail?.state, event.detail?.onlyIfChecking);
    this.onTap = () => this.tap();
    this.onContext = () => this.refreshContext();
    this.announced = new Set();
  }
  initialize() {
    if (this.initialized) return this;
    this.initialized = true;
    this.mascots = [...(this.document.querySelectorAll?.('[data-presence-mascot] .presence-mascot') || [])];
    this.button = this.document.querySelector?.('[data-mascot-hello]');
    this.bubble = this.document.querySelector?.('[data-mascot-bubble]');
    this.button?.addEventListener('click', this.onTap);
    this.document.addEventListener?.('presence:mascot', this.onReaction);
    this.document.addEventListener?.('presence:mascot-context', this.onContext);
    return this;
  }
  visible() { return this.button && !this.document.hidden && !this.button.closest('[hidden], [inert]'); }
  refreshContext() {
    const message = mascotEventMessage(this.getContext(), this.now());
    if (this.contextKey && this.contextKey !== message.key) this.hideBubble();
    this.contextKey = message.key;
    if (!this.visible() || !message.key || this.announced.has(message.key) || this.state === 'checking') return;
    this.announced.add(message.key);
    this.speak(message.text);
  }
  speak(text) {
    if (!this.bubble) return;
    if (this.bubbleTimer != null) this.cancel(this.bubbleTimer);
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    this.bubbleTimer = this.schedule(() => this.hideBubble(), 6500);
  }
  hideBubble() {
    if (this.bubbleTimer != null) this.cancel(this.bubbleTimer);
    this.bubbleTimer = null;
    if (this.bubble) { this.bubble.hidden = true; this.bubble.textContent = ''; }
  }
  tap() {
    if (!this.visible() || this.playTimer != null) return;
    if (this.state === 'checking') { this.speak('One moment, I’m checking something for you…'); return; }
    if (this.state && !['idle', 'welcome', 'goodbye'].includes(this.state)) return;
    // A playful bounce never uses the confirmed-attendance checkmark pose.
    this.react('idle');
    const effects = ['wave', 'bounce', 'wiggle'];
    this.button.dataset.mascotEffect = effects[Math.min(2, Math.floor(this.random() * effects.length))];
    const message = mascotEventMessage(this.getContext(), this.now());
    if (message.key) this.announced.add(message.key);
    this.speak(message.text);
    this.playTimer = this.schedule(() => this.clearPlay());
  }
  clearPlay() {
    if (this.playTimer != null) this.cancel(this.playTimer);
    this.playTimer = null;
    if (this.button) delete this.button.dataset.mascotEffect;
  }
  react(state, onlyIfChecking = false) {
    if (!states.has(state) || (onlyIfChecking && this.state !== 'checking')) return;
    if (this.timer != null) this.cancel(this.timer);
    this.clearPlay();
    this.timer = null;
    this.state = state;
    for (const mascot of this.mascots || []) mascot.dataset.mascotState = state;
    if (state !== 'idle' && state !== 'checking') this.timer = this.schedule(() => this.react('idle'));
  }
  dispose() {
    if (this.timer != null) this.cancel(this.timer);
    this.timer = null;
    this.document.removeEventListener?.('presence:mascot', this.onReaction);
    this.document.removeEventListener?.('presence:mascot-context', this.onContext);
    this.button?.removeEventListener('click', this.onTap);
    this.clearPlay();
    this.hideBubble();
    this.announced.clear();
    this.initialized = false;
    this.mascots = [];
  }
}
