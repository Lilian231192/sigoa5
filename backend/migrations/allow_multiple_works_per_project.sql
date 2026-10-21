-- Ejecutar una vez sobre la base SIGOA existente para permitir varias obras por proyecto.
SET @indice_unico_obras_proyecto = (
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'obras'
      AND COLUMN_NAME = 'id_proyecto'
      AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
    HAVING COUNT(*) = 1
    LIMIT 1
);

SET @sql_quitar_indice_unico = IF(
    @indice_unico_obras_proyecto IS NULL,
    'SELECT ''La relación ya permite varias obras por proyecto'' AS resultado',
    CONCAT('ALTER TABLE `obras` DROP INDEX `', @indice_unico_obras_proyecto, '`')
);

PREPARE quitar_indice_unico FROM @sql_quitar_indice_unico;
EXECUTE quitar_indice_unico;
DEALLOCATE PREPARE quitar_indice_unico;
