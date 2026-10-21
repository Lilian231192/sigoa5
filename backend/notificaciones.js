/**
 * NOTIFICACIONES DE SIGOA
 * ------------------------------------------------------------------
 * - Guarda cada notificación en la tabla `notificaciones` (historial de la campanita).
 * - La envía como notificación PUSH a todos los dispositivos del usuario
 *   (tabla `suscripciones_push`) usando el protocolo Web Push con llaves VAPID.
 * - Cada hora revisa pagos y obras para mandar recordatorios y alertas.
 *
 * Las rutas solo llaman a `eventos.algo(...)`; aquí se decide a quién
 * le llega, qué dice y a qué pantalla lleva al tocarla.
 * Si algo falla, NUNCA rompe la operación principal (solo se registra en consola).
 */
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');

const sql = db.promise();

// ============================================================
// 1. LLAVES VAPID
// Identifican a nuestro servidor ante los servicios de push
// (Google, Mozilla, Apple). Se leen de variables de entorno; si no
// existen, se generan una sola vez y se guardan en vapid-keys.json.
// ============================================================
const ARCHIVO_LLAVES = path.join(__dirname, 'vapid-keys.json');

function cargarLlaves() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_LLAVES, 'utf8'));
  } catch {
    const llaves = webpush.generateVAPIDKeys();
    fs.writeFileSync(ARCHIVO_LLAVES, JSON.stringify(llaves, null, 2));
    console.log('🔑 Llaves VAPID nuevas guardadas en backend/vapid-keys.json');
    return llaves;
  }
}

const llaves = cargarLlaves();
webpush.setVapidDetails(
  process.env.VAPID_CONTACTO || 'mailto:admin@sigoa.com',
  llaves.publicKey,
  llaves.privateKey
);

const llavePublica = () => llaves.publicKey;

// ============================================================
// 2. TABLAS (se crean solas al arrancar el servidor)
// ============================================================
async function prepararTablas() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id_notificacion INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      tipo VARCHAR(30) NOT NULL,
      titulo VARCHAR(120) NOT NULL,
      mensaje VARCHAR(255) NOT NULL,
      url VARCHAR(255),
      clave VARCHAR(120) NULL,
      cantidad INT NOT NULL DEFAULT 1,
      leida BOOLEAN NOT NULL DEFAULT FALSE,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_notificacion_clave (id_usuario, clave),
      INDEX idx_notificacion_usuario (id_usuario, leida, fecha),
      FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
    ) DEFAULT CHARSET = utf8mb4`);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS suscripciones_push (
      id_suscripcion INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario INT NOT NULL,
      endpoint VARCHAR(500) CHARACTER SET ascii NOT NULL,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(100) NOT NULL,
      fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_suscripcion_endpoint (endpoint),
      FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
    ) DEFAULT CHARSET = utf8mb4`);
}

// ============================================================
// 3. ENVIAR
// ============================================================

/** Lo que recibe el Service Worker de Angular (formato de ngsw) */
function cargaPush({ titulo, mensaje, url, tipo, id }) {
  return JSON.stringify({
    notification: {
      title: titulo,
      body: mensaje,
      icon: 'icons/icon-192x192.png',
      badge: 'icons/icon-96x96.png',
      lang: 'es-MX',
      tag: `sigoa-${tipo}-${id}`,
      renotify: true,
      data: {
        id,
        url,
        // Al tocarla: si SIGOA está abierta la enfoca y navega; si no, la abre
        onActionClick: {
          default: { operation: 'navigateLastFocusedOrOpen', url }
        }
      }
    }
  });
}

/** Manda el push a todos los dispositivos del usuario y limpia los que ya no existen */
async function enviarPush(idUsuario, datos) {
  const [suscripciones] = await sql.query(
    'SELECT id_suscripcion, endpoint, p256dh, auth FROM suscripciones_push WHERE id_usuario = ?',
    [idUsuario]
  );
  const carga = cargaPush(datos);
  await Promise.all(suscripciones.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        carga,
        { TTL: 60 * 60 * 24, urgency: 'normal' }
      );
    } catch (error) {
      // 404/410 = el usuario quitó el permiso o desinstaló: se borra la suscripción
      if (error.statusCode === 404 || error.statusCode === 410) {
        await sql.query('DELETE FROM suscripciones_push WHERE id_suscripcion = ?', [s.id_suscripcion]);
      } else {
        console.error('Push no enviado:', error.statusCode || '', error.body || error.message);
      }
    }
  }));
  return suscripciones.length;
}

