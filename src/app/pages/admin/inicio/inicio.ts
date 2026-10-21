import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA (se borra al cerrar sesión)
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-inicio';

interface Resumen {
  proyectos: { total: number; enProgreso: number };
  obras: { total: number; enConstruccion: number };
  cotizaciones: { total: number; pendientes: number };
  contratos: { total: number; activos: number };
  pagos: { pendientes: number; montoPendiente: number };
  avancePromedio: number;
}

interface Obra {
  id: number;
  nombre: string;
  proyecto: string;
  cliente: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  porcentaje_avance: number;
}

/** Lo que se guarda en IndexedDB para consultar sin conexión */
interface DatosInicio {
  resumen: Resumen;
  obras: Obra[];
  guardadoEn: number;
}

interface FechaProxima {
  fecha: Date;
  evento: string;
  obra: string;
  codigo: string;
}

const RESUMEN_VACIO: Resumen = {
  proyectos: { total: 0, enProgreso: 0 },
  obras: { total: 0, enConstruccion: 0 },
  cotizaciones: { total: 0, pendientes: 0 },
  contratos: { total: 0, activos: 0 },
  pagos: { pendientes: 0, montoPendiente: 0 },
  avancePromedio: 0
};

/**
 * INICIO · ADMINISTRADOR
 * Tablero con el estado general del despacho:
 *  - Indicadores (proyectos, obras, cotizaciones, pagos)
 *  - Avance de las obras en curso
 *  - Próximas fechas (inicios y entregas estimadas)
 * Con conexión consulta la API y guarda una copia en IndexedDB.
 * Sin conexión muestra la última copia guardada (modo consulta).
 */
