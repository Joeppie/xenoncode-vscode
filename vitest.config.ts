import { defineConfig } from 'vitest/config';

// L1 per the pyramid: the server's LOGIC is pure (server/lib.ts); the thin
// server.ts/client.ts adapters carry no logic to test at this tier.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: ['xenoncore'] } },
  },
});
