import { defineConfig } from 'vitest/config';

// Testes de integração criam um banco por arquivo; sob carga do servidor passam de 5 s.
export default defineConfig({ test: { testTimeout: 20_000, hookTimeout: 30_000 } });
