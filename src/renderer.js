'use strict';

const { ActivationModel, PAUSE_THRESHOLD } = require('./activation');
const { analyzeText } = require('./textcues');
const { Pacer, startPace } = require('./pacer');
const { SdkSource, SimSource } = require('./signals');

const params = new URLSearchParams(location.search);
const DEMO = params.get('demo') === '1';

const BREATHE_MS = 60_000;
const TRACE_WINDOW_MS = 20_000;

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
    'to', 'subject', 'body', 'cues', 'cues-list', 'send-note', 'btn-draft', 'btn-send',
    'sim-badge', 'camera-pill', 'camera-pill-text', 'btn-camera',
    'preview', 'preview-off', 'validation', 'r-pulse', 'r-breath', 'r-hrv',
    'meter-fill', 'meter-label', 'baseline-note', 'sim-panel', 'sim-slider', 'sim-value', 'outbox',
    'consent', 'telemetry', 'expressions', 'consent-error', 'btn-no-camera', 'btn-sim', 'btn-allow',
    'pause', 'pause-reasons', 'pause-cues', 'btn-send-anyway', 'btn-pause-draft', 'btn-breathe',
    'breathe', 'breathe-cue', 'orb', 'b-pace', 'b-you', 'b-pulse', 'b-timer', 'trace', 'trace-label', 'btn-breathe-done',
    'after', 'after-compare', 'btn-after-draft', 'btn-after-review',
].map((id) => [id, $(id)]));

const model = new ActivationModel();
let source = null;
let signalsOk = true;
// After a breathing session the current draft is sent without another pause.
let breathedForDraft = false;
const traceBuf = [];
const outbox = [];

els.body.value = [
    'Jordan,',
    '',
    "I just found out the launch slipped AGAIN and I had to hear it from the client. This is the third time. You always say it's under control and it never is!!",
    '',
    "Per my last email, I need a real date by tomorrow or I'm escalating.",
].join('\n');

// ---------- Signal source lifecycle ----------

function handlers() {
    return {
        onPreview: (url) => {
            els.preview.src = url;
            els['preview-off'].hidden = true;
        },
        onStatus: () => {},
        onValidation: (ok, name, hint) => {
            signalsOk = ok || name === 'CameraTuning';
            els.validation.textContent = ok ? '' : friendlyValidation(name, hint);
            els.validation.classList.toggle('bad', !ok);
        },
        onError: (msg) => showError(msg),
        onFatal: async (msg) => {
            await stopSource();
            showError(msg);
        },
        onSample: (s) => {
            if (!signalsOk) return; // e.g. two faces in view: ignore readings
            model.push(s);
            for (const p of s.trace) traceBuf.push(p);
            const cutoff = Date.now() - TRACE_WINDOW_MS;
            while (traceBuf.length && traceBuf[0].t < cutoff) traceBuf.shift();
            renderReadouts();
        },
    };
}

function friendlyValidation(name, hint) {
    const map = {
        NoFaceFound: 'Looking for your face…',
        MultipleFacesFound: 'More than one face in view. Sensing is paused so only you are read.',
        FaceNotCentered: 'Center your face in the camera.',
        TooDark: 'It is a bit dark. More light helps.',
        TooBright: 'Too much light behind or on you.',
        ExcessiveMotion: 'Try to sit still for a moment.',
        FaceTooClose: 'Lean back a little.',
        FaceTooFar: 'Come a little closer.',
        ChestNotVisible: 'Breathing works best with your shoulders in view.',
        FaceTooHigh: 'Move down a little, or tilt the camera up.',
        FaceTooLow: 'Move up a little, or tilt the camera down.',
        FaceNotForward: 'Face the screen.',
        FrameRateTooLow: 'The camera is running slowly. More light on your face usually fixes this.',
        CameraTuning: 'Adjusting the camera…',
    };
    return map[name] || hint || name;
}

