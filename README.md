# SIGOA  
**Sistema Integral de Gestión de Obras y Arquitectura**

Aplicación web progresiva (PWA) para que un despacho de arquitectura lleve el control de sus **proyectos, obras, cotizaciones, contratos y pagos** en un solo lugar. Se puede **instalar** en la computadora o en el celular, **funciona sin internet** en modo consulta y **avisa con notificaciones** de lo importante.

> Proyecto de la materia **Aplicaciones Web Progresivas** · Mtra. Sandra Alfaro Linares
> Equipo **Soluciones Integrales Tecnológicas**

---

##   ¿Quién la usa y para qué?

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Manejar todo el despacho: proyectos, obras, cotizaciones, contratos, pagos y usuarios. Genera recibos, cotizaciones y contratos en PDF. |
| **Arquitecto** | Ver sus proyectos y obras, actualizar el avance y subir fotos de evidencia. |
| **Cliente** | Ver cómo va su obra: avance, fotos, pagos y datos de su arquitecto. |

##   ¿Qué la hace una PWA?

- **Se instala** como app (botón "Instalar" del navegador) y abre en su propia ventana.
- **Abre al instante** gracias al *App Shell*: la barra de arriba y la de abajo se cargan una vez y solo cambia el contenido.
- **Funciona sin internet**: muestra los últimos datos guardados con un aviso de *"Modo consulta"*.
- **Notificaciones**: avance de obra, fotos nuevas, cotizaciones, pagos por vencer y más, aunque la app esté cerrada.
- **Renderizado mixto**: el login se arma en el servidor (SSR) y las pantallas privadas en el navegador (CSR).

##   Con qué está hecha

- **Pantallas:** Angular 22
- **Servidor / API:** Node.js + Express
- **Base de datos:** MySQL (con XAMPP en la compu)
- **Notificaciones:** Service Worker de Angular + `web-push`

---

##   Cómo correrla en tu compu

### Lo que necesitas instalado
- **Node.js** 22 o más nuevo
- **XAMPP** (para MySQL)
- **Git**

### Primera vez
1. Clona el repo y entra a la carpeta:
```bash
   git clone <url-del-repo>
   cd sigoa
```
2. Instala lo necesario (en la carpeta principal **y** en `backend`):
```bash
   npm install
   cd backend && npm install && cd ..
```
3. Abre **XAMPP**, prende **MySQL** y en phpMyAdmin importa la base de datos `sigoa` (archivo `.sql` del equipo).

### Para programar (se actualiza solo al guardar)
Necesitas **2 terminales**:

| Terminal | Comando | Qué levanta |
|---|---|---|
| 1 · Backend | `cd backend` y luego `node server.js` | La API en el puerto 3000 |
| 2 · Pantallas | `npm start` | La app en **http://localhost:4200** |

> En el 4200 **no** funciona el modo sin conexión ni la instalación: el Service Worker solo se prende en modo producción.

### Para presentar o probar la PWA completa
Con el backend prendido (terminal 1), en la terminal 2:
```bash
npm run produccion
```
y abre **http://localhost:4000**. Aquí sí funcionan la instalación, el modo sin conexión y las notificaciones.

### Configurar la API en un hosting
La dirección del backend está centralizada en `public/runtime-config.js`. Antes de compilar, cambia el valor de `API_URL` por la URL completa del backend, incluyendo `/api/routes`:

```text
const API_URL = 'https://tu-dominio.com/api/routes';
```

Si el hosting ya tiene la aplicación compilada, también puedes sustituir ese valor en `dist/sigoa/browser/runtime-config.js` y reiniciar el servidor; no hace falta recompilar. En desarrollo, el valor inicial es `http://localhost:3000/api/routes`. La misma dirección se usa para cargar los archivos subidos.

### Publicar el backend Express
Para el servicio que muestra `server.js` como archivo de entrada, configura el directorio raíz como `backend` y usa:

| Configuración | Valor |
|---|---|
| Versión de Node.js | 22 |
| Comando de compilación | `npm run build` |
| Comando de inicio | `npm start` |

El build verifica la sintaxis de `server.js`; la API escucha automáticamente en el puerto que asigne el hosting (`PORT`). En las variables de entorno del servicio configura `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` con los datos de una base MySQL accesible desde el hosting. No uses las credenciales de desarrollo ni subas contraseñas al repositorio. Para habilitar notificaciones push persistentes, configura también `VAPID_CONTACTO`, `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`; toma como referencia `backend/.env.example`.

El backend y la aplicación Angular son servicios separados: publica el backend primero, copia su URL pública en `public/runtime-config.js`, y después compila y publica la aplicación Angular desde la raíz del proyecto.

---

##   Dónde está cada cosa

```
sigoa/
├── backend/            API (rutas por módulo, conexión a MySQL, notificaciones)
├── public/             íconos de la app y manifest.webmanifest
├── docs/               guías del equipo
└── src/app/
    ├── core/           servicios compartidos (sesión, conexión, avisos, notificaciones…)
    ├── layout/shell/   App Shell: barra superior, barra inferior, campanita y menús
    ├── shared/         piezas reutilizables (íconos)
    └── pages/          una carpeta por pantalla: login, admin, arquitecto y cliente
```

Más detalle en [`docs/estructura-proyecto.md`](docs/estructura-proyecto.md).

##   Comandos útiles

| Comando | Para qué sirve |
|---|---|
| `npm start` | Programar en el 4200 |
| `npm run produccion` | Compilar y levantar la versión completa en el 4000 |
| `npm run build` | Solo compilar |

##   Problemas comunes

| Si te sale… | Haz esto |
|---|---|
| `EADDRINUSE ... 4000` (puerto ocupado) | Ya hay otro servidor prendido. Ciérralo con **Ctrl + C** en su terminal, o en Git Bash: `netstat -ano \| findstr :4000` y luego `taskkill //PID <número> //F` |
| `Could not fork child process` en Git Bash | Cierra todas las Git Bash y reinicia la compu (o usa las terminales de VS Code) |
| Sin internet no abren algunas pantallas | Estás en el 4200. Prueba en el 4000 y entra una vez con internet a cada pantalla |
| VS Code marca en rojo algo que sí existe | `Ctrl + Shift + P` → **TypeScript: Restart TS Server** |
| `Cannot find module` | Falta instalar: `npm install` (y también dentro de `backend`) |

---

##   Equipo

| Integrante | Rol |
|---|---|
| Jacob | Líder de proyecto |
| Liliana | Análisis y pruebas |
| Noé | Desarrollo (backend y publicación) |
| Carlos | Diseño UX/UI y frontend |