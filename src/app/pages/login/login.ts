import { Component, ChangeDetectorRef, Inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login implements OnInit {

  correo = '';
  password = '';
  mensaje = '';
  cargando = false;
  mostrarPassword = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  ngOnInit() {
    this.redirigirSegunRol();
  }

  redirigirSegunRol() {
    if (!isPlatformBrowser(this.platformId)) return;

    const usuarioGuardado = localStorage.getItem('usuario');
    if (!usuarioGuardado) return;

    try {
      const usuario = JSON.parse(usuarioGuardado);
      switch (usuario?.id_rol) {
        case 1: this.router.navigate(['/admin']); break;
        case 2: this.router.navigate(['/arquitecto']); break;
        case 3: this.router.navigate(['/cliente']); break;
        default: localStorage.removeItem('usuario'); break;
      }
    } catch (error) {
      console.error('Sesión inválida:', error);
      localStorage.removeItem('usuario');
    }
  }

  iniciarSesion() {
    if (!this.correo || !this.password) {
      this.mensaje = 'Completa todos los campos';
      this.cdr.detectChanges();
      return;
    }

    this.cargando = true;
    this.mensaje = '';
    this.cdr.detectChanges();

    this.authService.login(this.correo, this.password).subscribe({
      next: (respuesta) => {
        this.cargando = false;

        if (!respuesta.success) {
          this.mensaje = respuesta.mensaje;
          this.cdr.detectChanges();
          return;
        }

        localStorage.setItem('usuario', JSON.stringify(respuesta.usuario));
        this.redirigirSegunRol();
      },
      error: (error) => {
        console.error('Error de login:', error);
        this.cargando = false;

        if (error.status === 401) this.mensaje = 'Correo o contraseña incorrectos';
        else if (error.status === 403) this.mensaje = 'El usuario está desactivado';
        else if (error.status === 0) this.mensaje = 'No se pudo conectar con el servidor';
        else this.mensaje = 'Ocurrió un error al iniciar sesión';

        this.cdr.detectChanges();
      }
    });
  }
}
