const express = require('express');
const router = express.Router();
const db = require('../db');
const { eventos } = require('../notificaciones');

const estadosPermitidos = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Vencida'];

function agruparCotizaciones(filas) {
    const mapa = new Map();
    for (const fila of filas) {
        let cotizacion = mapa.get(fila.id);
        if (!cotizacion) {
            cotizacion = {
                id: fila.id,
                id_proyecto: fila.id_proyecto,
                proyecto: fila.proyecto,
                cliente: fila.cliente,
                folio: fila.folio,
                fecha: fila.fecha,
                vigencia: fila.vigencia,
                subtotal: Number(fila.subtotal || 0),
                iva: Number(fila.iva || 0),
                total: Number(fila.total || 0),
                estado: fila.estado,
                observaciones: fila.observaciones || '',
                detalles: []
            };
            mapa.set(fila.id, cotizacion);
        }
        if (fila.id_detalle != null) {
            cotizacion.detalles.push({
                id: fila.id_detalle,
                concepto: fila.concepto,
                descripcion: fila.descripcion_detalle || '',
                cantidad: Number(fila.cantidad || 0),
                unidad: fila.unidad || '',
                precio_unitario: Number(fila.precio_unitario || 0),
                importe: Number(fila.importe || 0)
            });
        }
    }
    return [...mapa.values()];
}

const consultaBase = `
    SELECT c.id_cotizacion AS id, c.id_proyecto, p.nombre AS proyecto,
           CONCAT(cl.nombre, ' ', cl.apellidos) AS cliente,
           c.folio, c.fecha, c.vigencia, c.subtotal, c.iva, c.total,
           c.estado, c.observaciones,
           d.id_detalle, d.concepto, d.descripcion AS descripcion_detalle,
           d.cantidad, d.unidad, d.precio_unitario, d.importe
    FROM cotizaciones c
    INNER JOIN proyectos p ON p.id_proyecto = c.id_proyecto
    INNER JOIN clientes cl ON cl.id_cliente = p.id_cliente
    LEFT JOIN cotizacion_detalles d ON d.id_cotizacion = c.id_cotizacion
`;

router.get('/opciones', (req, res) => {
    db.query('SELECT id_proyecto AS id, nombre FROM proyectos ORDER BY nombre', (error, proyectos) => {
        if (error) {
            console.error('Error al cargar proyectos para cotizaciones:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener proyectos' });
        }
        return res.json({ success: true, proyectos });
    });
});

router.get('/', (req, res) => {
    db.query(`${consultaBase} ORDER BY c.id_cotizacion DESC, d.id_detalle`, (error, filas) => {
        if (error) {
            console.error('Error al obtener cotizaciones:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener las cotizaciones' });
        }
        return res.json({ success: true, cotizaciones: agruparCotizaciones(filas) });
    });
});

