// Run: node --env-file=.env examples/cloudflare-omni.mjs clip.wav clip.mp4
// Makes two hosted inference calls. Supply valid local WAV and MP4 fixtures.
import { readFile } from 'node:fs/promises';
import { createBridge, CloudflareDecisionsProvider, noul, publicError } from '../src/index.mjs';

try {
    const [audioPath, videoPath] = process.argv.slice(2);
    if (!audioPath || !videoPath) throw new Error('Supply a WAV path and an MP4 path.');
    const [audio, video] = await Promise.all([readFile(audioPath), readFile(videoPath)]);
    const audioUrl = 'data:audio/wav;base64,' + audio.toString('base64');
    const videoUrl = 'data:video/mp4;base64,' + video.toString('base64');
    const provider = new CloudflareDecisionsProvider({ model: 'clef-omni' });
    const bridge = createBridge({ provider });
    const common = await bridge.evaluate({
        input: [
            { type: 'audio', dataUrl: audioUrl },
            { type: 'video', dataUrl: videoUrl },
            { type: 'text', text: 'Assess these clips.' },
        ],
        questions: { speech: noul('Is audible speech present?') },
    });
    const native = await provider.createDecision({
        state: { purpose: 'Assess these clips.' },
        audio: [audioUrl],
        videos: [videoUrl],
        questions: { speech: { type: 'noul', instructions: 'Is audible speech present?' } },
    });
    console.log(JSON.stringify({ common, native }, null, 2));
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
