import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { AvisosService } from '../../../core/services/avisos.service';
import { DocumentoService } from '../../../core/services/documento.service';
import { ESTADOS_CONTRATO, hoyISO, motivoEstadoContrato, validarContrato } from '../../../core/reglas/reglas-negocio';

import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-contratos';

const POR_PAGINA = 8;

interface Contrato {
  id: number;
  id_proyecto: number;
  proyecto: string;
  cliente: string;
  cliente_correo: string;
  cliente_telefono: string;
  cliente_direccion: string;
  numero_contrato: string;
  fecha_firma: string;
  fecha_inicio: string;
  fecha_fin: string;
  monto: number;
  estado: string;
  archivo: string;
  observaciones: string;
}

/** Pago del proyecto (para calcular lo cobrado de cada contrato) */
interface PagoResumen {
  id: number;
  id_proyecto: number;
  fecha: string;
  concepto: string;
  monto: number;
  metodo_pago: string;
  estado: string;
}

/** Cotización aceptada del proyecto (base del contrato) */
interface CotizacionBase {
  id: number;
  id_proyecto: number;
  folio: string;
  total: number;
}

interface Opcion {
  id: number;
  nombre: string;
}

interface FormContrato {
  id: number | null;
  id_proyecto: number | null;
  numero_contrato: string;
  fecha_firma: string;
  fecha_inicio: string;
  fecha_fin: string;
  monto: number;
  estado: string;
  estadoOriginal: string | null;
  archivo: string;
  observaciones: string;
}

interface Respuesta {
  success: boolean;
  mensaje?: string;
  contratos?: unknown[];
  pagos?: unknown[];
  cotizaciones?: unknown[];
  proyectos?: Opcion[];
}

interface DatosContratos {
  contratos: Contrato[];
  pagos: PagoResumen[];
  cotizaciones: CotizacionBase[];
  guardadoEn: number;
}

/**
 * CONTRATOS · ADMINISTRADOR
 *  - Indicadores (valor contratado, cobrado, por firmar)
 *  - Lista con búsqueda, filtro por estado / proyecto, avance de cobro y paginación
 *  - Ficha central con datos del cliente, cotización base y pagos del proyecto
 *  - Formulario con reglas (cotización aceptada, un solo contrato activo, fechas)
 * Con conexión consulta la API (contratos + pagos + cotizaciones) y guarda una copia en IndexedDB.
 */
