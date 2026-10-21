const express = require('express');
const router = express.Router();
const db = require('../db');

const estadosPermitidos = ['Borrador', 'Activo', 'Finalizado', 'Cancelado'];

const consultaBase = `
    SELECT c.id_contrato AS id, c.id_proyecto, p.nombre AS proyecto,
           CONCAT(cl.nombre, ' ', cl.apellidos) AS cliente,
           cl.correo AS cliente_correo, cl.telefono AS cliente_telefono,
           cl.direccion AS cliente_direccion,
           c.numero_contrato, c.fecha_firma, c.fecha_inicio, c.fecha_fin,
           c.monto, c.estado, c.archivo, c.observaciones
    FROM contratos c
    INNER JOIN proyectos p ON p.id_proyecto = c.id_proyecto
    INNER JOIN clientes cl ON cl.id_cliente = p.id_cliente
`;

router.get('/opciones', (req, res) => {
    db.query('SELECT id_proyecto AS id, nombre FROM proyectos ORDER BY nombre', (error, proyectos) => {
        if (error) {
            console.error('Error al cargar proyectos para contratos:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener proyectos' });
        }
        return res.json({ success: true, proyectos });
    });
});

router.get('/', (req, res) => {
    db.query(`${consultaBase} ORDER BY c.id_contrato DESC`, (error, contratos) => {
        if (error) {
            console.error('Error al obtener contratos:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener los contratos' });
        }
        return res.json({ success: true, contratos: contratos.map(c => ({ ...c, monto: Number(c.monto || 0) })) });
    });
});

router.post('/', (req, res) => {
    const { id_proyecto, numero_contrato, fecha_firma, fecha_inicio, fecha_fin, monto, estado, archivo, observaciones } = req.body;
    const montoNumero = Number(monto ?? 0);
    if (!id_proyecto || !numero_contrato?.trim() || !estadosPermitidos.includes(estado || 'Borrador')) {
        return res.status(400).json({ success: false, mensaje: 'Proyecto, número de contrato y estado válido son obligatorios' });
    }
    if (!Number.isFinite(montoNumero) || montoNumero < 0) {
        return res.status(400).json({ success: false, mensaje: 'El monto debe ser un número igual o mayor a cero' });
    }
    const sql = `INSERT INTO contratos
        (id_proyecto, numero_contrato, fecha_firma, fecha_inicio, fecha_fin, monto, estado, archivo, observaciones)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const valores = [id_proyecto, numero_contrato.trim(), fecha_firma || null, fecha_inicio || null,
        fecha_fin || null, montoNumero, estado || 'Borrador', archivo || null, observaciones || null];
    db.query(sql, valores, (error, resultado) => {
        if (error) {
            console.error('Error al crear contrato:', error);
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, mensaje: 'Ese número de contrato ya está registrado' });
            if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, mensaje: 'El proyecto seleccionado no existe' });
            return res.status(500).json({ success: false, mensaje: 'No se pudo crear el contrato' });
        }
        return res.status(201).json({ success: true, id: resultado.insertId, mensaje: 'Contrato creado correctamente' });
    });
});

router.get('/:id', (req, res) => {
    db.query(`${consultaBase} WHERE c.id_contrato = ?`, [req.params.id], (error, filas) => {
        if (error) {
            console.error('Error al obtener contrato:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener el contrato' });
        }
        if (!filas.length) return res.status(404).json({ success: false, mensaje: 'Contrato no encontrado' });
        filas[0].monto = Number(filas[0].monto || 0);
        return res.json({ success: true, contrato: filas[0] });
    });
});

router.put('/:id', (req, res) => {
    const { id_proyecto, numero_contrato, fecha_firma, fecha_inicio, fecha_fin, monto, estado, archivo, observaciones } = req.body;
    const montoNumero = Number(monto);
    if (!id_proyecto || !numero_contrato?.trim() || !estadosPermitidos.includes(estado)) {
        return res.status(400).json({ success: false, mensaje: 'Proyecto, número de contrato y estado válido son obligatorios' });
    }
    if (!Number.isFinite(montoNumero) || montoNumero < 0) {
        return res.status(400).json({ success: false, mensaje: 'El monto debe ser un número igual o mayor a cero' });
    }
    const sql = `UPDATE contratos SET id_proyecto = ?, numero_contrato = ?, fecha_firma = ?,
        fecha_inicio = ?, fecha_fin = ?, monto = ?, estado = ?, archivo = ?, observaciones = ?
        WHERE id_contrato = ?`;
    const valores = [id_proyecto, numero_contrato.trim(), fecha_firma || null, fecha_inicio || null,
        fecha_fin || null, montoNumero, estado, archivo || null, observaciones || null, req.params.id];
    db.query(sql, valores, (error, resultado) => {
        if (error) {
            console.error('Error al actualizar contrato:', error);
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, mensaje: 'Ese número de contrato ya está registrado' });
            if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, mensaje: 'El proyecto seleccionado no existe' });
            return res.status(500).json({ success: false, mensaje: 'Error al actualizar el contrato' });
        }
        if (!resultado.affectedRows) {
            return db.query('SELECT id_contrato FROM contratos WHERE id_contrato = ?', [req.params.id], (lookupError, filas) => {
                if (lookupError) return res.status(500).json({ success: false, mensaje: 'Error al verificar el contrato' });
                if (!filas.length) return res.status(404).json({ success: false, mensaje: 'Contrato no encontrado' });
                return res.json({ success: true, mensaje: 'El contrato ya tenía esos datos' });
            });
        }
        return res.json({ success: true, mensaje: 'Contrato actualizado correctamente' });
    });
});

router.delete('/:id', (req, res) => {
    db.query('DELETE FROM contratos WHERE id_contrato = ?', [req.params.id], (error, resultado) => {
        if (error) {
            console.error('Error al eliminar contrato:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al eliminar el contrato' });
        }
        if (!resultado.affectedRows) return res.status(404).json({ success: false, mensaje: 'Contrato no encontrado' });
        return res.json({ success: true, mensaje: 'Contrato eliminado correctamente' });
    });
});

module.exports = router;
