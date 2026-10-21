const express = require('express');
const router = express.Router();

const db = require('../db');
const { eventos } = require('../notificaciones');

function agregarObrasAProyectos(proyectos, callback) {
    if (!proyectos.length) return callback(null, proyectos);
    const ids = proyectos.map(proyecto => Number(proyecto.id));
    const sql = `
        SELECT id_obra, id_proyecto, nombre, descripcion, estado, fecha_inicio,
               fecha_fin_estimada, fecha_fin_real, porcentaje_avance
        FROM obras
        WHERE id_proyecto IN (?)
        ORDER BY id_proyecto, id_obra
    `;
    db.query(sql, [ids], (error, obras) => {
        if (error) return callback(error);
        const porProyecto = new Map();
        for (const obra of obras) {
            const idProyecto = Number(obra.id_proyecto);
            const lista = porProyecto.get(idProyecto) || [];
            lista.push(obra);
            porProyecto.set(idProyecto, lista);
        }
        for (const proyecto of proyectos) {
            proyecto.obras = porProyecto.get(Number(proyecto.id)) || [];
            const primeraObra = proyecto.obras[0];
            proyecto.id_obra = primeraObra?.id_obra ?? null;
            proyecto.obra_nombre = primeraObra?.nombre ?? '';
            proyecto.obra_estado = primeraObra?.estado ?? '';
            proyecto.obra_avance = primeraObra?.porcentaje_avance ?? 0;
            proyecto.obra_descripcion = primeraObra?.descripcion ?? '';
            proyecto.obra_fecha_inicio = primeraObra?.fecha_inicio ?? null;
            proyecto.obra_fecha_fin_estimada = primeraObra?.fecha_fin_estimada ?? null;
        }
        callback(null, proyectos);
    });
}

// Opciones disponibles para los selectores del formulario de edición.
router.get('/opciones', (req, res) => {
    const sqlClientes = `
        SELECT id_cliente AS id, CONCAT(nombre, ' ', apellidos) AS nombre
        FROM clientes WHERE activo = TRUE ORDER BY nombre, apellidos
    `;
    const sqlArquitectos = `
        SELECT u.id_usuario AS id, CONCAT(u.nombre, ' ', u.apellidos) AS nombre
        FROM usuarios u INNER JOIN roles r ON r.id_rol = u.id_rol
        WHERE r.nombre = 'Arquitecto' AND u.activo = TRUE
        ORDER BY u.nombre, u.apellidos
    `;
    db.query(sqlClientes, (error, clientes) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'Error al obtener clientes' });
        db.query(sqlArquitectos, (errorArquitectos, arquitectos) => {
            if (errorArquitectos) return res.status(500).json({ success: false, mensaje: 'Error al obtener arquitectos' });
            return res.json({ success: true, clientes, arquitectos });
        });
    });
});

// ========================================
// OBTENER TODOS LOS PROYECTOS
// GET /api/routes/proyectos
// ========================================

function consultarProyectos(res, idArquitecto = null) {
    const sql = `
        SELECT
            p.id_proyecto AS id,
            p.nombre,
            p.descripcion,
            p.id_cliente,
            p.id_arquitecto,
            CONCAT(c.nombre, ' ', c.apellidos) AS cliente,
            COALESCE(CONCAT(a.nombre, ' ', a.apellidos), '') AS arquitecto,
            p.direccion_obra AS ubicacion,
            CASE p.estado
                WHEN 'Finalizado' THEN 'Completado'
                WHEN 'En progreso' THEN 'En proceso'
                WHEN 'Planeacion' THEN 'Pendiente'
                ELSE p.estado
            END AS estado,
            p.fecha_inicio,
            p.fecha_fin_estimada AS fecha_fin,
            p.porcentaje_avance
        FROM proyectos p
        INNER JOIN clientes c
            ON p.id_cliente = c.id_cliente
        LEFT JOIN usuarios a ON p.id_arquitecto = a.id_usuario
        ${idArquitecto === null ? '' : 'WHERE p.id_arquitecto = ?'}
        ORDER BY p.id_proyecto DESC
    `;

    db.query(sql, idArquitecto === null ? [] : [idArquitecto], (error, resultados) => {

        if (error) {
            console.error('Error al obtener proyectos:', error);

            return res.status(500).json({
                success: false,
                mensaje: 'Error al obtener los proyectos'
            });
        }

        agregarObrasAProyectos(resultados, (errorObras, proyectos) => {
            if (errorObras) {
                console.error('Error al obtener las obras de los proyectos:', errorObras);
                return res.status(500).json({ success: false, mensaje: 'Error al obtener las obras relacionadas' });
            }
            return res.json({ success: true, proyectos });
        });
    });
}

