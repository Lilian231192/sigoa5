import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * MODO DE RENDERIZADO DE CADA RUTA
 *
 * - SSR (RenderMode.Server): el servidor arma el HTML completo en cada visita y
 *   el navegador lo recibe listo; después Angular lo "hidrata" (le da vida a los botones).
 *   Se usa en el login: es pública y es la puerta de entrada, debe verse al instante.
 *
 * - CSR (RenderMode.Client): el servidor manda la página casi vacía y el navegador
 *   la arma con JavaScript. Se usa en las pantallas privadas, porque dependen de la
 *   sesión del usuario, que solo existe en su navegador (localStorage).
 */
export const serverRoutes: ServerRoute[] = [
  // Pública → SSR
  { path: 'login', renderMode: RenderMode.Server },

  // Privadas → CSR
  { path: 'admin', renderMode: RenderMode.Client },
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'arquitecto', renderMode: RenderMode.Client },
  { path: 'arquitecto/**', renderMode: RenderMode.Client },
  { path: 'cliente', renderMode: RenderMode.Client },
  { path: 'cliente/**', renderMode: RenderMode.Client },

  // Cualquier otra dirección (la raíz o una que no existe) se resuelve en el servidor,
  // que redirige al login.
  { path: '**', renderMode: RenderMode.Server }
];