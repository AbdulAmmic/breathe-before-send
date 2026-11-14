'use strict';

// Turns a stream of normalized signal samples into a personal baseline and a
// 0–100 "activation" score. This is a self-awareness nudge, not a stress or
// health measurement: every number is compared only to the user's own
// baseline from the current session.

// Confidence thresholds follow the SDK's own "stable" definitions
// (pulse >= 40, breathing >= 45, HRV >= 50).
const MIN_CONF = { pulse: 40, breathing: 45, hrv: 50 };

// How long we watch before the baseline counts as learned.
const BASELINE_MS = 45_000;
const MIN_BASELINE_PULSE_SAMPLES = 5;

// Weights of each signal in the body score. They sum to 100.
const WEIGHTS = { pulse: 40, breathing: 20, hrv: 20, expression: 20 };

// The change from baseline that maps to a full component score.
const FULL_SCALE = { pulseBpm: 15, breathingBpm: 6, hrvDropRatio: 0.4 };

// Text cues can nudge the score but never trigger a pause on their own.
const MAX_TEXT_BOOST = 15;
const PAUSE_THRESHOLD = 50;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function median(values) {
    if (values.length === 0) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

class ActivationModel {
    constructor({ baselineMs = BASELINE_MS, smoothing = 0.25 } = {}) {
        this.baselineMs = baselineMs;
        this.smoothing = smoothing;
        this.reset();
    }

    reset() {
        this.startedAt = null;
        this.pool = { pulse: [], breathing: [], hrv: [] };
        this.baseline = null;
        this.latest = { pulse: null, breathing: null, hrv: null, tense: 0 };
        this.score = 0;
    }

    get baselineReady() {
        return this.baseline !== null;
    }

    // Fraction of the baseline window that has elapsed (0..1).
    baselineProgress(now) {
        if (this.baselineReady) return 1;
        if (this.startedAt === null) return 0;
        return clamp01((now - this.startedAt) / this.baselineMs);
    }

    // sample: { t, pulse, pulseConf, breathing, breathingConf, hrv, hrvConf, tense }
    // `tense` is the 0–100 confidence of the strongest of angry/contempt/disgust.
    push(sample) {
        const t = sample.t;
        if (this.startedAt === null) this.startedAt = t;

        if (sample.pulse != null && sample.pulseConf >= MIN_CONF.pulse) this.latest.pulse = sample.pulse;
        if (sample.breathing != null && sample.breathingConf >= MIN_CONF.breathing) this.latest.breathing = sample.breathing;
        if (sample.hrv != null && sample.hrvConf >= MIN_CONF.hrv) this.latest.hrv = sample.hrv;
        if (sample.tense != null) this.latest.tense = sample.tense;

        if (!this.baselineReady) {
            for (const k of ['pulse', 'breathing', 'hrv']) {
                if (this.latest[k] != null && sample[k] != null) this.pool[k].push(this.latest[k]);
            }
            if (t - this.startedAt >= this.baselineMs && this.pool.pulse.length >= MIN_BASELINE_PULSE_SAMPLES) {
                this.baseline = {
                    pulse: median(this.pool.pulse),
                    breathing: median(this.pool.breathing),
                    hrv: median(this.pool.hrv),
                };
            }
            return;
        }

        const raw = this.bodyScore().total;
        this.score += this.smoothing * (raw - this.score);
    }

    // Per-signal breakdown used both for scoring and for explaining a pause.
    bodyScore() {
        const b = this.baseline;
        const l = this.latest;
        const parts = { pulse: 0, breathing: 0, hrv: 0, expression: 0 };
        if (!b) return { total: 0, parts };

        if (b.pulse != null && l.pulse != null) {
            parts.pulse = WEIGHTS.pulse * clamp01((l.pulse - b.pulse) / FULL_SCALE.pulseBpm);
        }
        if (b.breathing != null && l.breathing != null) {
            parts.breathing = WEIGHTS.breathing * clamp01((l.breathing - b.breathing) / FULL_SCALE.breathingBpm);
        }
        if (b.hrv != null && l.hrv != null && b.hrv > 0) {
            parts.hrv = WEIGHTS.hrv * clamp01((b.hrv - l.hrv) / b.hrv / FULL_SCALE.hrvDropRatio);
        }
        parts.expression = WEIGHTS.expression * clamp01((l.tense || 0) / 100);

        const total = parts.pulse + parts.breathing + parts.hrv + parts.expression;
        return { total, parts };
    }

    // Decide whether pressing Send should open the pause screen.
    shouldPause(textCueScore = 0) {
        if (!this.baselineReady) return false;
        const boost = MAX_TEXT_BOOST * clamp01(textCueScore / 100);
        return this.score + boost >= PAUSE_THRESHOLD;
    }

    // Human-readable reasons, strongest first. Never diagnostic wording.
    reasons() {
        const { parts } = this.bodyScore();
        const b = this.baseline || {};
        const l = this.latest;
        const out = [];
        if (parts.pulse >= 8) out.push({ weight: parts.pulse, text: `Pulse ${Math.round(l.pulse)} bpm. Earlier it was about ${Math.round(b.pulse)}.` });
        if (parts.breathing >= 5) out.push({ weight: parts.breathing, text: `Breathing ${Math.round(l.breathing)}/min. Earlier it was about ${Math.round(b.breathing)}.` });
        if (parts.hrv >= 5) out.push({ weight: parts.hrv, text: `Heart rhythm variability is lower than earlier (${Math.round(l.hrv)} ms, earlier about ${Math.round(b.hrv)} ms).` });
        if (parts.expression >= 6) out.push({ weight: parts.expression, text: 'Your expression looks tense.' });
        return out.sort((a, c) => c.weight - a.weight).map((r) => r.text);
    }
}

module.exports = { ActivationModel, PAUSE_THRESHOLD, MAX_TEXT_BOOST, median };
