import { Component, input } from '@angular/core';

/**
 * Íconos de línea (estilo Lucide) dibujados en SVG.
 * Uso: <app-icono nombre="obras" />
 * Toman el color del texto (currentColor) y miden 20px por defecto.
 */
@Component({
  selector: 'app-icono',
  standalone: true,
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (nombre()) {
        @case ('inicio') {
          <path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>
        }
        @case ('proyectos') {
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
        }
        @case ('obras') {
          <path d="M2 18h20"/><path d="M4 18v-2a8 8 0 0 1 16 0v2"/><path d="M10 8V5h4v3"/>
        }
        @case ('cotizaciones') {
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>
        }
        @case ('contratos') {
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="m9 16 2 2 4-4"/>
        }
        @case ('pagos') {
          <rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>
        }
        @case ('usuarios') {
          <circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21a7 7 0 0 0-4-6.3"/>
        }
        @case ('avance') {
          <path d="M4 20V14"/><path d="M10 20V9"/><path d="M16 20V4"/><path d="M22 20H2"/>
        }
        @case ('fotos') {
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>
        }
        @case ('menu') {
          <path d="M4 6h16M4 12h16M4 18h16"/>
        }
        @case ('cerrar') {
          <path d="M18 6 6 18M6 6l12 12"/>
        }
        @case ('campana') {
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>
        }
        @case ('salir') {
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>
        }
        @case ('descargar') {
          <path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>
        }
        @case ('calendario') {
          <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>
        }
        @case ('mas') {
          <path d="M12 5v14M5 12h14"/>
        }
        @case ('flecha') {
          <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
        }
        @case ('buscar') {
          <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>
        }
        @case ('editar') {
          <path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>
        }
        @case ('borrar') {
          <path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>
        }
        @case ('opciones') {
          <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
        }
        @case ('anterior') {
          <path d="m15 6-6 6 6 6"/>
        }
        @case ('siguiente') {
          <path d="m9 6 6 6-6 6"/>
        }
        @case ('ubicacion') {
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>
        }
        @case ('ver') {
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
        }
        @case ('subir') {
          <path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v4h16v-4"/>
        }
        @case ('archivo') {
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>
        }
        @case ('wifi') {
          <path d="M12 20h.01"/><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/>
        }
        @case ('wifi-off') {
          <path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M19 12.9a10 10 0 0 0-2-1.5"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M22 8.8a15 15 0 0 0-11.3-3.8"/><path d="m2 2 20 20"/>
        }
        <!-- Glifos de los avisos (van dentro de un círculo de color) -->
        @case ('aviso-exito') {
          <path stroke-width="2.4" d="M5 12.5 9.5 17 19 7.5"/>
        }
        @case ('aviso-error') {
          <path stroke-width="2.4" d="M7 7l10 10"/><path stroke-width="2.4" d="M17 7 7 17"/>
        }
        @case ('aviso-alerta') {
          <path stroke-width="2.4" d="M12 5.5v8.5"/><path stroke-width="2.4" d="M12 18.5h.01"/>
        }
        @case ('aviso-info') {
          <path stroke-width="2.4" d="M12 10.5v8"/><path stroke-width="2.4" d="M12 5.5h.01"/>
        }
        @case ('sin-conexion') {
          <path d="m2 2 20 20"/><path d="M5.8 5.8A7 7 0 0 0 6 19h11"/><path d="M21 15.5A4.5 4.5 0 0 0 16.5 11h-.6A7 7 0 0 0 10 5.2"/>
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; width: 20px; height: 20px; flex-shrink: 0; }
    svg { width: 100%; height: 100%; }
  `]
})
export class Icono {
  readonly nombre = input.required<string>();
}