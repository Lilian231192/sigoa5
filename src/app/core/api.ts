const apiConfig = globalThis as typeof globalThis & {
  __SIGOA_API_URL__?: string;
};

export const API = (
  apiConfig.__SIGOA_API_URL__ ?? 'http://localhost:3000/api/routes'
).replace(/\/+$/, '');
export const SERVIDOR = new URL(API).origin;