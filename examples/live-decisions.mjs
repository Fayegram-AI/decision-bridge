// Call with your already authenticated, open WebSocket-like Live connection.
import { createLiveDecisions } from '../src/live/index.mjs';

export function attachLiveDecisions(connection) {
    return createLiveDecisions({ transport: {
        send(command) { connection.send(JSON.stringify(command)); },
        subscribe(listener) {
            const message = event => {
                try { listener({ kind: 'event', event: JSON.parse(event.data) }); }
                catch { listener({ kind: 'error' }); }
            };
            const close = () => listener({ kind: 'close' });
            const error = () => listener({ kind: 'error' });
            connection.addEventListener('message', message);
            connection.addEventListener('close', close);
            connection.addEventListener('error', error);
            return () => {
                connection.removeEventListener('message', message);
                connection.removeEventListener('close', close);
                connection.removeEventListener('error', error);
            };
        },
    } });
}
