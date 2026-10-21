CREATE DATABASE IF NOT EXISTS sigoa;
USE sigoa;

-- =========================================
-- TABLA ROLES
-- =========================================

CREATE TABLE roles (
    id_rol INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(30) NOT NULL UNIQUE
);

-- =========================================
-- TABLA USUARIOS
-- =========================================

CREATE TABLE usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    id_rol INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    correo VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (id_rol)
        REFERENCES roles(id_rol)
);

-- =========================================
-- TABLA CLIENTES
-- =========================================

CREATE TABLE clientes (
    id_cliente INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    correo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(255),
    fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- =========================================
-- TABLA PROYECTOS
-- =========================================

CREATE TABLE proyectos (
    id_proyecto INT AUTO_INCREMENT PRIMARY KEY,
    id_cliente INT NOT NULL,
    id_arquitecto INT,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    direccion_obra VARCHAR(255),
    fecha_inicio DATE,
    fecha_fin_estimada DATE,

    estado ENUM(
        'Planeacion',
        'En progreso',
        'Pausado',
        'Finalizado',
        'Cancelado'
    ) NOT NULL DEFAULT 'Planeacion',

    porcentaje_avance DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (id_cliente)
        REFERENCES clientes(id_cliente),

    FOREIGN KEY (id_arquitecto)
        REFERENCES usuarios(id_usuario)
        ON DELETE SET NULL,

    CHECK (porcentaje_avance >= 0 AND porcentaje_avance <= 100)
);

-- =========================================
-- TABLA OBRAS
-- =========================================

CREATE TABLE obras (
    id_obra INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,

    estado ENUM(
        'Pendiente',
        'En construccion',
        'Pausada',
        'Finalizada',
        'Cancelada'
    ) NOT NULL DEFAULT 'Pendiente',

    fecha_inicio DATE,
    fecha_fin_estimada DATE,
    fecha_fin_real DATE,
    porcentaje_avance DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    FOREIGN KEY (id_proyecto)
        REFERENCES proyectos(id_proyecto)
        ON DELETE CASCADE,

    CHECK (porcentaje_avance >= 0 AND porcentaje_avance <= 100)
);

-- =========================================
-- TABLA COTIZACIONES
-- =========================================

CREATE TABLE cotizaciones (
    id_cotizacion INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL,
    folio VARCHAR(50) NOT NULL UNIQUE,
    fecha DATE NOT NULL,
    vigencia DATE,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    iva DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    estado ENUM(
        'Borrador',
        'Enviada',
        'Aceptada',
        'Rechazada',
        'Vencida'
    ) NOT NULL DEFAULT 'Borrador',

    observaciones TEXT,

    FOREIGN KEY (id_proyecto)
        REFERENCES proyectos(id_proyecto)
        ON DELETE CASCADE
);

-- =========================================
-- TABLA DETALLES DE COTIZACION
-- =========================================

CREATE TABLE cotizacion_detalles (
    id_detalle INT AUTO_INCREMENT PRIMARY KEY,
    id_cotizacion INT NOT NULL,
    concepto VARCHAR(255) NOT NULL,
    descripcion TEXT,
    cantidad DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    unidad VARCHAR(30),
    precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    importe DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    FOREIGN KEY (id_cotizacion)
        REFERENCES cotizaciones(id_cotizacion)
        ON DELETE CASCADE
);

-- =========================================
-- TABLA CONTRATOS
-- =========================================

CREATE TABLE contratos (
    id_contrato INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL,
    numero_contrato VARCHAR(50) NOT NULL UNIQUE,
    fecha_firma DATE,
    fecha_inicio DATE,
    fecha_fin DATE,
    monto DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    estado ENUM(
        'Borrador',
        'Activo',
        'Finalizado',
        'Cancelado'
    ) NOT NULL DEFAULT 'Borrador',

    archivo VARCHAR(255),
    observaciones TEXT,

    FOREIGN KEY (id_proyecto)
        REFERENCES proyectos(id_proyecto)
        ON DELETE CASCADE
);

-- =========================================
-- TABLA ETAPAS
-- =========================================

CREATE TABLE etapas (
    id_etapa INT AUTO_INCREMENT PRIMARY KEY,
    id_obra INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    orden INT NOT NULL DEFAULT 1,
    porcentaje_avance DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    estado ENUM(
        'Pendiente',
        'En progreso',
        'Completada',
        'Cancelada'
    ) NOT NULL DEFAULT 'Pendiente',

    fecha_inicio DATE,
    fecha_fin_estimada DATE,
    fecha_fin_real DATE,

    FOREIGN KEY (id_obra)
        REFERENCES obras(id_obra)
        ON DELETE CASCADE,

    CHECK (porcentaje_avance >= 0 AND porcentaje_avance <= 100)
);

-- =========================================
-- TABLA ACTIVIDADES
-- =========================================

CREATE TABLE actividades (
    id_actividad INT AUTO_INCREMENT PRIMARY KEY,
    id_etapa INT NOT NULL,
    id_responsable INT,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    fecha_inicio DATE,
    fecha_fin_estimada DATE,
    fecha_fin_real DATE,

    prioridad ENUM(
        'Baja',
        'Media',
        'Alta'
    ) NOT NULL DEFAULT 'Media',

    estado ENUM(
        'Pendiente',
        'En progreso',
        'Completada',
        'Cancelada'
    ) NOT NULL DEFAULT 'Pendiente',

    porcentaje_avance DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    FOREIGN KEY (id_etapa)
        REFERENCES etapas(id_etapa)
        ON DELETE CASCADE,

    FOREIGN KEY (id_responsable)
        REFERENCES usuarios(id_usuario)
        ON DELETE SET NULL,

    CHECK (porcentaje_avance >= 0 AND porcentaje_avance <= 100)
);

-- =========================================
-- TABLA AVANCES
-- =========================================

CREATE TABLE avances (
    id_avance INT AUTO_INCREMENT PRIMARY KEY,
    id_actividad INT NOT NULL,
    id_usuario INT NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    porcentaje DECIMAL(5,2) NOT NULL,
    descripcion TEXT NOT NULL,

    FOREIGN KEY (id_actividad)
        REFERENCES actividades(id_actividad)
        ON DELETE CASCADE,

    FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario),

    CHECK (porcentaje >= 0 AND porcentaje <= 100)
);

