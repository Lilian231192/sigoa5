import { Routes } from '@angular/router';
import { adminAuthGuard } from './core/guards/admin-auth.guard';
import { architectAuthGuard } from './core/guards/architect-auth.guard';
import { clienteAuthGuard } from './core/guards/cliente-auth.guard';
import { Shell } from './layout/shell/shell';

/**
 * Cada rol tiene su propio App Shell (Shell) como ruta padre.
 * Las pantallas son rutas hijas que se cargan dentro de su <router-outlet>.
 */
export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then(m => m.Login)
  },

  // ===== Administrador =====
  {
    path: 'admin',
    component: Shell,
    canActivate: [adminAuthGuard],
    data: { rol: 'admin' },
    children: [
      { path: '', loadComponent: () => import('./pages/admin/inicio/inicio').then(m => m.InicioComponent) },
      { path: 'proyectos', loadComponent: () => import('./pages/admin/proyectos/proyectos').then(m => m.Proyectos) },
      { path: 'obras', loadComponent: () => import('./pages/admin/obras/obras').then(m => m.Obras) },
      { path: 'cotizaciones', loadComponent: () => import('./pages/admin/cotizaciones/cotizaciones').then(m => m.Cotizaciones) },
      { path: 'contratos', loadComponent: () => import('./pages/admin/contratos/contratos').then(m => m.Contratos) },
      { path: 'pagos', loadComponent: () => import('./pages/admin/pagos/pagos').then(m => m.Pagos) },
      { path: 'usuarios', loadComponent: () => import('./pages/admin/usuarios/usuarios').then(m => m.Usuarios) }
    ]
  },

  // ===== Arquitecto =====
  {
    path: 'arquitecto',
    component: Shell,
    canActivate: [architectAuthGuard],
    data: { rol: 'arquitecto' },
    children: [
      { path: '', loadComponent: () => import('./pages/arquitecto/inicio/inicio').then(m => m.InicioArquitecto) },
      { path: 'proyectos', loadComponent: () => import('./pages/arquitecto/proyectos/proyectos').then(m => m.ProyectosArquitecto) },
      { path: 'obras', loadComponent: () => import('./pages/arquitecto/obras/obras').then(m => m.ObrasArquitecto) }
    ]
  },

  // ===== Cliente =====
  {
    path: 'cliente',
    component: Shell,
    canActivate: [clienteAuthGuard],
    data: { rol: 'cliente' },
    children: [
      { path: '', loadComponent: () => import('./pages/cliente/inicio/inicio').then(m => m.InicioCliente) }
    ]
  },

  { path: '**', redirectTo: 'login' }
];
