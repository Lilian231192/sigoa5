const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const proyectosRoutes = require('./routes/proyectos');
const obrasRoutes = require('./routes/obras');
const cotizacionesRoutes = require('./routes/cotizaciones');
const contratosRoutes = require('./routes/contratos');
const pagosRoutes = require('./routes/pagos');
const evidenciasRoutes = require('./routes/evidencias');
const usuariosRoutes = require('./routes/usuarios');
const clienteRoutes = require('./routes/cliente');
const notificacionesRoutes = require('./routes/notificaciones'); // ← NUEVO
const notificaciones = require('./notificaciones'); // ← NUEVO
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

console.log('Cargando rutas...');

app.use('/api/routes/auth', authRoutes);
app.use('/api/routes/admin', adminRoutes);
app.use('/api/routes/proyectos', proyectosRoutes);
app.use('/api/routes/obras', obrasRoutes);
app.use('/api/routes/cotizaciones', cotizacionesRoutes);
app.use('/api/routes/contratos', contratosRoutes);
app.use('/api/routes/pagos', pagosRoutes);
app.use('/api/routes/evidencias', evidenciasRoutes);
app.use('/api/routes/usuarios', usuariosRoutes);
app.use('/api/routes/cliente', clienteRoutes);
app.use('/api/routes/notificaciones', notificacionesRoutes); // ← NUEVO

app.get('/', (req, res) => {
    res.json({
        mensaje: 'Servidor SIGOA funcionando'
    });
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
    // Crea las tablas de notificaciones (si faltan) y arranca los recordatorios automáticos
    notificaciones.iniciar(); // ← NUEVO
    console.log(
        'Ruta de resumen: http://localhost:3000/api/routes/admin/resumen'
    );
    console.log(
        'Ruta de proyectos: http://localhost:3000/api/routes/proyectos'
    );
    console.log(
        'Ruta de obras: http://localhost:3000/api/routes/obras'
    );
    console.log(
        'Ruta de cotizaciones: http://localhost:3000/api/routes/cotizaciones'
    );
    console.log(
        'Ruta de contratos: http://localhost:3000/api/routes/contratos'
    );
});