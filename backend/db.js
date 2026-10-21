const mysql = require('mysql2');

const conexion = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sigoa',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // DECIMAL llega como número (75) y no como texto ("75.00")
    decimalNumbers: true
});

module.exports = conexion;