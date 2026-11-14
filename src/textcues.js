'use strict';

// Local, rule-based look at the draft. Nothing here leaves the machine and no
// AI model is involved. The goal is to point at phrases the writer may want to
// reread once they are calmer, never to rewrite or judge the message.

const RULES = [
    { id: 'shouting', label: 'ALL-CAPS words', weight: 20, re: /\b[A-Z]{3,}\b/g },
    { id: 'bang', label: 'Stacked punctuation', weight: 15, re: /[!?]{2,}/g },
    { id: 'absolute', label: 'Absolutes', weight: 15, re: /\b(always|never|every single time|nobody|everyone knows)\b/gi },
    { id: 'blame', label: 'Blame framing', weight: 20, re: /\b(your fault|you people|you clearly|you obviously|you never|you always)\b/gi },
    { id: 'sarcasm', label: 'Sarcasm markers', weight: 10, re: /\b(thanks a lot|great job|per my last email|as i already said|as previously stated)\b/gi },
    { id: 'ultimatum', label: 'Ultimatums', weight: 20, re: /\b(or else|last chance|i'm done|i quit|unacceptable)\b/gi },
];

// Words that are commonly all-caps for good reasons.
const CAPS_ALLOW = new Set(['ASAP', 'FYI', 'API', 'URL', 'PDF', 'CEO', 'CTO', 'USA', 'UK', 'EOD', 'ETA', 'TBD', 'FAQ', 'HTML', 'CSS', 'JSON', 'SDK', 'OK']);

function analyzeText(text) {
    const hits = [];
    for (const rule of RULES) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(text)) !== null) {
            if (rule.id === 'shouting' && CAPS_ALLOW.has(m[0])) continue;
            hits.push({ rule: rule.id, label: rule.label, start: m.index, end: m.index + m[0].length, match: m[0] });
        }
    }
    hits.sort((a, b) => a.start - b.start);

    // Each rule counts once at full weight, then a little for repeats.
    const byRule = new Map();
    for (const h of hits) byRule.set(h.rule, (byRule.get(h.rule) || 0) + 1);
    let score = 0;
    for (const rule of RULES) {
        const n = byRule.get(rule.id) || 0;
        if (n > 0) score += rule.weight + Math.min(n - 1, 3) * 3;
    }
    return { score: Math.min(100, score), hits, labels: [...new Set(hits.map((h) => h.label))] };
}

module.exports = { analyzeText };