async function startSource(kind) {
    els['consent-error'].hidden = true;
    try {
        if (kind === 'sim') {
            source = new SimSource({ handlers: handlers() });
        } else {
            if (!window.bbs) throw new Error('Sensing is unavailable in this window.');
            source = new SdkSource({ telemetry: els.telemetry.checked, expressions: els.expressions.checked, handlers: handlers() });
        }
        model.reset();
        traceBuf.length = 0;
        await source.start();
        els.consent.hidden = true;
        setCameraState(true);
        renderReadouts();
    } catch (err) {
        source = null;
        els['consent-error'].textContent = err.message;
        els['consent-error'].hidden = false;
    }
}

async function stopSource() {
    if (source) await source.destroy();
    source = null;
    model.reset();
    els.preview.removeAttribute('src');
    els['preview-off'].hidden = false;
    setCameraState(false);
    renderReadouts();
}

function setCameraState(on) {
    const sim = on && source && source.simulated;
    els['camera-pill'].className = 'pill ' + (on && !sim ? 'pill-on' : 'pill-off');
    els['camera-pill-text'].textContent = on ? (sim ? 'Camera off, simulated' : 'Camera on, on-device') : 'Camera off';
    els['btn-camera'].hidden = false;
    els['btn-camera'].textContent = on ? 'Turn sensing off' : 'Turn sensing on';
    els['sim-badge'].hidden = !sim;
    els['sim-panel'].hidden = !sim;
    if (sim) els['preview-off'].textContent = 'Simulated signals, no camera';
    else els['preview-off'].textContent = 'Camera is off';
}

function showError(msg) {
    els.validation.textContent = msg;
    els.validation.classList.add('bad');
}

// ---------- Readouts ----------

function renderReadouts() {
    const l = model.latest;
    els['r-pulse'].textContent = l.pulse != null ? Math.round(l.pulse) : '—';
    els['r-breath'].textContent = l.breathing != null ? Math.round(l.breathing) : '—';
    els['r-hrv'].textContent = l.hrv != null ? Math.round(l.hrv) : '—';

    const now = Date.now();
    if (!source) {
        els['meter-label'].textContent = 'Off';
        els['meter-fill'].style.width = '0%';
        els['baseline-note'].textContent = 'Sensing is off. Send works like a normal Send button.';
        return;
    }
    if (!model.baselineReady) {
        const pct = Math.round(model.baselineProgress(now) * 100);
        els['meter-label'].textContent = `Learning your baseline ${pct}%`;
        els['meter-fill'].style.width = `${pct}%`;
        els['meter-fill'].className = 'meter-fill';
        els['baseline-note'].textContent = 'Sit as you normally would. We compare you only to yourself from this session.';
        return;
    }
    const s = Math.round(model.score);
    els['meter-fill'].style.width = `${Math.min(100, s)}%`;
    els['meter-fill'].className = 'meter-fill' + (s >= PAUSE_THRESHOLD ? ' hot' : s >= 30 ? ' warm' : '');
    els['meter-label'].textContent = s >= PAUSE_THRESHOLD ? 'Activated' : s >= 30 ? 'Rising' : 'Settled';
    const b = model.baseline;
    els['baseline-note'].textContent = `Your baseline: pulse ${fmt(b.pulse)}, breathing ${fmt(b.breathing)}/min${b.hrv != null ? `, HRV ${fmt(b.hrv)} ms` : ''}.`;
}

const fmt = (v) => (v == null ? '—' : Math.round(v));

// ---------- Composer ----------

function renderCues() {
    const { hits } = analyzeText(els.body.value);
    els['cues-list'].innerHTML = '';
    if (hits.length === 0) { els.cues.hidden = true; return; }
    const byLabel = new Map();
    for (const h of hits) {
        if (!byLabel.has(h.label)) byLabel.set(h.label, []);
        byLabel.get(h.label).push(h.match);
    }
    for (const [label, matches] of byLabel) {
        const li = document.createElement('li');
        li.append(`${label}: `);
        [...new Set(matches)].forEach((m, i) => {
            if (i) li.append(' ');
            const span = document.createElement('span');
            span.className = 'cue-match';
            span.textContent = m;
            li.append(span);
        });
        els['cues-list'].append(li);
    }
    els.cues.hidden = false;
}

