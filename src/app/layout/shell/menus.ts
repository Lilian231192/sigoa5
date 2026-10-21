/**
 * Menús del App Shell para cada rol.
 * - menu: aparece en la barra superior (escritorio) y en el menú lateral (celular)
 * - tabs: hasta 5 accesos rápidos en la barra inferior del celular
 */
export type Rol = 'admin' | 'arquitecto' | 'cliente';

export interface ItemMenu {
  texto: string;
  ruta: string;
  icono: string;
  exacto?: boolean;
}

export interface ConfigRol {
  etiqueta: string;
  menu: ItemMenu[];
  tabs: ItemMenu[];
}

const ADMIN: ItemMenu[] = [
  { texto: 'Inicio', ruta: '/admin', icono: 'inicio', exacto: true },
  { texto: 'Proyectos', ruta: '/admin/proyectos', icono: 'proyectos' },
  { texto: 'Obras', ruta: '/admin/obras', icono: 'obras' },
  { texto: 'Cotizaciones', ruta: '/admin/cotizaciones', icono: 'cotizaciones' },
  { texto: 'Contratos', ruta: '/admin/contratos', icono: 'contratos' },
  { texto: 'Pagos', ruta: '/admin/pagos', icono: 'pagos' },
  { texto: 'Usuarios', ruta: '/admin/usuarios', icono: 'usuarios' }
];

const ARQUITECTO: ItemMenu[] = [
  { texto: 'Inicio', ruta: '/arquitecto', icono: 'inicio', exacto: true },
  { texto: 'Proyectos', ruta: '/arquitecto/proyectos', icono: 'proyectos' },
  { texto: 'Obras', ruta: '/arquitecto/obras', icono: 'obras' }
];

const CLIENTE: ItemMenu[] = [
  { texto: 'Mi obra', ruta: '/cliente', icono: 'inicio', exacto: true }
];

export const MENUS: Record<Rol, ConfigRol> = {
  admin: { etiqueta: 'Administración', menu: ADMIN, tabs: [ADMIN[0], ADMIN[1], ADMIN[2], ADMIN[3], ADMIN[5]] },
  arquitecto: { etiqueta: 'Arquitecto', menu: ARQUITECTO, tabs: ARQUITECTO },
  cliente: { etiqueta: 'Cliente', menu: CLIENTE, tabs: CLIENTE }
};
