import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Proyectos } from './proyectos';

describe('Proyectos', () => {
  let component: Proyectos;
  let fixture: ComponentFixture<Proyectos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Proyectos, HttpClientTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(Proyectos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should open and close modal correctly', () => {
    const proyecto = {
      id: 1,
      nombre: 'Proyecto prueba',
      descripcion: 'Descripcion prueba',
      cliente: 'Cliente prueba',
      ubicacion: 'Ciudad prueba',
      estado: 'En proceso',
      fecha_inicio: '2026-01-01',
      fecha_fin: '2026-02-01',
    };

    component.verProyecto(proyecto as any);
    fixture.detectChanges();

    expect(component.mostrarModal).toBeTrue();
    expect(component.modoEdicion).toBeFalse();

    component.editarProyecto(proyecto as any);
    fixture.detectChanges();

    expect(component.mostrarModal).toBeTrue();
    expect(component.modoEdicion).toBeTrue();

    component.cerrarModal();
    fixture.detectChanges();

    expect(component.mostrarModal).toBeFalse();
  });
});
