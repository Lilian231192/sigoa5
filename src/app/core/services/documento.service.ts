import { Injectable, signal } from '@angular/core';

export interface DocumentoImprimible {
  titulo: string;
  html: string;
}

/**
 * VISTA PREVIA DE DOCUMENTOS (recibos, cotizaciones y contratos)
 *
 * Antes cada PDF se abría en una ventana emergente con window.print().
 * Esa ventanita comparte el mismo proceso que la pestaña de SIGOA, así que
 * mientras su diálogo de impresión seguía abierto (por ejemplo, si se
 * minimizaba) la aplicación entera se quedaba congelada.
 *
 * Ahora el documento se muestra en un modal centrado dentro de la misma
 * página (lo dibuja el Shell) y se imprime o guarda como PDF desde ahí.
 */
@Injectable({ providedIn: 'root' })
export class DocumentoService {
  readonly actual = signal<DocumentoImprimible | null>(null);

  abrir(titulo: string, html: string): void {
    this.actual.set({ titulo, html });
  }

  cerrar(): void {
    this.actual.set(null);
  }
}