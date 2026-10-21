import { Injectable, NgZone, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Evento que dispara el navegador cuando la PWA cumple los requisitos
 * para instalarse (manifiesto válido + Service Worker activo + HTTPS o localhost).
 * No viene tipado en TypeScript, por eso se declara aquí.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private readonly zone = inject(NgZone);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private eventoGuardado: BeforeInstallPromptEvent | null = null;

  /** true cuando el navegador ya permite instalar la app */
  readonly puedeInstalar = signal(false);

  /** true cuando la app ya se está ejecutando instalada (ventana propia) */
  readonly instalada = signal(false);

  constructor() {
    if (!this.esNavegador) return;

    this.instalada.set(window.matchMedia('(display-mode: standalone)').matches);

    window.addEventListener('beforeinstallprompt', (evento) => {
      // Se evita el aviso automático del navegador y se guarda el evento
      // para lanzarlo desde nuestro propio botón "Instalar aplicación".
      evento.preventDefault();
      this.zone.run(() => {
        this.eventoGuardado = evento as BeforeInstallPromptEvent;
        this.puedeInstalar.set(true);
      });
    });

    window.addEventListener('appinstalled', () => {
      this.zone.run(() => {
        this.eventoGuardado = null;
        this.puedeInstalar.set(false);
        this.instalada.set(true);
      });
    });
  }

  /** Abre el diálogo de instalación del navegador */
  async instalar(): Promise<void> {
    if (!this.eventoGuardado) return;

    await this.eventoGuardado.prompt();
    const { outcome } = await this.eventoGuardado.userChoice;

    // El evento solo puede usarse una vez
    this.eventoGuardado = null;
    this.puedeInstalar.set(false);

    if (outcome === 'accepted') {
      this.instalada.set(true);
    }
  }
}
