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

import {
  ESTADOS_PAGO, METODOS_PAGO, centavos, hoyISO, pideReferencia, validarPago
} from '../../../core/reglas/reglas-negocio';

import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-pagos';

const POR_PAGINA = 8;

interface Pago {
  id: number;
  id_proyecto: number;
  proyecto: string;
  cliente: string;
  fecha: string;
  concepto: string;
  monto: number;
  metodo_pago: string;
  referencia: string;
  estado: string;
  observaciones: string;
}

/** Contrato vigente del proyecto (para saber cuánto falta por cobrar) */
interface ContratoBase {
  id: number;
  id_proyecto: number;
  numero_contrato: string;
  monto: number;
  estado: string;
}

interface Opcion {
  id: number;
  nombre: string;
}

interface FormPago {
  id: number | null;
  id_proyecto: number | null;
  fecha: string;
  concepto: string;
  monto: number;
  metodo_pago: string;
  referencia: string;
  estado: string;
  observaciones: string;
}

interface Respuesta {
  success: boolean;
  mensaje?: string;
  pagos?: unknown[];
  contratos?: unknown[];
  proyectos?: Opcion[];
}

interface DatosPagos {
  pagos: Pago[];
  contratos: ContratoBase[];
  guardadoEn: number;
}

/**
 * PAGOS · ADMINISTRADOR
 *  - Indicadores (cobrado, por cobrar con vencidos, saldo de contratos)
 *  - Lista con búsqueda, filtro por estado / proyecto y paginación
 *  - Ficha central con el pago, su contrato y los demás pagos del proyecto
 *  - Formulario con reglas (referencia, fecha, no exceder el contrato) y recibo en PDF
 */
