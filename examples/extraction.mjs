// Explicit execution calls Cloudflare; configure account/token in your environment.
import { CloudflareExtractionProvider } from '../src/extraction/index.mjs';
import { publicError } from '../src/index.mjs';

try {
    const provider = new CloudflareExtractionProvider();
    const result = await provider.extract({
        state: 'Invoice total: 1080 USD. Due date: 2026-11-01.',
        reference_date: '2026-10-20',
        fields: { amount: { type: 'number', unit: 'USD' }, due_date: { type: 'date' } },
    });
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error(publicError(error));
    process.exitCode = 1;
}
