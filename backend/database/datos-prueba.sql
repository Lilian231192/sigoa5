-- =========================================================
-- SIGOA · Datos de prueba (2 proyectos completos)
-- Crea: 2 clientes, 2 proyectos, 3 obras, 2 cotizaciones con conceptos,
--       2 contratos y 4 pagos. Usa al arquitecto de ejemplo (id_usuario = 2).
-- Ejecutar UNA sola vez (los folios y números de contrato no se pueden repetir).
-- =========================================================
SET NAMES utf8mb4;
USE sigoa;

-- ---------- Clientes ----------
INSERT INTO clientes (nombre, apellidos, correo, telefono, direccion)
VALUES ('María', 'Pérez Gómez', 'maria.perez@correo.com', '5512345678', 'Av. Juárez 120, Nicolás Romero, Edo. Méx.');
SET @cliente1 = LAST_INSERT_ID();

INSERT INTO clientes (nombre, apellidos, correo, telefono, direccion)
VALUES ('Carlos', 'López Ruiz', 'carlos.lopez@correo.com', '5587654321', 'Calle Hidalgo 45, Atizapán, Edo. Méx.');
SET @cliente2 = LAST_INSERT_ID();

-- ---------- Proyectos ----------
INSERT INTO proyectos (id_cliente, id_arquitecto, nombre, descripcion, direccion_obra, fecha_inicio, fecha_fin_estimada, estado, porcentaje_avance)
VALUES (@cliente1, 2, 'Casa Pérez', 'Vivienda de dos niveles con barda perimetral y cochera para dos autos.',
        'Av. Juárez 120, Nicolás Romero, Edo. Méx.', '2026-08-01', '2026-12-15', 'En progreso', 60);
SET @proyecto1 = LAST_INSERT_ID();

INSERT INTO proyectos (id_cliente, id_arquitecto, nombre, descripcion, direccion_obra, fecha_inicio, fecha_fin_estimada, estado, porcentaje_avance)
VALUES (@cliente2, 2, 'Residencia López', 'Remodelación de casa habitación: cocina integral y ampliación de recámara.',
        'Calle Hidalgo 45, Atizapán, Edo. Méx.', '2026-09-15', '2027-02-28', 'Planeacion', 10);
SET @proyecto2 = LAST_INSERT_ID();

-- ---------- Obras ----------
INSERT INTO obras (id_proyecto, nombre, descripcion, estado, fecha_inicio, fecha_fin_estimada, porcentaje_avance) VALUES
(@proyecto1, 'Casa principal', 'Cimentación, estructura, muros de block y losas.', 'En construccion', '2026-08-05', '2026-12-10', 55),
(@proyecto1, 'Barda perimetral', 'Barda de block de 2.5 m con castillos y portón.', 'En construccion', '2026-09-01', '2026-10-30', 75),
(@proyecto2, 'Cocina integral', 'Demolición, instalaciones y montaje de cocina.', 'Pendiente', '2026-10-28', '2027-01-15', 0);

-- ---------- Cotizaciones ----------
INSERT INTO cotizaciones (id_proyecto, folio, fecha, vigencia, subtotal, iva, total, estado, observaciones)
VALUES (@proyecto1, 'COT-2026-001', '2026-07-10', '2026-08-10', 850000.00, 136000.00, 986000.00, 'Aceptada',
        'Incluye materiales y mano de obra. No incluye acabados de lujo.');
SET @cot1 = LAST_INSERT_ID();

INSERT INTO cotizacion_detalles (id_cotizacion, concepto, descripcion, cantidad, unidad, precio_unitario, importe) VALUES
(@cot1, 'Cimentación', 'Zapatas corridas y cadena de desplante', 1, 'lote', 180000.00, 180000.00),
(@cot1, 'Estructura y muros', 'Castillos, trabes y muro de block', 1, 'lote', 420000.00, 420000.00),
(@cot1, 'Losas', 'Losa de vigueta y bovedilla', 120, 'm2', 2083.33, 250000.00);

INSERT INTO cotizaciones (id_proyecto, folio, fecha, vigencia, subtotal, iva, total, estado, observaciones)
VALUES (@proyecto2, 'COT-2026-002', '2026-09-05', '2026-10-31', 240000.00, 38400.00, 278400.00, 'Enviada',
        'Pendiente de respuesta del cliente.');
SET @cot2 = LAST_INSERT_ID();

INSERT INTO cotizacion_detalles (id_cotizacion, concepto, descripcion, cantidad, unidad, precio_unitario, importe) VALUES
(@cot2, 'Demolición', 'Retiro de cocina existente y escombro', 1, 'lote', 25000.00, 25000.00),
(@cot2, 'Cocina integral', 'Muebles, cubierta de cuarzo y tarja', 1, 'pieza', 165000.00, 165000.00),
(@cot2, 'Instalaciones', 'Hidráulica, gas y eléctrica', 1, 'lote', 50000.00, 50000.00);

-- ---------- Contratos ----------
INSERT INTO contratos (id_proyecto, numero_contrato, fecha_firma, fecha_inicio, fecha_fin, monto, estado, observaciones) VALUES
(@proyecto1, 'CTR-2026-001', '2026-07-20', '2026-08-01', '2026-12-15', 986000.00, 'Activo', 'Pagos en 4 parcialidades.'),
(@proyecto2, 'CTR-2026-002', NULL, '2026-10-28', '2027-02-28', 278400.00, 'Borrador', 'Se firma al aceptar la cotización.');

-- ---------- Pagos ----------
INSERT INTO pagos (id_proyecto, fecha, concepto, monto, metodo_pago, referencia, estado, observaciones) VALUES
(@proyecto1, '2026-07-25', 'Anticipo 30%', 295800.00, 'Transferencia', 'SPEI 4471829', 'Pagado', NULL),
(@proyecto1, '2026-09-25', 'Segundo pago 30%', 295800.00, 'Transferencia', 'SPEI 5520931', 'Pagado', NULL),
(@proyecto1, '2026-11-15', 'Tercer pago 20%', 197200.00, 'Transferencia', NULL, 'Pendiente', 'Al terminar losas.'),
(@proyecto2, '2026-10-30', 'Anticipo 50%', 139200.00, 'Efectivo', NULL, 'Pendiente', 'Al firmar contrato.');

SELECT 'Datos de prueba insertados correctamente' AS resultado;
