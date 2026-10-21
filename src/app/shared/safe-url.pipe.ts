import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Marca una URL como segura para usarla en un <iframe> (por ejemplo, ver un PDF de evidencia).
 * Uso: <iframe [src]="url | safeUrl"></iframe>
 * Solo debe usarse con archivos que vienen de nuestro propio servidor.
 */
@Pipe({ name: 'safeUrl', standalone: true })
export class SafeUrlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}
