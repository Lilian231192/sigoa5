# SIGOA · Guía de diseño de pantallas

Referencia: **Inicio admin** (`src/app/pages/admin/inicio/`), versión aprobada por Carlos el 16 oct 2026.
Todas las demás pantallas siguen este mismo lenguaje.

## 1. Estilo visual ("Plano de día", versión limpia)

- **Tipografía:** Figtree en todo (`--sg-sans` y `--sg-mono` apuntan a Figtree). Etiquetas `.sg-label` en mayúsculas, 11px, peso 600, espaciado 0.06em.
- **Fondo de página:** contenedor con `background-color: #ffffff9b` para atenuar la cuadrícula del body.
- **Líneas:** `--fuerte: rgba(22,22,22,.45)` para bordes de tarjetas y separadores principales; `--suave: rgba(22,22,22,.1)` para separadores entre filas y la línea de los títulos de sección.
- **Tarjetas:** fondo transparente, borde 1px `--fuerte`, sin sombras ni efecto de elevación. Hover: el borde pasa a negro.
- **Íconos:** solo trazo negro (componente `<app-icono>`), sin cuadros de color detrás.
- **Sin tarjetas oscuras** ni bloques negros.
- **Amarillo (#FAC82B) solo como acento:** relleno de las barras de cota (`.sg-cota__relleno`), arco del medidor, cuadrito `.punto` del encabezado, la fecha más próxima de la línea de tiempo, borde izquierdo de avisos, hover muy suave `rgba(250,200,43,.1)`, píldora de la pestaña activa del Shell.
- **Nombre del usuario** en negro sólido (sin subrayado amarillo).

## 2. Estructura de cada pantalla

```
<section class="pagina">           max-width 1440px · padding 36px var(--sg-margen) 56px
  <header class="cabecera">        borde inferior --fuerte
    .sg-label con .punto  →  "VIE 16 OCT 2026 · SECCIÓN"
    h1 (800, clamp(32px, 4.4vw, 56px), letter-spacing -0.035em)
    .cabecera__sub (gris, 16px)
    dl.rotulo (cuadro de rótulo de lámina, sin bloque amarillo; se oculta en ≤640px)
  aviso sin conexión (si aplica) / .sg-alerta con "Reintentar"
  h2.seccion  →  <span>01</span> TÍTULO  + línea --suave  (número en negro 800, sin caja)
  ...contenido...
```

- Secciones numeradas 01, 02, 03… como referencias de plano.
- Grids: 4 columnas en escritorio → 2 en ≤1180px → 1 en ≤640px. Separación 20px (12px en celular).
- Estados vacíos: recuadro con borde punteado `--fuerte`, ícono, texto gris y enlace en negro para crear el primer registro.
- Mientras carga: clase `.cargando` (opacidad .45) sobre los bloques de datos, sin spinners.

## 3. Patrón de datos (igual en todas las pantallas)

- Componentes standalone con **signals** (`signal`, `computed`, `effect`).
- Conexión: `ConexionService.enLinea()` (no volver a escuchar `online/offline` en cada página).
- `effect` sobre `enLinea()`: en línea → API; sin conexión → copia de IndexedDB.
- IndexedDB: base `SIGOA_DB`, versión 1, store `resumen`, **una clave por pantalla** (`admin-inicio`, `admin-proyectos`, …). Se guarda `{ datos…, guardadoEn: Date.now() }`.
- Aviso al mostrar la copia: `Sin conexión · Mostrando datos guardados el 16 OCT 2026 · 19:30`.
- Sin conexión: botones/accesos de crear, editar o borrar deshabilitados (`.bloqueado`) + nota "Los registros nuevos se habilitan al volver la conexión".
- Formatos: `dinero()` MXN sin centavos, `dosDigitos()`, códigos tipo `OBR-003` / `PRY-001`, fechas `22 OCT 2026`, estados de BD con acento corregido para mostrar.
- Sin `console.log` de depuración.

## 4. Componentes compartidos (`src/componentes.css` + `core/services/avisos.service.ts`)

Usar estas clases en lugar de crear estilos nuevos en cada pantalla:

| Necesito… | Clase / servicio |
|---|---|
| Contenedor de página | `.sg-pagina` |
| Encabezado con título y acciones | `.sg-cabecera`, `.sg-cabecera__sub`, `.sg-cabecera__acciones`, `.sg-punto` |
| Aviso de datos guardados | `.sg-aviso-copia` |
| Buscador | `label.sg-buscador` + `<app-icono nombre="buscar">` + `.sg-input` |
| Filtro por estado | `nav.sg-tabs` con `button.activo` |
| Tabla | `table.sg-tabla`, código `.sg-codigo` |
| Menú ⋮ de acciones | `.sg-menu`, `.sg-menu__velo`, `.sg-menu__lista`, `.sg-menu__peligro` |
| Paginación | `.sg-paginacion` (8 por página) |
| Vacío | `.sg-vacio` |
| Ficha de detalle | `.sg-velo` + `aside.sg-lateral` |
| Formulario | `.sg-velo` + `form.sg-modal` (`--alto` si se abre sobre la ficha) con `__cabecera / __cuerpo.sg-form / __pie` |
| Campos | `.sg-campo` (`--completo` = ancho completo), `.sg-input`, `.sg-select`, `.sg-textarea` |
| Botones | `.sg-btn`, `--contorno`, `--chico`, `--peligro`, `.sg-icono-btn` |
| Mensajes al usuario | `AvisosService.exito() / error()` — **nunca** `alert()` |
| Confirmar borrado | `await AvisosService.confirmar({ titulo, mensaje, textoAceptar: 'Eliminar', peligro: true })` — **nunca** `confirm()` |

Ejemplo completo: `src/app/pages/admin/proyectos/`.
