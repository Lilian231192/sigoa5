const express = require('express');
const router = express.Router();
const conexion = require('../db');

router.get('/resumen', async (req, res) => {
    try {

        const [proyectos] = await conexion.promise().query(`
            SELECT
                COUNT(*) AS total,
                SUM(
                    CASE
                        WHEN estado = 'En progreso' THEN 1
                        ELSE 0
                    END
                ) AS enProgreso
            FROM proyectos
        `);

        const [obras] = await conexion.promise().query(`
            SELECT
                COUNT(*) AS total,
                SUM(
                    CASE
                        WHEN estado = 'En construccion' THEN 1
                        ELSE 0
                    END
                ) AS enConstruccion
            FROM obras
        `);

        const [cotizaciones] = await conexion.promise().query(`
            SELECT
                COUNT(*) AS total,
                SUM(
                    CASE
                        WHEN estado IN ('Borrador', 'Enviada') THEN 1
                        ELSE 0
                    END
                ) AS pendientes
            FROM cotizaciones
        `);

        const [contratos] = await conexion.promise().query(`
            SELECT
                COUNT(*) AS total,
                SUM(
                    CASE
                        WHEN estado = 'Activo' THEN 1
                        ELSE 0
                    END
                ) AS activos
            FROM contratos
        `);

        const [pagos] = await conexion.promise().query(`
            SELECT
                SUM(
                    CASE
                        WHEN estado = 'Pendiente' THEN 1
                        ELSE 0
                    END
                ) AS pendientes,

                COALESCE(
                    SUM(
                        CASE
                            WHEN estado = 'Pendiente' THEN monto
                            ELSE 0
                        END
                    ),
                    0
                ) AS montoPendiente

            FROM pagos
        `);

        const [avance] = await conexion.promise().query(`
            SELECT
                COALESCE(
                    AVG(porcentaje_avance),
                    0
                ) AS avancePromedio
            FROM obras
        `);

        res.json({
            success: true,

            proyectos: {
                total: Number(proyectos[0].total || 0),
                enProgreso: Number(proyectos[0].enProgreso || 0)
            },

            obras: {
                total: Number(obras[0].total || 0),
                enConstruccion: Number(obras[0].enConstruccion || 0)
            },

            cotizaciones: {
                total: Number(cotizaciones[0].total || 0),
                pendientes: Number(cotizaciones[0].pendientes || 0)
            },

            contratos: {
                total: Number(contratos[0].total || 0),
                activos: Number(contratos[0].activos || 0)
            },

            pagos: {
                pendientes: Number(pagos[0].pendientes || 0),
                montoPendiente: Number(pagos[0].montoPendiente || 0)
            },

            avancePromedio: Number(avance[0].avancePromedio || 0)
        });

    } catch (error) {

        console.error('Error en resumen:', error);

        res.status(500).json({
            success: false,
            mensaje: 'Error al obtener el resumen',
            error: error.message
        });
    }
});

module.exports = router;