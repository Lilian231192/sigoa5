import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/** Restringe las rutas administrativas a sesiones válidas con rol Administrador (id_rol = 1). */
export const adminAuthGuard: CanActivateFn = () => {
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // Durante SSR no existe localStorage; la validación se ejecuta en el navegador.
  if (!isPlatformBrowser(platformId)) return true;

  try {
    const raw = localStorage.getItem('usuario');
    if (!raw) return router.parseUrl('/login');

    const usuario = JSON.parse(raw);
    const activo = usuario?.activo === true || usuario?.activo === 1 || usuario?.activo === '1';
    const sesionValida = Number(usuario?.id_usuario) > 0 && Number(usuario?.id_rol) === 1 && activo;

    if (sesionValida) return true;
  } catch {
    // JSON corrupto se trata igual que una sesión ausente.
  }

  localStorage.removeItem('usuario');
  return router.parseUrl('/login');
};
