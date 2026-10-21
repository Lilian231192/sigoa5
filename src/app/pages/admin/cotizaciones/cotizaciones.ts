import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { AvisosService } from '../../../core/services/avisos.service';
import { DocumentoService } from '../../../core/services/documento.service';

import {
  ESTADOS_COTIZACION, centavos, conceptosBloqueados, hoyISO, motivoEstadoCotizacion, validarCotizacion
} from '../../../core/reglas/reglas-negocio';

import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-cotizaciones';

const POR_PAGINA = 8;
const UNIDADES = ['m²', 'm³', 'ml', 'pza', 'lote', 'servicio', 'hr', 'kg'];

interface Detalle {
  concepto: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  importe: number;
}

interface Cotizacion {
  id: number;
  id_proyecto: number;
  proyecto: string;
  cliente: string;
  folio: string;
  fecha: string;
  vigencia: string;
  subtotal: number;
  iva: number;
  total: number;
  estado: string;
  observaciones: string;
  detalles: Detalle[];
}

interface Opcion {
  id: number;
  nombre: string;
}

/** Fila editable de conceptos ("clave" solo sirve para que Angular no confunda filas) */
interface FormDetalle {
  clave: number;
  concepto: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
}

interface FormCotizacion {
  id: number | null;
  id_proyecto: number | null;
  folio: string;
  fecha: string;
  vigencia: string;
  estado: string;
  estadoOriginal: string | null;
  porcentaje_iva: number;
  observaciones: string;
  detalles: FormDetalle[];
}

interface Respuesta {
  success: boolean;
  mensaje?: string;
  cotizaciones?: unknown[];
  proyectos?: Opcion[];
}

interface DatosCotizaciones {
  cotizaciones: Cotizacion[];
  guardadoEn: number;
}

/**
 * COTIZACIONES · ADMINISTRADOR
 *  - Indicadores (cotizado, aceptado, por responder)
 *  - Lista con búsqueda, filtro por estado / proyecto y paginación
 *  - Ficha lateral con conceptos, montos, cambio rápido de estado y PDF
 *  - Formulario con conceptos editables y totales en vivo
 * Con conexión consulta la API y guarda una copia en IndexedDB.
 * Sin conexión muestra la copia y bloquea crear, editar y eliminar (el PDF sí funciona).
 */
