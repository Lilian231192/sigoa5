import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/** Restringe el portal del cliente a sesiones válidas con rol Cliente (id_rol = 3). */
export const clienteAuthGuard: CanActivateFn = () => {
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) return true;

  try {
    const raw = localStorage.getItem('usuario');
    if (!raw) return router.parseUrl('/login');
    const usuario = JSON.parse(raw);
    const activo = usuario?.activo === true || usuario?.activo === 1 || usuario?.activo === '1';
    if (Number(usuario?.id_usuario) > 0 && Number(usuario?.id_rol) === 3 && activo) return true;
  } catch {
    // Una sesión mal formada se trata como sesión inválida.
  }

  localStorage.removeItem('usuario');
  return router.parseUrl('/login');
};