function trySend() {
    const text = els.body.value.trim();
    if (!text) return;
    const cues = analyzeText(text);
    if (source && !breathedForDraft && model.shouldPause(cues.score)) {
        openPause(cues);
        return;
    }
    send('sent');
}

function send(kind) {
    outbox.unshift({ kind, to: els.to.value, subject: els.subject.value || '(no subject)', at: new Date(), breathed: breathedForDraft });
    renderOutbox();
    els['send-note'].textContent = kind === 'sent' ? 'Sent (to the local outbox).' : 'Saved as draft.';
    setTimeout(() => { els['send-note'].textContent = ''; }, 3500);
    if (kind === 'sent') {
        els.body.value = '';
        els.subject.value = '';
        breathedForDraft = false;
        els.cues.hidden = true;
    }
}

function renderOutbox() {
    els.outbox.innerHTML = '';
    for (const m of outbox) {
        const li = document.createElement('li');
        const sub = document.createElement('div');
        sub.className = 'o-sub';
        sub.textContent = m.subject;
        const meta = document.createElement('div');
        meta.className = 'o-meta';
        meta.textContent = `${m.kind === 'sent' ? 'Sent' : 'Draft'} to ${m.to} at ${m.at.toLocaleTimeString()}${m.breathed ? ', after a breath' : ''}`;
        li.append(sub, meta);
        els.outbox.append(li);
    }
}

// ---------- Pause and breathing ----------

function openPause(cues) {
    els['pause-reasons'].innerHTML = '';
    const reasons = model.reasons();
    if (reasons.length === 0) reasons.push('Several small signals are up at the same time.');
    for (const r of reasons) {
        const li = document.createElement('li');
        li.textContent = r;
        els['pause-reasons'].append(li);
    }
    els['pause-cues'].hidden = cues.labels.length === 0;
    els['pause-cues'].textContent = cues.labels.length ? `In the message: ${cues.labels.join(', ').toLowerCase()}.` : '';
    els.pause.hidden = false;
}

let breath = null;

function startBreathing() {
    els.pause.hidden = true;
    els.breathe.hidden = false;
    els['trace-label'].textContent = source && source.simulated
        ? 'Simulated chest movement (line) and the guide (shaded)'
        : 'Your chest movement from the camera (line) and the guide (shaded)';
    const l = model.latest;
    breath = {
        pacer: new Pacer(startPace(l.breathing)),
        startedAt: performance.now(),
        lastFrame: performance.now(),
        before: { pulse: l.pulse, breathing: l.breathing, score: model.score },
        guide: [],
        raf: 0,
    };
    breath.raf = requestAnimationFrame(breathFrame);
}

function breathFrame(now) {
    const dt = now - breath.lastFrame;
    breath.lastFrame = now;
    const elapsed = now - breath.startedAt;
    const g = breath.pacer.step(dt);

    breath.guide.push({ t: Date.now(), v: g.level });
    const cutoff = Date.now() - TRACE_WINDOW_MS;
    while (breath.guide.length && breath.guide[0].t < cutoff) breath.guide.shift();

    // Let the simulator respond to the session so the demo shows recovery.
    if (source && source.simulated) {
        const v = Math.max(0, Number(els['sim-slider'].value) - dt * 0.0012);
        els['sim-slider'].value = v;
        source.setActivation(v / 100);
        els['sim-value'].textContent = `${Math.round(v)}%`;
    }

    els['breathe-cue'].textContent = g.inhale ? 'Breathe in' : 'Breathe out';
    els['b-pace'].textContent = g.bpm.toFixed(1);
    els['b-you'].textContent = fmt(model.latest.breathing);
    els['b-pulse'].textContent = fmt(model.latest.pulse);
    const secs = Math.ceil(Math.max(0, BREATHE_MS - elapsed) / 1000);
    els['b-timer'].textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

    drawOrb(g.level);
    drawTrace();

    if (elapsed >= BREATHE_MS) { finishBreathing(); return; }
    breath.raf = requestAnimationFrame(breathFrame);
}

