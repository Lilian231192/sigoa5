import { Injectable, NgZone, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Indica en todo momento si el dispositivo tiene conexión a Internet.
 * Lo usan el App Shell (indicador "En línea / Sin conexión")
 * y las pantallas que deben deshabilitar formularios sin conexión.
 */
@Injectable({ providedIn: 'root' })
export class ConexionService {
  private readonly zone = inject(NgZone);

  /** true = con conexión · false = sin conexión */
  readonly enLinea = signal(true);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    this.enLinea.set(navigator.onLine);
    window.addEventListener('online', () => this.zone.run(() => this.enLinea.set(true)));
    window.addEventListener('offline', () => this.zone.run(() => this.enLinea.set(false)));
  }
}
