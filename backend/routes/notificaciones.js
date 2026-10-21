const express = require('express');
const router = express.Router();
const db = require('../db');
const { llavePublica, notificar } = require('../notificaciones');

const sql = db.promise();

// Llave pública VAPID: Angular la necesita para suscribir el dispositivo
router.get('/llave-publica', (req, res) => {
  res.json({ success: true, llave: llavePublica() });
});

// Guardar el dispositivo del usuario (cuando acepta las notificaciones)
router.post('/suscribir', async (req, res) => {
  const { id_usuario, suscripcion } = req.body;
  const endpoint = suscripcion?.endpoint;
  const p256dh = suscripcion?.keys?.p256dh;
  const auth = suscripcion?.keys?.auth;
  if (!id_usuario || !endpoint || !p256dh || !auth) {
    return res.status(400).json({ success: false, mensaje: 'Suscripción incompleta' });
  }
  try {
    // Si el dispositivo ya estaba registrado (aunque sea con otro usuario), se actualiza
    await sql.query(
      `INSERT INTO suscripciones_push (id_usuario, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id_usuario = VALUES(id_usuario), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [id_usuario, endpoint, p256dh, auth]
    );
    res.status(201).json({ success: true, mensaje: 'Notificaciones activadas en este dispositivo' });
  } catch (error) {
    console.error('Error al guardar suscripción:', error.message);
    res.status(500).json({ success: false, mensaje: 'No se pudo activar las notificaciones' });
  }
});

// Quitar el dispositivo (al cerrar sesión)
router.post('/desuscribir', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ success: false, mensaje: 'Falta el dispositivo' });
  try {
    await sql.query('DELETE FROM suscripciones_push WHERE endpoint = ?', [endpoint]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'No se pudo desactivar' });
  }
});

// Notificación de prueba (para la demo y para revisar que todo funciona)
router.post('/prueba', async (req, res) => {
  const { id_usuario } = req.body;
  if (!id_usuario) return res.status(400).json({ success: false, mensaje: 'Falta el usuario' });
  try {
    const [[usuario]] = await sql.query(
      `SELECT u.nombre, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id_rol = u.id_rol WHERE u.id_usuario = ?`,
      [id_usuario]
    );
    if (!usuario) return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
    const inicio = { 1: '/admin', 2: '/arquitecto', 3: '/cliente' }[req.body.id_rol] || '/';
    await notificar([id_usuario], {
      tipo: 'prueba', url: inicio,
      titulo: '¡Las notificaciones funcionan! 🔔',
      mensaje: `Hola, ${usuario.nombre}. Así te avisaremos de lo importante en SIGOA.`
    });
    res.json({ success: true, mensaje: 'Notificación de prueba enviada' });
  } catch (error) {
    console.error('Error en notificación de prueba:', error.message);
    res.status(500).json({ success: false, mensaje: 'No se pudo enviar la prueba' });
  }
});

// Marcar todas como leídas
router.patch('/usuario/:id_usuario/leidas', async (req, res) => {
  try {
    await sql.query('UPDATE notificaciones SET leida = TRUE WHERE id_usuario = ? AND leida = FALSE', [req.params.id_usuario]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'No se pudieron marcar como leídas' });
  }
});

// Marcar una como leída
router.patch('/:id/leida', async (req, res) => {
  try {
    await sql.query('UPDATE notificaciones SET leida = TRUE WHERE id_notificacion = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'No se pudo marcar como leída' });
  }
});

// Eliminar todas las notificaciones del usuario
router.delete('/usuario/:id_usuario', async (req, res) => {
  try {
    const [resultado] = await sql.query('DELETE FROM notificaciones WHERE id_usuario = ?', [req.params.id_usuario]);
    res.json({ success: true, eliminadas: resultado.affectedRows, mensaje: 'Notificaciones eliminadas' });
  } catch (error) {
    console.error('Error al eliminar notificaciones:', error.message);
    res.status(500).json({ success: false, mensaje: 'No se pudieron eliminar las notificaciones' });
  }
});

// Eliminar una notificación
router.delete('/:id', async (req, res) => {
  try {
    const [resultado] = await sql.query('DELETE FROM notificaciones WHERE id_notificacion = ?', [req.params.id]);
    if (!resultado.affectedRows) return res.status(404).json({ success: false, mensaje: 'Notificación no encontrada' });
    res.json({ success: true, mensaje: 'Notificación eliminada' });
  } catch (error) {
    console.error('Error al eliminar notificación:', error.message);
    res.status(500).json({ success: false, mensaje: 'No se pudo eliminar la notificación' });
  }
});

// Historial de la campanita: las últimas 30 + cuántas faltan por leer
router.get('/usuario/:id_usuario', async (req, res) => {
  try {
    const [notificaciones] = await sql.query(
      `SELECT id_notificacion AS id, tipo, titulo, mensaje, url, leida, fecha
       FROM notificaciones WHERE id_usuario = ?
       ORDER BY fecha DESC, id_notificacion DESC LIMIT 30`,
      [req.params.id_usuario]
    );
    const [[{ total }]] = await sql.query(
      'SELECT COUNT(*) AS total FROM notificaciones WHERE id_usuario = ? AND leida = FALSE',
      [req.params.id_usuario]
    );
    res.json({
      success: true,
      noLeidas: Number(total),
      notificaciones: notificaciones.map((n) => ({ ...n, leida: !!n.leida }))
    });
  } catch (error) {
    console.error('Error al cargar notificaciones:', error.message);
    res.status(500).json({ success: false, mensaje: 'No se pudieron cargar las notificaciones' });
  }
});

module.exports = router;