@Component({
  selector: 'app-contratos',
  standalone: true,
  imports: [FormsModule, Icono],
  templateUrl: './contratos.html',
  styleUrl: './contratos.css'
})
export class Contratos implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly avisos = inject(AvisosService);
  private readonly documento = inject(DocumentoService);

  readonly estados = ESTADOS_CONTRATO;
  readonly filtros = ['Todos', ...ESTADOS_CONTRATO];

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly contratos = signal<Contrato[]>([]);
  readonly pagos = signal<PagoResumen[]>([]);
  readonly cotizaciones = signal<CotizacionBase[]>([]);
  readonly proyectos = signal<Opcion[]>([]);
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);

  // ---------- Filtros ----------
  readonly busqueda = signal('');
  readonly filtroEstado = signal('Todos');
  readonly pagina = signal(1);
  readonly idProyectoFiltro = signal(0);
  readonly nombreProyectoFiltro = signal('');

  // ---------- Ventanas ----------
  readonly seleccionado = signal<Contrato | null>(null);
  readonly formContrato = signal<FormContrato | null>(null);
  readonly menuAbierto = signal<number | null>(null);
  readonly guardando = signal(false);

  // ---------- Datos calculados ----------
  readonly delProyecto = computed(() => {
    const id = this.idProyectoFiltro();
    return id ? this.contratos().filter((c) => c.id_proyecto === id) : this.contratos();
  });

  readonly filtrados = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.delProyecto().filter((c) => {
      const coincideEstado = estado === 'Todos' || c.estado === estado;
      const coincideTexto = !texto || [c.numero_contrato, c.proyecto, c.cliente].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const conteo: Record<string, number> = { Todos: this.delProyecto().length };
    for (const c of this.delProyecto()) conteo[c.estado] = (conteo[c.estado] ?? 0) + 1;
    return conteo;
  });

  /** Lo pagado (estado "Pagado") por proyecto */
  private readonly cobradoPorProyecto = computed(() => {
    const mapa = new Map<number, number>();
    for (const p of this.pagos()) {
      if (p.estado === 'Pagado') mapa.set(p.id_proyecto, (mapa.get(p.id_proyecto) ?? 0) + p.monto);
    }
    return mapa;
  });

  readonly indicadores = computed(() => {
    const vigentes = this.delProyecto().filter((c) => ['Activo', 'Finalizado'].includes(c.estado));
    const contratado = vigentes.reduce((t, c) => t + c.monto, 0);
    const cobrado = vigentes.reduce((t, c) => t + Math.min(this.cobrado(c), c.monto), 0);
    const borradores = this.delProyecto().filter((c) => c.estado === 'Borrador');
    return {
      contratado,
      activos: vigentes.filter((c) => c.estado === 'Activo').length,
      cobrado,
      porCobrar: Math.max(0, contratado - cobrado),
      porcentaje: contratado > 0 ? Math.round((cobrado / contratado) * 100) : 0,
      porFirmar: borradores.length,
      montoPorFirmar: borradores.reduce((t, c) => t + c.monto, 0)
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
          this.formContrato.set(null);
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

  /** Contratos + pagos + cotizaciones en paralelo (si pagos o cotizaciones fallan, la pantalla sigue) */
  private consultarServidor(): void {
    this.cargando.set(true);
    this.error.set('');

    const vacio: Respuesta = { success: false };
    forkJoin({
      contratos: this.http.get<Respuesta>(`${API}/contratos`),
      pagos: this.http.get<Respuesta>(`${API}/pagos`).pipe(catchError(() => of(vacio))),
      cotizaciones: this.http.get<Respuesta>(`${API}/cotizaciones`).pipe(catchError(() => of(vacio)))
    }).subscribe({
      next: ({ contratos, pagos, cotizaciones }) => {
        if (!contratos.success) {
          this.error.set(contratos.mensaje || 'No se pudieron cargar los contratos.');
          this.cargando.set(false);
          return;
        }
        const datos: DatosContratos = {
          contratos: (contratos.contratos ?? []).map((c) => this.normalizar(c)),
          pagos: (pagos.pagos ?? []).map((p) => this.normalizarPago(p)),
          cotizaciones: (cotizaciones.cotizaciones ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((c: any) => c.estado === 'Aceptada')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => ({ id: Number(c.id), id_proyecto: Number(c.id_proyecto), folio: c.folio ?? '', total: Number(c.total) || 0 })),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private cargarProyectos(): void {
    this.http.get<Respuesta>(`${API}/contratos/opciones`).subscribe({
      next: (respuesta) => this.proyectos.set(respuesta.proyectos ?? []),
      error: () => this.proyectos.set([])
    });
  }

  private mostrar(datos: DatosContratos, desdeCopia: boolean): void {
    this.contratos.set(datos.contratos);
    this.pagos.set(datos.pagos ?? []);
    this.cotizaciones.set(datos.cotizaciones ?? []);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    const abierto = this.seleccionado();
    if (abierto) this.seleccionado.set(datos.contratos.find((c) => c.id === abierto.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(c: any): Contrato {
    return {
      id: Number(c.id ?? c.id_contrato),
      id_proyecto: Number(c.id_proyecto),
      proyecto: c.proyecto ?? '',
      cliente: c.cliente ?? '',
      cliente_correo: c.cliente_correo ?? '',
      cliente_telefono: c.cliente_telefono ?? '',
      cliente_direccion: c.cliente_direccion ?? '',
      numero_contrato: c.numero_contrato ?? '',
      fecha_firma: this.fechaISO(c.fecha_firma),
      fecha_inicio: this.fechaISO(c.fecha_inicio),
      fecha_fin: this.fechaISO(c.fecha_fin),
      monto: Number(c.monto) || 0,
      estado: c.estado ?? 'Borrador',
      archivo: c.archivo ?? '',
      observaciones: c.observaciones ?? ''
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizarPago(p: any): PagoResumen {
    return {
      id: Number(p.id ?? p.id_pago),
      id_proyecto: Number(p.id_proyecto),
      fecha: this.fechaISO(p.fecha),
      concepto: p.concepto ?? '',
      monto: Number(p.monto) || 0,
      metodo_pago: p.metodo_pago ?? '',
      estado: p.estado ?? 'Pendiente'
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

  private async guardarCopia(datos: DatosContratos): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia de contratos:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene contratos guardados.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosContratos | undefined;
        datos?.contratos ? this.mostrar(datos, true) : sinDatos();
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

  verContrato(c: Contrato): void {
    this.menuAbierto.set(null);
    this.seleccionado.set(c);
  }

  irA(apartado: 'pagos' | 'cotizaciones', c: Contrato): void {
    this.router.navigate([`/admin/${apartado}`], { queryParams: { id_proyecto: c.id_proyecto, proyecto: c.proyecto } });
  }

  // =========================================================
  // CONTRATOS: crear, editar, eliminar, cambiar estado
  // =========================================================

  nuevoContrato(): void {
    if (!this.conexion.enLinea()) return;
    const idProyecto = this.idProyectoFiltro() || null;
    this.formContrato.set({
      id: null,
      id_proyecto: idProyecto,
      numero_contrato: this.siguienteNumero(),
      fecha_firma: '',
      fecha_inicio: '',
      fecha_fin: '',
      monto: idProyecto ? this.cotizacionBase(idProyecto)?.total ?? 0 : 0,
      estado: 'Borrador',
      estadoOriginal: null,
      archivo: '',
      observaciones: ''
    });
  }

  editarContrato(c: Contrato): void {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    this.formContrato.set({
      id: c.id, id_proyecto: c.id_proyecto, numero_contrato: c.numero_contrato,
      fecha_firma: c.fecha_firma, fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin,
      monto: c.monto, estado: c.estado, estadoOriginal: c.estado,
      archivo: c.archivo, observaciones: c.observaciones
    });
  }

  /** Al elegir proyecto en un contrato nuevo, el monto se toma de su cotización aceptada */
  cambiarProyecto(form: FormContrato, idProyecto: number | null): void {
    form.id_proyecto = idProyecto;
    const base = idProyecto ? this.cotizacionBase(idProyecto) : null;
    if (!form.id && base && !Number(form.monto)) form.monto = base.total;
  }

  usarMontoCotizacion(form: FormContrato): void {
    const base = form.id_proyecto ? this.cotizacionBase(form.id_proyecto) : null;
    if (base) form.monto = base.total;
  }

  guardarContrato(): void {
    const form = this.formContrato();
    if (!form || this.guardando()) return;

    const problema = validarContrato(form, this.contratos(), this.tieneAceptada(form.id_proyecto));
    if (problema) return this.avisos.error(problema);

    const datos = {
      id_proyecto: form.id_proyecto,
      numero_contrato: form.numero_contrato.trim().toUpperCase(),
      fecha_firma: form.fecha_firma || null,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null,
      monto: Number(form.monto),
      estado: form.estado,
      archivo: form.archivo || null,
      observaciones: form.observaciones.trim()
    };

    this.guardando.set(true);
    const peticion = form.id
      ? this.http.put<Respuesta>(`${API}/contratos/${form.id}`, datos)
      : this.http.post<Respuesta>(`${API}/contratos`, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar el contrato.');
        this.avisos.exito(form.id ? 'Contrato actualizado.' : 'Contrato creado.');
        this.formContrato.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar el contrato.');
      }
    });
  }

  /** Cambio rápido desde la ficha */
  async cambiarEstado(c: Contrato, estado: string): Promise<void> {
    if (!this.conexion.enLinea()) return;

    const motivo = this.motivoEstadoDe(c, estado);
    if (motivo) return this.avisos.error(`No se puede marcar como "${estado}": ${motivo}.`);

    // Para activarlo hacen falta firma y fechas: si no las tiene, se abre el formulario
    if (estado === 'Activo' && (!c.fecha_firma || !c.fecha_inicio || !c.fecha_fin || !(c.monto > 0))) {
      this.editarContrato(c);
      const form = this.formContrato();
      if (form) {
        form.estado = 'Activo';
        if (!form.fecha_firma) form.fecha_firma = hoyISO();
      }
      return this.avisos.mostrar('Completa la firma, las fechas y el monto para activar el contrato.');
    }

    if (estado === 'Cancelado' || estado === 'Finalizado') {
      const aceptado = await this.avisos.confirmar({
        titulo: estado === 'Cancelado' ? 'Cancelar contrato' : 'Finalizar contrato',
        mensaje: estado === 'Cancelado'
          ? `${c.numero_contrato} quedará cancelado. Sus pagos registrados se conservan.`
          : `${c.numero_contrato} se marcará como finalizado.${this.saldo(c) > 0 ? ` Aún hay ${this.moneda(this.saldo(c))} por cobrar.` : ''}`,
        textoAceptar: estado === 'Cancelado' ? 'Cancelar contrato' : 'Finalizar',
        peligro: estado === 'Cancelado'
      });
      if (!aceptado) return;
    }

    const datos = {
      id_proyecto: c.id_proyecto, numero_contrato: c.numero_contrato,
      fecha_firma: c.fecha_firma || null, fecha_inicio: c.fecha_inicio || null, fecha_fin: c.fecha_fin || null,
      monto: c.monto, estado, archivo: c.archivo || null, observaciones: c.observaciones
    };
    this.http.put<Respuesta>(`${API}/contratos/${c.id}`, datos).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo cambiar el estado.');
        this.avisos.exito(`${c.numero_contrato} marcado como ${estado.toLowerCase()}.`);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo cambiar el estado.')
    });
  }

  async eliminarContrato(c: Contrato): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar contrato',
      mensaje: c.estado === 'Activo'
        ? `${c.numero_contrato} está ACTIVO. Si el cliente canceló, mejor márcalo como cancelado para conservar el historial.`
        : `Se eliminará ${c.numero_contrato}. Esta acción no se puede deshacer.`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/contratos/${c.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar el contrato.');
        this.avisos.exito('Contrato eliminado.');
        if (this.seleccionado()?.id === c.id) this.seleccionado.set(null);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar el contrato.')
    });
  }

  // =========================================================
  // REGLAS Y CÁLCULOS (se usan en el HTML)
  // =========================================================

  cotizacionBase(idProyecto: number): CotizacionBase | null {
    return this.cotizaciones().find((c) => c.id_proyecto === idProyecto) ?? null;
  }

  private tieneAceptada(idProyecto: number | null): boolean {
    return !!idProyecto && !!this.cotizacionBase(idProyecto);
  }

  motivoEstado(form: FormContrato, estado: string): string {
    return motivoEstadoContrato(form, estado, this.contratos(), this.tieneAceptada(form.id_proyecto));
  }

  private motivoEstadoDe(c: Contrato, estado: string): string {
    return motivoEstadoContrato({ ...c, estadoOriginal: c.estado }, estado, this.contratos(), this.tieneAceptada(c.id_proyecto));
  }

  /** En activo o finalizado: firma, fechas y monto son obligatorios */
  pideDatosCompletos(form: FormContrato): boolean {
    return ['Activo', 'Finalizado'].includes(form.estado);
  }

  /** El monto no coincide con la cotización aceptada (solo aviso, no bloquea) */
  difiereDeCotizacion(idProyecto: number | null, monto: number): CotizacionBase | null {
    const base = idProyecto ? this.cotizacionBase(idProyecto) : null;
    return base && Math.abs(base.total - Number(monto)) >= 0.01 ? base : null;
  }

  accionesEstado(c: Contrato): { estado: string; texto: string; motivo: string }[] {
    const siguientes: Record<string, [string, string][]> = {
      Borrador: [['Activo', 'Firmado · activar'], ['Cancelado', 'Cancelar']],
      Activo: [['Finalizado', 'Finalizar'], ['Cancelado', 'Cancelar']],
      Finalizado: [],
      Cancelado: []
    };
    return (siguientes[c.estado] ?? []).map(([estado, texto]) => ({ estado, texto, motivo: this.motivoEstadoDe(c, estado) }));
  }

  pagosDe(c: Contrato): PagoResumen[] {
    return this.pagos()
      .filter((p) => p.id_proyecto === c.id_proyecto)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  cobrado(c: Contrato): number {
    return this.cobradoPorProyecto().get(c.id_proyecto) ?? 0;
  }

  saldo(c: Contrato): number {
    return Math.max(0, c.monto - this.cobrado(c));
  }

  porcentajeCobrado(c: Contrato): number {
    return c.monto > 0 ? Math.min(100, Math.round((this.cobrado(c) / c.monto) * 100)) : 0;
  }

  /** Días que faltan para la fecha de terminación (negativo si ya pasó) */
  diasRestantes(c: Contrato): number | null {
    if (!c.fecha_fin) return null;
    const [a, m, d] = c.fecha_fin.split('-').map(Number);
    const [ha, hm, hd] = hoyISO().split('-').map(Number);
    return Math.round((new Date(a, m - 1, d).getTime() - new Date(ha, hm - 1, hd).getTime()) / 86400000);
  }

  /** Siguiente número del año: CTR-2026-003 */
  private siguienteNumero(): string {
    const prefijo = `CTR-${new Date().getFullYear()}-`;
    const mayor = this.contratos()
      .map((c) => c.numero_contrato.toUpperCase())
      .filter((n) => n.startsWith(prefijo))
      .map((n) => Number(n.slice(prefijo.length)) || 0)
      .reduce((max, n) => Math.max(max, n), 0);
    return `${prefijo}${String(mayor + 1).padStart(3, '0')}`;
  }

  // =========================================================
  // PDF (abre una ventana lista para imprimir / guardar como PDF)
  // =========================================================

  descargarPdf(c: Contrato): void {
    if (!this.esNavegador) return;
    this.menuAbierto.set(null);

    const entidades: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const e = (valor: unknown): string => String(valor ?? '').replace(/[&<>"']/g, (ch) => entidades[ch] || ch);
    const f = (valor: string): string => (valor ? this.fecha(valor) : 'Por definir');
    const dato = (etiqueta: string, valor: string): string =>
      `<div class="dato"><small>${e(etiqueta)}</small><strong>${e(valor || 'No registrado')}</strong></div>`;
    const base = this.cotizacionBase(c.id_proyecto);

    const documento = `<!doctype html>
      <html lang="es"><head><meta charset="utf-8"><title>Contrato ${e(c.numero_contrato)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box}body{font-family:Figtree,Arial,sans-serif;color:#161616;margin:40px;font-size:12.5px;line-height:1.55}
        header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #161616;padding-bottom:18px;margin-bottom:22px}
        .marca{font-weight:800;font-size:22px;letter-spacing:-0.02em}.marca span{display:block;font-size:11px;font-weight:600;color:#878787;letter-spacing:.08em;text-transform:uppercase}
        .folio{text-align:right}.folio small{display:block;color:#878787;font-size:10px;letter-spacing:.1em;text-transform:uppercase}.folio strong{font-size:20px}
        h1{font-size:26px;margin:0 0 6px;letter-spacing:-0.02em}
        section{margin:20px 0;page-break-inside:avoid}h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #ddd}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}.dato small{display:block;color:#878787;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.dato strong{font-weight:600}
        .monto{padding:12px 16px;border-left:4px solid #FAC82B;background:#fff9df}.monto strong{font-size:20px}
        p{text-align:justify;margin:8px 0}.texto{white-space:pre-wrap}
        .firmas{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin:64px 16px 10px;text-align:center;page-break-inside:avoid}
        .firma{border-top:1px solid #161616;padding-top:8px}.firma small{display:block;color:#878787;font-size:10px}
        footer{margin-top:32px;padding-top:10px;border-top:1px solid #ddd;color:#878787;font-size:10px;text-align:center}
        @media print{body{margin:16mm}}
      </style></head><body>
      <header>
        <div class="marca">SIGOA<span>Contrato de obra</span></div>
        <div class="folio"><small>Contrato</small><strong>${e(c.numero_contrato)}</strong></div>
      </header>
      <h1>${e(c.proyecto)}</h1>
      <p>Documento que registra los datos del cliente, el objeto, el importe y la vigencia de los trabajos. Las condiciones específicas corresponden a lo acordado y firmado por las partes.</p>
      <section><h2>Primera · Datos del cliente</h2><div class="grid">
        ${dato('Nombre completo', c.cliente)}${dato('Correo electrónico', c.cliente_correo)}
        ${dato('Teléfono', c.cliente_telefono)}${dato('Domicilio', c.cliente_direccion)}
      </div></section>
      <section><h2>Segunda · Objeto del contrato</h2><div class="grid">
        ${dato('Proyecto u obra', c.proyecto)}${dato('Cotización base', base ? base.folio : 'Sin cotización aceptada')}
      </div><p>El alcance, materiales y entregables son los descritos en la cotización base y en las observaciones de este contrato.</p></section>
      <section><h2>Tercera · Importe</h2><div class="monto">Importe total: <strong>${e(this.moneda(c.monto))} MXN</strong></div></section>
      <section><h2>Cuarta · Vigencia</h2><div class="grid">
        ${dato('Fecha de firma', f(c.fecha_firma))}${dato('Inicio de los trabajos', f(c.fecha_inicio))}
        ${dato('Terminación', f(c.fecha_fin))}${dato('Estado', c.estado)}
      </div></section>
      <section><h2>Quinta · Condiciones y observaciones</h2><p class="texto">${e(c.observaciones || 'Sin condiciones adicionales registradas.')}</p></section>
      <div class="firmas">
        <div class="firma"><strong>${e(c.cliente || 'EL CLIENTE')}</strong><small>Nombre y firma del cliente</small></div>
        <div class="firma"><strong>REPRESENTANTE DEL DESPACHO</strong><small>Nombre y firma</small></div>
      </div>
      <footer>SIGOA · Contrato ${e(c.numero_contrato)} · Generado el ${e(this.fecha(hoyISO()))}</footer>
      </body></html>`;

       // Vista previa dentro de la app (sin ventana emergente que congele la página)
    this.documento.abrir(`Contrato ${c.numero_contrato}`, documento); 
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      Activo: 'sg-chip--proceso',
      Finalizado: 'sg-chip--activo',
      Cancelado: 'sg-chip--cancelado',
      Pagado: 'sg-chip--activo',
      Pendiente: 'sg-chip--pausado'
    };
    return clases[estado] ?? '';
  }

  codigoProyecto(id: number): string {
    return `PRY-${String(id).padStart(3, '0')}`;
  }

  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  moneda(valor: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor || 0);
  }

  dinero(valor: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(valor || 0);
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