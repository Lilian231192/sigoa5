const express = require('express');
const router = express.Router();
const db = require('../db');
const { eventos } = require('../notificaciones');

// Proyectos que todavía pueden vincularse a una obra (o el de la obra editada).
router.get('/opciones', (req, res) => {
    const sql = `
        SELECT p.id_proyecto AS id, p.nombre
        FROM proyectos p
        ORDER BY p.nombre
    `;
    db.query(sql, (error, proyectos) => {
        if (error) {
            console.error('Error al obtener proyectos disponibles:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener proyectos disponibles' });
        }
        return res.json({ success: true, proyectos });
    });
});

// Listar obras.
router.get('/', (req, res) => {
    const sql = `
        SELECT o.id_obra AS id, o.id_proyecto, p.nombre AS proyecto,
               CONCAT(c.nombre, ' ', c.apellidos) AS cliente,
               o.nombre, o.descripcion, o.estado, o.fecha_inicio,
               o.fecha_fin_estimada, o.fecha_fin_real, o.porcentaje_avance
        FROM obras o
        INNER JOIN proyectos p ON p.id_proyecto = o.id_proyecto
        INNER JOIN clientes c ON c.id_cliente = p.id_cliente
        ORDER BY o.id_obra DESC
    `;
    db.query(sql, (error, obras) => {
        if (error) {
            console.error('Error al obtener obras:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener las obras' });
        }
        return res.json({ success: true, obras });
    });
});

// Crear obra vinculada a un proyecto.
router.post('/', (req, res) => {
    const { id_proyecto, nombre, descripcion, estado, fecha_inicio, fecha_fin_estimada, fecha_fin_real, porcentaje_avance } = req.body;
    const estados = ['Pendiente', 'En construccion', 'Pausada', 'Finalizada', 'Cancelada'];
    const avance = Number(porcentaje_avance ?? 0);
    if (!id_proyecto || !nombre?.trim() || !estados.includes(estado || 'Pendiente')) {
        return res.status(400).json({ success: false, mensaje: 'El proyecto, nombre y estado válido son obligatorios' });
    }
    if (!Number.isFinite(avance) || avance < 0 || avance > 100) {
        return res.status(400).json({ success: false, mensaje: 'El avance debe estar entre 0 y 100' });
    }
    const sql = `INSERT INTO obras (id_proyecto, nombre, descripcion, estado, fecha_inicio, fecha_fin_estimada, fecha_fin_real, porcentaje_avance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [id_proyecto, nombre.trim(), descripcion || null, estado || 'Pendiente', fecha_inicio || null, fecha_fin_estimada || null, fecha_fin_real || null, avance], (error, result) => {
        if (error) {
            console.error('Error al crear obra:', error);
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, mensaje: 'La obra contiene un valor duplicado' });
            if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ success: false, mensaje: 'El proyecto seleccionado no existe' });
            return res.status(500).json({ success: false, mensaje: 'No se pudo crear la obra' });
        }
        res.status(201).json({ success: true, id: result.insertId, mensaje: 'Obra creada correctamente' });
    });
});

// Obtener una obra por ID.
router.get('/:id', (req, res) => {
    const sql = `
        SELECT o.id_obra AS id, o.id_proyecto, p.nombre AS proyecto,
               CONCAT(c.nombre, ' ', c.apellidos) AS cliente,
               o.nombre, o.descripcion, o.estado, o.fecha_inicio,
               o.fecha_fin_estimada, o.fecha_fin_real, o.porcentaje_avance
        FROM obras o
        INNER JOIN proyectos p ON p.id_proyecto = o.id_proyecto
        INNER JOIN clientes c ON c.id_cliente = p.id_cliente
        WHERE o.id_obra = ?
    `;
    db.query(sql, [req.params.id], (error, filas) => {
        if (error) {
            console.error('Error al obtener obra:', error);
            return res.status(500).json({ success: false, mensaje: 'Error al obtener la obra' });
        }
        if (!filas.length) return res.status(404).json({ success: false, mensaje: 'Obra no encontrada' });
        return res.json({ success: true, obra: filas[0] });
    });
});

// Actualizar obra.
router.put('/:id', (req, res) => {
    const {
        id_proyecto, nombre, descripcion, estado, fecha_inicio,
        fecha_fin_estimada, fecha_fin_real, porcentaje_avance
    } = req.body;
    const estados = ['Pendiente', 'En construccion', 'Pausada', 'Finalizada', 'Cancelada'];
    const avance = Number(porcentaje_avance);

    if (!id_proyecto || !nombre || !estado || !estados.includes(estado)) {
        return res.status(400).json({ success: false, mensaje: 'El proyecto, el nombre y un estado válido son obligatorios' });
    }
    if (!Number.isFinite(avance) || avance < 0 || avance > 100) {
        return res.status(400).json({ success: false, mensaje: 'El avance debe estar entre 0 y 100' });
    }

    const sql = `
        UPDATE obras SET id_proyecto = ?, nombre = ?, descripcion = ?, estado = ?,
            fecha_inicio = ?, fecha_fin_estimada = ?, fecha_fin_real = ?, porcentaje_avance = ?
        WHERE id_obra = ?
    `;
    const valores = [
        id_proyecto, nombre.trim(), descripcion || null, estado,
        fecha_inicio || null, fecha_fin_estimada || null, fecha_fin_real || null,
        avance, req.params.id
    ];
    // Se leen el avance y estado anteriores para avisar al cliente si cambiaron
    db.query('SELECT porcentaje_avance, estado FROM obras WHERE id_obra = ?', [req.params.id], (errorAntes, filasAntes) => {
    const antes = filasAntes?.[0];

    db.query(sql, valores, (error, resultado) => {
        if (error) {
            console.error('Error al actualizar obra:', error);
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, mensaje: 'La obra contiene un valor duplicado' });
            if (error.code === 'ER_NO_REFERENCED_ROW_2') {
                return res.status(400).json({ success: false, mensaje: 'El proyecto seleccionado no existe' });
            }
            return res.status(500).json({ success: false, mensaje: 'Error al actualizar la obra' });
        }
        if (!resultado.affectedRows) {
            return db.query('SELECT id_obra FROM obras WHERE id_obra = ?', [req.params.id], (errorConsulta, filas) => {
                if (errorConsulta) return res.status(500).json({ success: false, mensaje: 'Error al verificar la obra' });
                if (!filas.length) return res.status(404).json({ success: false, mensaje: 'Obra no encontrada' });
                return res.json({ success: true, mensaje: 'La obra ya tenía esos datos' });
            });
        }
        eventos.obraActualizada(Number(req.params.id), antes);
        return res.json({ success: true, mensaje: 'Obra actualizada correctamente' });
    });
    });
});

// Eliminar obra.
router.delete('/:id', (req, res) => {
    db.query('DELETE FROM obras WHERE id_obra = ?', [req.params.id], (error, resultado) => {
        if (error) {
            console.error('Error al eliminar obra:', error);
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(409).json({ success: false, mensaje: 'No se puede eliminar la obra porque tiene registros relacionados' });
            }
            return res.status(500).json({ success: false, mensaje: 'Error al eliminar la obra' });
        }
        if (!resultado.affectedRows) return res.status(404).json({ success: false, mensaje: 'Obra no encontrada' });
        return res.json({ success: true, mensaje: 'Obra eliminada correctamente' });
    });
});

module.exports = router;