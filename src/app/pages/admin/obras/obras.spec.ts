import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Obras } from './obras';

describe('Obras', () => {
  let component: Obras;
  let fixture: ComponentFixture<Obras>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Obras],
    }).compileComponents();

    fixture = TestBed.createComponent(Obras);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
