const mysql = require('mysql2');

const conexion = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '12345678',
    database: 'sigoa',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // DECIMAL llega como número (75) y no como texto ("75.00")
    decimalNumbers: true
});

module.exports = conexion;