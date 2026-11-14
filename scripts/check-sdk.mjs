// Checks that SmartSpectra works on this computer without opening the app:
// API key, camera, network to Presage, and whether live readings arrive.
// Usage: npm run check-sdk  (add -- --face to include expressions)
import fs from 'fs';
import sdkPkg from '@smartspectra/node-sdk';
import msgs from '@smartspectra/node-sdk/messages';

const { SmartSpectraSDK, CameraSelection, MetricType, ValidationCode } = sdkPkg;
const key = process.env.SMARTSPECTRA_API_KEY
    || (fs.existsSync('.env') && fs.readFileSync('.env', 'utf8').match(/SMARTSPECTRA_API_KEY\s*=\s*(\S+)/)?.[1]);
if (!key) { console.error('No SMARTSPECTRA_API_KEY in the environment or .env'); process.exit(1); }

const secs = Number(process.env.SECS || 60);
const metrics = [MetricType.CHEST_BREATHING, MetricType.BREATHING_RATE, MetricType.PULSE_RATE, MetricType.HRV];
if (process.argv.includes('--face')) metrics.push(MetricType.EXPRESSIONS);

const cams = SmartSpectraSDK.availableCameras();
console.log('Cameras:', cams.map((c) => c.name || c.id).join(', ') || 'none');
if (!cams.length) process.exit(1);

const sdk = new SmartSpectraSDK({ apiKey: key, enableTelemetry: false, requestedMetrics: metrics });
const vNames = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]));
let lastHint = '';
let readings = 0;
sdk.on('validationStatus', (c, _ts, hint) => {
    const line = `${vNames[c] || c}${hint ? `: ${hint}` : ''}`;
    if (line !== lastHint) console.log('Camera check ->', line);
    lastHint = line;
});
sdk.on('error', (c, m, r) => console.log(`SDK error ${c}: ${m}${r ? ' (retryable)' : ''}`));
sdk.on('metrics', (buf) => {
    const m = msgs.decodeMetrics(buf);
    const p = m.cardio?.pulseRate?.at(-1);
    const b = m.breathing?.rate?.at(-1);
    const h = m.cardio?.hrv?.at(-1);
    if (p || b || h) {
        readings++;
        if (readings % 10 === 1) {
            console.log(`Reading: pulse ${p ? `${p.value.toFixed(0)} (conf ${p.confidence.toFixed(0)})` : '-'}, `
                + `breathing ${b ? `${b.value.toFixed(0)} (conf ${b.confidence.toFixed(0)})` : '-'}, `
                + `HRV ${h ? `${h.rmssd.toFixed(0)} ms` : '-'}`);
        }
    }
});
sdk.useCamera(CameraSelection.byId(cams[0].id), { width: 1280, height: 720, fps: 30 });
sdk.start();
console.log(`Measuring for ${secs} s. Sit facing the camera with light on your face.`);
setTimeout(async () => {
    console.log(readings ? `OK: ${readings} packets with readings.` : 'No readings arrived. See the camera check and errors above.');
    await sdk.stopAsync();
    await sdk.destroy();
    process.exit(readings ? 0 : 1);
}, secs * 1000);
