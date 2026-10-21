import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { AvisosService } from '../../../core/services/avisos.service';
import {
  ESTADOS_OBRA, ESTADOS_PROYECTO, ajustarObraPorEstado, motivoEstadoProyecto, validarObra, validarProyecto
} from '../../../core/reglas/reglas-negocio';

import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA (se borra al cerrar sesión)
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-proyectos';

const POR_PAGINA = 8;

interface ObraProyecto {
  id_obra: number;
  id_proyecto: number;
  nombre: string;
  descripcion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_fin_real: string;
  porcentaje_avance: number;
}

interface Proyecto {
  id: number;
  id_cliente: number | null;
  id_arquitecto: number | null;
  nombre: string;
  descripcion: string;
  cliente: string;
  arquitecto: string;
  ubicacion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  porcentaje_avance: number;
  obras: ObraProyecto[];
}

interface Opcion {
  id: number;
  nombre: string;
}

interface FormProyecto {
  id: number | null;
  id_cliente: number | null;
  id_arquitecto: number | null;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface FormObra {
  id: number | null;
  id_proyecto: number;
  nombre: string;
  descripcion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_fin_real: string;
  porcentaje_avance: number;
}

interface Respuesta {
  success: boolean;
  mensaje?: string;
  id?: number;
  proyectos?: unknown[];
  clientes?: Opcion[];
  arquitectos?: Opcion[];
}

/** Lo que se guarda en IndexedDB para consultar sin conexión */
interface DatosProyectos {
  proyectos: Proyecto[];
  guardadoEn: number;
}

/**
 * PROYECTOS · ADMINISTRADOR
 *  - Lista con búsqueda, filtro por estado y paginación
 *  - Ficha lateral del proyecto con sus obras y accesos a cotizaciones, contratos y pagos
 *  - Formularios (modales) para crear/editar proyectos y obras
 * Con conexión consulta la API y guarda una copia en IndexedDB.
 * Sin conexión muestra la copia guardada y bloquea crear, editar y eliminar.
 */
@Component({
  selector: 'app-proyectos',
  standalone: true,
  imports: [FormsModule, Icono],
  templateUrl: './proyectos.html',
  styleUrl: './proyectos.css'
})
export class Proyectos implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly avisos = inject(AvisosService);

