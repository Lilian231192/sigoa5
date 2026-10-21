import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA (se borra al cerrar sesión)
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'arquitecto-inicio';

interface Obra {
  id: number;
  nombre: string;
  proyecto: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  porcentaje_avance: number;
}

interface Proyecto {
  id: number;
  nombre: string;
  cliente: string;
  estado: string;
  obras: Obra[];
}

interface DatosInicio {
  proyectos: Proyecto[];
  guardadoEn: number;
}

interface FechaProxima {
  fecha: Date;
  evento: string;
  obra: string;
  codigo: string;
}

/**
 * INICIO · ARQUITECTO
 * Mismo diseño que el Inicio del administrador (usa su misma hoja de estilos),
 * pero solo con los proyectos y obras asignados al arquitecto que inició sesión:
 *  - Indicadores (proyectos en curso, obras en construcción, entregas próximas, finalizadas)
 *  - Avance de sus obras y próximas fechas
 *  - Accesos rápidos a sus obras y proyectos
 */
@Component({
  selector: 'app-inicio-arquitecto',
  standalone: true,
  imports: [RouterLink, Icono],
  templateUrl: './inicio.html',
  // Se reutiliza el diseño aprobado del Inicio del administrador
  styleUrl: '../../admin/inicio/inicio.css'
})
export class InicioArquitecto implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly proyectos = signal<Proyecto[]>([]);
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);

  // ---------- Encabezado ----------
  readonly nombre = signal('Arquitecto');
  readonly saludo = this.calcularSaludo();
  readonly fechaHoy = this.formatoFecha(new Date(), true);
  private idUsuario = 0;

  // ---------- Datos calculados ----------
  /** Todas las obras de los proyectos asignados */
  readonly obras = computed(() =>
    this.proyectos().flatMap((p) => p.obras.map((o) => ({ ...o, proyecto: p.nombre })))
  );

  readonly indicadores = computed(() => {
    const proyectos = this.proyectos();
    const obras = this.obras();
    const vigentes = obras.filter((o) => !['Finalizada', 'Cancelada'].includes(o.estado));
    const hoy = this.hoy();
    const en30 = new Date(hoy.getTime() + 30 * 86400000);
    return {
      proyectos: proyectos.length,
      proyectosEnCurso: proyectos.filter((p) => ['En proceso', 'Pausado'].includes(p.estado)).length,
      obras: obras.length,
      enConstruccion: obras.filter((o) => o.estado === 'En construccion').length,
      pausadas: obras.filter((o) => o.estado === 'Pausada').length,
      entregasProximas: vigentes.filter((o) => {
        const f = this.aFecha(o.fecha_fin_estimada);
        return !!f && f >= hoy && f <= en30;
      }).length,
      atrasadas: vigentes.filter((o) => {
        const f = this.aFecha(o.fecha_fin_estimada);
        return !!f && f < hoy;
      }).length,
      finalizadas: obras.filter((o) => o.estado === 'Finalizada').length,
      avancePromedio: vigentes.length
        ? vigentes.reduce((t, o) => t + o.porcentaje_avance, 0) / vigentes.length
        : 0
    };
  });

  /** Obras que siguen en curso, de menor a mayor avance (las que más atención piden primero) */
  readonly obrasEnCurso = computed(() =>
    this.obras()
      .filter((o) => !['Finalizada', 'Cancelada'].includes(o.estado))
      .sort((a, b) => a.porcentaje_avance - b.porcentaje_avance)
      .slice(0, 5)
  );

  /** Inicios y entregas estimadas que aún no llegan (máx. 5) */
  readonly proximasFechas = computed<FechaProxima[]>(() => {
    const hoy = this.hoy();
    const fechas: FechaProxima[] = [];
    for (const o of this.obras()) {
      if (['Finalizada', 'Cancelada'].includes(o.estado)) continue;
      const inicio = this.aFecha(o.fecha_inicio);
      const entrega = this.aFecha(o.fecha_fin_estimada);
      if (inicio && inicio >= hoy && o.estado === 'Pendiente') {
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
      this.idUsuario = Number(usuario?.id_usuario) || 0;
    } catch { /* sesión dañada: se muestra el error al consultar */ }

    this.dbLista = this.abrirDB();

    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => (enLinea ? this.consultarServidor() : this.cargarCopia()));
    });
  }

  ngOnDestroy(): void {
    this.db?.close();
  }

  recargar(): void {
    this.conexion.enLinea() ? this.consultarServidor() : this.cargarCopia();
  }

  // =========================================================
  // DATOS
  // =========================================================

  private consultarServidor(): void {
    if (!this.idUsuario) {
      this.error.set('No se encontró tu sesión. Vuelve a iniciar sesión.');
      this.cargando.set(false);
      return;
    }
    this.cargando.set(true);
    this.error.set('');

    this.http.get<{ success: boolean; mensaje?: string; proyectos?: unknown[] }>(`${API}/proyectos/asignados/${this.idUsuario}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) {
          this.error.set(respuesta.mensaje || 'No se pudieron cargar tus proyectos.');
          this.cargando.set(false);
          return;
        }
        const datos: DatosInicio = {
          proyectos: (respuesta.proyectos ?? []).map((p) => this.normalizar(p)),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private mostrar(datos: DatosInicio, desdeCopia: boolean): void {
    this.proyectos.set(datos.proyectos);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(p: any): Proyecto {
    return {
      id: Number(p.id ?? p.id_proyecto),
      nombre: p.nombre ?? '',
      cliente: p.cliente ?? '',
      estado: p.estado ?? 'Pendiente',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obras: (Array.isArray(p.obras) ? p.obras : []).map((o: any) => ({
        id: Number(o.id_obra ?? o.id),
        nombre: o.nombre ?? '',
        proyecto: p.nombre ?? '',
        estado: o.estado ?? 'Pendiente',
        fecha_inicio: o.fecha_inicio ? String(o.fecha_inicio).substring(0, 10) : '',
        fecha_fin_estimada: o.fecha_fin_estimada ? String(o.fecha_fin_estimada).substring(0, 10) : '',
        porcentaje_avance: Number(o.porcentaje_avance) || 0
      }))
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
        datos?.proyectos ? this.mostrar(datos, true) : sinDatos();
      };
      peticion.onerror = sinDatos;
    } catch {
      sinDatos();
    }
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  private hoy(): Date {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return hoy;
  }

  /** "2026-10-22" → fecha local (sin desfase por zona horaria) */
  private aFecha(valor: string): Date | null {
    if (!valor) return null;
    const [a, m, d] = valor.split('-').map(Number);
    return new Date(a, m - 1, d);
  }

  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  proporcion(parte: number, total: number): number {
    return total > 0 ? Math.min(100, (parte / total) * 100) : 0;
  }

  dia(fecha: Date): string {
    return String(fecha.getDate()).padStart(2, '0');
  }

  mes(fecha: Date): string {
    return fecha.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '').toUpperCase();
  }

  faltan(fecha: Date): string {
    const dias = Math.round((fecha.getTime() - this.hoy().getTime()) / 86400000);
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Mañana';
    return `En ${dias} días`;
  }

  estadoTexto(estado: string): string {
    return estado.replace('construccion', 'construcción');
  }

  codigo(id: number): string {
    return `OBR-${String(id).padStart(3, '0')}`;
  }

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