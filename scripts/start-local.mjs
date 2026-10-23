import {fileURLToPath} from 'node:url';

// Reuse the existing encrypted, MFA-verified session store across local restarts.
// This private directory is ignored by Git and excluded from source backups.
process.env.HOT_DOOGY_SESSION_DIR ||= fileURLToPath(new URL('../.secrets/local-preview/auth/', import.meta.url));

await import('../server.mjs');
