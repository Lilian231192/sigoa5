const express = require('express');
const router = express.Router();

const conexion = require('../db');

router.post('/login', (req, res) => {

    const { correo, password } = req.body;

    if (!correo || !password) {
        return res.status(400).json({
            success: false,
            mensaje: 'Correo y contraseña son obligatorios'
        });
    }

    const sql = `
        SELECT
            u.id_usuario,
            u.id_rol,
            u.nombre,
            u.apellidos,
            u.correo,
            u.password_hash,
            u.telefono,
            u.activo,
            r.nombre AS rol
        FROM usuarios u
        INNER JOIN roles r
            ON u.id_rol = r.id_rol
        WHERE u.correo = ?
        LIMIT 1
    `;

    conexion.query(sql, [correo], (error, resultados) => {

        if (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                mensaje: 'Error en el servidor'
            });
        }

        if (resultados.length === 0) {
            return res.status(401).json({
                success: false,
                mensaje: 'Correo o contraseña incorrectos'
            });
        }

        const usuario = resultados[0];

        if (!usuario.activo) {
            return res.status(403).json({
                success: false,
                mensaje: 'El usuario está desactivado'
            });
        }

        if (password !== usuario.password_hash) {
            return res.status(401).json({
                success: false,
                mensaje: 'Correo o contraseña incorrectos'
            });
        }

        delete usuario.password_hash;

        res.json({
            success: true,
            mensaje: 'Inicio de sesión correcto',
            usuario: usuario
        });
    });
});

module.exports = router;