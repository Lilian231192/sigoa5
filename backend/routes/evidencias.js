const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const { eventos } = require('../notificaciones');

const carpeta = path.join(__dirname, '..', 'uploads', 'evidencias');
const tiposMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'application/pdf': '.pdf' };
const tipos = ['Fotografia', 'Video', 'Otro'];

router.get('/opciones', (req, res) => {
    db.query('SELECT o.id_obra AS id, o.nombre, p.nombre AS proyecto FROM obras o JOIN proyectos p ON p.id_proyecto=o.id_proyecto ORDER BY o.nombre', (error, obras) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'Error al cargar obras' });
        res.json({ success: true, obras });
    });
});

router.get('/', (req, res) => {
    const filtro = req.query.id_obra ? 'WHERE e.id_obra = ?' : '';
    const parametros = req.query.id_obra ? [req.query.id_obra] : [];
    const sql = `SELECT e.id_evidencia AS id, e.id_obra, o.nombre AS obra, p.nombre AS proyecto,
        e.tipo, e.archivo, e.descripcion, e.fecha, e.id_usuario, CONCAT(u.nombre, ' ', u.apellidos) AS usuario
        FROM evidencias e JOIN obras o ON o.id_obra=e.id_obra JOIN proyectos p ON p.id_proyecto=o.id_proyecto
        JOIN usuarios u ON u.id_usuario=e.id_usuario ${filtro} ORDER BY e.fecha DESC, e.id_evidencia DESC`;
    db.query(sql, parametros, (error, evidencias) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'Error al cargar evidencias' });
        res.json({ success: true, evidencias });
    });
});

router.post('/', async (req, res) => {
    const { id_obra, id_usuario, tipo, descripcion, archivo_nombre, archivo_mime, archivo_base64 } = req.body;
    if (!id_obra || !id_usuario || !tipos.includes(tipo) || !archivo_nombre || !tiposMime[archivo_mime] || typeof archivo_base64 !== 'string') {
        return res.status(400).json({ success: false, mensaje: 'Selecciona obra, tipo y un archivo permitido' });
    }
    const data = archivo_base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) return res.status(400).json({ success: false, mensaje: 'El archivo debe pesar máximo 10 MB' });
    const nombreSeguro = `${crypto.randomUUID()}${tiposMime[archivo_mime]}`;
    try {
        await fs.promises.mkdir(carpeta, { recursive: true });
        await fs.promises.writeFile(path.join(carpeta, nombreSeguro), buffer, { flag: 'wx' });
    } catch (error) {
        console.error('Error guardando evidencia:', error);
        return res.status(500).json({ success: false, mensaje: 'No se pudo guardar el archivo' });
    }
    const rutaPublica = `/uploads/evidencias/${nombreSeguro}`;
    db.query('INSERT INTO evidencias (id_obra, id_usuario, tipo, archivo, descripcion) VALUES (?, ?, ?, ?, ?)',
        [id_obra, id_usuario, tipo, rutaPublica, descripcion || null], (error, result) => {
            if (error) {
                fs.promises.unlink(path.join(carpeta, nombreSeguro)).catch(() => {});
                console.error('Error registrando evidencia:', error);
                return res.status(500).json({ success: false, mensaje: 'No se pudo registrar la evidencia' });
            }
            eventos.evidenciaSubida(Number(id_obra), tipo);
            res.status(201).json({ success: true, id: result.insertId, mensaje: 'Evidencia subida correctamente' });
        });
});

router.delete('/:id', (req, res) => {
    db.query('SELECT archivo FROM evidencias WHERE id_evidencia=?', [req.params.id], (error, rows) => {
        if (error) return res.status(500).json({ success: false, mensaje: 'Error al buscar la evidencia' });
        if (!rows.length) return res.status(404).json({ success: false, mensaje: 'Evidencia no encontrada' });
        db.query('DELETE FROM evidencias WHERE id_evidencia=?', [req.params.id], (deleteError, result) => {
            if (deleteError) return res.status(500).json({ success: false, mensaje: 'No se pudo eliminar la evidencia' });
            const nombre = path.basename(rows[0].archivo);
            fs.promises.unlink(path.join(carpeta, nombre)).catch(() => {});
            res.json({ success: true, mensaje: 'Evidencia eliminada' });
        });
    });
});

module.exports = router;