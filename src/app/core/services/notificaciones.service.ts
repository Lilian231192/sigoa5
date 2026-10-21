import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { Subscription, firstValueFrom } from 'rxjs';
import { API } from '../api';
import { AvisosService } from './avisos.service';
import { ConexionService } from './conexion.service';

export type TipoNotificacion =
  | 'avance' | 'fotos' | 'cotizacion' | 'pago' | 'recordatorio'
  | 'asignacion' | 'vencido' | 'terminada' | 'prueba';

export interface Notificacion {
  id: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  url: string | null;
  leida: boolean;
  fecha: string;
}

/**
 * - pendiente:    el navegador todavía no pregunta (se muestra el botón "Activar")
 * - activadas:    el usuario aceptó
 * - bloqueadas:   el usuario dijo que no (solo se reactivan desde el navegador)
 * - no-soportado: el navegador no tiene notificaciones (ej. Safari de iPhone sin instalar la app)
 */
export type EstadoPermiso = 'pendiente' | 'activadas' | 'bloqueadas' | 'no-soportado';

/** Cada cuánto se revisa si hay notificaciones nuevas mientras la app está abierta */
const INTERVALO_MS = 20_000;

/** "ahora", "hace 5 min", "hace 2 h", "ayer", "12 oct" */
export function hace(fechaIso: string): string {
  const fecha = new Date(fechaIso);
  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return 'ahora';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  if (horas < 48) return 'ayer';
  return fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * NOTIFICACIONES DE SIGOA (lado de Angular)
 *
 * 1. PUSH REAL (Service Worker activo: build de producción o hosting):
 *    SwPush suscribe el dispositivo con la llave VAPID del servidor. Las
 *    notificaciones llegan aunque la app esté cerrada.
 * 2. RESPALDO (con `npm start` no hay Service Worker):
 *    la app revisa el servidor cada 20 s y, si la pestaña está en segundo plano,
 *    muestra la notificación del sistema con la API Notification.
 *
 * En ambos casos la campanita muestra el historial y cuántas faltan por leer.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly swPush = inject(SwPush);
  private readonly avisos = inject(AvisosService);
  private readonly conexion = inject(ConexionService);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly lista = signal<Notificacion[]>([]);
  readonly noLeidas = signal(0);
  readonly permiso = signal<EstadoPermiso>('no-soportado');
  readonly activando = signal(false);
  /**
   * Sube de 1 en 1 cada vez que llegan notificaciones nuevas.
   * Las pantallas lo escuchan con un effect() para volver a pedir sus datos
   * y actualizarse solas (ej. el portal del cliente cuando avanza su obra).
   */
  readonly cambios = signal(0);

  private idUsuario: number | null = null;
  private idRol: number | null = null;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private suscripciones: Subscription[] = [];
  /** Notificaciones ya vistas (id + fecha), para saber cuáles son nuevas */
  private vistas = new Set<string>();

  /** true cuando hay Service Worker y por lo tanto push real */
  get pushDisponible(): boolean {
    return this.swPush.isEnabled;
  }

  /** Lo llama el App Shell al entrar con la sesión del usuario */
  iniciar(usuario: { id_usuario?: number; id_rol?: number } | null): void {
    if (!this.esNavegador || !usuario?.id_usuario) return;
    if (this.idUsuario === usuario.id_usuario) return;

    this.detener();
    this.idUsuario = usuario.id_usuario;
    this.idRol = usuario.id_rol ?? null;
    this.permiso.set(this.leerPermiso());

    this.cargar(true);
    this.temporizador = setInterval(() => this.cargar(), INTERVALO_MS);
    document.addEventListener('visibilitychange', this.alVolver);

    if (this.swPush.isEnabled) {
      // Llegó un push con la app abierta: se actualiza la campanita
      this.suscripciones.push(this.swPush.messages.subscribe(() => this.cargar()));
      // Tocó la notificación del sistema: se abre la pantalla correspondiente
      this.suscripciones.push(
        this.swPush.notificationClicks.subscribe(({ notification }) => {
          const url = (notification.data as { url?: string } | undefined)?.url;
          if (url) this.router.navigateByUrl(url);
          this.cargar();
        })
      );
      // Si ya había dado permiso, se confirma que este dispositivo quede ligado a este usuario.
      // Si no se puede, se vuelve a mostrar el botón "Activar" para reintentar.
      if (this.permiso() === 'activadas') this.suscribir().catch(() => this.permiso.set('pendiente'));
    }
  }

  /** Pide permiso y registra el dispositivo */
  async activar(): Promise<void> {
    if (this.activando()) return;
    this.activando.set(true);
    try {
      if (this.swPush.isEnabled) {
        await this.suscribir();
      } else {
        const respuesta = await Notification.requestPermission();
        if (respuesta !== 'granted') throw new Error(respuesta);
      }
      this.permiso.set('activadas');
      this.avisos.exito('Notificaciones activadas en este dispositivo.');
      this.enviarBienvenida();
    } catch {
      const permiso = this.leerPermiso();
      if (permiso === 'bloqueadas') {
        this.permiso.set('bloqueadas');
        this.avisos.alerta('Bloqueaste las notificaciones. Puedes activarlas desde el candado junto a la dirección de la página.');
      } else if (permiso === 'activadas') {
        // Dio permiso, pero no se pudo registrar el dispositivo (sin conexión, modo incógnito…)
        this.permiso.set('pendiente');
        this.avisos.error('No se pudo registrar este dispositivo. Revisa tu conexión e intenta otra vez (en modo incógnito no funcionan).');
      } else {
        // Cerró la ventanita sin elegir
        this.permiso.set(permiso);
      }
    } finally {
      this.activando.set(false);
    }
  }

  /** Abre la notificación: la marca como leída y lleva a su pantalla */
  abrir(n: Notificacion): void {
    this.marcarLeida(n);
    if (n.url) this.router.navigateByUrl(n.url);
  }

  marcarLeida(n: Notificacion): void {
    if (n.leida) return;
    this.lista.update((lista) => lista.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
    this.noLeidas.update((total) => Math.max(0, total - 1));
    this.http.patch(`${API}/notificaciones/${n.id}/leida`, {}).subscribe({ error: () => {} });
  }

  marcarTodas(): void {
    if (!this.idUsuario || !this.noLeidas()) return;
    this.lista.update((lista) => lista.map((x) => ({ ...x, leida: true })));
    this.noLeidas.set(0);
    this.http.patch(`${API}/notificaciones/usuario/${this.idUsuario}/leidas`, {}).subscribe({ error: () => {} });
  }

    /** Borra una notificación del historial */
  eliminar(n: Notificacion): void {
    this.lista.update((lista) => lista.filter((x) => x.id !== n.id));
    if (!n.leida) this.noLeidas.update((total) => Math.max(0, total - 1));
    this.http.delete(`${API}/notificaciones/${n.id}`).subscribe({
      error: () => {
        this.avisos.error('No se pudo eliminar la notificación.');
        this.cargar();
      }
    });
  }

  /** Borra todo el historial, después de confirmar */
  async eliminarTodas(): Promise<void> {
    const total = this.lista().length;
    if (!this.idUsuario || !total) return;
    const confirmado = await this.avisos.confirmar({
      titulo: '¿Eliminar todas las notificaciones?',
      mensaje: `Se borrarán ${total === 1 ? 'la notificación' : `las ${total} notificaciones`} de tu historial. Esta acción no se puede deshacer.`,
      textoAceptar: 'Eliminar todas',
      peligro: true
    });
    if (!confirmado) return;

    const respaldo = { lista: this.lista(), noLeidas: this.noLeidas() };
    this.lista.set([]);
    this.noLeidas.set(0);
    this.http.delete(`${API}/notificaciones/usuario/${this.idUsuario}`).subscribe({
      next: () => this.avisos.exito('Se eliminaron todas las notificaciones.'),
      error: () => {
        this.lista.set(respaldo.lista);
        this.noLeidas.set(respaldo.noLeidas);
        this.avisos.error('No se pudieron eliminar las notificaciones.');
      }
    });
  }

  /**
   * Bienvenida: llega UNA sola vez, justo al activar, y confirma que el
   * dispositivo ya recibe notificaciones (no hay botón para repetirla).
   */
  private enviarBienvenida(): void {
    if (!this.idUsuario) return;
    this.http.post(`${API}/notificaciones/prueba`, { id_usuario: this.idUsuario, id_rol: this.idRol }).subscribe({
      next: () => setTimeout(() => this.cargar(), 1200),
      error: () => {}
    });
  }

  /** Al cerrar sesión: este dispositivo deja de recibir las notificaciones de este usuario */
  async salir(): Promise<void> {
    if (this.esNavegador && this.swPush.isEnabled) {
      try {
        const suscripcion = await Promise.race([
          firstValueFrom(this.swPush.subscription),
          new Promise<null>((resolver) => setTimeout(() => resolver(null), 1500))
        ]);
        if (suscripcion) {
          await firstValueFrom(this.http.post(`${API}/notificaciones/desuscribir`, { endpoint: suscripcion.endpoint }));
          await this.swPush.unsubscribe();
        }
      } catch {
        // Si falla (p. ej. sin conexión) no se detiene el cierre de sesión
      }
    }
    this.detener();
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    this.suscripciones.forEach((s) => s.unsubscribe());
    this.suscripciones = [];
    if (this.esNavegador) document.removeEventListener('visibilitychange', this.alVolver);
    this.idUsuario = null;
    this.idRol = null;
    this.vistas.clear();
    this.lista.set([]);
    this.noLeidas.set(0);
  }

  // ------------------------------------------------------------------

  private async suscribir(): Promise<void> {
    const { llave } = await firstValueFrom(this.http.get<{ llave: string }>(`${API}/notificaciones/llave-publica`));
    const suscripcion = await this.swPush.requestSubscription({ serverPublicKey: llave });
    await firstValueFrom(
      this.http.post(`${API}/notificaciones/suscribir`, { id_usuario: this.idUsuario, suscripcion: suscripcion.toJSON() })
    );
  }

  private async cargar(primeraVez = false): Promise<void> {
    if (!this.idUsuario || !this.conexion.enLinea()) return;
    try {
      const respuesta = await firstValueFrom(
        this.http.get<{ noLeidas: number; notificaciones: Notificacion[] }>(`${API}/notificaciones/usuario/${this.idUsuario}`)
      );
      const clave = (n: Notificacion) => `${n.id}-${n.fecha}`;
      const nuevas = primeraVez ? [] : respuesta.notificaciones.filter((n) => !n.leida && !this.vistas.has(clave(n)));

      respuesta.notificaciones.forEach((n) => this.vistas.add(clave(n)));
      this.lista.set(respuesta.notificaciones);
      this.noLeidas.set(respuesta.noLeidas);
      if (nuevas.length) this.cambios.update((n) => n + 1);

      nuevas.slice(0, 3).reverse().forEach((n) => this.anunciar(n));
    } catch {
      // Sin servidor: la campanita se queda con lo último que tenía
    }
  }

  /** Avisa de una notificación nueva detectada con la app abierta */
  private anunciar(n: Notificacion): void {
    if (document.visibilityState === 'visible') {
      this.avisos.info(`${n.titulo} · ${n.mensaje}`);
      return;
    }
    // En segundo plano y sin Service Worker: notificación del sistema "a mano"
    if (!this.swPush.isEnabled && 'Notification' in window && Notification.permission === 'granted') {
      const aviso = new Notification(n.titulo, { body: n.mensaje, icon: 'icons/icon-192x192.png', tag: `sigoa-${n.id}` });
      aviso.onclick = () => {
        window.focus();
        this.abrir(n);
        aviso.close();
      };
    }
  }

  /** Al regresar a la pestaña se revisa de inmediato */
  private readonly alVolver = (): void => {
    if (document.visibilityState === 'visible') this.cargar();
  };

  private leerPermiso(): EstadoPermiso {
    if (!this.esNavegador || !('Notification' in window)) return 'no-soportado';
    switch (Notification.permission) {
      case 'granted': return 'activadas';
      case 'denied': return 'bloqueadas';
      default: return 'pendiente';
    }
  }
}