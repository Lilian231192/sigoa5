import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { AvisosService } from '../../../core/services/avisos.service';
import { SafeUrlPipe } from '../../../shared/safe-url.pipe';
import { ESTADOS_OBRA, ajustarObraPorEstado, validarObra } from '../../../core/reglas/reglas-negocio';
import { API, SERVIDOR } from '../../../core/api';

// IndexedDB
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-obras';

const POR_PAGINA = 8;
const TIPOS_EVIDENCIA = ['Fotografia', 'Video', 'Otro'];
const FORMATOS = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'];
const MAX_MB = 10;

interface Obra {
  id: number;
  id_proyecto: number;
  proyecto: string;
  cliente: string;
  nombre: string;
  descripcion: string;
  estado: string;
  fecha_inicio: string;
  fecha_fin_estimada: string;
  fecha_fin_real: string;
  porcentaje_avance: number;
}

interface Opcion {
  id: number;
  nombre: string;
}

interface Evidencia {
  id: number;
  tipo: string;
  archivo: string;
  descripcion: string;
  fecha: string;
  usuario: string;
}

interface FormObra {
  id: number | null;
  id_proyecto: number | null;
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
  obras?: unknown[];
  proyectos?: Opcion[];
  evidencias?: Evidencia[];
}

interface DatosObras {
  obras: Obra[];
  guardadoEn: number;
}