-- =========================================
-- TABLA COMENTARIOS
-- =========================================

CREATE TABLE comentarios (
    id_comentario INT AUTO_INCREMENT PRIMARY KEY,
    id_obra INT NOT NULL,
    id_usuario INT NOT NULL,
    comentario TEXT NOT NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (id_obra)
        REFERENCES obras(id_obra)
        ON DELETE CASCADE,

    FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
);

-- =========================================
-- TABLA EVIDENCIAS
-- =========================================

CREATE TABLE evidencias (
    id_evidencia INT AUTO_INCREMENT PRIMARY KEY,
    id_obra INT NOT NULL,
    id_actividad INT,
    id_usuario INT NOT NULL,

    tipo ENUM(
        'Fotografia',
        'Video',
        'Otro'
    ) NOT NULL DEFAULT 'Fotografia',

    archivo VARCHAR(255) NOT NULL,
    descripcion TEXT,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (id_obra)
        REFERENCES obras(id_obra)
        ON DELETE CASCADE,

    FOREIGN KEY (id_actividad)
        REFERENCES actividades(id_actividad)
        ON DELETE SET NULL,

    FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
);

-- =========================================
-- TABLA DOCUMENTOS
-- =========================================

CREATE TABLE documentos (
    id_documento INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL,
    id_usuario INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    tipo VARCHAR(50),
    archivo VARCHAR(255) NOT NULL,
    descripcion TEXT,
    fecha_subida DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    visible_cliente BOOLEAN NOT NULL DEFAULT TRUE,

    FOREIGN KEY (id_proyecto)
        REFERENCES proyectos(id_proyecto)
        ON DELETE CASCADE,

    FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
);

-- =========================================
-- TABLA PAGOS
-- =========================================

CREATE TABLE pagos (
    id_pago INT AUTO_INCREMENT PRIMARY KEY,
    id_proyecto INT NOT NULL,
    fecha DATE NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    monto DECIMAL(12,2) NOT NULL,

    metodo_pago ENUM(
        'Efectivo',
        'Transferencia',
        'Tarjeta',
        'Otro'
    ) NOT NULL,

    referencia VARCHAR(100),

    estado ENUM(
        'Pendiente',
        'Pagado',
        'Cancelado'
    ) NOT NULL DEFAULT 'Pendiente',

    observaciones TEXT,

    FOREIGN KEY (id_proyecto)
        REFERENCES proyectos(id_proyecto)
        ON DELETE CASCADE
);

-- =========================================
-- DATOS INICIALES
-- =========================================

INSERT INTO roles (nombre) VALUES
('Administrador'),
('Arquitecto'),
('Cliente');

INSERT INTO usuarios
(id_rol, nombre, apellidos, correo, password_hash, telefono)
VALUES
(1, 'Administrador', 'SIGOA',
 'admin@sigoa.com', 'CAMBIAR_HASH', '5555555555'),

(2, 'Arquitecto', 'SIGOA',
 'arquitecto@sigoa.com', 'CAMBIAR_HASH', '5555555556'),

(3, 'Cliente', 'Ejemplo',
 'cliente@sigoa.com', 'CAMBIAR_HASH', '5555555557');

INSERT INTO clientes
(id_usuario, nombre, apellidos, correo, telefono, direccion)
VALUES
(3, 'Cliente', 'Ejemplo',
 'cliente@sigoa.com', '5555555557',
 'Direccion de ejemplo');

-- =========================================
-- INDICES
-- =========================================

CREATE INDEX idx_proyectos_cliente
ON proyectos(id_cliente);

CREATE INDEX idx_proyectos_arquitecto
ON proyectos(id_arquitecto);

CREATE INDEX idx_obras_proyecto
ON obras(id_proyecto);

CREATE INDEX idx_cotizaciones_proyecto
ON cotizaciones(id_proyecto);

CREATE INDEX idx_contratos_proyecto
ON contratos(id_proyecto);

CREATE INDEX idx_etapas_obra
ON etapas(id_obra);

CREATE INDEX idx_actividades_etapa
ON actividades(id_etapa);

CREATE INDEX idx_avances_actividad
ON avances(id_actividad);

CREATE INDEX idx_documentos_proyecto
ON documentos(id_proyecto);

CREATE INDEX idx_pagos_proyecto
ON pagos(id_proyecto);

-- =========================================
-- VISTA DEL PORTAL DEL CLIENTE
-- =========================================

CREATE VIEW vista_portal_cliente AS
SELECT
    c.id_cliente,
    c.nombre AS cliente_nombre,
    c.apellidos AS cliente_apellidos,
    p.id_proyecto,
    p.nombre AS proyecto,
    p.estado AS estado_proyecto,
    p.porcentaje_avance,
    o.id_obra,
    o.nombre AS obra,
    o.estado AS estado_obra,
    o.porcentaje_avance AS avance_obra
FROM clientes c
INNER JOIN proyectos p
    ON p.id_cliente = c.id_cliente
LEFT JOIN obras o
    ON o.id_proyecto = p.id_proyecto;
