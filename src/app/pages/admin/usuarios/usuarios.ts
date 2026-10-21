import { Component, OnDestroy, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { Icono } from '../../../shared/icono/icono';
import { ConexionService } from '../../../core/services/conexion.service';
import { AvisosService } from '../../../core/services/avisos.service';
import { PROYECTO_EN_CURSO, validarPersona } from '../../../core/reglas/reglas-negocio';

import { API } from '../../../core/api';

// IndexedDB: misma base que usa todo SIGOA
const DB_NOMBRE = 'SIGOA_DB';
const DB_VERSION = 1;
const DB_STORE = 'resumen';
const DB_CLAVE = 'admin-usuarios';

const POR_PAGINA = 8;

type Tipo = 'clientes' | 'arquitectos';

interface Persona {
  id: number;
  nombre: string;
  apellidos: string;
  correo: string;
  telefono: string;
  direccion: string;
  activo: boolean;
  fecha_registro: string;
  proyectos: number;
}

/** Proyecto resumido para la ficha de la persona */
interface ProyectoResumen {
  id: number;
  nombre: string;
  id_cliente: number | null;
  id_arquitecto: number | null;
  cliente: string;
  arquitecto: string;
  estado: string;
  avance: number;
}

interface FormPersona {
  tipo: Tipo;
  id: number | null;
  nombre: string;
  apellidos: string;
  correo: string;
  telefono: string;
  direccion: string;
  password: string;
  confirmar: string;
}

interface Respuesta {
  success: boolean;
  mensaje?: string;
  clientes?: unknown[];
  arquitectos?: unknown[];
  proyectos?: unknown[];
}

interface DatosUsuarios {
  clientes: Persona[];
  arquitectos: Persona[];
  proyectos: ProyectoResumen[];
  guardadoEn: number;
}

/**
 * USUARIOS · ADMINISTRADOR
 *  - Clientes y arquitectos en pestañas, con búsqueda, filtro activo/inactivo y paginación
 *  - Ficha central con contacto, acceso al sistema y proyectos de la persona
 *  - Formulario de alta/edición (contraseña obligatoria al crear, opcional al editar)
 *  - Activar / desactivar el acceso (el login rechaza cuentas inactivas)
 */
@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [FormsModule, Icono],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.css'
})
export class Usuarios implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  readonly conexion = inject(ConexionService);
  private readonly avisos = inject(AvisosService);

  readonly filtrosEstado = ['Todos', 'Activos', 'Inactivos'];

  // ---------- Estado de la pantalla ----------
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly clientes = signal<Persona[]>([]);
  readonly arquitectos = signal<Persona[]>([]);
  readonly proyectos = signal<ProyectoResumen[]>([]);
  readonly desdeCopia = signal(false);
  readonly guardadoEn = signal<number | null>(null);

  // ---------- Filtros ----------
  readonly tipo = signal<Tipo>('clientes');
  readonly busqueda = signal('');
  readonly filtroEstado = signal('Todos');
  readonly pagina = signal(1);

  // ---------- Ventanas ----------
  readonly seleccionado = signal<Persona | null>(null);
  readonly formPersona = signal<FormPersona | null>(null);
  readonly menuAbierto = signal<number | null>(null);
  readonly guardando = signal(false);
  readonly verPassword = signal(false);

  // ---------- Datos calculados ----------
  readonly listaTipo = computed(() => (this.tipo() === 'clientes' ? this.clientes() : this.arquitectos()));

  readonly filtrados = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.listaTipo().filter((p) => {
      const coincideEstado = estado === 'Todos' || (estado === 'Activos' ? p.activo : !p.activo);
      const coincideTexto = !texto ||
        [`${p.nombre} ${p.apellidos}`, p.correo, p.telefono, p.direccion].some((v) => v.toLowerCase().includes(texto));
      return coincideEstado && coincideTexto;
    });
  });

  readonly conteos = computed(() => {
    const lista = this.listaTipo();
    return {
      Todos: lista.length,
      Activos: lista.filter((p) => p.activo).length,
      Inactivos: lista.filter((p) => !p.activo).length
    } as Record<string, number>;
  });

  readonly indicadores = computed(() => {
    const clientes = this.clientes();
    const arquitectos = this.arquitectos();
    const enCurso = this.proyectos().filter((p) => PROYECTO_EN_CURSO.includes(p.estado));
    const arquitectosActivos = arquitectos.filter((a) => a.activo);
    return {
      clientes: clientes.length,
      clientesActivos: clientes.filter((c) => c.activo).length,
      clientesConProyecto: clientes.filter((c) => c.proyectos > 0).length,
      arquitectos: arquitectos.length,
      arquitectosActivos: arquitectosActivos.length,
      cargaPromedio: arquitectosActivos.length ? Math.round((enCurso.length / arquitectosActivos.length) * 10) / 10 : 0,
      sinArquitecto: enCurso.filter((p) => !p.id_arquitecto).length,
      inactivos: clientes.filter((c) => !c.activo).length + arquitectos.filter((a) => !a.activo).length
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

    this.dbLista = this.abrirDB();

    effect(() => {
      const enLinea = this.conexion.enLinea();
      untracked(() => {
        if (enLinea) {
          this.consultarServidor();
        } else {
          this.cargarCopia();
          this.formPersona.set(null);
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

  /** Usuarios + proyectos en paralelo (si proyectos falla, la pantalla sigue) */
  private consultarServidor(): void {
    this.cargando.set(true);
    this.error.set('');

    forkJoin({
      usuarios: this.http.get<Respuesta>(`${API}/usuarios`),
      proyectos: this.http.get<Respuesta>(`${API}/proyectos`).pipe(catchError(() => of({ success: false } as Respuesta)))
    }).subscribe({
      next: ({ usuarios, proyectos }) => {
        if (!usuarios.success) {
          this.error.set(usuarios.mensaje || 'No se pudieron cargar los usuarios.');
          this.cargando.set(false);
          return;
        }
        const datos: DatosUsuarios = {
          clientes: (usuarios.clientes ?? []).map((p) => this.normalizar(p)),
          arquitectos: (usuarios.arquitectos ?? []).map((p) => this.normalizar(p)),
          proyectos: (proyectos.proyectos ?? []).map((p) => this.normalizarProyecto(p)),
          guardadoEn: Date.now()
        };
        this.mostrar(datos, false);
        this.guardarCopia(datos);
      },
      error: () => this.cargarCopia()
    });
  }

  private mostrar(datos: DatosUsuarios, desdeCopia: boolean): void {
    this.clientes.set(datos.clientes);
    this.arquitectos.set(datos.arquitectos);
    this.proyectos.set(datos.proyectos ?? []);
    this.guardadoEn.set(datos.guardadoEn);
    this.desdeCopia.set(desdeCopia);
    this.error.set('');
    this.cargando.set(false);

    const abierto = this.seleccionado();
    if (abierto) this.seleccionado.set(this.listaTipo().find((p) => p.id === abierto.id) ?? null);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizar(p: any): Persona {
    return {
      id: Number(p.id),
      nombre: p.nombre ?? '',
      apellidos: p.apellidos ?? '',
      correo: p.correo ?? '',
      telefono: p.telefono ?? '',
      direccion: p.direccion ?? '',
      activo: !!Number(p.activo),
      fecha_registro: p.fecha_registro ? String(p.fecha_registro).substring(0, 10) : '',
      proyectos: Number(p.proyectos) || 0
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizarProyecto(p: any): ProyectoResumen {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obras: any[] = Array.isArray(p.obras) ? p.obras : [];
    const avance = obras.length
      ? obras.reduce((t, o) => t + (Number(o.porcentaje_avance) || 0), 0) / obras.length
      : Number(p.porcentaje_avance) || 0;
    return {
      id: Number(p.id ?? p.id_proyecto),
      nombre: p.nombre ?? '',
      id_cliente: p.id_cliente ? Number(p.id_cliente) : null,
      id_arquitecto: p.id_arquitecto ? Number(p.id_arquitecto) : null,
      cliente: p.cliente ?? '',
      arquitecto: p.arquitecto ?? '',
      estado: p.estado ?? 'Pendiente',
      avance: Math.round(avance)
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

  private async guardarCopia(datos: DatosUsuarios): Promise<void> {
    const db = await this.dbLista;
    if (!db) return;
    try {
      db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(datos, DB_CLAVE);
    } catch (e) {
      console.error('No se pudo guardar la copia de usuarios:', e);
    }
  }

  private async cargarCopia(): Promise<void> {
    this.cargando.set(true);
    const db = await this.dbLista;

    const sinDatos = () => {
      this.error.set('No hay conexión con el servidor y este dispositivo aún no tiene usuarios guardados.');
      this.cargando.set(false);
    };
    if (!db) return sinDatos();

    try {
      const peticion = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_CLAVE);
      peticion.onsuccess = () => {
        const datos = peticion.result as DatosUsuarios | undefined;
        datos?.clientes ? this.mostrar(datos, true) : sinDatos();
      };
      peticion.onerror = sinDatos;
    } catch {
      sinDatos();
    }
  }

  // =========================================================
  // FILTROS Y NAVEGACIÓN
  // =========================================================

  cambiarTipo(tipo: Tipo): void {
    this.tipo.set(tipo);
    this.busqueda.set('');
    this.filtroEstado.set('Todos');
    this.pagina.set(1);
    this.seleccionado.set(null);
  }

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

  verPersona(p: Persona): void {
    this.menuAbierto.set(null);
    this.seleccionado.set(p);
  }

  irAProyectos(): void {
    this.router.navigate(['/admin/proyectos']);
  }

  // =========================================================
  // ALTA, EDICIÓN, ACCESO Y ELIMINACIÓN
  // =========================================================

  nuevaPersona(): void {
    if (!this.conexion.enLinea()) return;
    this.verPassword.set(false);
    this.formPersona.set({
      tipo: this.tipo(), id: null, nombre: '', apellidos: '', correo: '',
      telefono: '', direccion: '', password: '', confirmar: ''
    });
  }

  editarPersona(p: Persona): void {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    this.verPassword.set(false);
    this.formPersona.set({
      tipo: this.tipo(), id: p.id, nombre: p.nombre, apellidos: p.apellidos, correo: p.correo,
      telefono: p.telefono, direccion: p.direccion, password: '', confirmar: ''
    });
  }

  guardarPersona(): void {
    const form = this.formPersona();
    if (!form || this.guardando()) return;

    const problema = validarPersona(form, this.correosOcupados(form));
    if (problema) return this.avisos.error(problema);

    const datos: Record<string, unknown> = {
      nombre: form.nombre.trim(),
      apellidos: form.apellidos.trim(),
      correo: form.correo.trim().toLowerCase(),
      telefono: form.telefono.replace(/\D/g, ''),
      direccion: form.direccion.trim()
    };
    if (form.password) datos['password'] = form.password;

    this.guardando.set(true);
    const url = `${API}/usuarios/${form.tipo}`;
    const peticion = form.id ? this.http.put<Respuesta>(`${url}/${form.id}`, datos) : this.http.post<Respuesta>(url, datos);

    peticion.subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo guardar.');
        this.avisos.exito(`${this.singular(form.tipo, true)} ${form.id ? 'actualizado' : 'registrado'}.`);
        this.formPersona.set(null);
        this.consultarServidor();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(e.error?.mensaje || 'No se pudo guardar.');
      }
    });
  }

  async cambiarAcceso(p: Persona): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    const tipo = this.tipo();
    const activar = !p.activo;

    if (!activar) {
      const motivo = this.motivoNoDesactivar(p);
      if (motivo) return this.avisos.error(motivo);

      const aceptado = await this.avisos.confirmar({
        titulo: `Desactivar ${this.singular(tipo)}`,
        mensaje: `${p.nombre} ${p.apellidos} ya no podrá iniciar sesión ni aparecerá al crear proyectos. Sus registros se conservan.`,
        textoAceptar: 'Desactivar',
        peligro: true
      });
      if (!aceptado) return;
    }

    this.http.patch<Respuesta>(`${API}/usuarios/${tipo}/${p.id}/activo`, { activo: activar }).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo cambiar el acceso.');
        this.avisos.exito(activar ? 'Acceso activado.' : 'Acceso desactivado.');
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo cambiar el acceso.')
    });
  }

  async eliminarPersona(p: Persona): Promise<void> {
    if (!this.conexion.enLinea()) return;
    this.menuAbierto.set(null);
    const tipo = this.tipo();

    // Con proyectos no se borra: se desactiva para conservar el historial
    if (p.proyectos > 0) {
      return this.avisos.error(
        `${p.nombre} tiene ${p.proyectos} proyecto(s) registrado(s). Desactívalo en lugar de eliminarlo para conservar el historial.`
      );
    }

    const aceptado = await this.avisos.confirmar({
      titulo: `Eliminar ${this.singular(tipo)}`,
      mensaje: `Se eliminará la cuenta de ${p.nombre} ${p.apellidos}. Esta acción no se puede deshacer.`,
      textoAceptar: 'Eliminar',
      peligro: true
    });
    if (!aceptado) return;

    this.http.delete<Respuesta>(`${API}/usuarios/${tipo}/${p.id}`).subscribe({
      next: (respuesta) => {
        if (!respuesta.success) return this.avisos.error(respuesta.mensaje || 'No se pudo eliminar.');
        this.avisos.exito(`${this.singular(tipo, true)} eliminado.`);
        if (this.seleccionado()?.id === p.id) this.seleccionado.set(null);
        this.consultarServidor();
      },
      error: (e) => this.avisos.error(e.error?.mensaje || 'No se pudo eliminar.')
    });
  }

  // =========================================================
  // REGLAS Y CÁLCULOS (se usan en el HTML)
  // =========================================================

  /** Correos de todas las demás cuentas (el correo es único en todo el sistema) */
  private correosOcupados(form: FormPersona): string[] {
    const propios = form.tipo === 'clientes' ? this.clientes() : this.arquitectos();
    const otros = form.tipo === 'clientes' ? this.arquitectos() : this.clientes();
    return [
      ...propios.filter((p) => p.id !== form.id).map((p) => p.correo.toLowerCase()),
      ...otros.map((p) => p.correo.toLowerCase())
    ];
  }

  /** Un arquitecto con proyectos en curso no se puede desactivar ('' = sí se puede) */
  motivoNoDesactivar(p: Persona): string {
    if (this.tipo() !== 'arquitectos') return '';
    const enCurso = this.proyectosDe(p).filter((pr) => PROYECTO_EN_CURSO.includes(pr.estado)).length;
    return enCurso ? `Tiene ${enCurso} proyecto(s) en curso: reasígnalos a otro arquitecto antes de desactivarlo.` : '';
  }

  proyectosDe(p: Persona): ProyectoResumen[] {
    return this.tipo() === 'clientes'
      ? this.proyectos().filter((pr) => pr.id_cliente === p.id)
      : this.proyectos().filter((pr) => pr.id_arquitecto === p.id);
  }

  proyectosEnCurso(p: Persona): number {
    return this.proyectosDe(p).filter((pr) => PROYECTO_EN_CURSO.includes(pr.estado)).length;
  }

  /** "clientes" → "cliente" / "Cliente" */
  singular(tipo: Tipo, mayuscula = false): string {
    const texto = tipo === 'clientes' ? 'cliente' : 'arquitecto';
    return mayuscula ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
  }

  // =========================================================
  // FORMATOS (se usan en el HTML)
  // =========================================================

  iniciales(p: { nombre: string; apellidos: string }): string {
    return `${p.nombre.charAt(0)}${p.apellidos.charAt(0)}`.toUpperCase();
  }

  /** 5512345678 → "55 1234 5678" */
  telefono(valor: string): string {
    const d = valor.replace(/\D/g, '');
    return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}` : valor || '—';
  }

  claseEstadoProyecto(estado: string): string {
    const clases: Record<string, string> = {
      'En proceso': 'sg-chip--proceso',
      Completado: 'sg-chip--activo',
      Pausado: 'sg-chip--pausado',
      Cancelado: 'sg-chip--cancelado'
    };
    return clases[estado] ?? '';
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