router.get('/asignados/:id_arquitecto', (req, res) => {
    const idArquitecto = Number(req.params.id_arquitecto);
    if (!Number.isInteger(idArquitecto) || idArquitecto < 1) {
        return res.status(400).json({ success: false, mensaje: 'El identificador del arquitecto no es válido' });
    }
    consultarProyectos(res, idArquitecto);
});

router.get('/', (req, res) => consultarProyectos(res));

// Crear proyecto.
router.post('/', (req, res) => {
    const { id_cliente, id_arquitecto, nombre, descripcion, ubicacion, estado, fecha_inicio, fecha_fin } = req.body;
    const estadosPermitidos = ['Planeacion', 'En progreso', 'Pausado', 'Finalizado', 'Cancelado'];
    const equivalencias = { 'Pendiente': 'Planeacion', 'En proceso': 'En progreso', 'Completado': 'Finalizado' };
    const estadoBD = equivalencias[estado] || estado;
    if (!id_cliente || !nombre?.trim() || !estadoBD || !estadosPermitidos.includes(estadoBD)) {
        return res.status(400).json({ success: false, mensaje: 'El nombre, el cliente y un estado válido son obligatorios' });
    }
    const sql = `INSERT INTO proyectos (id_cliente, id_arquitecto, nombre, descripcion, direccion_obra, estado, fecha_inicio, fecha_fin_estimada)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [id_cliente, id_arquitecto || null, nombre.trim(), descripcion || null, ubicacion || null, estadoBD, fecha_inicio || null, fecha_fin || null], (error, result) => {
        if (error) {
            console.error('Error al crear proyecto:', error);
            if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, mensaje: 'El cliente o arquitecto seleccionado no existe' });
            return res.status(500).json({ success: false, mensaje: 'No se pudo crear el proyecto' });
        }
        if (id_arquitecto) eventos.proyectoAsignado(result.insertId, Number(id_arquitecto));
        res.status(201).json({ success: true, id: result.insertId, mensaje: 'Proyecto creado correctamente' });
    });
});


// ========================================
// OBTENER UN PROYECTO POR ID
// GET /api/routes/proyectos/:id
// ========================================

router.get('/:id', (req, res) => {

    const { id } = req.params;

    const sql = `
        SELECT
            p.id_proyecto AS id,
            p.nombre,
            p.descripcion,
            p.id_cliente,
            p.id_arquitecto,
            CONCAT(c.nombre, ' ', c.apellidos) AS cliente,
            COALESCE(CONCAT(a.nombre, ' ', a.apellidos), '') AS arquitecto,
            p.direccion_obra AS ubicacion,
            CASE p.estado
                WHEN 'Finalizado' THEN 'Completado'
                WHEN 'En progreso' THEN 'En proceso'
                WHEN 'Planeacion' THEN 'Pendiente'
                ELSE p.estado
            END AS estado,
            p.fecha_inicio,
            p.fecha_fin_estimada AS fecha_fin
        FROM proyectos p
        INNER JOIN clientes c
            ON p.id_cliente = c.id_cliente
        LEFT JOIN usuarios a ON p.id_arquitecto = a.id_usuario
        WHERE p.id_proyecto = ?
    `;

    db.query(sql, [id], (error, resultados) => {

        if (error) {
            console.error('Error al obtener proyecto:', error);

            return res.status(500).json({
                success: false,
                mensaje: 'Error al obtener el proyecto'
            });
        }

        if (resultados.length === 0) {
            return res.status(404).json({
                success: false,
                mensaje: 'Proyecto no encontrado'
            });
        }

        agregarObrasAProyectos(resultados, (errorObras, proyectos) => {
            if (errorObras) {
                console.error('Error al obtener las obras del proyecto:', errorObras);
                return res.status(500).json({ success: false, mensaje: 'Error al obtener las obras relacionadas' });
            }
            return res.json({ success: true, proyecto: proyectos[0] });
        });
    });
});


// ========================================
// EDITAR PROYECTO
// PUT /api/routes/proyectos/:id
// ========================================

router.put('/:id', (req, res) => {

    const { id } = req.params;

    const {
        nombre,
        descripcion,
        id_cliente,
        id_arquitecto,
        ubicacion,
        estado,
        fecha_inicio,
        fecha_fin
    } = req.body;

    // Validar campos obligatorios
    if (
        !nombre ||
        id_cliente === undefined ||
        id_cliente === null ||
        !estado
    ) {
        return res.status(400).json({
            success: false,
            mensaje: 'El nombre, el cliente y el estado son obligatorios'
        });
    }

    // Validar que el estado coincida con el ENUM de MySQL
    const estadosPermitidos = [
        'Planeacion',
        'En progreso',
        'Pausado',
        'Finalizado',
        'Cancelado'
    ];

    // Aceptar también los nombres que muestra la interfaz
    const equivalenciasEstado = {
        'Pendiente': 'Planeacion',
        'En proceso': 'En progreso',
        'Completado': 'Finalizado'
    };

    const estadoBD = equivalenciasEstado[estado] || estado;

    if (!estadosPermitidos.includes(estadoBD)) {
        return res.status(400).json({
            success: false,
            mensaje: 'El estado del proyecto no es válido'
        });
    }

    const sql = `
        UPDATE proyectos
        SET
            nombre = ?,
            descripcion = ?,
            id_cliente = ?,
            id_arquitecto = ?,
            direccion_obra = ?,
            estado = ?,
            fecha_inicio = ?,
            fecha_fin_estimada = ?
        WHERE id_proyecto = ?
    `;

    const valores = [
        nombre,
        descripcion || null,
        id_cliente,
        id_arquitecto || null,
        ubicacion || null,
        estadoBD,
        fecha_inicio || null,
        fecha_fin || null,
        id
    ];

    // Se lee el arquitecto anterior para saber si cambió (y avisarle al nuevo)
    db.query('SELECT id_arquitecto FROM proyectos WHERE id_proyecto = ?', [id], (errorAntes, filasAntes) => {
    const arquitectoAntes = filasAntes?.[0]?.id_arquitecto ?? null;

    db.query(sql, valores, (error, resultado) => {

        if (error) {
            console.error('Error al actualizar proyecto:', error);

            return res.status(500).json({
                success: false,
                mensaje: 'Error al actualizar el proyecto'
            });
        }

        if (resultado.affectedRows === 0) {

            // Verificar si el proyecto existe, aunque no haya cambios
            const sqlExiste = `
                SELECT id_proyecto
                FROM proyectos
                WHERE id_proyecto = ?
            `;

            return db.query(sqlExiste, [id], (errorConsulta, filas) => {

                if (errorConsulta) {
                    console.error(
                        'Error al verificar proyecto:',
                        errorConsulta
                    );

                    return res.status(500).json({
                        success: false,
                        mensaje: 'Error al verificar el proyecto'
                    });
                }

                if (filas.length === 0) {
                    return res.status(404).json({
                        success: false,
                        mensaje: 'Proyecto no encontrado'
                    });
                }

                return res.json({
                    success: true,
                    mensaje: 'El proyecto ya tenía esos datos'
                });
            });
        }

        const arquitectoNuevo = id_arquitecto ? Number(id_arquitecto) : null;
        if (arquitectoNuevo && arquitectoNuevo !== arquitectoAntes) {
            eventos.proyectoAsignado(Number(id), arquitectoNuevo);
        }

        return res.json({
            success: true,
            mensaje: 'Proyecto actualizado correctamente'
        });
    });
    });
});


// ========================================
// ELIMINAR PROYECTO
// DELETE /api/routes/proyectos/:id
// ========================================

router.delete('/:id', (req, res) => {

    const { id } = req.params;

    // La clave primaria correcta es id_proyecto
    const sql = `
        DELETE FROM proyectos
        WHERE id_proyecto = ?
    `;

    db.query(sql, [id], (error, resultado) => {

        if (error) {
            console.error('Error al eliminar proyecto:', error);

            // Puede existir una restricción de clave foránea
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(409).json({
                    success: false,
                    mensaje:
                        'No se puede eliminar el proyecto porque tiene registros relacionados, como obras, cotizaciones o contratos.'
                });
            }

            return res.status(500).json({
                success: false,
                mensaje: 'Error al eliminar el proyecto'
            });
        }

        if (resultado.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                mensaje: 'Proyecto no encontrado'
            });
        }

        return res.json({
            success: true,
            mensaje: 'Proyecto eliminado correctamente'
        });
    });
});

module.exports = router;