router.post('/', async (req, res) => {
    const { id_proyecto, folio, fecha, vigencia, estado, observaciones } = req.body;
    const proyectoId = Number(id_proyecto);
    const porcentajeIva = Number(req.body.porcentaje_iva ?? 16);
    const detallesEntrada = req.body.detalles;

    if (!Number.isInteger(proyectoId) || proyectoId < 1 || !folio?.trim() || !fecha || !estadosPermitidos.includes(estado || 'Borrador')) {
        return res.status(400).json({ success: false, mensaje: 'Proyecto, folio, fecha y estado válido son obligatorios' });
    }
    if (!Number.isFinite(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) {
        return res.status(400).json({ success: false, mensaje: 'El porcentaje de IVA debe estar entre 0 y 100' });
    }
    if (!Array.isArray(detallesEntrada) || !detallesEntrada.length) {
        return res.status(400).json({ success: false, mensaje: 'Agrega al menos un concepto a la cotización' });
    }

    const detalles = detallesEntrada.map(detalle => {
        const cantidad = Number(detalle.cantidad);
        const precioUnitario = Number(detalle.precio_unitario);
        return {
            concepto: String(detalle.concepto || '').trim(),
            descripcion: String(detalle.descripcion || '').trim(),
            cantidad,
            unidad: String(detalle.unidad || '').trim(),
            precioUnitario,
            importe: Math.round((cantidad * precioUnitario + Number.EPSILON) * 100) / 100
        };
    });
    if (detalles.some(d => !d.concepto || !Number.isFinite(d.cantidad) || d.cantidad <= 0 || !Number.isFinite(d.precioUnitario) || d.precioUnitario < 0)) {
        return res.status(400).json({ success: false, mensaje: 'Revisa los conceptos, cantidades y precios de la cotización' });
    }

    const subtotal = Math.round((detalles.reduce((suma, d) => suma + d.importe, 0) + Number.EPSILON) * 100) / 100;
    const iva = Math.round((subtotal * porcentajeIva / 100 + Number.EPSILON) * 100) / 100;
    const total = Math.round((subtotal + iva + Number.EPSILON) * 100) / 100;
    let conexion;
    try {
        conexion = await db.promise().getConnection();
        await conexion.beginTransaction();
        const [resultado] = await conexion.execute(
            `INSERT INTO cotizaciones (id_proyecto, folio, fecha, vigencia, subtotal, iva, total, estado, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [proyectoId, folio.trim(), fecha, vigencia || null, subtotal, iva, total, estado || 'Borrador', observaciones || null]
        );
        for (const detalle of detalles) {
            await conexion.execute(
                `INSERT INTO cotizacion_detalles (id_cotizacion, concepto, descripcion, cantidad, unidad, precio_unitario, importe)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [resultado.insertId, detalle.concepto, detalle.descripcion || null, detalle.cantidad, detalle.unidad || null, detalle.precioUnitario, detalle.importe]
            );
        }
        await conexion.commit();
        if ((estado || 'Borrador') === 'Enviada') eventos.cotizacionEnviada(resultado.insertId);
        return res.status(201).json({ success: true, id: resultado.insertId, subtotal, iva, total, mensaje: 'Cotización creada correctamente' });
    } catch (error) {
        if (conexion) await conexion.rollback();
        console.error('Error al crear cotización:', error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, mensaje: 'Ese folio ya está registrado' });
        if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, mensaje: 'El proyecto seleccionado no existe' });
        return res.status(500).json({ success: false, mensaje: 'No se pudo crear la cotización' });
    } finally {
        conexion?.release();
    }
});

router.get('/:id', (req, res) => {
    db.query(`${consultaBase} WHERE c.id_cotizacion = ? ORDER BY d.id_detalle`, [req.params.id], (error, filas) => {
        if (error) {
            console.error('Error al obtener cotización:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener la cotización' });
        }
        if (!filas.length) return res.status(404).json({ success: false, mensaje: 'Cotización no encontrada' });
        return res.json({ success: true, cotizacion: agruparCotizaciones(filas)[0] });
    });
});