@Component({
  selector: 'app-cotizaciones',
  standalone: true,
  imports: [FormsModule, Icono],
  templateUrl: './cotizaciones.html',
  styleUrl: './cotizaciones.css'
})
export class Cotizaciones implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly avisos = inject(AvisosService);
       private readonly documento = inject(DocumentoService);

  readonly estados = ESTADOS_COTIZACION;
  readonly filtros = ['Todos', ...ESTADOS_COTIZACION];
  readonly unidades = UNIDADES;

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly cotizaciones = signal<Cotizacion[]>([]);
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
  readonly seleccionada = signal<Cotizacion | null>(null);
  readonly formCotizacion = signal<FormCotizacion | null>(null);
  readonly menuAbierto = signal<number | null>(null);
  readonly guardando = signal(false);

  private siguienteClave = 1;

  // ---------- Datos calculados ----------
  readonly delProyecto = computed(() => {
    const id = this.idProyectoFiltro();
    return id ? this.cotizaciones().filter((c) => c.id_proyecto === id) : this.cotizaciones();
  });

  readonly filtradas = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.delProyecto().filter((c) => {
      const coincideEstado = estado === 'Todos' || c.estado === estado;
      const coincideTexto = !texto || [c.folio, c.proyecto, c.cliente].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const conteo: Record<string, number> = { Todos: this.delProyecto().length };
    for (const c of this.delProyecto()) conteo[c.estado] = (conteo[c.estado] ?? 0) + 1;
    return conteo;
  });

  /** Indicadores de la parte superior (respetan el filtro por proyecto) */
  readonly indicadores = computed(() => {
    const lista = this.delProyecto();
    const suma = (estados: string[]) =>
      lista.filter((c) => estados.includes(c.estado)).reduce((t, c) => t + c.total, 0);
    const enviadas = lista.filter((c) => c.estado === 'Enviada');
    const respondidas = lista.filter((c) => ['Aceptada', 'Rechazada'].includes(c.estado)).length;
    const aceptadas = lista.filter((c) => c.estado === 'Aceptada').length;
    return {
      cotizado: suma(['Enviada', 'Aceptada', 'Rechazada', 'Vencida']),
      emitidas: lista.filter((c) => c.estado !== 'Borrador').length,
      aceptado: suma(['Aceptada']),
      aceptadas,
      tasa: respondidas ? Math.round((aceptadas / respondidas) * 100) : 0,
      porResponder: enviadas.length,
      montoPorResponder: enviadas.reduce((t, c) => t + c.total, 0),
      porVencer: enviadas.filter((c) => this.vencePronto(c)).length
    };
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

    // Cada vez que cambia la conexión: en línea → API, sin conexión → copia guardada
    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => {
        if (enLinea) {
          this.consultarServidor();
          this.cargarProyectos();
        } else {
          this.cargarCopia();
          this.formCotizacion.set(null);
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

    this.http.get<Respuesta>(`${API}/cotizaciones`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) {
          this.error.set(respuesta.mensaje || 'No se pudieron cargar las cotizaciones.');
          this.cargando.set(false);
          return;
        }
        const datos: DatosCotizaciones = {
          cotizaciones: (respuesta.cotizaciones ?? []).map((c) => this.normalizar(c)),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private cargarProyectos(): void {
    this.http.get<Respuesta>(`${API}/cotizaciones/opciones`).subscribe({
      next: (respuesta) => this.proyectos.set(respuesta.proyectos ?? []),
      error: () => this.proyectos.set([])
    });
  }

  private mostrar(datos: DatosCotizaciones, desdeCopia: boolean): void {
    this.cotizaciones.set(datos.cotizaciones);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    const abierta = this.seleccionada();
    if (abierta) this.seleccionada.set(datos.cotizaciones.find((c) => c.id === abierta.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(c: any): Cotizacion {
    return {
      id: Number(c.id ?? c.id_cotizacion),
      id_proyecto: Number(c.id_proyecto),
      proyecto: c.proyecto ?? '',
      cliente: c.cliente ?? '',
      folio: c.folio ?? '',
      fecha: this.fechaISO(c.fecha),
      vigencia: this.fechaISO(c.vigencia),
      subtotal: Number(c.subtotal) || 0,
      iva: Number(c.iva) || 0,
      total: Number(c.total) || 0,
      estado: c.estado ?? 'Borrador',
      observaciones: c.observaciones ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detalles: (Array.isArray(c.detalles) ? c.detalles : []).map((d: any) => ({
        concepto: d.concepto ?? '',
        descripcion: d.descripcion ?? '',
        cantidad: Number(d.cantidad) || 0,
        unidad: d.unidad ?? '',
        precio_unitario: Number(d.precio_unitario) || 0,
        importe: Number(d.importe) || 0
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

  private async guardarCopia(datos: DatosCotizaciones): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia de cotizaciones:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene cotizaciones guardadas.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosCotizaciones | undefined;
        datos?.cotizaciones ? this.mostrar(datos, true) : sinDatos();
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

  verCotizacion(c: Cotizacion): void {
    this.menuAbierto.set(null);
    this.seleccionada.set(c);
  }

  irAContratos(c: Cotizacion): void {
    this.router.navigate(['/admin/contratos'], { queryParams: { id_proyecto: c.id_proyecto, proyecto: c.proyecto } });
  }

  // =========================================================
  // COTIZACIONES: crear, editar, eliminar, cambiar estado
  // =========================================================

  nuevaCotizacion(): void {
    if (!this.conexion.enLinea()) return;
    this.formCotizacion.set({
      id: null,
      id_proyecto: this.idProyectoFiltro() || null,
      folio: this.siguienteFolio(),
      fecha: hoyISO(),
      vigencia: this.sumarDias(hoyISO(), 30),
      estado: 'Borrador',
      estadoOriginal: null,
      porcentaje_iva: 16,
      observaciones: '',
      detalles: [this.filaVacia()]
    });
  }

  editarCotizacion(c: Cotizacion): void {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    this.formCotizacion.set({
      id: c.id,
      id_proyecto: c.id_proyecto,
      folio: c.folio,
      fecha: c.fecha,
      vigencia: c.vigencia,
      estado: c.estado,
      estadoOriginal: c.estado,
      // El IVA no se guarda como porcentaje; se deduce de los montos
      porcentaje_iva: c.subtotal > 0 ? Math.round((c.iva / c.subtotal) * 100) : 16,
      observaciones: c.observaciones,
      detalles: c.detalles.length
        ? c.detalles.map((d) => ({
            clave: this.siguienteClave++, concepto: d.concepto, descripcion: d.descripcion,
            cantidad: d.cantidad, unidad: d.unidad, precio_unitario: d.precio_unitario
          }))
        : [this.filaVacia()]
    });
  }

  guardarCotizacion(): void {
    const form = this.formCotizacion();
    if (!form || this.guardando()) return;

    const problema = validarCotizacion(form, this.cotizaciones());
    if (problema) return this.avisos.error(problema);

    const datos: Record<string, unknown> = {
      id_proyecto: form.id_proyecto,
      folio: form.folio.trim().toUpperCase(),
      fecha: form.fecha,
      vigencia: form.vigencia || null,
      estado: form.estado,
      observaciones: form.observaciones.trim()
    };
    // Si la cotización ya fue aceptada, sus conceptos no se vuelven a mandar
    if (!this.bloqueaConceptos(form)) {
      datos['porcentaje_iva'] = Number(form.porcentaje_iva);
      datos['detalles'] = form.detalles.map((d) => ({
        concepto: d.concepto.trim(),
        descripcion: d.descripcion.trim(),
        cantidad: Number(d.cantidad),
        unidad: d.unidad.trim(),
        precio_unitario: Number(d.precio_unitario)
      }));
    }

    this.guardando.set(true);
    const peticion = form.id
      ? this.http.put<Respuesta>(`${API}/cotizaciones/${form.id}`, datos)
      : this.http.post<Respuesta>(`${API}/cotizaciones`, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar la cotización.');
        this.avisos.exito(form.id ? 'Cotización actualizada.' : 'Cotización creada.');
        this.formCotizacion.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar la cotización.');
      }
    });
  }

  /** Cambio rápido desde la ficha: Enviada, Aceptada, Rechazada, Vencida */
  async cambiarEstado(c: Cotizacion, estado: string): Promise<void> {
    if (!this.conexion.enLinea()) return;

    // Reenviar una cotización con la vigencia vencida: se abre el formulario para poner una nueva
    if (estado === 'Enviada' && c.vigencia && c.vigencia < hoyISO()) {
      this.editarCotizacion(c);
      const form = this.formCotizacion();
      if (form) form.estado = 'Enviada';
      return this.avisos.mostrar('Pon una nueva vigencia para reenviar la cotización.');
    }

    const motivo = this.motivoEstadoDe(c, estado);
    if (motivo) return this.avisos.error(`No se puede marcar como "${estado}": ${motivo}.`);

    if (estado === 'Aceptada') {
      const aceptado = await this.avisos.confirmar({
        titulo: 'Aceptar cotización',
        mensaje: `Al aceptar ${c.folio} sus conceptos y montos quedan fijos y sirven de base para el contrato.`,
        textoAceptar: 'Marcar aceptada',
        peligro: false
      });
      if (!aceptado) return;
    }

    const datos = {
      id_proyecto: c.id_proyecto, folio: c.folio, fecha: c.fecha,
      vigencia: c.vigencia || null, estado, observaciones: c.observaciones
    };
    this.http.put<Respuesta>(`${API}/cotizaciones/${c.id}`, datos).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo cambiar el estado.');
        this.avisos.exito(`${c.folio} marcada como ${estado.toLowerCase()}.`);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo cambiar el estado.')
    });
  }

  async eliminarCotizacion(c: Cotizacion): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar cotización',
      mensaje: c.estado === 'Aceptada'
        ? `${c.folio} está ACEPTADA y puede ser la base de un contrato. Se eliminará con todos sus conceptos.`
        : `Se eliminará ${c.folio} con todos sus conceptos. Esta acción no se puede deshacer.`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/cotizaciones/${c.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar la cotización.');
        this.avisos.exito('Cotización eliminada.');
        if (this.seleccionada()?.id === c.id) this.seleccionada.set(null);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar la cotización.')
    });
  }

  // =========================================================
  // CONCEPTOS DEL FORMULARIO
  // =========================================================

  agregarConcepto(form: FormCotizacion): void {
    form.detalles.push(this.filaVacia());
  }

  quitarConcepto(form: FormCotizacion, clave: number): void {
    if (form.detalles.length === 1) return this.avisos.error('La cotización necesita al menos un concepto.');
    form.detalles = form.detalles.filter((d) => d.clave !== clave);
  }

  importeFila(d: FormDetalle): number {
    return centavos((Number(d.cantidad) || 0) * (Number(d.precio_unitario) || 0));
  }

  /** Subtotal, IVA y total del formulario (mismo cálculo que el backend) */
  montos(form: FormCotizacion): { subtotal: number; iva: number; total: number } {
    const subtotal = centavos(form.detalles.reduce((t, d) => t + this.importeFila(d), 0));
    const iva = centavos((subtotal * (Number(form.porcentaje_iva) || 0)) / 100);
    return { subtotal, iva, total: centavos(subtotal + iva) };
  }

  private filaVacia(): FormDetalle {
    return { clave: this.siguienteClave++, concepto: '', descripcion: '', cantidad: 1, unidad: '', precio_unitario: 0 };
  }

  // =========================================================
  // REGLAS (se usan en el HTML)
  // =========================================================

  motivoEstado(form: FormCotizacion, estado: string): string {
    return motivoEstadoCotizacion(form, estado, this.cotizaciones());
  }

  private motivoEstadoDe(c: Cotizacion, estado: string): string {
    return motivoEstadoCotizacion({ ...c, estadoOriginal: c.estado }, estado, this.cotizaciones());
  }

  bloqueaConceptos(form: FormCotizacion): boolean {
    return conceptosBloqueados(form.estadoOriginal);
  }

  /** Acciones rápidas que tiene sentido ofrecer según el estado actual */
  accionesEstado(c: Cotizacion): { estado: string; texto: string; motivo: string }[] {
    const siguientes: Record<string, [string, string][]> = {
      Borrador: [['Enviada', 'Marcar enviada']],
      Enviada: [['Aceptada', 'Aceptada'], ['Rechazada', 'Rechazada'], ['Vencida', 'Vencida']],
      Rechazada: [['Enviada', 'Reenviar']],
      Vencida: [['Enviada', 'Reenviar']],
      Aceptada: []
    };
    return (siguientes[c.estado] ?? []).map(([estado, texto]) => ({
      estado, texto, motivo: estado === 'Enviada' ? '' : this.motivoEstadoDe(c, estado)
    }));
  }

  /** Enviada cuya vigencia ya pasó (debería marcarse como vencida) */
  vencida(c: Cotizacion): boolean {
    return c.estado === 'Enviada' && !!c.vigencia && c.vigencia < hoyISO();
  }

  /** Enviada que vence en los próximos 7 días */
  vencePronto(c: Cotizacion): boolean {
    if (c.estado !== 'Enviada' || !c.vigencia) return false;
    const hoy = hoyISO();
    return c.vigencia >= hoy && c.vigencia <= this.sumarDias(hoy, 7);
  }

  // =========================================================
  // FOLIOS Y FECHAS
  // =========================================================

  /** Siguiente folio del año: COT-2026-003 */
  private siguienteFolio(): string {
    const anio = new Date().getFullYear();
    const prefijo = `COT-${anio}-`;
    const mayor = this.cotizaciones()
      .map((c) => c.folio.toUpperCase())
      .filter((f) => f.startsWith(prefijo))
      .map((f) => Number(f.slice(prefijo.length)) || 0)
      .reduce((max, n) => Math.max(max, n), 0);
    return `${prefijo}${String(mayor + 1).padStart(3, '0')}`;
  }

  private sumarDias(iso: string, dias: number): string {
    const [a, m, d] = iso.split('-').map(Number);
    const fecha = new Date(a, m - 1, d + dias);
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }

  // =========================================================
  // PDF (abre una ventana lista para imprimir / guardar como PDF)
  // =========================================================

  descargarPdf(c: Cotizacion): void {
    if (!this.esNavegador) return;
    this.menuAbierto.set(null);

    const entidades: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const e = (valor: unknown): string => String(valor ?? '').replace(/[&<>"']/g, (ch) => entidades[ch] || ch);

    const filas = c.detalles.map((d, i) => `
      <tr>
        <td class="num">${String(i + 1).padStart(2, '0')}</td>
        <td><strong>${e(d.concepto)}</strong>${d.descripcion ? `<small>${e(d.descripcion)}</small>` : ''}</td>
        <td class="der">${e(d.cantidad)} ${e(d.unidad)}</td>
        <td class="der">${e(this.moneda(d.precio_unitario))}</td>
        <td class="der">${e(this.moneda(d.importe))}</td>
      </tr>`).join('');

    const documento = `<!doctype html>
      <html lang="es"><head><meta charset="utf-8"><title>Cotización ${e(c.folio)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box}body{font-family:Figtree,Arial,sans-serif;color:#161616;margin:40px;font-size:13px}
        header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #161616;padding-bottom:18px;margin-bottom:26px}
        .marca{font-weight:800;font-size:22px;letter-spacing:-0.02em}.marca span{display:block;font-size:11px;font-weight:600;color:#878787;letter-spacing:.08em;text-transform:uppercase}
        .folio{text-align:right}.folio small{display:block;color:#878787;font-size:10px;letter-spacing:.1em;text-transform:uppercase}.folio strong{font-size:20px}
        h1{font-size:28px;margin:0 0 4px;letter-spacing:-0.02em}h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:28px 0 8px}
        .datos{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}
        .datos small{display:block;color:#878787;text-transform:uppercase;font-size:10px;letter-spacing:.08em;margin-bottom:4px}
        table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
        th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:1px solid #161616}
        td small{display:block;color:#878787;margin-top:3px}.der{text-align:right;white-space:nowrap}.num{color:#878787;width:32px}
        .montos{width:280px;margin:18px 0 0 auto}.monto{display:flex;justify-content:space-between;padding:6px 0}
        .total{border-top:2px solid #161616;font-size:18px;font-weight:800;margin-top:4px;padding-top:10px}
        .total span:last-child{background:#FAC82B;padding:0 6px}
        .observaciones{white-space:pre-wrap;color:#555}
        footer{margin-top:40px;padding-top:12px;border-top:1px solid #ddd;color:#878787;font-size:11px}
        @media print{body{margin:16mm}tr{break-inside:avoid}}
      </style></head><body>
      <header>
        <div class="marca">SIGOA<span>Cotización de servicios</span></div>
        <div class="folio"><small>Folio</small><strong>${e(c.folio)}</strong></div>
      </header>
      <h1>${e(c.proyecto)}</h1>
      <div>${e(c.cliente)}</div>
      <section class="datos">
        <div><small>Fecha</small>${e(this.fecha(c.fecha))}</div>
        <div><small>Válida hasta</small>${e(this.fecha(c.vigencia))}</div>
        <div><small>Estado</small>${e(c.estado)}</div>
        <div><small>Conceptos</small>${c.detalles.length}</div>
      </section>
      <h2>Conceptos</h2>
      <table><thead><tr><th>#</th><th>Concepto</th><th class="der">Cantidad</th><th class="der">Precio unitario</th><th class="der">Importe</th></tr></thead><tbody>
        ${filas || '<tr><td colspan="5">No hay conceptos registrados.</td></tr>'}
      </tbody></table>
      <div class="montos">
        <div class="monto"><span>Subtotal</span><span>${e(this.moneda(c.subtotal))}</span></div>
        <div class="monto"><span>IVA</span><span>${e(this.moneda(c.iva))}</span></div>
        <div class="monto total"><span>Total</span><span>${e(this.moneda(c.total))}</span></div>
      </div>
      ${c.observaciones ? `<h2>Observaciones</h2><p class="observaciones">${e(c.observaciones)}</p>` : ''}
      <footer>Precios en pesos mexicanos (MXN). Esta cotización es válida hasta la fecha indicada.</footer>
      </body></html>`;

    // Vista previa dentro de la app (sin ventana emergente que congele la página)
    this.documento.abrir(`Cotización ${c.folio}`, documento);
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      Enviada: 'sg-chip--proceso',
      Aceptada: 'sg-chip--activo',
      Rechazada: 'sg-chip--cancelado',
      Vencida: 'sg-chip--pausado'
    };
    return clases[estado] ?? '';
  }

  codigoProyecto(id: number): string {
    return `PRY-${String(id).padStart(3, '0')}`;
  }

  dosDigitos(valor: number): string {
    return String(valor).padStart(2, '0');
  }

  /** Montos en tablas y ficha: con centavos */
  moneda(valor: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor || 0);
  }

  /** Montos grandes de los indicadores: sin centavos */
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