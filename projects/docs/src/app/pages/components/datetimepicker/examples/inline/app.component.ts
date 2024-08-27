import { Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { provideNativeDatetimeAdapter } from '@dcnx/mat-extensions/core';
import { MtxDatetimepickerModule } from '@dcnx/mat-extensions/datetimepicker';

@Component({
  selector: 'datetimepicker-example',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  standalone: true,
  imports: [MatCardModule, MtxDatetimepickerModule],
  providers: [provideNativeDatetimeAdapter()],
})
export class AppComponent {
  selectedDate: Date | null = null;
  selectedTime: Date | null = null;
}
