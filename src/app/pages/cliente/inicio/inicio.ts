import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Icono } from '../../../shared/icono/icono';
import { SafeUrlPipe } from '../../../shared/safe-url.pipe';
import { ConexionService } from '../../../core/services/conexion.service';
import { NotificacionesService } from '../../../core/services/notificaciones.service';
import { hoyISO } from '../../../core/reglas/reglas-negocio';
import { API, SERVIDOR } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'cliente-portal';

interface Cliente {
  id: number;
  nombre: string;
  apellidos: string;
}

interface Proyecto {
  id: number;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  porcentaje_avance: number;
  arquitecto: string;
  arquitecto_correo: string;
  arquitecto_telefono: string;
}

interface Obra {
  id: number;
  id_proyecto: number;
  nombre: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_fin_real: string;
  porcentaje_avance: number;
}

interface Evidencia {
  id: number;
  id_proyecto: number;
  obra: string;
  tipo: string;
  archivo: string;
  descripcion: string;
  fecha: string;
}

interface Pago {
  id: number;
  id_proyecto: number;
  fecha: string;
  concepto: string;
  monto: number;
  metodo_pago: string;
  estado: string;
}

interface Contrato {
  id: number;
  id_proyecto: number;
  numero_contrato: string;
  monto: number;
  estado: string;
}

interface Cotizacion {
  id: number;
  id_proyecto: number;
  folio: string;
  vigencia: string;
  total: number;
  estado: string;
}

interface DatosPortal {
  cliente: Cliente;
  proyectos: Proyecto[];
  obras: Obra[];
  evidencias: Evidencia[];
  pagos: Pago[];
  contratos: Contrato[];
  cotizaciones: Cotizacion[];
  guardadoEn: number;
}

interface FechaProxima {
  fecha: string;
  evento: string;
  detalle: string;
}

/**
 * PORTAL DEL CLIENTE · "Mi obra"
 * Lo que el cliente necesita saber de su proyecto, en una sola pantalla:
 *  - Avance general y de cada obra
 *  - Próximas fechas (entregas y pagos)
 *  - Fotos y videos del avance
 *  - Pagos: contrato, pagado, saldo y calendario
 *  - Contacto con su arquitecto
 * Solo consulta (no edita nada). Usa el diseño del Inicio del administrador.
 */
