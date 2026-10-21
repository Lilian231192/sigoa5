const express = require('express');
const router = express.Router();
const db = require('../db');
const { eventos } = require('../notificaciones');

const metodos = ['Efectivo', 'Transferencia', 'Tarjeta', 'Otro'];
const estados = ['Pendiente', 'Pagado', 'Cancelado'];
const selectBase = `SELECT pg.id_pago AS id, pg.id_proyecto, p.nombre AS proyecto,
    CONCAT(cl.nombre, ' ', cl.apellidos) AS cliente, pg.fecha, pg.concepto,
    pg.monto, pg.metodo_pago, pg.referencia, pg.estado, pg.observaciones
    FROM pagos pg JOIN proyectos p ON p.id_proyecto = pg.id_proyecto
    JOIN clientes cl ON cl.id_cliente = p.id_cliente`;

router.get('/opciones', (req, res) => {
    db.query('SELECT id_proyecto AS id, nombre FROM proyectos ORDER BY nombre', (error, proyectos) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'Error al cargar proyectos' });
        res.json({ success: true, proyectos });
    });
});

router.get('/', (req, res) => {
    db.query(`${selectBase} ORDER BY pg.fecha DESC, pg.id_pago DESC`, (error, pagos) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'Error al cargar pagos' });
        res.json({ success: true, pagos: pagos.map(p => ({ ...p, monto: Number(p.monto || 0) })) });
    });
});

function validar(body, res) {
    const monto = Number(body.monto);
    if (!body.id_proyecto || !body.concepto?.trim() || !body.fecha || !Number.isFinite(monto) || monto < 0 || !metodos.includes(body.metodo_pago) || !estados.includes(body.estado)) {
        res.status(400).json({ success: false, mensaje: 'Completa proyecto, concepto, fecha, monto, método y estado válidos' });
        return null;
    }
    return [body.id_proyecto, body.fecha, body.concepto.trim(), monto, body.metodo_pago, body.referencia || null, body.estado, body.observaciones || null];
}

router.post('/', (req, res) => {
    const valores = validar(req.body, res);
    if (!valores) return;
    db.query('INSERT INTO pagos (id_proyecto, fecha, concepto, monto, metodo_pago, referencia, estado, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', valores, (error, result) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'No se pudo registrar el pago' });
        if (req.body.estado === 'Pagado') eventos.pagoRegistrado(result.insertId);
        res.status(201).json({ success: true, id: result.insertId, mensaje: 'Pago registrado' });
    });
});

router.put('/:id', (req, res) => {
    const valores = validar(req.body, res);
    if (!valores) return;
    // Se lee el estado anterior: solo se avisa al cliente cuando el pago pasa a "Pagado"
    db.query('SELECT estado FROM pagos WHERE id_pago=?', [req.params.id], (errorAntes, filasAntes) => {
    const estadoAntes = filasAntes?.[0]?.estado;
    db.query('UPDATE pagos SET id_proyecto=?, fecha=?, concepto=?, monto=?, metodo_pago=?, referencia=?, estado=?, observaciones=? WHERE id_pago=?', [...valores, req.params.id], (error, result) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'No se pudo actualizar el pago' });
        if (!result.affectedRows) return db.query('SELECT id_pago FROM pagos WHERE id_pago=?', [req.params.id], (lookupError, rows) => {
            if (lookupError) return res.status(500).json({ success: false, mensaje: 'Error al verificar el pago' });
            if (!rows.length) return res.status(404).json({ success: false, mensaje: 'Pago no encontrado' });
            res.json({ success: true, mensaje: 'Pago actualizado' });
        });
        if (req.body.estado === 'Pagado' && estadoAntes !== 'Pagado') eventos.pagoRegistrado(Number(req.params.id));
        res.json({ success: true, mensaje: 'Pago actualizado' });
    });
    });
});

router.delete('/:id', (req, res) => {
    db.query('DELETE FROM pagos WHERE id_pago=?', [req.params.id], (error, result) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'No se pudo eliminar el pago' });
        if (!result.affectedRows) return res.status(404).json({ success: false, mensaje: 'Pago no encontrado' });
        res.json({ success: true, mensaje: 'Pago eliminado' });
    });
});

module.exports = router;