@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [RouterLink, Icono],
  templateUrl: './inicio.html',
  styleUrl: './inicio.css'
})
export class InicioComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly resumen = signal<Resumen>(RESUMEN_VACIO);
  readonly obras = signal<Obra[]>([]);
  /** true cuando lo que se ve viene de IndexedDB (sin conexión o servidor apagado) */
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);

  // ---------- Encabezado ----------
  readonly nombre = signal('Administrador');
  readonly saludo = this.calcularSaludo();
  readonly fechaHoy = this.formatoFecha(new Date(), true);

  // ---------- Datos calculados ----------
  /** Obras que siguen en curso, de mayor a menor avance (máx. 5) */
  readonly obrasEnCurso = computed(() =>
    this.obras()
      .filter((o) => !['Finalizada', 'Cancelada'].includes(o.estado))
      .sort((a, b) => Number(b.porcentaje_avance) - Number(a.porcentaje_avance))
      .slice(0, 5)
  );

  /** Inicios y entregas estimadas que aún no llegan (máx. 5) */
  readonly proximasFechas = computed<FechaProxima[]>(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechas: FechaProxima[] = [];

    for (const o of this.obras()) {
      if (['Finalizada', 'Cancelada'].includes(o.estado)) continue;
      const inicio = o.fecha_inicio ? new Date(o.fecha_inicio) : null;
      const entrega = o.fecha_fin_estimada ? new Date(o.fecha_fin_estimada) : null;

      if (inicio && inicio >= hoy) {
        fechas.push({ fecha: inicio, evento: 'Inicio de obra', obra: o.nombre, codigo: this.codigo(o.id) });
      }
      if (entrega && entrega >= hoy) {
        fechas.push({ fecha: entrega, evento: 'Entrega estimada', obra: o.nombre, codigo: this.codigo(o.id) });
      }
    }
    return fechas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).slice(0, 5);
  });

  /** Rayitas del medidor circular (como un transportador): una cada 9° */
  readonly marcas = Array.from({ length: 40 }, (_, i) => i * 9);

  private db: IDBDatabase | null = null;
  private dbLista: Promise<IDBDatabase | null> = Promise.resolve(null);

  constructor() {
    if (!this.esNavegador) {
      this.cargando.set(false);
      return;
    }

    try {
      const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
      if (usuario?.nombre) this.nombre.set(usuario.nombre);
    } catch { /* sesión sin nombre: se queda "Administrador" */ }

    this.dbLista = this.abrirDB();

    // Cada vez que cambia la conexión: en línea → API, sin conexión → copia guardada
    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => (enLinea ? this.consultarServidor() : this.cargarCopia()));
    });
  }

  ngOnDestroy(): void {
    this.db?.close();
  }

  /** Botón "Reintentar" */
  recargar(): void {
    this.conexion.enLinea() ? this.consultarServidor() : this.cargarCopia();
  }

  // =========================================================
  // DATOS
  // =========================================================

  private consultarServidor(): void {
    this.cargando.set(true);
    this.error.set('');

    forkJoin({
      resumen: this.http.get<Partial<Resumen>>(`${API}/admin/resumen`),
      // Si la lista de obras falla, el tablero se muestra igual con los indicadores
      obras: this.http.get<{ obras?: Obra[] }>(`${API}/obras`).pipe(catchError(() => of({ obras: [] })))
    }).subscribe({
      next: ({ resumen, obras }) => {
        const datos: DatosInicio = {
          resumen: this.normalizar(resumen),
          obras: obras.obras ?? [],
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      // Servidor apagado o error: se intenta con la copia guardada
      error: () => this.cargarCopia()
    });
  }

  private mostrar(datos: DatosInicio, desdeCopia: boolean): void {
    this.resumen.set(datos.resumen);
    this.obras.set(datos.obras);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);
  }

  private normalizar(r: Partial<Resumen>): Resumen {
    const n = (v: unknown) => Number(v ?? 0) || 0;
    return {
      proyectos: { total: n(r.proyectos?.total), enProgreso: n(r.proyectos?.enProgreso) },
      obras: { total: n(r.obras?.total), enConstruccion: n(r.obras?.enConstruccion) },
      cotizaciones: { total: n(r.cotizaciones?.total), pendientes: n(r.cotizaciones?.pendientes) },
      contratos: { total: n(r.contratos?.total), activos: n(r.contratos?.activos) },
      pagos: { pendientes: n(r.pagos?.pendientes), montoPendiente: n(r.pagos?.montoPendiente) },
      avancePromedio: n(r.avancePromedio)
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

  private async guardarCopia(datos: DatosInicio): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia del inicio:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene datos guardados.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosInicio | undefined;
        datos?.resumen ? this.mostrar(datos, true) : sinDatos();
      };
      peticion.onerror = sinDatos;
    } catch {
      sinDatos();
    }
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  /** 8 → "08" */
  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  /** 145000 → "$145,000" */
  dinero(valor: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(valor);
  }

  /** Proporción para las barras de los indicadores: 3 de 8 → 37.5 */
  proporcion(parte: number, total: number): number {
    return total > 0 ? Math.min(100, (parte / total) * 100) : 0;
  }

  /** Día y mes por separado para el bloque de calendario: "22" · "OCT" */
  dia(fecha: Date): string {
    return String(fecha.getDate()).padStart(2, '0');
  }

  mes(fecha: Date): string {
    return fecha.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').toUpperCase();
  }

  /** Días que faltan: "Hoy", "Mañana", "En 6 días" */
  faltan(fecha: Date): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Mañana';
    return `En ${dias} días`;
  }

  /** "En construccion" (como viene de la BD) → "En construcción" */
  estadoTexto(estado: string): string {
    return estado.replace('construccion', 'construcción');
  }

  /** id 3 → "OBR-003" */
  codigo(id: number): string {
    return `OBR-${String(id).padStart(3, '0')}`;
  }

  /** "22 OCT 2026" (o "VIE 16 OCT 2026" con día de la semana) */
  formatoFecha(fecha: Date, conDia = false): string {
    return new Intl.DateTimeFormat('es-MX', {
      weekday: conDia ? 'short' : undefined,
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
      .format(fecha)
      .replace(/[.,]/g, '')
      .replace(/ de /g, ' ')
      .toUpperCase();
  }

  /** Fecha y hora de la copia guardada: "16 OCT 2026 · 19:30" */
  momentoCopia(): string {
    const marca = this.guardadoEn();
    if (!marca) return '';
    const fecha = new Date(marca);
    const hora = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `${this.formatoFecha(fecha)} · ${hora}`;
  }

  private calcularSaludo(): string {
    const hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }
}