@Component({
  selector: 'app-pagos',
  standalone: true,
  imports: [FormsModule, Icono],
  templateUrl: './pagos.html',
  styleUrl: './pagos.css'
})
export class Pagos implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly avisos = inject(AvisosService);
  private readonly documento = inject(DocumentoService);

  readonly estados = ESTADOS_PAGO;
  readonly metodos = METODOS_PAGO;
  readonly filtros = ['Todos', 'Vencidos', ...ESTADOS_PAGO];

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly pagos = signal<Pago[]>([]);
  readonly contratos = signal<ContratoBase[]>([]);
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
  readonly seleccionado = signal<Pago | null>(null);
  readonly formPago = signal<FormPago | null>(null);
  readonly menuAbierto = signal<number | null>(null);
  readonly guardando = signal(false);

  // ---------- Datos calculados ----------
  readonly delProyecto = computed(() => {
    const id = this.idProyectoFiltro();
    return id ? this.pagos().filter((p) => p.id_proyecto === id) : this.pagos();
  });

  readonly filtrados = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const filtro = this.filtroEstado();
    return this.delProyecto().filter((p) => {
      const coincideEstado = filtro === 'Todos' || (filtro === 'Vencidos' ? this.vencido(p) : p.estado === filtro);
      const coincideTexto = !texto || [p.concepto, p.proyecto, p.cliente, p.referencia].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const conteo: Record<string, number> = { Todos: this.delProyecto().length, Vencidos: 0 };
    for (const p of this.delProyecto()) {
      conteo[p.estado] = (conteo[p.estado] ?? 0) + 1;
      if (this.vencido(p)) conteo['Vencidos']++;
    }
    return conteo;
  });

  readonly indicadores = computed(() => {
    const lista = this.delProyecto();
    const mes = hoyISO().substring(0, 7);
    const pagados = lista.filter((p) => p.estado === 'Pagado');
    const pendientes = lista.filter((p) => p.estado === 'Pendiente');
    const vencidos = pendientes.filter((p) => this.vencido(p));

    // Saldo de los contratos vigentes (de los proyectos visibles)
    const idsProyecto = this.idProyectoFiltro() ? [this.idProyectoFiltro()] : null;
    const vigentes = this.contratos().filter((c) => !idsProyecto || idsProyecto.includes(c.id_proyecto));
    const contratado = vigentes.reduce((t, c) => t + c.monto, 0);
    const cobradoContratos = vigentes.reduce((t, c) => t + Math.min(this.cobradoProyecto(c.id_proyecto), c.monto), 0);

    return {
      cobrado: pagados.reduce((t, p) => t + p.monto, 0),
      cobradoMes: pagados.filter((p) => p.fecha.startsWith(mes)).reduce((t, p) => t + p.monto, 0),
      porCobrar: pendientes.reduce((t, p) => t + p.monto, 0),
      pendientes: pendientes.length,
      vencidos: vencidos.length,
      montoVencido: vencidos.reduce((t, p) => t + p.monto, 0),
      saldoContratos: Math.max(0, contratado - cobradoContratos),
      porcentajeContratos: contratado > 0 ? Math.round((cobradoContratos / contratado) * 100) : 0
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
          this.formPago.set(null);
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

  /** Pagos + contratos en paralelo (si contratos falla, la pantalla sigue) */
  private consultarServidor(): void {
    this.cargando.set(true);
    this.error.set('');

    forkJoin({
      pagos: this.http.get<Respuesta>(`${API}/pagos`),
      contratos: this.http.get<Respuesta>(`${API}/contratos`).pipe(catchError(() => of({ success: false } as Respuesta)))
    }).subscribe({
      next: ({ pagos, contratos }) => {
        if (!pagos.success) {
          this.error.set(pagos.mensaje || 'No se pudieron cargar los pagos.');
          this.cargando.set(false);
          return;
        }
        const datos: DatosPagos = {
          pagos: (pagos.pagos ?? []).map((p) => this.normalizar(p)),
          contratos: (contratos.contratos ?? [])
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((c: any) => ['Activo', 'Finalizado'].includes(c.estado))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => ({
              id: Number(c.id), id_proyecto: Number(c.id_proyecto), numero_contrato: c.numero_contrato ?? '',
              monto: Number(c.monto) || 0, estado: c.estado
            })),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private cargarProyectos(): void {
    this.http.get<Respuesta>(`${API}/pagos/opciones`).subscribe({
      next: (respuesta) => this.proyectos.set(respuesta.proyectos ?? []),
      error: () => this.proyectos.set([])
    });
  }

  private mostrar(datos: DatosPagos, desdeCopia: boolean): void {
    this.pagos.set(datos.pagos);
    this.contratos.set(datos.contratos ?? []);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    const abierto = this.seleccionado();
    if (abierto) this.seleccionado.set(datos.pagos.find((p) => p.id === abierto.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(p: any): Pago {
    return {
      id: Number(p.id ?? p.id_pago),
      id_proyecto: Number(p.id_proyecto),
      proyecto: p.proyecto ?? '',
      cliente: p.cliente ?? '',
      fecha: this.fechaISO(p.fecha),
      concepto: p.concepto ?? '',
      monto: Number(p.monto) || 0,
      metodo_pago: p.metodo_pago ?? 'Transferencia',
      referencia: p.referencia ?? '',
      estado: p.estado ?? 'Pendiente',
      observaciones: p.observaciones ?? ''
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

  private async guardarCopia(datos: DatosPagos): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia de pagos:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene pagos guardados.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosPagos | undefined;
        datos?.pagos ? this.mostrar(datos, true) : sinDatos();
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

  verPago(p: Pago): void {
    this.menuAbierto.set(null);
    this.seleccionado.set(p);
  }

  irAContratos(p: Pago): void {
    this.router.navigate(['/admin/contratos'], { queryParams: { id_proyecto: p.id_proyecto, proyecto: p.proyecto } });
  }

  // =========================================================
  // PAGOS: crear, editar, eliminar, cambiar estado
  // =========================================================

  nuevoPago(): void {
    if (!this.conexion.enLinea()) return;
    this.formPago.set({
      id: null,
      id_proyecto: this.idProyectoFiltro() || null,
      fecha: hoyISO(),
      concepto: '',
      monto: 0,
      metodo_pago: 'Transferencia',
      referencia: '',
      estado: 'Pendiente',
      observaciones: ''
    });
  }

  editarPago(p: Pago): void {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    this.formPago.set({
      id: p.id, id_proyecto: p.id_proyecto, fecha: p.fecha, concepto: p.concepto, monto: p.monto,
      metodo_pago: p.metodo_pago, referencia: p.referencia, estado: p.estado, observaciones: p.observaciones
    });
  }

  /** Pone en el monto lo que falta por programar del contrato */
  usarSaldo(form: FormPago): void {
    const disponible = this.disponible(form);
    if (disponible !== null) form.monto = disponible;
  }

  guardarPago(): void {
    const form = this.formPago();
    if (!form || this.guardando()) return;

    const contrato = form.id_proyecto ? this.contratoDe(form.id_proyecto) : null;
    const problema = validarPago(form, contrato?.monto ?? null, this.comprometido(form.id_proyecto, form.id));
    if (problema) return this.avisos.error(problema);

    const datos = {
      id_proyecto: form.id_proyecto,
      fecha: form.fecha,
      concepto: form.concepto.trim(),
      monto: Number(form.monto),
      metodo_pago: form.metodo_pago,
      referencia: form.referencia.trim() || null,
      estado: form.estado,
      observaciones: form.observaciones.trim() || null
    };

    this.guardando.set(true);
    const peticion = form.id
      ? this.http.put<Respuesta>(`${API}/pagos/${form.id}`, datos)
      : this.http.post<Respuesta>(`${API}/pagos`, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar el pago.');
        this.avisos.exito(form.id ? 'Pago actualizado.' : 'Pago registrado.');
        this.formPago.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar el pago.');
      }
    });
  }

  /** Cambio rápido desde la ficha o el menú */
  async cambiarEstado(p: Pago, estado: string): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);

    // Marcar pagado: si falta referencia o la fecha es futura, se abre el formulario para completarlo
    if (estado === 'Pagado' && (p.fecha > hoyISO() || (pideReferencia({ ...p, estado }) && !p.referencia))) {
      this.editarPago(p);
      const form = this.formPago();
      if (form) {
        form.estado = 'Pagado';
        if (form.fecha > hoyISO()) form.fecha = hoyISO();
      }
      return this.avisos.mostrar('Confirma la fecha y la referencia para marcarlo como pagado.');
    }

    if (estado === 'Cancelado') {
      const aceptado = await this.avisos.confirmar({
        titulo: 'Cancelar pago',
        mensaje: `"${p.concepto}" por ${this.moneda(p.monto)} dejará de contar como cobro o como pago programado.`,
        textoAceptar: 'Cancelar pago',
        peligro: true
      });
      if (!aceptado) return;
    }

    const contrato = this.contratoDe(p.id_proyecto);
    const problema = validarPago({ ...p, estado }, contrato?.monto ?? null, this.comprometido(p.id_proyecto, p.id));
    if (problema) return this.avisos.error(problema);

    const datos = {
      id_proyecto: p.id_proyecto, fecha: p.fecha, concepto: p.concepto, monto: p.monto,
      metodo_pago: p.metodo_pago, referencia: p.referencia || null, estado, observaciones: p.observaciones || null
    };
    this.http.put<Respuesta>(`${API}/pagos/${p.id}`, datos).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo cambiar el estado.');
        this.avisos.exito(`Pago marcado como ${estado.toLowerCase()}.`);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo cambiar el estado.')
    });
  }

  async eliminarPago(p: Pago): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);

    const aceptado = await this.avisos.confirmar({
      titulo: 'Eliminar pago',
      mensaje: p.estado === 'Pagado'
        ? `"${p.concepto}" ya está PAGADO. Si fue un error de captura, elimínalo; si el cliente lo canceló, mejor márcalo como cancelado.`
        : `Se eliminará "${p.concepto}" por ${this.moneda(p.monto)}.`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/pagos/${p.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar el pago.');
        this.avisos.exito('Pago eliminado.');
        if (this.seleccionado()?.id === p.id) this.seleccionado.set(null);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar el pago.')
    });
  }

  // =========================================================
  // REGLAS Y CÁLCULOS (se usan en el HTML)
  // =========================================================

  contratoDe(idProyecto: number): ContratoBase | null {
    return this.contratos().find((c) => c.id_proyecto === idProyecto && c.estado === 'Activo')
      ?? this.contratos().find((c) => c.id_proyecto === idProyecto)
      ?? null;
  }

  /** Suma de los demás pagos no cancelados del proyecto (pagados + pendientes) */
  private comprometido(idProyecto: number | null, excluirId: number | null): number {
    if (!idProyecto) return 0;
    return centavos(this.pagos()
      .filter((p) => p.id_proyecto === idProyecto && p.id !== excluirId && p.estado !== 'Cancelado')
      .reduce((t, p) => t + p.monto, 0));
  }

  /** Lo que falta por programar del contrato (null si el proyecto no tiene contrato vigente) */
  disponible(form: FormPago): number | null {
    const contrato = form.id_proyecto ? this.contratoDe(form.id_proyecto) : null;
    return contrato ? Math.max(0, centavos(contrato.monto - this.comprometido(form.id_proyecto, form.id))) : null;
  }

  cobradoProyecto(idProyecto: number): number {
    return this.pagos()
      .filter((p) => p.id_proyecto === idProyecto && p.estado === 'Pagado')
      .reduce((t, p) => t + p.monto, 0);
  }

  porcentajeCobrado(contrato: ContratoBase): number {
    return contrato.monto > 0 ? Math.min(100, Math.round((this.cobradoProyecto(contrato.id_proyecto) / contrato.monto) * 100)) : 0;
  }

  otrosPagos(p: Pago): Pago[] {
    return this.pagos()
      .filter((o) => o.id_proyecto === p.id_proyecto && o.id !== p.id)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  /** Pendiente cuya fecha ya pasó */
  vencido(p: Pago): boolean {
    return p.estado === 'Pendiente' && !!p.fecha && p.fecha < hoyISO();
  }

  referenciaObligatoria(form: FormPago): boolean {
    return pideReferencia(form);
  }

  accionesEstado(p: Pago): { estado: string; texto: string }[] {
    const siguientes: Record<string, [string, string][]> = {
      Pendiente: [['Pagado', 'Marcar pagado'], ['Cancelado', 'Cancelar']],
      Pagado: [['Pendiente', 'Regresar a pendiente']],
      Cancelado: [['Pendiente', 'Reabrir']]
    };
    return (siguientes[p.estado] ?? []).map(([estado, texto]) => ({ estado, texto }));
  }

  // =========================================================
  // RECIBO EN PDF (solo pagos pagados)
  // =========================================================

  descargarRecibo(p: Pago): void {
    if (!this.esNavegador || p.estado !== 'Pagado') return;
    this.menuAbierto.set(null);

    const entidades: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const e = (valor: unknown): string => String(valor ?? '').replace(/[&<>"']/g, (ch) => entidades[ch] || ch);
    const contrato = this.contratoDe(p.id_proyecto);
    const cobrado = this.cobradoProyecto(p.id_proyecto);

    const documento = `<!doctype html>
      <html lang="es"><head><meta charset="utf-8"><title>Recibo ${e(this.folio(p))}</title>
      <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box}body{font-family:Figtree,Arial,sans-serif;color:#161616;margin:40px;font-size:13px}
        .recibo{max-width:640px;margin:0 auto;border:1px solid #161616;border-radius:8px;padding:32px}
        header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #161616;padding-bottom:16px;margin-bottom:24px}
        .marca{font-weight:800;font-size:22px}.marca span{display:block;font-size:11px;font-weight:600;color:#878787;letter-spacing:.08em;text-transform:uppercase}
        .folio{text-align:right}.folio small{display:block;color:#878787;font-size:10px;letter-spacing:.1em;text-transform:uppercase}.folio strong{font-size:18px}
        .monto{margin:8px 0 24px}.monto small{display:block;color:#878787;font-size:10px;letter-spacing:.1em;text-transform:uppercase}
        .monto strong{font-size:40px;font-weight:800;letter-spacing:-0.03em;background:linear-gradient(transparent 60%,#FAC82B 60%)}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 24px}.grid small{display:block;color:#878787;font-size:10px;letter-spacing:.08em;text-transform:uppercase}.grid strong{font-weight:600}
        .saldo{margin-top:24px;padding-top:14px;border-top:1px solid #ddd;display:flex;justify-content:space-between}
        .firma{margin:56px auto 0;width:260px;border-top:1px solid #161616;padding-top:8px;text-align:center;font-size:11px;color:#878787}
        @media print{body{margin:16mm}}
      </style></head><body><div class="recibo">
      <header>
        <div class="marca">SIGOA<span>Recibo de pago</span></div>
        <div class="folio"><small>Folio</small><strong>${e(this.folio(p))}</strong></div>
      </header>
      <div class="monto"><small>Recibimos la cantidad de</small><strong>${e(this.moneda(p.monto))} MXN</strong></div>
      <div class="grid">
        <div><small>Cliente</small><strong>${e(p.cliente)}</strong></div>
        <div><small>Proyecto</small><strong>${e(p.proyecto)}</strong></div>
        <div><small>Concepto</small><strong>${e(p.concepto)}</strong></div>
        <div><small>Fecha de pago</small><strong>${e(this.fecha(p.fecha))}</strong></div>
        <div><small>Método</small><strong>${e(p.metodo_pago)}</strong></div>
        <div><small>Referencia</small><strong>${e(p.referencia || '—')}</strong></div>
      </div>
      ${contrato ? `<div class="saldo"><span>Contrato ${e(contrato.numero_contrato)} · cobrado ${e(this.moneda(cobrado))}</span><strong>Saldo ${e(this.moneda(Math.max(0, contrato.monto - cobrado)))}</strong></div>` : ''}
      <div class="firma">Recibió · Nombre y firma</div>
      </div></body></html>`;

        // Vista previa dentro de la app (sin ventana emergente que congele la página)
    this.documento.abrir(`Recibo ${this.folio(p)}`, documento);
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      Pagado: 'sg-chip--activo',
      Pendiente: 'sg-chip--proceso',
      Cancelado: 'sg-chip--cancelado'
    };
    return clases[estado] ?? '';
  }

  /** id 4 → "PAG-004" */
  folio(p: Pago): string {
    return this.folioDe(p.id);
  }

  folioDe(id: number): string {
    return `PAG-${String(id).padStart(3, '0')}`;
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