@Component({
  selector: 'app-obras',
  standalone: true,
  imports: [FormsModule, Icono, SafeUrlPipe],
  templateUrl: './obras.html',
  styleUrl: './obras.css'
})
export class Obras implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly avisos = inject(AvisosService);

  readonly estadosObra = ESTADOS_OBRA;
  readonly tiposEvidencia = TIPOS_EVIDENCIA;
  readonly filtros = ['Todos', ...ESTADOS_OBRA];

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly obras = signal<Obra[]>([]);
  readonly proyectos = signal<Opcion[]>([]);
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);

  // ---------- Filtros ----------
  readonly busqueda = signal('');
  readonly filtroEstado = signal('Todos');
  readonly pagina = signal(1);
  readonly idProyectoFiltro = signal(0);
  readonly nombreProyectoFiltro = signal('');

  // ---------- Ventanas y Modales ----------
  readonly seleccionada = signal<Obra | null>(null);
  readonly formObra = signal<FormObra | null>(null);
  readonly menuAbierto = signal<number | null>(null);
  readonly guardando = signal(false);

  // ---------- Evidencias ----------
  readonly evidencias = signal<Evidencia[]>([]);
  readonly cargandoEvidencias = signal(false);
  readonly subiendo = signal(false);
  readonly archivo = signal<File | null>(null);
  
  /** Signal para controlar el visor de imágenes (Lightbox) */
  readonly evidenciaVisor = signal<Evidencia | null>(null);

  tipoEvidencia = 'Fotografia';
  descripcionEvidencia = '';

  // ---------- Datos calculados ----------
  readonly delProyecto = computed(() => {
    const id = this.idProyectoFiltro();
    return id ? this.obras().filter((o) => o.id_proyecto === id) : this.obras();
  });

  readonly filtradas = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.delProyecto().filter((o) => {
      const coincideEstado = estado === 'Todos' || o.estado === estado;
      const coincideTexto =
        !texto || [o.nombre, o.proyecto, o.cliente, this.codigo(o.id)].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const conteo: Record<string, number> = { Todos: this.delProyecto().length };
    for (const o of this.delProyecto()) conteo[o.estado] = (conteo[o.estado] ?? 0) + 1;
    return conteo;
  });

  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtradas().length / POR_PAGINA)));

  readonly paginaActual = computed(() => {
    const inicio = (Math.min(this.pagina(), this.totalPaginas()) - 1) * POR_PAGINA;
    return this.filtradas().slice(inicio, inicio + POR_PAGINA);
  });

  private db: IDBDatabase | null = null;
  private dbLista: Promise<IDBDatabase | null> = Promise.resolve(null);

  constructor() {
    const parametros = this.ruta.snapshot.queryParamMap;
    this.idProyectoFiltro.set(Number(parametros.get('id_proyecto')) || 0);
    this.nombreProyectoFiltro.set(parametros.get('proyecto') || '');

    if (!this.esNavegador) {
      this.cargando.set(false);
      return;
    }

    this.dbLista = this.abrirDB();

    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => {
        if (enLinea) {
          this.consultarServidor();
          this.cargarProyectos();
        } else {
          this.cargarCopia();
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

    this.http.get<Respuesta>(`${API}/obras`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) {
          this.error.set(respuesta.mensaje || 'No se pudieron cargar las obras.');
          this.cargando.set(false);
          return;
        }
        const datos: DatosObras = {
          obras: (respuesta.obras ?? []).map((o) => this.normalizar(o)),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private cargarProyectos(): void {
    this.http.get<Respuesta>(`${API}/obras/opciones`).subscribe({
      next: (respuesta) => this.proyectos.set(respuesta.proyectos ?? []),
      error: () => this.proyectos.set([])
    });
  }

  private mostrar(datos: DatosObras, desdeCopia: boolean): void {
    this.obras.set(datos.obras);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    const abierta = this.seleccionada();
    if (abierta) this.seleccionada.set(datos.obras.find((o) => o.id === abierta.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(o: any): Obra {
    return {
      id: Number(o.id ?? o.id_obra),
      id_proyecto: Number(o.id_proyecto),
      proyecto: o.proyecto ?? '',
      cliente: o.cliente ?? '',
      nombre: o.nombre ?? '',
      descripcion: o.descripcion ?? '',
      estado: o.estado ?? 'Pendiente',
      fecha_inicio: this.fechaISO(o.fecha_inicio),
      fecha_fin_estimada: this.fechaISO(o.fecha_fin_estimada),
      fecha_fin_real: this.fechaISO(o.fecha_fin_real),
      porcentaje_avance: Number(o.porcentaje_avance) || 0
    };
  }

  private fechaISO(valor: unknown): string {
    if (!valor) return '';
    if (typeof valor === 'string') return valor.substring(0, 10);
    if (valor instanceof Date) return valor.toISOString().substring(0, 10);
    return '';
  }

  // =========================================================
  // INDEXED DB
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

  private async guardarCopia(datos: DatosObras): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia de obras:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene obras guardadas.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosObras | undefined;
        datos?.obras ? this.mostrar(datos, true) : sinDatos();
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

  quitarFiltroProyecto(): void {
    this.idProyectoFiltro.set(0);
    this.nombreProyectoFiltro.set('');
    this.pagina.set(1);
    this.router.navigate([], { queryParams: {} });
  }

  alternarMenu(id: number, evento: Event): void {
    evento.stopPropagation();
    this.menuAbierto.set(this.menuAbierto() === id ? null : id);
  }

  verObra(obra: Obra): void {
    this.menuAbierto.set(null);
    this.seleccionada.set(obra);
    this.limpiarEvidencia();
    this.evidencias.set([]);
    if (this.conexion.enLinea()) this.cargarEvidencias(obra.id);
  }

  cerrarFicha(): void {
    this.seleccionada.set(null);
    this.evidencias.set([]);
    this.limpiarEvidencia();
    this.evidenciaVisor.set(null); // Cierra el visor si estaba abierto
  }

  // =========================================================
  // VISOR DE EVIDENCIAS (Lightbox)
  // =========================================================

  abrirVisor(e: Evidencia): void {
    this.evidenciaVisor.set(e);
  }

  cerrarVisor(): void {
    this.evidenciaVisor.set(null);
  }

  // =========================================================
  // OBRAS: crear, editar, eliminar
  // =========================================================

  nuevaObra(): void {
    if (!this.conexion.enLinea()) return;
    this.formObra.set({
      id: null,
      id_proyecto: this.idProyectoFiltro() || null,
      nombre: '', descripcion: '', estado: 'Pendiente',
      fecha_inicio: '', fecha_fin_estimada: '', fecha_fin_real: '', porcentaje_avance: 0
    });
  }

  editarObra(o: Obra): void {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    this.formObra.set({
      id: o.id, id_proyecto: o.id_proyecto, nombre: o.nombre, descripcion: o.descripcion,
      estado: o.estado, fecha_inicio: o.fecha_inicio, fecha_fin_estimada: o.fecha_fin_estimada,
      fecha_fin_real: o.fecha_fin_real, porcentaje_avance: o.porcentaje_avance
    });
  }

  guardarObra(): void {
    const form = this.formObra();
    if (!form || this.guardando()) return;

    const problema = validarObra(form);
    if (problema) return this.avisos.error(problema);
    const avance = Number(form.porcentaje_avance);

    const datos = {
      id_proyecto: form.id_proyecto,
      nombre: form.nombre.trim(),
      descripcion: form.descripcion,
      estado: form.estado,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin_estimada: form.fecha_fin_estimada || null,
      fecha_fin_real: form.fecha_fin_real || null,
      porcentaje_avance: avance
    };

    this.guardando.set(true);
    const peticion = form.id
      ? this.http.put<Respuesta>(`${API}/obras/${form.id}`, datos)
      : this.http.post<Respuesta>(`${API}/obras`, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar la obra.');
        this.avisos.exito(form.id ? 'Obra actualizada.' : 'Obra creada.');
        this.formObra.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar la obra.');
      }
    });
  }

  async eliminarObra(o: Obra): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar obra',
      mensaje: `Se eliminará "${o.nombre}". Esta acción no se puede deshacer.`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/obras/${o.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar la obra.');
        this.avisos.exito('Obra eliminada.');
        if (this.seleccionada()?.id === o.id) this.cerrarFicha();
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar la obra.')
    });
  }

  /** Al cambiar el estado de la obra se ajustan avance y fecha real */
  cambiarEstado(form: FormObra, estado: string): void {
    form.estado = estado;
    ajustarObraPorEstado(form, estado);
  }

  // =========================================================
  // EVIDENCIAS
  // =========================================================

  private cargarEvidencias(idObra: number): void {
    this.cargandoEvidencias.set(true);
    this.http.get<Respuesta>(`${API}/evidencias?id_obra=${idObra}`).subscribe({
      next: (respuesta) => {
        this.evidencias.set(respuesta.evidencias ?? []);
        this.cargandoEvidencias.set(false);
      },
      error: () => {
        this.cargandoEvidencias.set(false);
        this.avisos.error('No se pudieron cargar las evidencias de la obra.');
      }
    });
  }

  elegirArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';
    if (!archivo) return;

    if (!FORMATOS.includes(archivo.type)) return this.avisos.error('Formatos permitidos: JPG, PNG, WEBP, MP4 y PDF.');
    if (archivo.size > MAX_MB * 1024 * 1024) return this.avisos.error(`El archivo no puede pesar más de ${MAX_MB} MB.`);

    this.archivo.set(archivo);
    if (archivo.type.startsWith('video/')) this.tipoEvidencia = 'Video';
    else if (archivo.type.startsWith('image/')) this.tipoEvidencia = 'Fotografia';
    else this.tipoEvidencia = 'Otro';
  }

  async subirEvidencia(): Promise<void> {
    const obra = this.seleccionada();
    const archivo = this.archivo();
    if (!obra || !archivo || this.subiendo() || !this.conexion.enLinea()) return;

    let idUsuario = 0;
    try {
      idUsuario = Number(JSON.parse(localStorage.getItem('usuario') || '{}').id_usuario) || 0;
    } catch { /* sesión dañada */ }
    if (!idUsuario) return this.avisos.error('No se encontró tu sesión. Vuelve a iniciar sesión.');

    this.subiendo.set(true);
    try {
      const base64 = await this.leerBase64(archivo);
      this.http.post<Respuesta>(`${API}/evidencias`, {
        id_obra: obra.id,
        id_usuario: idUsuario,
        tipo: this.tipoEvidencia,
        descripcion: this.descripcionEvidencia,
        archivo_nombre: archivo.name,
        archivo_mime: archivo.type,
        archivo_base64: base64
      }).subscribe({
        next: (respuesta) => {
          this.subiendo.set(false);
          if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo subir la evidencia.');
          this.avisos.exito('Evidencia subida.');
          this.limpiarEvidencia();
          this.cargarEvidencias(obra.id);
        },
        error: (e) => {
          this.subiendo.set(false);
          this.avisos.error(e.error?.mensaje || 'No se pudo subir la evidencia.');
        }
      });
    } catch {
      this.subiendo.set(false);
      this.avisos.error('No se pudo leer el archivo seleccionado.');
    }
  }

  async eliminarEvidencia(evidencia: Evidencia): Promise<void> {
    const obra = this.seleccionada();
    if (!obra || !this.conexion.enLinea()) return;

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar evidencia',
      mensaje: 'El archivo se borrará del servidor.',
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/evidencias/${evidencia.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar la evidencia.');
        this.avisos.exito('Evidencia eliminada.');
        this.cargarEvidencias(obra.id);
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar la evidencia.')
    });
  }

  limpiarEvidencia(): void {
    this.archivo.set(null);
    this.tipoEvidencia = 'Fotografia';
    this.descripcionEvidencia = '';
  }

  private leerBase64(archivo: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(',')[1] || '');
      lector.onerror = () => reject(lector.error);
      lector.readAsDataURL(archivo);
    });
  }

  // =========================================================
  // FORMATOS
  // =========================================================

  urlArchivo(ruta: string): string {
    return ruta.startsWith('http') ? ruta : `${SERVIDOR}${ruta}`;
  }

  esImagen(evidencia: Evidencia): boolean {
    return /\.(jpe?g|png|webp)$/i.test(evidencia.archivo);
  }

  esVideo(evidencia: Evidencia): boolean {
    return /\.mp4$/i.test(evidencia.archivo);
  }

  pesoArchivo(archivo: File): string {
    const mb = archivo.size / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(archivo.size / 1024)} KB`;
  }

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      'En construccion': 'sg-chip--proceso',
      'Finalizada': 'sg-chip--activo',
      'Pausada': 'sg-chip--pausado',
      'Cancelada': 'sg-chip--cancelado'
    };
    return clases[estado] ?? '';
  }

  estadoTexto(estado: string): string {
    return estado.replace('construccion', 'construcción');
  }

  codigo(id: number): string {
    return `OBR-${String(id).padStart(3, '0')}`;
  }

  codigoProyecto(id: number): string {
    return `PRY-${String(id).padStart(3, '0')}`;
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