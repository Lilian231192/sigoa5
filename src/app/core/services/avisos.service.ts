import { Injectable, signal } from '@angular/core';

/**
 * Tipos de aviso y su color:
 * - exito  → verde    (se guardó, se registró, se eliminó…)
 * - error  → rojo     (falló el servidor o un dato está mal)
 * - alerta → amarillo (falta algo o hay que tener cuidado)
 * - info   → azul     (información general)
 */
export type TipoAviso = 'exito' | 'error' | 'alerta' | 'info';

export interface Aviso {
  id: number;
  texto: string;
  tipo: TipoAviso;
  titulo: string;
  /** Cuántas veces se ha mostrado el mismo aviso seguido (×2, ×3…) */
  veces: number;
  /** Duración en milisegundos (la barrita de abajo se vacía en ese tiempo) */
  duracion: number;
  /** true mientras corre la animación de salida */
  saliendo: boolean;
}

export interface Confirmacion {
  titulo: string;
  mensaje: string;
  textoAceptar: string;
  peligro: boolean;
  responder: (aceptado: boolean) => void;
}

/** Título y duración de cada tipo de aviso */
const TIPOS: Record<TipoAviso, { titulo: string; duracion: number }> = {
  exito:  { titulo: 'Listo', duracion: 4500 },
  error:  { titulo: 'Revisa esto', duracion: 6500 },
  alerta: { titulo: 'Atención', duracion: 5500 },
  info:   { titulo: 'Aviso', duracion: 5000 }
};

/** Máximo de avisos en pantalla al mismo tiempo */
const MAXIMO = 3;

/** Lo que dura la animación de salida (debe coincidir con shell.css) */
const SALIDA_MS = 220;

interface Temporizador {
  id: ReturnType<typeof setTimeout> | null;
  inicio: number;
  restante: number;
}

/**
 * Avisos flotantes y cuadro de confirmación de SIGOA.
 * Reemplaza los alert() y confirm() del navegador con componentes
 * del diseño. Los dibuja el App Shell, así que funcionan en todas las pantallas.
 *
 * - Aparecen arriba a la derecha, con color según el tipo.
 * - Si el mismo aviso se repite (p. ej. dar clic varias veces en Guardar),
 *   no se apilan copias: queda uno solo con un contador ×2, ×3…
 * - Al pasar el mouse encima, el aviso se queda quieto hasta que lo sueltes.
 *
 * Uso:
 *   this.avisos.exito('Proyecto guardado');
 *   this.avisos.error('No se pudo guardar');
 *   this.avisos.alerta('Falta la fecha de entrega');
 *   if (await this.avisos.confirmar({ titulo: 'Eliminar', mensaje: '¿Seguro?' })) { ... }
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  readonly lista = signal<Aviso[]>([]);
  readonly confirmacion = signal<Confirmacion | null>(null);
  private siguienteId = 1;
  private readonly temporizadores = new Map<number, Temporizador>();

  mostrar(texto: string, tipo: TipoAviso = 'alerta'): void {
    // Si ya está en pantalla el mismo aviso, se quita y vuelve a entrar con el contador
    const repetido = this.lista().find((a) => a.texto === texto && a.tipo === tipo && !a.saliendo);
    if (repetido) this.quitar(repetido.id);

    const { titulo, duracion } = TIPOS[tipo];
    const aviso: Aviso = {
      id: this.siguienteId++, texto, tipo, titulo, duracion,
      veces: (repetido?.veces ?? 0) + 1,
      saliendo: false
    };

    this.lista.update((avisos) => [...avisos, aviso]);
    this.programar(aviso.id, duracion);

    // Si ya hay muchos, se va el más viejo
    const visibles = this.lista().filter((a) => !a.saliendo);
    const sobrantes = visibles.length - MAXIMO;
    if (sobrantes > 0) visibles.slice(0, sobrantes).forEach((a) => this.cerrar(a.id));
  }

  exito(texto: string): void {
    this.mostrar(texto, 'exito');
  }

  error(texto: string): void {
    this.mostrar(texto, 'error');
  }

  alerta(texto: string): void {
    this.mostrar(texto, 'alerta');
  }

  info(texto: string): void {
    this.mostrar(texto, 'info');
  }

  /** Cierra con animación de salida */
  cerrar(id: number): void {
    const aviso = this.lista().find((a) => a.id === id);
    if (!aviso || aviso.saliendo) return;
    this.limpiarTemporizador(id);
    this.lista.update((avisos) => avisos.map((a) => (a.id === id ? { ...a, saliendo: true } : a)));
    setTimeout(() => this.quitar(id), SALIDA_MS);
  }

  /** Quita de inmediato, sin animación */
  private quitar(id: number): void {
    this.limpiarTemporizador(id);
    this.lista.update((avisos) => avisos.filter((a) => a.id !== id));
  }

  /** Mouse encima: el aviso se queda quieto */
  pausar(id: number): void {
    const t = this.temporizadores.get(id);
    if (!t?.id) return;
    clearTimeout(t.id);
    t.id = null;
    t.restante -= Date.now() - t.inicio;
  }

  /** Mouse fuera: sigue corriendo el tiempo que le faltaba */
  reanudar(id: number): void {
    const t = this.temporizadores.get(id);
    if (!t || t.id) return;
    this.programar(id, Math.max(t.restante, 800));
  }

  private programar(id: number, ms: number): void {
    this.temporizadores.set(id, { id: setTimeout(() => this.cerrar(id), ms), inicio: Date.now(), restante: ms });
  }

  private limpiarTemporizador(id: number): void {
    const t = this.temporizadores.get(id);
    if (t?.id) clearTimeout(t.id);
    this.temporizadores.delete(id);
  }

  /** Abre el cuadro de confirmación y espera la respuesta (true = aceptar) */
  confirmar(opciones: { titulo: string; mensaje: string; textoAceptar?: string; peligro?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmacion.set({
        titulo: opciones.titulo,
        mensaje: opciones.mensaje,
        textoAceptar: opciones.textoAceptar ?? 'Aceptar',
        peligro: opciones.peligro ?? false,
        responder: (aceptado) => {
          this.confirmacion.set(null);
          resolve(aceptado);
        }
      });
    });
  }
}