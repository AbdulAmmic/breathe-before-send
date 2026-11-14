'use strict';

// Two interchangeable signal sources that emit the same normalized sample:
//   - SdkSource: live camera signals from SmartSpectra (pulse, breathing, HRV,
//     facial expression, chest breathing trace).
//   - SimSource: a clearly labelled simulator for trying the app without a
//     camera or API key. Its "activation" is set from a slider.

const TENSE_TYPES = new Set([1, 2, 3, 'ANGRY', 'CONTEMPT', 'DISGUST']);

function tsToMs(ts) {
    if (ts == null) return Date.now();
    if (typeof ts === 'number') return ts / 1000;
    if (typeof ts === 'bigint') return Number(ts) / 1000;
    if (typeof ts.toNumber === 'function') return ts.toNumber() / 1000;
    return Number(ts) / 1000;
}

const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);

// Convert one decoded Metrics packet into a sample. Fields the packet doesn't
// carry stay null so the model keeps its previous reading.
function normalizeMetrics(m) {
    const pulse = last(m.cardio?.pulseRate);
    const br = last(m.breathing?.rate);
    const hrv = last(m.cardio?.hrv);
    const expr = last(m.face?.expression);
    const trace = (m.breathing?.upperTrace || []).map((p) => ({ t: tsToMs(p.timestamp), v: p.value }));

    let tense = null;
    if (expr && expr.scores) {
        tense = 0;
        for (const s of expr.scores) if (TENSE_TYPES.has(s.type)) tense = Math.max(tense, s.confidence || 0);
    }

    return {
        t: Date.now(),
        pulse: pulse ? pulse.value : null,
        pulseConf: pulse ? pulse.confidence || 0 : 0,
        breathing: br ? br.value : null,
        breathingConf: br ? br.confidence || 0 : 0,
        hrv: hrv ? hrv.rmssd : null,
        hrvConf: hrv ? hrv.confidence || 0 : 0,
        tense,
        trace,
    };
}

class SdkSource {
    // SmartSpectra runs in the main process (see sensing.js). `bridge` is the
    // narrow API from preload.js.
    constructor({ telemetry, expressions, handlers, bridge = window.bbs }) {
        const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
        this.handlers = handlers;
        this.telemetry = telemetry;
        this.expressions = expressions;
        this.bridge = bridge;
        this.active = false;
        if (!SdkSource.wired) {
            // ipcRenderer listeners can't be removed through the bridge, so wire
            // once and route to whichever source is current.
            SdkSource.wired = true;
            bridge.on('bbs:validation', (ok, name, hint) => SdkSource.current?.handlers.onValidation?.(ok, name, hint));
            bridge.on('bbs:preview', (url) => SdkSource.current?.handlers.onPreview?.(url));
            bridge.on('bbs:fatal', (msg) => {
                const cur = SdkSource.current;
                if (!cur) return;
                cur.active = false;
                SdkSource.current = null;
                cur.handlers.onFatal?.(msg);
            });
            bridge.on('bbs:metrics', (buf) => {
                const cur = SdkSource.current;
                if (!cur) return;
                try {
                    cur.handlers.onSample?.(normalizeMetrics(decodeMetrics(buf)));
                } catch (e) {
                    cur.handlers.onError?.(`Could not read metrics: ${e.message}`);
                }
            });
        }
    }

    get simulated() { return false; }

    async start() {
        SdkSource.current = this;
        this.active = true;
        await this.bridge.start({ telemetry: !!this.telemetry, expressions: !!this.expressions });
    }

    async stop() {
        if (SdkSource.current === this) SdkSource.current = null;
        if (!this.active) return;
        this.active = false;
        await this.bridge.stop();
    }

    async destroy() { await this.stop(); }
}

class SimSource {
    constructor({ handlers }) {
        this.handlers = handlers;
        this.activation = 0; // 0..1, driven by the demo slider
        this.timer = null;
        this.phase = 0;
        this.startedAt = 0;
    }

    get simulated() { return true; }

    setActivation(a) { this.activation = Math.max(0, Math.min(1, a)); }

    async start() {
        this.startedAt = Date.now();
        this.handlers.onStatus?.('Running');
        this.handlers.onValidation?.(true, 'Ok', 'Simulated signals');
        let lastT = Date.now();
        this.timer = setInterval(() => {
            const now = Date.now();
            const dt = now - lastT;
            lastT = now;
            const a = this.activation;
            const noise = () => (Math.random() - 0.5);
            const breathing = 13 + a * 8 + noise() * 0.6;
            // A trace sample every tick, following the simulated breathing rate.
            this.phase += (dt / 60_000) * breathing * 2 * Math.PI;
            const warm = (now - this.startedAt) / 1000;
            this.handlers.onSample?.({
                t: now,
                pulse: 68 + a * 28 + noise() * 2,
                pulseConf: warm > 4 ? 80 : 0,
                breathing,
                breathingConf: warm > 6 ? 75 : 0,
                hrv: 48 - a * 26 + noise() * 3,
                hrvConf: warm > 8 ? 70 : 0,
                tense: Math.max(0, a * 70 + noise() * 10),
                trace: [{ t: now, v: Math.sin(this.phase) }],
            });
        }, 200);
    }

    async stop() {
        clearInterval(this.timer);
        this.timer = null;
        this.handlers.onStatus?.('Idle');
    }

    async destroy() { await this.stop(); }
}

module.exports = { SdkSource, SimSource, normalizeMetrics };
