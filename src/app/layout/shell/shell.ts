import { Component, ElementRef, OnDestroy, OnInit, PLATFORM_ID, computed, inject, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { Icono } from '../../shared/icono/icono';
import { ConexionService } from '../../core/services/conexion.service';
import { PwaInstallService } from '../../core/services/pwa-install.service';
import { AvisosService } from '../../core/services/avisos.service';
import { DocumentoService } from '../../core/services/documento.service';
import { Notificacion, NotificacionesService, TipoNotificacion, hace } from '../../core/services/notificaciones.service';
import { MENUS, Rol } from './menus';

interface UsuarioSesion {
  id_usuario?: number;
  id_rol?: number;
  nombre?: string;
  apellidos?: string;
  correo?: string;
}

/** Ícono y color de cada tipo de notificación */
const TIPOS_NOTIFICACION: Record<TipoNotificacion, { icono: string; color: string }> = {
  avance:       { icono: 'avance', color: 'amarillo' },
  fotos:        { icono: 'fotos', color: 'amarillo' },
  cotizacion:   { icono: 'cotizaciones', color: 'azul' },
  pago:         { icono: 'pagos', color: 'verde' },
  recordatorio: { icono: 'calendario', color: 'amarillo' },
  asignacion:   { icono: 'proyectos', color: 'azul' },
  vencido:      { icono: 'aviso-alerta', color: 'rojo' },
  terminada:    { icono: 'aviso-exito', color: 'verde' },
  prueba:       { icono: 'campana', color: 'negro' }
};

/** Qué se le explica a cada rol para que active las notificaciones */
const TEXTO_ACTIVAR: Record<Rol, string> = {
  cliente: 'Entérate al momento del avance de tu obra, las fotos nuevas, tus pagos y cotizaciones.',
  arquitecto: 'Entérate cuando te asignen un proyecto o una de tus obras esté por vencer.',
  admin: 'Entérate de pagos vencidos y de las obras que se terminan.'
};

/**
 * APP SHELL de SIGOA
 * Es el "cascarón" fijo de la aplicación: barra superior (todas las pantallas)
 * y barra inferior de navegación (celular y tablet). Se carga una sola vez y
 * queda en caché del Service Worker; lo único que cambia es el contenido
 * dentro de <router-outlet>.
 * El rol (admin, arquitecto o cliente) llega desde la ruta: data: { rol: 'admin' }.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono],
  templateUrl: './shell.html',
  styleUrls: ['./shell.css', './notificaciones.css', './documento.css'],
  // Clic en cualquier parte de la pantalla o tecla Esc: se cierran los menús
  host: {
    '(document:click)': 'clicEnDocumento($event)',
    '(document:keydown.escape)': 'alPresionarEsc()'
  }
})
export class Shell implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private navegacion?: Subscription;

  readonly conexion = inject(ConexionService);
  readonly pwa = inject(PwaInstallService);
  readonly avisos = inject(AvisosService);
  readonly notis = inject(NotificacionesService);
  readonly documento = inject(DocumentoService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly rol = signal<Rol>('admin');
  readonly config = computed(() => MENUS[this.rol()]);
  readonly usuario = signal<UsuarioSesion | null>(null);
  readonly inicial = computed(() => (this.usuario()?.nombre ?? 'U').charAt(0).toUpperCase());
  readonly textoActivar = computed(() => TEXTO_ACTIVAR[this.rol()]);

  readonly perfilAbierto = signal(false);
  readonly notisAbierto = signal(false);
  private readonly perfil = viewChild<ElementRef<HTMLElement>>('perfil');
  private readonly campana = viewChild<ElementRef<HTMLElement>>('campana');

  readonly hace = hace;

  ngOnInit(): void {
    this.rol.set((this.ruta.snapshot.data['rol'] as Rol) ?? 'admin');

    if (this.esNavegador) {
      try {
        this.usuario.set(JSON.parse(localStorage.getItem('usuario') || 'null'));
      } catch {
        this.usuario.set(null);
      }
      this.centrarPestanaActiva();
      this.notis.iniciar(this.usuario());
      this.sugerirNotificaciones();
    }

    // Al cambiar de pantalla se cierran los menús y, en celular,
    // la barra inferior se desliza para que se vea la opción activa.
    this.navegacion = this.router.events
      .pipe(filter((evento) => evento instanceof NavigationEnd))
      .subscribe(() => {
        this.cerrarMenus();
        this.centrarPestanaActiva();
      });
  }

  ngOnDestroy(): void {
    this.navegacion?.unsubscribe();
  }

  /** En celular la barra inferior puede deslizarse (admin tiene 7 opciones) */
  private centrarPestanaActiva(): void {
    if (!this.esNavegador) return;
    setTimeout(() => {
      document.querySelector('.tabs a.activo')
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    });
  }

  /** La primera vez, un aviso invita a activar las notificaciones desde la campanita */
  private sugerirNotificaciones(): void {
    const clave = 'sigoa-notificaciones-sugeridas';
    try {
      if (this.notis.permiso() !== 'pendiente' || localStorage.getItem(clave)) return;
      localStorage.setItem(clave, '1');
    } catch {
      return;
    }
    setTimeout(() => {
      if (!this.notisAbierto()) this.avisos.info('Activa las notificaciones desde la campanita 🔔 para enterarte de todo al momento.');
    }, 2500);
  }

  // ---------- Menús de la barra superior (solo uno abierto a la vez) ----------
  alternarPerfil(): void {
    this.notisAbierto.set(false);
    this.perfilAbierto.update((abierto) => !abierto);
  }

  alternarNotis(): void {
    this.perfilAbierto.set(false);
    this.notisAbierto.update((abierto) => !abierto);
  }

  /** Esc: primero cierra la vista previa del documento; si no hay, los menús */
  alPresionarEsc(): void {
    if (this.documento.actual()) this.documento.cerrar();
    else this.cerrarMenus();
  }

  cerrarMenus(): void {
    this.perfilAbierto.set(false);
    this.notisAbierto.set(false);
  }

  /** Si el clic fue fuera de un menú abierto, ese menú se cierra */
  clicEnDocumento(evento: MouseEvent): void {
    const objetivo = evento.target as Node;
    if (this.perfilAbierto() && !this.perfil()?.nativeElement.contains(objetivo)) this.perfilAbierto.set(false);
    if (this.notisAbierto() && !this.campana()?.nativeElement.contains(objetivo)) this.notisAbierto.set(false);
  }

  // ---------- Notificaciones ----------
  abrirNotificacion(n: Notificacion): void {
    this.notisAbierto.set(false);
    this.notis.abrir(n);
  }

  /** Notificación que se está yendo (para animar su salida antes de borrarla) */
  readonly borrando = signal<number | null>(null);

  eliminarNotificacion(n: Notificacion, evento: Event): void {
    evento.stopPropagation();
    this.borrando.set(n.id);
    setTimeout(() => {
      this.notis.eliminar(n);
      this.borrando.set(null);
    }, 220);
  }

  eliminarTodas(): void {
    this.notisAbierto.set(false);
    this.notis.eliminarTodas();
  }

  iconoDe(tipo: TipoNotificacion): string {
    return TIPOS_NOTIFICACION[tipo]?.icono ?? 'campana';
  }

  colorDe(tipo: TipoNotificacion): string {
    return TIPOS_NOTIFICACION[tipo]?.color ?? 'negro';
  }

  // ---------- Vista previa de documentos (recibos, cotizaciones, contratos) ----------
  private readonly marco = viewChild<ElementRef<HTMLIFrameElement>>('marco');

  /** El HTML lo arma SIGOA (con los datos ya escapados), por eso se marca como seguro */
  readonly documentoHtml = computed(() => {
    const doc = this.documento.actual();
    return doc ? this.sanitizer.bypassSecurityTrustHtml(doc.html) : null;
  });

  /** Imprime solo el documento; en el diálogo se elige «Guardar como PDF» */
  imprimirDocumento(): void {
    const ventana = this.marco()?.nativeElement.contentWindow;
    if (!ventana) return;
    ventana.focus();
    ventana.print();
  }

  // ---------- Sesión ----------
  /** Pide confirmación antes de salir */
  async confirmarCerrarSesion(): Promise<void> {
    this.perfilAbierto.set(false);
    const salir = await this.avisos.confirmar({
      titulo: '¿Cerrar sesión?',
      mensaje: 'Tendrás que volver a ingresar tu correo y contraseña. Los datos guardados para consultar sin conexión se borrarán de este dispositivo.',
      textoAceptar: 'Cerrar sesión',
      peligro: true
    });
    if (salir) await this.cerrarSesion();
  }

  private async cerrarSesion(): Promise<void> {
    // Este dispositivo deja de recibir las notificaciones de este usuario
    await this.notis.salir();
    if (this.esNavegador) {
      localStorage.removeItem('usuario');
      // Se borra la información guardada para consulta sin conexión,
      // por si el dispositivo es compartido.
      indexedDB.deleteDatabase('SIGOA_DB');
    }
    this.router.navigate(['/login']);
  }
}