  readonly estadosProyecto = ESTADOS_PROYECTO;
  readonly estadosObra = ESTADOS_OBRA;
  readonly filtros = ['Todos', ...ESTADOS_PROYECTO];

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly proyectos = signal<Proyecto[]>([]);
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);
  readonly clientes = signal<Opcion[]>([]);
  readonly arquitectos = signal<Opcion[]>([]);

  // ---------- Filtros ----------
  readonly busqueda = signal('');
  readonly filtroEstado = signal('Todos');
  readonly pagina = signal(1);

  // ---------- Ventanas ----------
  /** Proyecto abierto en la ficha lateral */
  readonly seleccionado = signal<Proyecto | null>(null);
  /** Formulario de proyecto abierto (crear o editar) */
  readonly formProyecto = signal<FormProyecto | null>(null);
  /** Formulario de obra abierto (crear o editar) */
  readonly formObra = signal<FormObra | null>(null);
  /** Id del proyecto con el menú ⋮ abierto */
  readonly menuAbierto = signal<number | null>(null);
  readonly guardando = signal(false);

  // ---------- Datos calculados ----------
  readonly filtrados = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.proyectos().filter((p) => {
      const coincideEstado = estado === 'Todos' || p.estado === estado;
      const coincideTexto =
        !texto ||
        [p.nombre, p.cliente, p.arquitecto, p.ubicacion, this.codigo(p.id)].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const conteo: Record<string, number> = { Todos: this.proyectos().length };
    for (const p of this.proyectos()) conteo[p.estado] = (conteo[p.estado] ?? 0) + 1;
    return conteo;
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

    this.dbLista = this.abrirDB();

    // Cada vez que cambia la conexión: en línea → API, sin conexión → copia guardada
    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => {
        if (enLinea) {
          this.consultarServidor();
          this.cargarOpciones();
        } else {
          this.cargarCopia();
          this.formProyecto.set(null);
          this.formObra.set(null);
        }
      });
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
    this.cargando.set(true);
    this.error.set('');

    this.http.get<Respuesta>(`${API}/proyectos`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) {
          this.error.set(respuesta.mensaje || 'No se pudieron cargar los proyectos.');
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
      // Servidor apagado o error: se intenta con la copia guardada
      error: () => this.cargarCopia()
    });
  }

  private cargarOpciones(): void {
    this.http.get<Respuesta>(`${API}/proyectos/opciones`).subscribe({
      next: (respuesta) => {
        this.clientes.set(respuesta.clientes ?? []);
        this.arquitectos.set(respuesta.arquitectos ?? []);
      },
      error: () => { /* los selectores quedan vacíos; se reintenta al volver la conexión */ }
    });
  }

  private mostrar(datos: DatosProyectos, desdeCopia: boolean): void {
    this.proyectos.set(datos.proyectos);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    // Si la ficha lateral está abierta, se refresca con los datos nuevos
    const abierto = this.seleccionado();
    if (abierto) this.seleccionado.set(datos.proyectos.find((p) => p.id === abierto.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(p: any): Proyecto {
    return {
      id: Number(p.id ?? p.id_proyecto),
      id_cliente: p.id_cliente ? Number(p.id_cliente) : null,
      id_arquitecto: p.id_arquitecto ? Number(p.id_arquitecto) : null,
      nombre: p.nombre ?? '',
      descripcion: p.descripcion ?? '',
      cliente: p.cliente ?? '',
      arquitecto: p.arquitecto ?? '',
      ubicacion: p.ubicacion ?? '',
      estado: p.estado ?? 'Pendiente',
      fecha_inicio: this.fechaISO(p.fecha_inicio),
      fecha_fin: this.fechaISO(p.fecha_fin),
      porcentaje_avance: Number(p.porcentaje_avance) || 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      obras: (Array.isArray(p.obras) ? p.obras : []).map((o: any) => ({
        id_obra: Number(o.id_obra),
        id_proyecto: Number(o.id_proyecto),
        nombre: o.nombre ?? '',
        descripcion: o.descripcion ?? '',
        estado: o.estado ?? 'Pendiente',
        fecha_inicio: this.fechaISO(o.fecha_inicio),
        fecha_fin_estimada: this.fechaISO(o.fecha_fin_estimada),
        fecha_fin_real: this.fechaISO(o.fecha_fin_real),
        porcentaje_avance: Number(o.porcentaje_avance) || 0
      }))
    };
  }

  /** Deja la fecha como "2026-10-22" (sirve para los input type="date") */
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
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene proyectos guardados.');
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

  alternarMenu(id: number, evento: Event): void {
    evento.stopPropagation();
    this.menuAbierto.set(this.menuAbierto() === id ? null : id);
  }

  verProyecto(proyecto: Proyecto): void {
    this.menuAbierto.set(null);
    this.seleccionado.set(proyecto);
  }

  /** Abre cotizaciones, contratos, pagos u obras filtrados por el proyecto */
  irA(apartado: 'obras' | 'cotizaciones' | 'contratos' | 'pagos', proyecto: Proyecto): void {
    this.router.navigate([`/admin/${apartado}`], {
      queryParams: { id_proyecto: proyecto.id, proyecto: proyecto.nombre }
    });
  }

  // =========================================================
  // PROYECTOS: crear, editar, eliminar
  // =========================================================

  nuevoProyecto(): void {
    if (!this.conexion.enLinea()) return;
    this.formProyecto.set({
      id: null, id_cliente: null, id_arquitecto: null, nombre: '', descripcion: '',
      ubicacion: '', estado: 'Pendiente', fecha_inicio: '', fecha_fin: ''
    });
  }

  editarProyecto(p: Proyecto): void {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    this.formProyecto.set({
      id: p.id, id_cliente: p.id_cliente, id_arquitecto: p.id_arquitecto, nombre: p.nombre,
      descripcion: p.descripcion, ubicacion: p.ubicacion, estado: p.estado,
      fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin
    });
  }

  guardarProyecto(): void {
    const form = this.formProyecto();
    if (!form || this.guardando()) return;

    const problema = validarProyecto(form, this.obrasDe(form.id));
    if (problema) return this.avisos.error(problema);

    const datos = {
      id_cliente: form.id_cliente,
      id_arquitecto: form.id_arquitecto || null,
      nombre: form.nombre.trim(),
      descripcion: form.descripcion,
      ubicacion: form.ubicacion,
      estado: form.estado,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null
    };

    this.guardando.set(true);
    const peticion = form.id
      ? this.http.put<Respuesta>(`${API}/proyectos/${form.id}`, datos)
      : this.http.post<Respuesta>(`${API}/proyectos`, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar el proyecto.');
        this.avisos.exito(form.id ? 'Proyecto actualizado.' : 'Proyecto creado.');
        this.formProyecto.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar el proyecto.');
      }
    });
  }

  async eliminarProyecto(p: Proyecto): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar proyecto',
      mensaje: `Se eliminará "${p.nombre}". Esta acción no se puede deshacer.`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/proyectos/${p.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar el proyecto.');
        this.avisos.exito('Proyecto eliminado.');
        if (this.seleccionado()?.id === p.id) this.seleccionado.set(null);
        this.consultarServidor();
      },
      // El backend avisa si tiene obras, cotizaciones o contratos relacionados
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar el proyecto.')
    });
  }

  // =========================================================
  // OBRAS DEL PROYECTO: crear, editar, eliminar
  // =========================================================

  nuevaObra(p: Proyecto): void {
    if (!this.conexion.enLinea()) return;
    this.formObra.set({
      id: null, id_proyecto: p.id, nombre: '', descripcion: '', estado: 'Pendiente',
      fecha_inicio: '', fecha_fin_estimada: '', fecha_fin_real: '', porcentaje_avance: 0
    });
  }

  editarObra(o: ObraProyecto): void {
    if (!this.conexion.enLinea()) return;
    this.formObra.set({
      id: o.id_obra, id_proyecto: o.id_proyecto, nombre: o.nombre, descripcion: o.descripcion,
      estado: o.estado, fecha_inicio: o.fecha_inicio, fecha_fin_estimada: o.fecha_fin_estimada,
      fecha_fin_real: o.fecha_fin_real, porcentaje_avance: o.porcentaje_avance
    });
  }

  guardarObra(): void {
    const form = this.formObra();
    if (!form || this.guardando()) return;

    const problema = validarObra(form);
    if (problema) return this.avisos.error(problema);

    const datos = {
      ...form,
      nombre: form.nombre.trim(),
      porcentaje_avance: Number(form.porcentaje_avance),
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin_estimada: form.fecha_fin_estimada || null,
      fecha_fin_real: form.fecha_fin_real || null
    };

    this.guardando.set(true);
    const peticion = form.id
      ? this.http.put<Respuesta>(`${API}/obras/${form.id}`, datos)
      : this.http.post<Respuesta>(`${API}/obras`, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar la obra.');
        this.avisos.exito(form.id ? 'Obra actualizada.' : 'Obra agregada al proyecto.');
        this.formObra.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar la obra.');
      }
    });
  }

  async eliminarObra(o: ObraProyecto): Promise<void> {
    if (!this.conexion.enLinea()) return;

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar obra',
      mensaje: `Se eliminará la obra "${o.nombre}".`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/obras/${o.id_obra}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar la obra.');
        this.avisos.exito('Obra eliminada.');
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar la obra.')
    });
  }

  // =========================================================
  // REGLAS (se usan en el HTML de los formularios)
  // =========================================================

  /** Obras registradas de un proyecto (vacío si es un proyecto nuevo) */
  private obrasDe(idProyecto: number | null): ObraProyecto[] {
    return this.proyectos().find((p) => p.id === idProyecto)?.obras ?? [];
  }

  /** Motivo por el que un estado no se puede elegir en el formulario ('' = sí se puede) */
  motivoEstado(form: FormProyecto, estado: string): string {
    return motivoEstadoProyecto(estado, !form.id, this.obrasDe(form.id));
  }

  /** En proceso, pausado o completado: arquitecto y fechas son obligatorios */
  pideDatosCompletos(form: FormProyecto): boolean {
    return ['En proceso', 'Pausado', 'Completado'].includes(form.estado);
  }

  /** Al cambiar el estado de la obra se ajustan avance y fecha real */
  cambiarEstadoObra(form: FormObra, estado: string): void {
    form.estado = estado;
    ajustarObraPorEstado(form, estado);
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  /** Avance del proyecto: promedio de sus obras (o el del proyecto si no tiene obras) */
  avance(p: Proyecto): number {
    if (!p.obras.length) return Math.round(p.porcentaje_avance);
    const suma = p.obras.reduce((total, o) => total + o.porcentaje_avance, 0);
    return Math.round(suma / p.obras.length);
  }

  /** Clase del chip de color según el estado */
  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      'En proceso': 'sg-chip--proceso',
      'En construccion': 'sg-chip--proceso',
      'Completado': 'sg-chip--activo',
      'Finalizada': 'sg-chip--activo',
      'Pausado': 'sg-chip--pausado',
      'Pausada': 'sg-chip--pausado',
      'Cancelado': 'sg-chip--cancelado',
      'Cancelada': 'sg-chip--cancelado'
    };
    return clases[estado] ?? '';
  }

  /** "En construccion" (como viene de la BD) → "En construcción" */
  estadoTexto(estado: string): string {
    return estado.replace('construccion', 'construcción');
  }

  /** id 3 → "PRY-003" */
  codigo(id: number): string {
    return `PRY-${String(id).padStart(3, '0')}`;
  }

  codigoObra(id: number): string {
    return `OBR-${String(id).padStart(3, '0')}`;
  }

  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  /** "2026-10-22" → "22 OCT 2026" */
  fecha(valor: string): string {
    if (!valor) return '—';
    const [anio, mes, dia] = valor.split('-').map(Number);
    return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
      .format(new Date(anio, mes - 1, dia))
      .replace(/[.,]/g, '')
      .replace(/ de /g, ' ')
      .toUpperCase();
  }

  /** Fecha y hora de la copia guardada: "16 OCT 2026 · 19:30" */
  momentoCopia(): string {
    const marca = this.guardadoEn();
    if (!marca) return '';
    const d = new Date(marca);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `${this.fecha(iso)} · ${hora}`;
  }
}