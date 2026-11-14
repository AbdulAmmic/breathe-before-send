'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ActivationModel, median } = require('../src/activation');
const { analyzeText } = require('../src/textcues');
const { Pacer, startPace, TARGET_BPM } = require('../src/pacer');
const { normalizeMetrics } = require('../src/signals');

const calm = (t) => ({ t, pulse: 70, pulseConf: 80, breathing: 13, breathingConf: 80, hrv: 50, hrvConf: 80, tense: 5 });
const tense = (t) => ({ t, pulse: 92, pulseConf: 80, breathing: 20, breathingConf: 80, hrv: 25, hrvConf: 80, tense: 60 });

function learned() {
    const m = new ActivationModel({ baselineMs: 10_000, smoothing: 1 });
    for (let t = 0; t <= 10_000; t += 1000) m.push(calm(t));
    return m;
}

test('median', () => {
    assert.strictEqual(median([3, 1, 2]), 2);
    assert.strictEqual(median([4, 1, 2, 3]), 2.5);
    assert.strictEqual(median([]), null);
});

test('baseline is learned after the window and never pauses before', () => {
    const m = new ActivationModel({ baselineMs: 10_000 });
    for (let t = 0; t < 10_000; t += 1000) m.push(tense(t));
    assert.strictEqual(m.baselineReady, false);
    assert.strictEqual(m.shouldPause(100), false);
    const l = learned();
    assert.deepStrictEqual(l.baseline, { pulse: 70, breathing: 13, hrv: 50 });
});

test('calm readings stay below the pause threshold', () => {
    const m = learned();
    m.push(calm(11_000));
    assert.ok(m.score < 15, `score ${m.score}`);
    assert.strictEqual(m.shouldPause(0), false);
});

test('activated readings trigger a pause and explain why', () => {
    const m = learned();
    m.push(tense(11_000));
    assert.ok(m.score >= 50, `score ${m.score}`);
    assert.strictEqual(m.shouldPause(0), true);
    const reasons = m.reasons();
    assert.match(reasons[0], /^Pulse 92 bpm/);
    assert.ok(reasons.every((r) => !/stress|anxiety|diagnos/i.test(r)));
});

test('low-confidence readings are ignored', () => {
    const m = learned();
    m.push({ ...tense(11_000), pulseConf: 10, breathingConf: 10, hrvConf: 10, tense: 0 });
    assert.strictEqual(m.latest.pulse, 70);
    assert.strictEqual(m.shouldPause(0), false);
});

test('text cues alone never trigger a pause', () => {
    const m = learned();
    m.push(calm(11_000));
    assert.strictEqual(m.shouldPause(100), false);
});

test('text analysis finds heated phrasing and ignores common acronyms', () => {
    const r = analyzeText("This is AGAIN your fault!! You always do this. FYI per my last email.");
    const labels = r.labels.join('|');
    assert.match(labels, /ALL-CAPS/);
    assert.match(labels, /Stacked punctuation/);
    assert.match(labels, /Blame framing/);
    assert.match(labels, /Sarcasm/);
    assert.ok(!r.hits.some((h) => h.match === 'FYI'));
    assert.ok(r.score > 50);
    assert.strictEqual(analyzeText('Thanks, see you tomorrow.').score, 0);
});

test('pacer starts near the user and slows to the target', () => {
    assert.strictEqual(startPace(18), 17);
    assert.strictEqual(startPace(null), 10);
    assert.strictEqual(startPace(40), 20);
    const p = new Pacer(16, 10_000);
    let g;
    for (let i = 0; i < 200; i++) g = p.step(100);
    assert.strictEqual(g.bpm, TARGET_BPM);
    assert.ok(g.level >= 0 && g.level <= 1);
});

test('normalizeMetrics reads the SDK packet shape', () => {
    const s = normalizeMetrics({
        cardio: { pulseRate: [{ value: 80, confidence: 70 }], hrv: [{ rmssd: 33, confidence: 60 }] },
        breathing: { rate: [{ value: 15, confidence: 50 }], upperTrace: [{ value: 0.2, timestamp: 1_000_000 }] },
        face: { expression: [{ scores: [{ type: 5, confidence: 90 }, { type: 1, confidence: 40 }, { type: 3, confidence: 20 }] }] },
    });
    assert.strictEqual(s.pulse, 80);
    assert.strictEqual(s.hrv, 33);
    assert.strictEqual(s.breathing, 15);
    assert.strictEqual(s.tense, 40);
    assert.deepStrictEqual(s.trace, [{ t: 1000, v: 0.2 }]);
    const empty = normalizeMetrics({});
    assert.strictEqual(empty.pulse, null);
    assert.strictEqual(empty.tense, null);
});
