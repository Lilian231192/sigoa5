const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * PORTAL DEL CLIENTE
 * GET /api/routes/cliente/portal/:id_usuario
 * Devuelve en una sola respuesta todo lo que el cliente puede consultar de SUS proyectos:
 * datos del cliente, proyectos con sus obras, fotos recientes, pagos, contrato y cotizaciones por revisar.
 * (Cuando se agregue JWT, el id_usuario saldrá del token en lugar de la URL.)
 */
router.get('/portal/:id_usuario', async (req, res) => {
    const idUsuario = Number(req.params.id_usuario);
    if (!Number.isInteger(idUsuario) || idUsuario < 1) {
        return res.status(400).json({ success: false, mensaje: 'Identificador de usuario no válido' });
    }

    try {
        const consulta = (sql, valores = []) => db.promise().query(sql, valores).then(([filas]) => filas);

        const clientes = await consulta(
            `SELECT id_cliente AS id, nombre, apellidos, correo, telefono, direccion
             FROM clientes WHERE id_usuario = ? AND activo = TRUE LIMIT 1`, [idUsuario]
        );
        if (!clientes.length) {
            return res.status(404).json({ success: false, mensaje: 'Tu cuenta no está ligada a un cliente activo. Comunícate con el despacho.' });
        }
        const cliente = clientes[0];

        const proyectos = await consulta(
            `SELECT p.id_proyecto AS id, p.nombre, p.descripcion, p.direccion_obra AS ubicacion,
                    CASE p.estado
                        WHEN 'Finalizado' THEN 'Completado'
                        WHEN 'En progreso' THEN 'En proceso'
                        WHEN 'Planeacion' THEN 'Pendiente'
                        ELSE p.estado
                    END AS estado,
                    p.fecha_inicio, p.fecha_fin_estimada AS fecha_fin, p.porcentaje_avance,
                    COALESCE(CONCAT(a.nombre, ' ', a.apellidos), '') AS arquitecto,
                    a.correo AS arquitecto_correo, a.telefono AS arquitecto_telefono
             FROM proyectos p
             LEFT JOIN usuarios a ON a.id_usuario = p.id_arquitecto
             WHERE p.id_cliente = ?
             ORDER BY FIELD(p.estado, 'En progreso', 'Pausado', 'Planeacion', 'Finalizado', 'Cancelado'), p.id_proyecto DESC`,
            [cliente.id]
        );

        const ids = proyectos.map(p => p.id);
        if (!ids.length) {
            return res.json({ success: true, cliente, proyectos: [], obras: [], evidencias: [], pagos: [], contratos: [], cotizaciones: [] });
        }

        const [obras, evidencias, pagos, contratos, cotizaciones] = await Promise.all([
            consulta(
                `SELECT id_obra AS id, id_proyecto, nombre, descripcion, estado, fecha_inicio,
                        fecha_fin_estimada, fecha_fin_real, porcentaje_avance
                 FROM obras WHERE id_proyecto IN (?) ORDER BY id_proyecto, id_obra`, [ids]
            ),
            consulta(
                `SELECT e.id_evidencia AS id, o.id_proyecto, e.id_obra, o.nombre AS obra,
                        e.tipo, e.archivo, e.descripcion, e.fecha
                 FROM evidencias e JOIN obras o ON o.id_obra = e.id_obra
                 WHERE o.id_proyecto IN (?)
                 ORDER BY e.fecha DESC, e.id_evidencia DESC LIMIT 60`, [ids]
            ),
            consulta(
                `SELECT id_pago AS id, id_proyecto, fecha, concepto, monto, metodo_pago, estado
                 FROM pagos WHERE id_proyecto IN (?) AND estado <> 'Cancelado'
                 ORDER BY fecha`, [ids]
            ),
            consulta(
                `SELECT id_contrato AS id, id_proyecto, numero_contrato, fecha_firma, fecha_inicio, fecha_fin, monto, estado
                 FROM contratos WHERE id_proyecto IN (?) AND estado IN ('Activo', 'Finalizado')`, [ids]
            ),
            consulta(
                `SELECT id_cotizacion AS id, id_proyecto, folio, fecha, vigencia, total, estado
                 FROM cotizaciones WHERE id_proyecto IN (?) AND estado IN ('Enviada', 'Aceptada')
                 ORDER BY fecha DESC`, [ids]
            )
        ]);

        const numero = (filas, campos) => filas.map(f => {
            const copia = { ...f };
            for (const c of campos) copia[c] = Number(copia[c] || 0);
            return copia;
        });

        return res.json({
            success: true,
            cliente,
            proyectos: numero(proyectos, ['porcentaje_avance']),
            obras: numero(obras, ['porcentaje_avance']),
            evidencias,
            pagos: numero(pagos, ['monto']),
            contratos: numero(contratos, ['monto']),
            cotizaciones: numero(cotizaciones, ['total'])
        });
    } catch (error) {
        console.error('Error al cargar el portal del cliente:', error);
        return res.status(500).json({ success: false, mensaje: 'No se pudo cargar la información de tu proyecto' });
    }
});

module.exports = router;