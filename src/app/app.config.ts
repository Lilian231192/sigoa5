import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  isDevMode
} from '@angular/core';

import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';

import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {

  providers: [

    provideBrowserGlobalErrorListeners(),

    // Al cambiar de pantalla, la nueva empieza desde arriba
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),

    provideHttpClient(),

    // Hidratación: Angular toma el HTML que mandó el servidor (SSR) sin volver a dibujarlo.
    // Event Replay: si el usuario escribe o da clic antes de que cargue, esa acción no se pierde.
    provideClientHydration(withEventReplay()),

    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

  ],

};