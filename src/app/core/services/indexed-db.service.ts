import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class IndexedDbService {

  private dbName = 'SIGOA_DB';
  private storeName = 'resumen';

  private abrirDB(): Promise<IDBDatabase> {

    return new Promise((resolve, reject) => {

      if (typeof indexedDB === 'undefined') {
        reject('IndexedDB no está disponible');
        return;
      }

      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {

        const db = request.result;

        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }

      };

      request.onsuccess = () => {

        console.log('IndexedDB abierta correctamente');

        resolve(request.result);

      };

      request.onerror = () => {

        reject(request.error);

      };

    });

  }

  guardarResumen(data: any): Promise<void> {

    return this.abrirDB().then(db => {

      return new Promise((resolve, reject) => {

        const transaction = db.transaction(
          this.storeName,
          'readwrite'
        );

        const store = transaction.objectStore(
          this.storeName
        );

        store.put(data, 'admin-resumen');

        transaction.oncomplete = () => {

          console.log(
            'RESUMEN GUARDADO EN INDEXEDDB'
          );

          resolve();

        };

        transaction.onerror = () => {

          reject(transaction.error);

        };

      });

    });

  }

  obtenerResumen(): Promise<any> {

    return this.abrirDB().then(db => {

      return new Promise((resolve, reject) => {

        const transaction = db.transaction(
          this.storeName,
          'readonly'
        );

        const store = transaction.objectStore(
          this.storeName
        );

        const request = store.get('admin-resumen');

        request.onsuccess = () => {

          console.log(
            'RESUMEN OBTENIDO DE INDEXEDDB:',
            request.result
          );

          resolve(request.result);

        };

        request.onerror = () => {

          reject(request.error);

        };

      });

    });

  }

}