/**
 * Crea la notificación para cada usuario y la manda por push.
 * - `clave`: si ya existe una notificación con esa clave para el usuario, no se repite
 *   (sirve para los recordatorios automáticos).
 * - `agrupar`: si hay una sin leer con esa clave, se actualiza en vez de crear otra
 *   (ej. "3 fotos nuevas" en lugar de 3 notificaciones).
 */
async function notificar(idsUsuarios, { tipo, titulo, mensaje, url = null, clave = null, agrupar = null }) {
  const ids = [...new Set((idsUsuarios || []).filter(Boolean))];
  for (const idUsuario of ids) {
    try {
      let id;
      let datos = { tipo, titulo, mensaje, url };

      if (agrupar) {
        const [previas] = await sql.query(
          `SELECT id_notificacion, cantidad FROM notificaciones
           WHERE id_usuario = ? AND clave = ? AND leida = FALSE`,
          [idUsuario, agrupar.clave]
        );
        if (previas.length) {
          const cantidad = previas[0].cantidad + 1;
          datos = { ...datos, ...agrupar.varias(cantidad) };
          id = previas[0].id_notificacion;
          await sql.query(
            'UPDATE notificaciones SET titulo = ?, mensaje = ?, cantidad = ?, fecha = NOW() WHERE id_notificacion = ?',
            [datos.titulo, datos.mensaje, cantidad, id]
          );
        } else {
          // La anterior ya se leyó: se le quita la clave para empezar un grupo nuevo
          await sql.query('UPDATE notificaciones SET clave = NULL WHERE id_usuario = ? AND clave = ?', [idUsuario, agrupar.clave]);
          clave = agrupar.clave;
        }
      }

      if (!id) {
        const [resultado] = await sql.query(
          `INSERT IGNORE INTO notificaciones (id_usuario, tipo, titulo, mensaje, url, clave)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [idUsuario, tipo, datos.titulo, datos.mensaje, url, clave]
        );
        if (!resultado.affectedRows) continue; // ya se había mandado esa (misma clave)
        id = resultado.insertId;
      }

      await enviarPush(idUsuario, { ...datos, id });
    } catch (error) {
      console.error('No se pudo notificar al usuario', idUsuario, error.message);
    }
  }
}

// ============================================================
// 4. ¿A QUIÉN LE LLEGA?
// ============================================================
async function datosProyecto(idProyecto) {
  const [filas] = await sql.query(
    `SELECT p.id_proyecto, p.nombre, p.id_arquitecto, c.id_usuario AS id_usuario_cliente
     FROM proyectos p JOIN clientes c ON c.id_cliente = p.id_cliente
     WHERE p.id_proyecto = ?`,
    [idProyecto]
  );
  return filas[0] || null;
}

async function datosObra(idObra) {
  const [filas] = await sql.query(
    `SELECT o.id_obra, o.nombre, o.porcentaje_avance, o.estado, o.id_proyecto,
            p.nombre AS proyecto, p.id_arquitecto, c.id_usuario AS id_usuario_cliente
     FROM obras o
     JOIN proyectos p ON p.id_proyecto = o.id_proyecto
     JOIN clientes c ON c.id_cliente = p.id_cliente
     WHERE o.id_obra = ?`,
    [idObra]
  );
  return filas[0] || null;
}

async function administradores() {
  const [filas] = await sql.query('SELECT id_usuario FROM usuarios WHERE id_rol = 1 AND activo = TRUE');
  return filas.map((f) => f.id_usuario);
}

const dinero = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });
const fechaCorta = (d) => new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
/** AAAA-MM-DD con la hora local del servidor (no UTC, para que "hoy" sea hoy en México) */
const diaLocal = (d) => {
  const f = new Date(d);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};

/** Ejecuta sin bloquear la respuesta de la ruta y sin romperla nunca */
const enSegundoPlano = (tarea) => () => {
  setImmediate(() => tarea().catch((e) => console.error('Notificación:', e.message)));
};

// ============================================================
// 5. EVENTOS (los llaman las rutas)
// ============================================================
const eventos = {
  /** Se guardó una obra: avisa avance al cliente y, si terminó, al cliente y al admin */
  obraActualizada: (idObra, antes) => enSegundoPlano(async () => {
    const o = await datosObra(idObra);
    if (!o || !antes) return;
    const avance = Math.round(Number(o.porcentaje_avance));
    const avanceAntes = Math.round(Number(antes.porcentaje_avance));
    const termino = (o.estado === 'Finalizada' && antes.estado !== 'Finalizada') || (avance >= 100 && avanceAntes < 100);

    if (termino) {
      await notificar([o.id_usuario_cliente], {
        tipo: 'terminada', url: '/cliente',
        titulo: '¡Obra terminada! 🎉',
        mensaje: `${o.nombre} de ${o.proyecto} quedó terminada.`
      });
      await notificar(await administradores(), {
        tipo: 'terminada', url: '/admin/obras',
        titulo: 'Obra terminada',
        mensaje: `${o.nombre} (${o.proyecto}) llegó al 100%.`
      });
    } else if (avance > avanceAntes) {
      await notificar([o.id_usuario_cliente], {
        tipo: 'avance', url: '/cliente',
        titulo: 'Tu obra avanzó',
        mensaje: `${o.nombre} avanzó a ${avance}% · ${o.proyecto}`
      });
    }
  })(),

  /** El arquitecto subió fotos/videos: se agrupan en una sola notificación */
  evidenciaSubida: (idObra, tipo) => enSegundoPlano(async () => {
    const o = await datosObra(idObra);
    if (!o) return;
    const que = tipo === 'Video' ? 'un video nuevo' : tipo === 'Otro' ? 'un archivo nuevo' : 'una foto nueva';
    await notificar([o.id_usuario_cliente], {
      tipo: 'fotos', url: '/cliente',
      titulo: 'Nuevas fotos del avance',
      mensaje: `Hay ${que} de ${o.nombre} · ${o.proyecto}`,
      agrupar: {
        clave: `fotos-obra-${idObra}`,
        varias: (n) => ({ mensaje: `Hay ${n} archivos nuevos del avance de ${o.nombre} · ${o.proyecto}` })
      }
    });
  })(),

  /** El admin marcó una cotización como Enviada */
  cotizacionEnviada: (idCotizacion) => enSegundoPlano(async () => {
    const [filas] = await sql.query('SELECT folio, total, vigencia, id_proyecto FROM cotizaciones WHERE id_cotizacion = ?', [idCotizacion]);
    if (!filas.length) return;
    const c = filas[0];
    const p = await datosProyecto(c.id_proyecto);
    if (!p) return;
    await notificar([p.id_usuario_cliente], {
      tipo: 'cotizacion', url: '/cliente',
      titulo: 'Tienes una cotización por revisar',
      mensaje: `${c.folio} · ${dinero(c.total)}${c.vigencia ? ` · válida hasta el ${fechaCorta(c.vigencia)}` : ''}`
    });
  })(),

  /** Se registró un pago como Pagado */
  pagoRegistrado: (idPago) => enSegundoPlano(async () => {
    const [filas] = await sql.query('SELECT monto, concepto, id_proyecto FROM pagos WHERE id_pago = ?', [idPago]);
    if (!filas.length) return;
    const pg = filas[0];
    const p = await datosProyecto(pg.id_proyecto);
    if (!p) return;
    await notificar([p.id_usuario_cliente], {
      tipo: 'pago', url: '/cliente',
      titulo: 'Recibimos tu pago',
      mensaje: `${dinero(pg.monto)} · ${pg.concepto}. ¡Gracias!`
    });
  })(),

  /** Al arquitecto le asignaron un proyecto */
  proyectoAsignado: (idProyecto, idArquitecto) => enSegundoPlano(async () => {
    if (!idArquitecto) return;
    const p = await datosProyecto(idProyecto);
    if (!p) return;
    await notificar([idArquitecto], {
      tipo: 'asignacion', url: '/arquitecto/proyectos',
      titulo: 'Te asignaron un proyecto',
      mensaje: `Ahora estás a cargo de ${p.nombre}.`
    });
  })()
};

// ============================================================
// 6. REVISIÓN AUTOMÁTICA (al arrancar y cada hora)
// La `clave` evita que el mismo recordatorio llegue dos veces.
// ============================================================
async function revisarPendientes() {
  // Cliente: pagos que vencen en los próximos 3 días
  const [porVencer] = await sql.query(`
    SELECT pg.id_pago, pg.monto, pg.fecha, pg.concepto, c.id_usuario
    FROM pagos pg
    JOIN proyectos p ON p.id_proyecto = pg.id_proyecto
    JOIN clientes c ON c.id_cliente = p.id_cliente
    WHERE pg.estado = 'Pendiente' AND pg.fecha BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)`);
  for (const pg of porVencer) {
    await notificar([pg.id_usuario], {
      tipo: 'recordatorio', url: '/cliente',
      titulo: 'Tu próximo pago se acerca',
      mensaje: `${dinero(pg.monto)} · ${pg.concepto} · vence el ${fechaCorta(pg.fecha)}`,
      clave: `pago-por-vencer-${pg.id_pago}-${diaLocal(pg.fecha)}`
    });
  }

  // Admin: pagos vencidos sin registrar
  const [vencidos] = await sql.query(`
    SELECT pg.id_pago, pg.monto, pg.fecha, p.nombre AS proyecto
    FROM pagos pg JOIN proyectos p ON p.id_proyecto = pg.id_proyecto
    WHERE pg.estado = 'Pendiente' AND pg.fecha < CURDATE()`);
  if (vencidos.length) {
    const admins = await administradores();
    for (const pg of vencidos) {
      await notificar(admins, {
        tipo: 'vencido', url: '/admin/pagos',
        titulo: 'Pago vencido',
        mensaje: `${pg.proyecto} · ${dinero(pg.monto)} · venció el ${fechaCorta(pg.fecha)}`,
        clave: `pago-vencido-${pg.id_pago}-${diaLocal(pg.fecha)}`
      });
    }
  }

  // Arquitecto: obras que llegaron a su fecha de entrega sin terminar
  const [obras] = await sql.query(`
    SELECT o.id_obra, o.nombre, o.porcentaje_avance, o.fecha_fin_estimada, p.id_arquitecto
    FROM obras o JOIN proyectos p ON p.id_proyecto = o.id_proyecto
    WHERE o.estado NOT IN ('Finalizada', 'Cancelada') AND o.porcentaje_avance < 100
      AND o.fecha_fin_estimada <= CURDATE() AND p.id_arquitecto IS NOT NULL`);
  for (const o of obras) {
    const vence = diaLocal(o.fecha_fin_estimada);
    const hoy = diaLocal(new Date());
    await notificar([o.id_arquitecto], {
      tipo: 'vencido', url: '/arquitecto/obras',
      titulo: vence === hoy ? 'Una obra vence hoy' : 'Obra con entrega atrasada',
      mensaje: `${o.nombre} va en ${Math.round(o.porcentaje_avance)}% · entrega ${fechaCorta(o.fecha_fin_estimada)}`,
      clave: `obra-vence-${o.id_obra}-${vence}`
    });
  }
}

/** Se llama una vez desde server.js */
async function iniciar() {
  try {
    await prepararTablas();
    await revisarPendientes();
    setInterval(() => revisarPendientes().catch((e) => console.error('Revisión de pendientes:', e.message)), 60 * 60 * 1000);
    console.log('🔔 Notificaciones listas');
  } catch (error) {
    console.error('No se pudieron preparar las notificaciones:', error.message);
  }
}

module.exports = { iniciar, notificar, enviarPush, eventos, llavePublica };