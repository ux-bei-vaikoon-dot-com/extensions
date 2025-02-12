import { Component } from '@angular/core';
import { MtxLoaderModule } from '@dcnx/mat-extensions/loader';

@Component({
  selector: 'loader-example',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  imports: [MtxLoaderModule],
})
export class AppComponent {}