// Actualiza los datos generales. Si llegan "detalles", también reemplaza los conceptos
// y recalcula subtotal, IVA y total dentro de una transacción.
router.put('/:id', async (req, res) => {
    const { id_proyecto, folio, fecha, vigencia, estado, observaciones } = req.body;
    const idCotizacion = Number(req.params.id);
    if (!id_proyecto || !folio?.trim() || !fecha || !estadosPermitidos.includes(estado)) {
        return res.status(400).json({ success: false, mensaje: 'Proyecto, folio, fecha y estado válido son obligatorios' });
    }
    if (vigencia && vigencia < fecha) {
        return res.status(400).json({ success: false, mensaje: 'La vigencia no puede ser antes de la fecha' });
    }

    let detalles = null;
    let porcentajeIva = 16;
    if (Array.isArray(req.body.detalles)) {
        porcentajeIva = Number(req.body.porcentaje_iva ?? 16);
        if (!Number.isFinite(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) {
            return res.status(400).json({ success: false, mensaje: 'El porcentaje de IVA debe estar entre 0 y 100' });
        }
        if (!req.body.detalles.length) {
            return res.status(400).json({ success: false, mensaje: 'Agrega al menos un concepto a la cotización' });
        }
        detalles = req.body.detalles.map(detalle => {
            const cantidad = Number(detalle.cantidad);
            const precioUnitario = Number(detalle.precio_unitario);
            return {
                concepto: String(detalle.concepto || '').trim(),
                descripcion: String(detalle.descripcion || '').trim(),
                cantidad,
                unidad: String(detalle.unidad || '').trim(),
                precioUnitario,
                importe: Math.round((cantidad * precioUnitario + Number.EPSILON) * 100) / 100
            };
        });
        if (detalles.some(d => !d.concepto || !Number.isFinite(d.cantidad) || d.cantidad <= 0 || !Number.isFinite(d.precioUnitario) || d.precioUnitario < 0)) {
            return res.status(400).json({ success: false, mensaje: 'Revisa los conceptos, cantidades y precios de la cotización' });
        }
    }

    let conexion;
    try {
        conexion = await db.promise().getConnection();
        await conexion.beginTransaction();

        const [existe] = await conexion.execute('SELECT estado FROM cotizaciones WHERE id_cotizacion = ?', [idCotizacion]);
        if (!existe.length) {
            await conexion.rollback();
            return res.status(404).json({ success: false, mensaje: 'Cotización no encontrada' });
        }
        if (detalles && existe[0].estado === 'Aceptada') {
            await conexion.rollback();
            return res.status(400).json({ success: false, mensaje: 'Una cotización aceptada ya no puede cambiar sus conceptos' });
        }

        await conexion.execute(
            `UPDATE cotizaciones
             SET id_proyecto = ?, folio = ?, fecha = ?, vigencia = ?, estado = ?, observaciones = ?
             WHERE id_cotizacion = ?`,
            [id_proyecto, folio.trim(), fecha, vigencia || null, estado, observaciones || null, idCotizacion]
        );

        if (detalles) {
            const subtotal = Math.round((detalles.reduce((suma, d) => suma + d.importe, 0) + Number.EPSILON) * 100) / 100;
            const iva = Math.round((subtotal * porcentajeIva / 100 + Number.EPSILON) * 100) / 100;
            const total = Math.round((subtotal + iva + Number.EPSILON) * 100) / 100;

            await conexion.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [idCotizacion]);
            for (const detalle of detalles) {
                await conexion.execute(
                    `INSERT INTO cotizacion_detalles (id_cotizacion, concepto, descripcion, cantidad, unidad, precio_unitario, importe)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [idCotizacion, detalle.concepto, detalle.descripcion || null, detalle.cantidad, detalle.unidad || null, detalle.precioUnitario, detalle.importe]
                );
            }
            await conexion.execute(
                'UPDATE cotizaciones SET subtotal = ?, iva = ?, total = ? WHERE id_cotizacion = ?',
                [subtotal, iva, total, idCotizacion]
            );
        }

        await conexion.commit();
        // Se avisa al cliente solo cuando pasa a "Enviada" (no en cada edición)
        if (estado === 'Enviada' && existe[0].estado !== 'Enviada') eventos.cotizacionEnviada(idCotizacion);
        return res.json({ success: true, mensaje: 'Cotización actualizada correctamente' });
    } catch (error) {
        if (conexion) await conexion.rollback();
        console.error('Error al actualizar cotización:', error);
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, mensaje: 'Ese folio ya está registrado' });
        if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, mensaje: 'El proyecto seleccionado no existe' });
        return res.status(500).json({ success: false, mensaje: 'Error al actualizar la cotización' });
    } finally {
        conexion?.release();
    }
});

router.delete('/:id', (req, res) => {
    db.query('DELETE FROM cotizaciones WHERE id_cotizacion = ?', [req.params.id], (error, resultado) => {
        if (error) {
            console.error('Error al eliminar cotización:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al eliminar la cotización' });
        }
        if (!resultado.affectedRows) return res.status(404).json({ success: false, mensaje: 'Cotización no encontrada' });
        return res.json({ success: true, mensaje: 'Cotización eliminada correctamente' });
    });
});

module.exports = router;