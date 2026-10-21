# SIGOA · Estructura del proyecto

```
sigoa/
├── backend/                     API Node.js + Express + MySQL (Noé)
│   ├── database/sigoa.sql       script de la base de datos
│   ├── routes/                  una ruta por módulo (proyectos, obras, …)
│   └── server.js
├── docs/                        guías del equipo (diseño y estructura)
├── public/                      archivos que se sirven tal cual
│   ├── icons/                   íconos de la PWA (normales y maskable)
│   ├── img/                     logo y dibujo del login
│   ├── favicon.ico
│   └── manifest.webmanifest
└── src/
    ├── index.html               página base (idioma, color de tema, manifest)
    ├── styles.css               sistema de diseño global (colores, tipografía, botones, campos)
    ├── componentes.css          componentes compartidos (tabla, modal, ficha, avisos…)
    └── app/
        ├── app.routes.ts        rutas: login + un Shell por rol con sus pantallas
        ├── core/                piezas únicas de toda la app
        │   ├── guards/          quién puede entrar a cada rol
        │   └── services/        sesión, conexión, avisos, instalación PWA, IndexedDB
        ├── shared/              piezas reutilizables en varias pantallas
        │   └── icono/           <app-icono nombre="…">
        ├── layout/
        │   └── shell/           App Shell: barra superior, barra inferior, menús por rol
        └── pages/               una carpeta por pantalla
            ├── login/
            ├── admin/           inicio, proyectos, obras, cotizaciones, contratos, pagos, usuarios
            ├── arquitecto/      inicio, proyectos, obras
            └── cliente/         inicio
```

## Reglas para no perderse

- **Pantalla nueva** → `src/app/pages/<rol>/<pantalla>/` con sus 3 archivos (`.ts`, `.html`, `.css`) y su ruta en `app.routes.ts`.
- **Servicio** (datos o lógica que usan varias pantallas) → `src/app/core/services/`.
- **Componente pequeño reutilizable** (ícono, tarjeta, etc.) → `src/app/shared/`.
- **Estilos** que se repiten en varias pantallas → `src/componentes.css`; los propios de una pantalla → su `.css`.
- No mover carpetas arrastrando en VS Code: usar `git mv origen destino` en Git Bash.