@Component({
  selector: 'app-cliente-inicio',
  standalone: true,
  imports: [Icono, SafeUrlPipe],
  templateUrl: './inicio.html',
  styleUrls: ['../../admin/inicio/inicio.css', './inicio.css']
})
export class InicioCliente implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly notis = inject(NotificacionesService);

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly datos = signal<DatosPortal | null>(null);
  readonly desdeCopia = signal(false);
  readonly idProyecto = signal(0);
  readonly evidenciaVisor = signal<Evidencia | null>(null);

  readonly nombre = signal('');
  readonly saludo = this.calcularSaludo();
  readonly fechaHoy = this.formatoFecha(hoyISO(), true);
  private idUsuario = 0;

  /** Rayitas del medidor circular (como un transportador): una cada 9° */
  readonly marcas = Array.from({ length: 40 }, (_, i) => i * 9);

  // ---------- Datos del proyecto elegido ----------
  readonly proyectos = computed(() => this.datos()?.proyectos ?? []);

  readonly proyecto = computed(() =>
    this.proyectos().find((p) => p.id === this.idProyecto()) ?? this.proyectos()[0] ?? null
  );

  private readonly delProyecto = <T extends { id_proyecto: number }>(lista: T[] | undefined): T[] => {
    const p = this.proyecto();
    return p ? (lista ?? []).filter((x) => x.id_proyecto === p.id) : [];
  };

  readonly obras = computed(() => this.delProyecto(this.datos()?.obras));
  readonly evidencias = computed(() => this.delProyecto(this.datos()?.evidencias).slice(0, 12));
  readonly pagos = computed(() => this.delProyecto(this.datos()?.pagos));
  readonly contrato = computed(() => this.delProyecto(this.datos()?.contratos)[0] ?? null);
  readonly cotizacionPendiente = computed(() =>
    this.delProyecto(this.datos()?.cotizaciones).find((c) => c.estado === 'Enviada') ?? null
  );

  readonly avance = computed(() => {
    const obras = this.obras().filter((o) => o.estado !== 'Cancelada');
    if (!obras.length) return Math.round(this.proyecto()?.porcentaje_avance ?? 0);
    return Math.round(obras.reduce((t, o) => t + o.porcentaje_avance, 0) / obras.length);
  });

  readonly cobro = computed(() => {
    const pagado = this.pagos().filter((p) => p.estado === 'Pagado').reduce((t, p) => t + p.monto, 0);
    const pendiente = this.pagos().filter((p) => p.estado === 'Pendiente').reduce((t, p) => t + p.monto, 0);
    const total = this.contrato()?.monto ?? pagado + pendiente;
    return {
      total,
      pagado,
      saldo: Math.max(0, total - pagado),
      porcentaje: total > 0 ? Math.min(100, Math.round((pagado / total) * 100)) : 0,
      proximo: this.pagos().find((p) => p.estado === 'Pendiente') ?? null
    };
  });

  /** Entregas de obra y pagos pendientes que vienen (máx. 5) */
  readonly proximasFechas = computed<FechaProxima[]>(() => {
    const hoy = hoyISO();
    const fechas: FechaProxima[] = [];
    for (const o of this.obras()) {
      if (['Finalizada', 'Cancelada'].includes(o.estado)) continue;
      if (o.fecha_fin_estimada && o.fecha_fin_estimada >= hoy) {
        fechas.push({ fecha: o.fecha_fin_estimada, evento: 'Entrega de obra', detalle: o.nombre });
      }
    }
    for (const p of this.pagos()) {
      if (p.estado === 'Pendiente' && p.fecha >= hoy) {
        fechas.push({ fecha: p.fecha, evento: `Pago · ${this.dinero(p.monto)}`, detalle: p.concepto });
      }
    }
    const fin = this.proyecto()?.fecha_fin;
    if (fin && fin >= hoy && this.proyecto()?.estado !== 'Completado') {
      fechas.push({ fecha: fin, evento: 'Entrega del proyecto', detalle: this.proyecto()?.nombre ?? '' });
    }
    return fechas.sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 5);
  });

  private db: IDBDatabase | null = null;
  private dbLista: Promise<IDBDatabase | null> = Promise.resolve(null);

  constructor() {
    if (!this.esNavegador) {
      this.cargando.set(false);
      return;
    }

    try {
      const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
      this.idUsuario = Number(usuario.id_usuario) || 0;
      this.nombre.set(usuario.nombre ?? '');
    } catch { /* sesión dañada: se avisa al consultar */ }

    this.dbLista = this.abrirDB();

    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => (enLinea ? this.consultarServidor() : this.cargarCopia()));
    });

    // Llegó una notificación nueva (avance, fotos, pago, cotización…):
    // el portal se actualiza solo, sin parpadear ni recargar la página.
    let primeraVez = true;
    effect(() => {
      this.notis.cambios();
      if (primeraVez) { primeraVez = false; return; }
      untracked(() => { if (this.conexion.enLinea()) this.consultarServidor(true); });
    });
  }

  ngOnDestroy(): void {
    this.db?.close();
  }

  // =========================================================
  // DATOS
  // =========================================================

  recargar(): void {
    this.conexion.enLinea() ? this.consultarServidor() : this.cargarCopia();
  }

  /** `silencioso`: actualiza en segundo plano (sin el efecto de "cargando") */
  private consultarServidor(silencioso = false): void {
    if (!this.idUsuario) {
      this.error.set('No se encontró tu sesión. Vuelve a iniciar sesión.');
      this.cargando.set(false);
      return;
    }
    if (!silencioso) {
      this.cargando.set(true);
      this.error.set('');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.http.get<any>(`${API}/cliente/portal/${this.idUsuario}`).subscribe({
      next: (r) => {
        if (!r.success) {
          this.error.set(r.mensaje || 'No se pudo cargar tu proyecto.');
          this.cargando.set(false);
          return;
        }
        const datos = this.normalizar(r);
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: (e) => {
        if (silencioso) return; // si falla una actualización en segundo plano, se queda lo que ya se ve
        // 404 = cuenta sin cliente ligado: no tiene caso buscar copia
        if (e.status === 404) {
          this.error.set(e.error?.mensaje || 'Tu cuenta no está ligada a un cliente.');
          this.cargando.set(false);
          return;
        }
        this.cargarCopia();
      }
    });
  }

  private mostrar(datos: DatosPortal, desdeCopia: boolean): void {
    this.datos.set(datos);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);
    if (!datos.proyectos.some((p) => p.id === this.idProyecto())) {
      this.idProyecto.set(datos.proyectos[0]?.id ?? 0);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(r: any): DatosPortal {
    const f = (v: unknown) => (v ? String(v).substring(0, 10) : '');
    const n = (v: unknown) => Number(v) || 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lista = (v: any): any[] => (Array.isArray(v) ? v : []);
    return {
      cliente: { id: n(r.cliente?.id), nombre: r.cliente?.nombre ?? '', apellidos: r.cliente?.apellidos ?? '' },
      proyectos: lista(r.proyectos).map((p) => ({
        id: n(p.id), nombre: p.nombre ?? '', descripcion: p.descripcion ?? '', ubicacion: p.ubicacion ?? '',
        estado: p.estado ?? 'Pendiente', fecha_inicio: f(p.fecha_inicio), fecha_fin: f(p.fecha_fin),
        porcentaje_avance: n(p.porcentaje_avance), arquitecto: p.arquitecto ?? '',
        arquitecto_correo: p.arquitecto_correo ?? '', arquitecto_telefono: p.arquitecto_telefono ?? ''
      })),
      obras: lista(r.obras).map((o) => ({
        id: n(o.id), id_proyecto: n(o.id_proyecto), nombre: o.nombre ?? '', estado: o.estado ?? 'Pendiente',
        fecha_inicio: f(o.fecha_inicio), fecha_fin_estimada: f(o.fecha_fin_estimada), fecha_fin_real: f(o.fecha_fin_real),
        porcentaje_avance: n(o.porcentaje_avance)
      })),
      evidencias: lista(r.evidencias).map((e) => ({
        id: n(e.id), id_proyecto: n(e.id_proyecto), obra: e.obra ?? '', tipo: e.tipo ?? '',
        archivo: e.archivo ?? '', descripcion: e.descripcion ?? '', fecha: f(e.fecha)
      })),
      pagos: lista(r.pagos).map((p) => ({
        id: n(p.id), id_proyecto: n(p.id_proyecto), fecha: f(p.fecha), concepto: p.concepto ?? '',
        monto: n(p.monto), metodo_pago: p.metodo_pago ?? '', estado: p.estado ?? 'Pendiente'
      })),
      contratos: lista(r.contratos).map((c) => ({
        id: n(c.id), id_proyecto: n(c.id_proyecto), numero_contrato: c.numero_contrato ?? '', monto: n(c.monto), estado: c.estado ?? ''
      })),
      cotizaciones: lista(r.cotizaciones).map((c) => ({
        id: n(c.id), id_proyecto: n(c.id_proyecto), folio: c.folio ?? '', vigencia: f(c.vigencia), total: n(c.total), estado: c.estado ?? ''
      })),
      guardadoEn: Date.now()
    };
  }

  // =========================================================
  // INDEXED DB (copia para modo sin conexión)
  // =========================================================

  private abrirDB(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      const peticion = indexedDB.open(DB_NOMBRE, DB_VERSION);
      peticion.onupgradeneeded = () => {
        if (!peticion.result.objectStoreNames.contains(DB_STORE)) {
          peticion.result.createObjectStore(DB_STORE);
        }
      };
      peticion.onsuccess = () => {
        this.db = peticion.result;
        resolve(peticion.result);
      };
      peticion.onerror = () => resolve(null);
      peticion.onblocked = () => resolve(null);
    });
  }

  private async guardarCopia(datos: DatosPortal): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia del portal:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión y este dispositivo aún no tiene guardada la información de tu proyecto.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosPortal | undefined;
        datos?.proyectos ? this.mostrar(datos, true) : sinDatos();
      };
      peticion.onerror = sinDatos;
    } catch {
      sinDatos();
    }
  }

  // =========================================================
  // ACCIONES
  // =========================================================

  elegirProyecto(id: number): void {
    this.idProyecto.set(id);
  }

  abrirVisor(e: Evidencia): void {
    this.evidenciaVisor.set(e);
  }

  cerrarVisor(): void {
    this.evidenciaVisor.set(null);
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  urlArchivo(ruta: string): string {
    return ruta.startsWith('http') ? ruta : `${SERVIDOR}${ruta}`;
  }

  esImagen(e: Evidencia): boolean {
    return /\.(jpe?g|png|webp)$/i.test(e.archivo);
  }

  esVideo(e: Evidencia): boolean {
    return /\.mp4$/i.test(e.archivo);
  }

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      'En proceso': 'sg-chip--proceso',
      'En construccion': 'sg-chip--proceso',
      Completado: 'sg-chip--activo',
      Finalizada: 'sg-chip--activo',
      Pagado: 'sg-chip--activo',
      Pendiente: 'sg-chip--pausado',
      Pausado: 'sg-chip--pausado',
      Pausada: 'sg-chip--pausado',
      Cancelado: 'sg-chip--cancelado',
      Cancelada: 'sg-chip--cancelado'
    };
    return clases[estado] ?? '';
  }

  estadoTexto(estado: string): string {
    return estado.replace('construccion', 'construcción');
  }

  vencido(p: Pago): boolean {
    return p.estado === 'Pendiente' && p.fecha < hoyISO();
  }

  codigo(id: number): string {
    return `PRY-${String(id).padStart(3, '0')}`;
  }

  dinero(valor: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(valor || 0);
  }

  moneda(valor: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor || 0);
  }

  dia(fecha: string): string {
    return fecha.substring(8, 10);
  }

  mes(fecha: string): string {
    const [a, m, d] = fecha.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').toUpperCase();
  }

  faltan(fecha: string): string {
    const [a, m, d] = fecha.split('-').map(Number);
    const [ha, hm, hd] = hoyISO().split('-').map(Number);
    const dias = Math.round((new Date(a, m - 1, d).getTime() - new Date(ha, hm - 1, hd).getTime()) / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Mañana';
    return `En ${dias} días`;
  }

  formatoFecha(valor: string, conDia = false): string {
    if (!valor) return '—';
    const [a, m, d] = valor.substring(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat('es-MX', {
      weekday: conDia ? 'short' : undefined, day: '2-digit', month: 'short', year: 'numeric'
    })
      .format(new Date(a, m - 1, d))
      .replace(/[.,]/g, '')
      .replace(/ de /g, ' ')
      .toUpperCase();
  }

  momentoCopia(): string {
    const marca = this.datos()?.guardadoEn;
    if (!marca) return '';
    const d = new Date(marca);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${this.formatoFecha(iso)} · ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }

  private calcularSaludo(): string {
    const hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }
}