function drawOrb(level) {
    const c = els.orb;
    const ctx = c.getContext('2d');
    const w = c.width;
    const r = w * (0.2 + 0.22 * level);
    ctx.clearRect(0, 0, w, w);
    const grad = ctx.createRadialGradient(w / 2, w / 2, r * 0.1, w / 2, w / 2, r);
    grad.addColorStop(0, 'rgba(180, 240, 220, 0.95)');
    grad.addColorStop(1, 'rgba(60, 150, 125, 0.35)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 240, 220, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, w / 2, w * 0.42, 0, Math.PI * 2);
    ctx.stroke();
}

// Guide as a shaded area, the user's chest trace as a line, both normalized.
function drawTrace() {
    const c = els.trace;
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    ctx.clearRect(0, 0, w, h);
    const now = Date.now();
    const x = (t) => w - ((now - t) / TRACE_WINDOW_MS) * w;

    if (breath.guide.length > 1) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--calm-guide');
        ctx.beginPath();
        ctx.moveTo(x(breath.guide[0].t), h);
        for (const p of breath.guide) ctx.lineTo(x(p.t), h - p.v * (h - 8) - 4);
        ctx.lineTo(x(breath.guide[breath.guide.length - 1].t), h);
        ctx.closePath();
        ctx.fill();
    }

    if (traceBuf.length > 1) {
        let lo = Infinity, hi = -Infinity;
        for (const p of traceBuf) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
        const span = hi - lo || 1;
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--calm-line');
        ctx.lineWidth = 2;
        ctx.beginPath();
        traceBuf.forEach((p, i) => {
            const y = h - ((p.v - lo) / span) * (h - 8) - 4;
            if (i === 0) ctx.moveTo(x(p.t), y); else ctx.lineTo(x(p.t), y);
        });
        ctx.stroke();
    }
}

function finishBreathing() {
    cancelAnimationFrame(breath.raf);
    els.breathe.hidden = true;
    breathedForDraft = true;
    const b = breath.before;
    const l = model.latest;
    els['after-compare'].innerHTML = '';
    const tile = (label, before, after, unit) => {
        const d = document.createElement('div');
        d.className = 'c';
        const t = document.createElement('div');
        t.className = 'r-label';
        t.textContent = label;
        const v = document.createElement('b');
        v.textContent = `${fmt(before)} → ${fmt(after)}`;
        const u = document.createElement('span');
        u.className = 'r-unit';
        u.textContent = ` ${unit}`;
        d.append(t, v, u);
        return d;
    };
    els['after-compare'].append(
        tile('Pulse', b.pulse, l.pulse, 'bpm'),
        tile('Breathing', b.breathing, l.breathing, '/min'),
        tile('Activation', b.score, model.score, ''),
    );
    els.after.hidden = false;
}

// ---------- Wiring ----------

els['btn-allow'].addEventListener('click', () => startSource('sdk'));
els['btn-sim'].addEventListener('click', () => startSource('sim'));
els['btn-no-camera'].addEventListener('click', () => { els.consent.hidden = true; setCameraState(false); renderReadouts(); });
els['btn-camera'].addEventListener('click', () => (source ? stopSource() : (els.consent.hidden = false)));

els['btn-send'].addEventListener('click', trySend);
els['btn-draft'].addEventListener('click', () => send('draft'));
els.body.addEventListener('input', () => { if (!els.cues.hidden) renderCues(); });

els['btn-send-anyway'].addEventListener('click', () => { els.pause.hidden = true; send('sent'); });
els['btn-pause-draft'].addEventListener('click', () => { els.pause.hidden = true; send('draft'); });
els['btn-breathe'].addEventListener('click', startBreathing);
els['btn-breathe-done'].addEventListener('click', finishBreathing);
els['btn-after-draft'].addEventListener('click', () => { els.after.hidden = true; send('draft'); });
els['btn-after-review'].addEventListener('click', () => { els.after.hidden = true; renderCues(); els.body.focus(); });

els['sim-slider'].addEventListener('input', () => {
    const v = Number(els['sim-slider'].value);
    els['sim-value'].textContent = `${Math.round(v)}%`;
    if (source && source.simulated) source.setActivation(v / 100);
});

window.addEventListener('beforeunload', () => { if (source) source.destroy(); });

if (DEMO) startSource('sim');
renderReadouts();
