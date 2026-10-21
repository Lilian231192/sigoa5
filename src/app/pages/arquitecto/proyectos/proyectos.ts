import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { ESTADOS_PROYECTO, hoyISO } from '../../../core/reglas/reglas-negocio';

import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'arquitecto-proyectos';

const POR_PAGINA = 8;

interface Obra {
  id: number;
  nombre: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  porcentaje_avance: number;
}

interface Proyecto {
  id: number;
  nombre: string;
  descripcion: string;
  cliente: string;
  ubicacion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  porcentaje_avance: number;
  obras: Obra[];
}

interface DatosProyectos {
  proyectos: Proyecto[];
  guardadoEn: number;
}

/**
 * PROYECTOS · ARQUITECTO
 * Consulta de los proyectos asignados al arquitecto que inició sesión:
 *  - Indicadores (en curso, avance promedio, próxima entrega)
 *  - Lista con búsqueda, filtro por estado y paginación
 *  - Ficha central con datos del proyecto y sus obras (acceso directo a actualizarlas)
 * El arquitecto no crea ni borra proyectos: eso lo hace el administrador.
 */
@Component({
  selector: 'app-proyectos-arquitecto',
  standalone: true,
  imports: [FormsModule, Icono],
  templateUrl: './proyectos.html',
  styleUrl: './proyectos.css'
})
export class ProyectosArquitecto implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);

  readonly filtros = ['Todos', ...ESTADOS_PROYECTO];

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly proyectos = signal<Proyecto[]>([]);
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);
  private idUsuario = 0;

  // ---------- Filtros ----------
  readonly busqueda = signal('');
  readonly filtroEstado = signal('Todos');
  readonly pagina = signal(1);

  // ---------- Ventanas ----------
  readonly seleccionado = signal<Proyecto | null>(null);

  // ---------- Datos calculados ----------
  readonly filtrados = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.proyectos().filter((p) => {
      const coincideEstado = estado === 'Todos' || p.estado === estado;
      const coincideTexto = !texto ||
        [p.nombre, p.cliente, p.ubicacion, this.codigo(p.id)].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const conteo: Record<string, number> = { Todos: this.proyectos().length };
    for (const p of this.proyectos()) conteo[p.estado] = (conteo[p.estado] ?? 0) + 1;
    return conteo;
  });

  readonly indicadores = computed(() => {
    const proyectos = this.proyectos();
    const enCurso = proyectos.filter((p) => ['En proceso', 'Pausado'].includes(p.estado));
    const vigentes = proyectos.filter((p) => !['Completado', 'Cancelado'].includes(p.estado));
    const hoy = hoyISO();
    const proxima = vigentes
      .filter((p) => p.fecha_fin && p.fecha_fin >= hoy)
      .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin))[0] ?? null;
    return {
      enCurso: enCurso.length,
      total: proyectos.length,
      obras: proyectos.reduce((t, p) => t + p.obras.length, 0),
      avancePromedio: vigentes.length ? Math.round(vigentes.reduce((t, p) => t + this.avance(p), 0) / vigentes.length) : 0,
      proxima,
      atrasados: vigentes.filter((p) => p.fecha_fin && p.fecha_fin < hoy).length
    };
  });

  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtrados().length / POR_PAGINA)));

  readonly paginaActual = computed(() => {
    const inicio = (Math.min(this.pagina(), this.totalPaginas()) - 1) * POR_PAGINA;
    return this.filtrados().slice(inicio, inicio + POR_PAGINA);
  });

  private db: IDBDatabase | null = null;
  private dbLista: Promise<IDBDatabase | null> = Promise.resolve(null);

  constructor() {
    if (!this.esNavegador) {
      this.cargando.set(false);
      return;
    }

    try {
      this.idUsuario = Number(JSON.parse(localStorage.getItem('usuario') || '{}').id_usuario) || 0;
    } catch { /* sesión dañada: se avisa al consultar */ }

    this.dbLista = this.abrirDB();

    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => (enLinea ? this.consultarServidor() : this.cargarCopia()));
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
        const datos: DatosProyectos = {
          proyectos: (respuesta.proyectos ?? []).map((p) => this.normalizar(p)),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private mostrar(datos: DatosProyectos, desdeCopia: boolean): void {
    this.proyectos.set(datos.proyectos);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    const abierto = this.seleccionado();
    if (abierto) this.seleccionado.set(datos.proyectos.find((p) => p.id === abierto.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(p: any): Proyecto {
    return {
      id: Number(p.id ?? p.id_proyecto),
      nombre: p.nombre ?? '',
      descripcion: p.descripcion ?? '',
      cliente: p.cliente ?? '',
      ubicacion: p.ubicacion ?? '',
      estado: p.estado ?? 'Pendiente',
      fecha_inicio: this.fechaISO(p.fecha_inicio),
      fecha_fin: this.fechaISO(p.fecha_fin),
      porcentaje_avance: Number(p.porcentaje_avance) || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obras: (Array.isArray(p.obras) ? p.obras : []).map((o: any) => ({
        id: Number(o.id_obra ?? o.id),
        nombre: o.nombre ?? '',
        estado: o.estado ?? 'Pendiente',
        fecha_inicio: this.fechaISO(o.fecha_inicio),
        fecha_fin_estimada: this.fechaISO(o.fecha_fin_estimada),
        porcentaje_avance: Number(o.porcentaje_avance) || 0
      }))
    };
  }

  private fechaISO(valor: unknown): string {
    if (!valor) return '';
    if (typeof valor === 'string') return valor.substring(0, 10);
    if (valor instanceof Date) return valor.toISOString().substring(0, 10);
    return '';
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

  private async guardarCopia(datos: DatosProyectos): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia de proyectos:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene tus proyectos guardados.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosProyectos | undefined;
        datos?.proyectos ? this.mostrar(datos, true) : sinDatos();
      };
      peticion.onerror = sinDatos;
    } catch {
      sinDatos();
    }
  }

  // =========================================================
  // FILTROS Y NAVEGACIÓN
  // =========================================================

  buscar(texto: string): void {
    this.busqueda.set(texto);
    this.pagina.set(1);
  }

  filtrar(estado: string): void {
    this.filtroEstado.set(estado);
    this.pagina.set(1);
  }

  cambiarPagina(paso: number): void {
    this.pagina.set(Math.min(this.totalPaginas(), Math.max(1, this.pagina() + paso)));
  }

  verProyecto(p: Proyecto): void {
    this.seleccionado.set(p);
  }

  /** Abre "Mis obras" filtrado por el proyecto (y opcionalmente con una obra abierta) */
  irAObras(p: Proyecto, idObra?: number): void {
    this.router.navigate(['/arquitecto/obras'], {
      queryParams: { id_proyecto: p.id, proyecto: p.nombre, ...(idObra ? { obra: idObra } : {}) }
    });
  }

  // =========================================================
  // CÁLCULOS Y FORMATOS (se usan en el HTML)
  // =========================================================

  /** Avance del proyecto: promedio de sus obras (o el del proyecto si no tiene obras) */
  avance(p: Proyecto): number {
    if (!p.obras.length) return Math.round(p.porcentaje_avance);
    return Math.round(p.obras.reduce((t, o) => t + o.porcentaje_avance, 0) / p.obras.length);
  }

  obrasActivas(p: Proyecto): number {
    return p.obras.filter((o) => ['En construccion', 'Pausada'].includes(o.estado)).length;
  }

  /** Días que faltan para una fecha (negativo si ya pasó) */
  dias(fecha: string): number | null {
    if (!fecha) return null;
    const [a, m, d] = fecha.split('-').map(Number);
    const [ha, hm, hd] = hoyISO().split('-').map(Number);
    return Math.round((new Date(a, m - 1, d).getTime() - new Date(ha, hm - 1, hd).getTime()) / 86400000);
  }

  /** "Faltan 12 días" / "Hoy" / "Venció hace 3 días" (solo proyectos que siguen vigentes) */
  plazo(p: Proyecto): string {
    if (['Completado', 'Cancelado'].includes(p.estado)) return '';
    const d = this.dias(p.fecha_fin);
    if (d === null) return '';
    if (d < 0) return `Venció hace ${-d} día${d === -1 ? '' : 's'}`;
    if (d === 0) return 'Vence hoy';
    return `Faltan ${d} día${d === 1 ? '' : 's'}`;
  }

  atrasado(p: Proyecto): boolean {
    const d = this.dias(p.fecha_fin);
    return d !== null && d < 0 && !['Completado', 'Cancelado'].includes(p.estado);
  }

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      'En proceso': 'sg-chip--proceso',
      'En construccion': 'sg-chip--proceso',
      Completado: 'sg-chip--activo',
      Finalizada: 'sg-chip--activo',
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

  codigo(id: number): string {
    return `PRY-${String(id).padStart(3, '0')}`;
  }

  codigoObra(id: number): string {
    return `OBR-${String(id).padStart(3, '0')}`;
  }

  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  fecha(valor: string): string {
    if (!valor) return '—';
    const [anio, mes, dia] = valor.substring(0, 10).split('-').map(Number);
    return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
      .format(new Date(anio, mes - 1, dia))
      .replace(/[.,]/g, '')
      .replace(/ de /g, ' ')
      .toUpperCase();
  }

  momentoCopia(): string {
    const marca = this.guardadoEn();
    if (!marca) return '';
    const d = new Date(marca);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `${this.fecha(iso)} · ${hora}`;
  }
}