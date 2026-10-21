import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API } from '../api';

export interface Usuario {
  id_usuario: number;
  id_rol: number;
  nombre: string;
  apellidos: string;
  correo: string;
  telefono: string;
  activo: boolean;
  rol: string;
}

export interface RespuestaLogin {
  success: boolean;
  mensaje: string;
  usuario?: Usuario;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private apiUrl = `${API}/auth`;

  constructor(private http: HttpClient) {}

  login(
    correo: string,
    password: string
  ): Observable<RespuestaLogin> {

    return this.http.post<RespuestaLogin>(
      `${this.apiUrl}/login`,
      {
        correo,
        password
      }
    );
  }
}