'use strict';

// Breathing guide that starts near the user's current breathing rate and eases
// down toward a slow, comfortable pace. Starting where the user already is
// makes the guide easy to follow instead of something to fight.

const TARGET_BPM = 6;
const MIN_START_BPM = 8;
const MAX_START_BPM = 20;
const INHALE_FRACTION = 0.4; // slightly longer exhale than inhale

function startPace(currentBreathing) {
    if (currentBreathing == null) return 10;
    return Math.max(MIN_START_BPM, Math.min(MAX_START_BPM, currentBreathing - 1));
}

class Pacer {
    constructor(startBpm, rampMs = 45_000) {
        this.startBpm = startBpm;
        this.rampMs = rampMs;
        this.phase = 0; // 0..1 through the current breath cycle
        this.elapsed = 0;
    }

    bpmAt(elapsedMs) {
        const k = Math.min(1, elapsedMs / this.rampMs);
        const target = Math.min(this.startBpm, TARGET_BPM);
        return this.startBpm + (target - this.startBpm) * k;
    }

    // Advance by dtMs. Returns { bpm, inhale, level } where level is 0..1 lung fullness.
    step(dtMs) {
        this.elapsed += dtMs;
        const bpm = this.bpmAt(this.elapsed);
        this.phase = (this.phase + dtMs / (60_000 / bpm)) % 1;
        const inhale = this.phase < INHALE_FRACTION;
        const level = inhale
            ? easeInOut(this.phase / INHALE_FRACTION)
            : 1 - easeInOut((this.phase - INHALE_FRACTION) / (1 - INHALE_FRACTION));
        return { bpm, inhale, level };
    }
}

function easeInOut(x) {
    return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

module.exports = { Pacer, startPace, TARGET_BPM };
