import {
  AfterContentInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ComponentRef,
  ElementRef,
  EventEmitter,
  Inject,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  Optional,
  Output,
  ViewChild,
  ViewContainerRef,
  ViewEncapsulation,
} from '@angular/core';
import { Directionality } from '@angular/cdk/bidi';
import { BooleanInput, coerceBooleanProperty } from '@angular/cdk/coercion';
import { ESCAPE, hasModifierKey, UP_ARROW } from '@angular/cdk/keycodes';
import {
  FlexibleConnectedPositionStrategy,
  Overlay,
  OverlayConfig,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { _getFocusedElementPierceShadowDom } from '@angular/cdk/platform';
import { CanColor, mixinColor, ThemePalette } from '@angular/material/core';
import { MAT_DATEPICKER_SCROLL_STRATEGY } from '@angular/material/datepicker';
import { merge, Subject, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { DatetimeAdapter } from '@ng-matero/extensions/core';
import { MtxCalendarView, MtxCalendar } from './calendar';
import { createMissingDateImplError } from './datetimepicker-errors';
import { MtxDatetimepickerFilterType } from './datetimepicker-filtertype';
import { MtxDatetimepickerInput } from './datetimepicker-input';
import { mtxDatetimepickerAnimations } from './datetimepicker-animations';

/** Used to generate a unique ID for each datetimepicker instance. */
let datetimepickerUid = 0;

export type MtxDatetimepickerType = 'date' | 'time' | 'month' | 'year' | 'datetime';

export type MtxDatetimepickerMode = 'auto' | 'portrait' | 'landscape';

// Boilerplate for applying mixins to MtxColorpickerContent.
/** @docs-private */
const _MtxDatetimepickerContentBase = mixinColor(
  class {
    constructor(public _elementRef: ElementRef) {}
  }
);

/**
 * Component used as the content for the datetimepicker dialog and popup. We use this instead of
 * using MtxCalendar directly as the content so we can control the initial focus. This also gives us
 * a place to put additional features of the popup that are not part of the calendar itself in the
 * future. (e.g. confirmation buttons).
 * @docs-private
 */
@Component({
  selector: 'mtx-datetimepicker-content',
  templateUrl: 'datetimepicker-content.html',
  styleUrls: ['datetimepicker-content.scss'],
  host: {
    'class': 'mtx-datetimepicker-content',
    '[class.mtx-datetimepicker-content-touch]': 'datetimepicker?.touchUi',
    '[attr.mode]': 'datetimepicker.mode',
    '[@transformPanel]': '_animationState',
    '(@transformPanel.done)': '_animationDone.next()',
  },
  animations: [
    mtxDatetimepickerAnimations.transformPanel,
    mtxDatetimepickerAnimations.fadeInCalendar,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  inputs: ['color'],
})
export class MtxDatetimepickerContent<D>
  extends _MtxDatetimepickerContentBase
  implements OnInit, AfterContentInit, OnDestroy, CanColor
{
  @ViewChild(MtxCalendar, { static: true }) _calendar!: MtxCalendar<D>;

  datetimepicker!: MtxDatetimepicker<D>;

  /** Whether the datetimepicker is above or below the input. */
  _isAbove!: boolean;

  /** Current state of the animation. */
  _animationState!: 'enter-dropdown' | 'enter-dialog' | 'void';

  /** Emits when an animation has finished. */
  readonly _animationDone = new Subject<void>();

  constructor(elementRef: ElementRef, private _changeDetectorRef: ChangeDetectorRef) {
    super(elementRef);
  }

  ngOnInit() {
    this._animationState = this.datetimepicker.touchUi ? 'enter-dialog' : 'enter-dropdown';
  }

  ngAfterContentInit() {
    this._calendar._focusActiveCell();
  }

  _startExitAnimation() {
    this._animationState = 'void';
    this._changeDetectorRef.markForCheck();
  }

  ngOnDestroy() {
    this._animationDone.complete();
  }
}

@Component({
  selector: 'mtx-datetimepicker',
  exportAs: 'mtxDatetimepicker',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  preserveWhitespaces: false,
})
export class MtxDatetimepicker<D> implements OnDestroy {
  /** Active multi year view when click on year. */
  @Input()
  get multiYearSelector(): boolean {
    return this._multiYearSelector;
  }
  set multiYearSelector(value: boolean) {
    this._multiYearSelector = coerceBooleanProperty(value);
  }
  private _multiYearSelector = false;

  /** if true change the clock to 12 hour format. */
  @Input()
  get twelvehour(): boolean {
    return this._twelvehour;
  }
  set twelvehour(value: boolean) {
    this._twelvehour = coerceBooleanProperty(value);
  }
  private _twelvehour = false;

  /** The view that the calendar should start in. */
  @Input() startView: MtxCalendarView = 'month';

  @Input() mode: MtxDatetimepickerMode = 'auto';

  @Input() timeInterval: number = 1;

  @Input() ariaNextMonthLabel = 'Next month';
  @Input() ariaPrevMonthLabel = 'Previous month';
  @Input() ariaNextYearLabel = 'Next year';
  @Input() ariaPrevYearLabel = 'Previous year';

  /** Prevent user to select same date time */
  @Input() preventSameDateTimeSelection = false;

  /**
   * Emits new selected date when selected date changes.
   * @deprecated Switch to the `dateChange` and `dateInput` binding on the input element.
   */
  @Output() selectedChanged = new EventEmitter<D>();

  /** Classes to be passed to the date picker panel. Supports the same syntax as `ngClass`. */
  @Input() panelClass!: string | string[];

  /** Emits when the datetimepicker has been opened. */
  @Output('opened') openedStream: EventEmitter<void> = new EventEmitter<void>();

  /** Emits when the datetimepicker has been closed. */
  @Output('closed') closedStream: EventEmitter<void> = new EventEmitter<void>();

  /** Emits when the view has been changed. */
  @Output() viewChanged: EventEmitter<MtxCalendarView> = new EventEmitter<MtxCalendarView>();

  /** Whether the calendar is open. */
  opened = false;

  /** The id for the datetimepicker calendar. */
  id = `mtx-datetimepicker-${datetimepickerUid++}`;

  /** Color palette to use on the datetimepicker's calendar. */
  @Input()
  get color(): ThemePalette {
    return (
      this._color ||
      (this.datetimepickerInput ? this.datetimepickerInput.getThemePalette() : undefined)
    );
  }
  set color(value: ThemePalette) {
    this._color = value;
  }
  private _color: ThemePalette;

  /** The input element this datetimepicker is associated with. */
  datetimepickerInput!: MtxDatetimepickerInput<D>;

  /** Emits when the datetimepicker is disabled. */
  _disabledChange = new Subject<boolean>();

  private _validSelected: D | null = null;

  /** A reference to the overlay into which we've rendered the calendar. */
  private _overlayRef!: OverlayRef | null;

  /** Reference to the component instance rendered in the overlay. */
  private _componentRef!: ComponentRef<MtxDatetimepickerContent<D>> | null;

  /** The element that was focused before the datetimepicker was opened. */
  private _focusedElementBeforeOpen: HTMLElement | null = null;

  /** Unique class that will be added to the backdrop so that the test harnesses can look it up. */
  private _backdropHarnessClass = `${this.id}-backdrop`;

  private _inputStateChanges = Subscription.EMPTY;

  constructor(
    private _overlay: Overlay,
    private _ngZone: NgZone,
    private _viewContainerRef: ViewContainerRef,
    @Inject(MAT_DATEPICKER_SCROLL_STRATEGY) private _scrollStrategy: any,
    @Optional() private _dateAdapter: DatetimeAdapter<D>,
    @Optional() private _dir: Directionality
  ) {
    if (!this._dateAdapter) {
      throw createMissingDateImplError('DateAdapter');
    }
  }

  /** The date to open the calendar to initially. */
  @Input()
  get startAt(): D | null {
    // If an explicit startAt is set we start there, otherwise we start at whatever the currently
    // selected value is.
    return this._startAt || (this.datetimepickerInput ? this.datetimepickerInput.value : null);
  }
  set startAt(date: D | null) {
    this._startAt = this._dateAdapter.getValidDateOrNull(date);
  }
  private _startAt!: D | null;

  @Input()
  get openOnFocus(): boolean {
    return this._openOnFocus;
  }
  set openOnFocus(value: boolean) {
    this._openOnFocus = coerceBooleanProperty(value);
  }
  private _openOnFocus!: boolean;

  @Input()
  get type() {
    return this._type;
  }
  set type(value: MtxDatetimepickerType) {
    this._type = value || 'date';
  }
  private _type: MtxDatetimepickerType = 'date';

  /**
   * Whether the calendar UI is in touch mode. In touch mode the calendar opens in a dialog rather
   * than a popup and elements have more padding to allow for bigger touch targets.
   */
  @Input()
  get touchUi(): boolean {
    return this._touchUi;
  }
  set touchUi(value: boolean) {
    this._touchUi = coerceBooleanProperty(value);
  }
  private _touchUi = false;

  /** Whether the datetimepicker pop-up should be disabled. */
  @Input()
  get disabled(): boolean {
    return this._disabled === undefined && this.datetimepickerInput
      ? this.datetimepickerInput.disabled
      : !!this._disabled;
  }
  set disabled(value: boolean) {
    const newValue = coerceBooleanProperty(value);

    if (newValue !== this._disabled) {
      this._disabled = newValue;
      this._disabledChange.next(newValue);
    }
  }
  private _disabled!: boolean;

  /** The currently selected date. */
  get _selected(): D | null {
    return this._validSelected;
  }

  set _selected(value: D | null) {
    this._validSelected = value;
  }

  /** The minimum selectable date. */
  get _minDate(): D | null {
    return this.datetimepickerInput && this.datetimepickerInput.min;
  }

  /** The maximum selectable date. */
  get _maxDate(): D | null {
    return this.datetimepickerInput && this.datetimepickerInput.max;
  }

  get _dateFilter(): (date: D | null, type: MtxDatetimepickerFilterType) => boolean {
    return this.datetimepickerInput && this.datetimepickerInput._dateFilter;
  }

  _viewChanged(type: MtxCalendarView): void {
    this.viewChanged.emit(type);
  }

  ngOnDestroy() {
    this._destroyOverlay();
    this.close();
    this._inputStateChanges.unsubscribe();
    this._disabledChange.complete();
  }

  /**
   * TODO: use model
   * Selects the given date
   */
  _select(date: D): void {
    const oldValue = this._selected;
    this._selected = date;
    if (!this._dateAdapter.sameDatetime(oldValue, this._selected)) {
      this.selectedChanged.emit(date);
    }
  }

  /**
   * Register an input with this datetimepicker.
   * @param input The datetimepicker input to register with this datetimepicker.
   */
  _registerInput(input: MtxDatetimepickerInput<D>): void {
    if (this.datetimepickerInput) {
      throw Error('A MtxDatetimepicker can only be associated with a single input.');
    }
    this.datetimepickerInput = input;
    this._inputStateChanges = this.datetimepickerInput._valueChange.subscribe(
      (value: D | null) => (this._selected = value)
    );
  }

  /** Open the calendar. */
  open(): void {
    if (this.opened || this.disabled) {
      return;
    }
    if (!this.datetimepickerInput) {
      throw Error('Attempted to open an MtxDatetimepicker with no associated input.');
    }

    this._focusedElementBeforeOpen = _getFocusedElementPierceShadowDom();
    this._openOverlay();
    this.opened = true;
    this.openedStream.emit();
  }

  /** Close the calendar. */
  close(): void {
    if (!this.opened) {
      return;
    }

    if (this._componentRef) {
      this._destroyOverlay();
    }

    const completeClose = () => {
      // The `_opened` could've been reset already if
      // we got two events in quick succession.
      if (this.opened) {
        this.opened = false;
        this.closedStream.emit();
        this._focusedElementBeforeOpen = null;
      }
    };

    if (
      this._focusedElementBeforeOpen &&
      typeof this._focusedElementBeforeOpen.focus === 'function'
    ) {
      // Because IE moves focus asynchronously, we can't count on it being restored before we've
      // marked the datetimepicker as closed. If the event fires out of sequence and the element
      // that we're refocusing opens the datetimepicker on focus, the user could be stuck with not
      // being able to close the calendar at all. We work around it by making the logic, that marks
      // the datetimepicker as closed, async as well.
      this._focusedElementBeforeOpen.focus();
      setTimeout(completeClose);
    } else {
      completeClose();
    }
  }

  /**
   * TODO: add datetimepicker color
   * Forwards relevant values from the datetimepicker to the
   * datetimepicker content inside the overlay.
   */
  protected _forwardContentValues(instance: MtxDatetimepickerContent<D>) {
    instance.datetimepicker = this;
  }

  /** Opens the overlay with the calendar. */
  private _openOverlay(): void {
    this._destroyOverlay();

    const isDialog = this.touchUi;
    const labelId = this.datetimepickerInput.getOverlayLabelId();

    const portal = new ComponentPortal<MtxDatetimepickerContent<D>>(
      MtxDatetimepickerContent,
      this._viewContainerRef
    );
    const overlayRef = (this._overlayRef = this._overlay.create(
      new OverlayConfig({
        positionStrategy: isDialog ? this._getDialogStrategy() : this._getDropdownStrategy(),
        hasBackdrop: true,
        backdropClass: [
          isDialog ? 'cdk-overlay-dark-backdrop' : 'mat-overlay-transparent-backdrop',
          this._backdropHarnessClass,
        ],
        direction: this._dir,
        scrollStrategy: isDialog ? this._overlay.scrollStrategies.block() : this._scrollStrategy(),
        panelClass: `mtx-datetimepicker-${isDialog ? 'dialog' : 'popup'}`,
      })
    ));

    const overlayElement = overlayRef.overlayElement;
    overlayElement.setAttribute('role', 'dialog');

    if (labelId) {
      overlayElement.setAttribute('aria-labelledby', labelId);
    }

    if (isDialog) {
      overlayElement.setAttribute('aria-modal', 'true');
    }

    this._getCloseStream(overlayRef).subscribe(event => {
      if (event) {
        event.preventDefault();
      }
      this.close();
    });

    this._componentRef = overlayRef.attach(portal);
    this._forwardContentValues(this._componentRef.instance);

    // Update the position once the calendar has rendered. Only relevant in dropdown mode.
    if (!isDialog) {
      this._ngZone.onStable.pipe(take(1)).subscribe(() => overlayRef.updatePosition());
    }
  }

  /** Destroys the current overlay. */
  private _destroyOverlay() {
    if (this._overlayRef) {
      this._overlayRef.dispose();
      this._overlayRef = this._componentRef = null;
    }
  }

  /** Gets a position strategy that will open the calendar as a dropdown. */
  private _getDialogStrategy() {
    return this._overlay.position().global().centerHorizontally().centerVertically();
  }

  /** Gets a position strategy that will open the calendar as a dropdown. */
  private _getDropdownStrategy() {
    const strategy = this._overlay
      .position()
      .flexibleConnectedTo(this.datetimepickerInput.getConnectedOverlayOrigin())
      .withTransformOriginOn('.mtx-datetimepicker-content')
      .withFlexibleDimensions(false)
      .withViewportMargin(8)
      .withLockedPosition();

    return this._setConnectedPositions(strategy);
  }

  /**
   * TODO: `xPosition` and `yPosition`
   * Sets the positions of the datetimepicker in dropdown mode based on the current configuration.
   */
  private _setConnectedPositions(strategy: FlexibleConnectedPositionStrategy) {
    return strategy.withPositions([
      {
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top',
      },
      {
        originX: 'start',
        originY: 'top',
        overlayX: 'start',
        overlayY: 'bottom',
      },
      {
        originX: 'end',
        originY: 'bottom',
        overlayX: 'end',
        overlayY: 'top',
      },
      {
        originX: 'end',
        originY: 'top',
        overlayX: 'end',
        overlayY: 'bottom',
      },
    ]);
  }

  /** Gets an observable that will emit when the overlay is supposed to be closed. */
  private _getCloseStream(overlayRef: OverlayRef) {
    return merge(
      overlayRef.backdropClick(),
      overlayRef.detachments(),
      overlayRef.keydownEvents().pipe(
        filter(event => {
          // Closing on alt + up is only valid when there's an input associated with the datetimepicker.
          return (
            (event.keyCode === ESCAPE && !hasModifierKey(event)) ||
            (this.datetimepickerInput &&
              hasModifierKey(event, 'altKey') &&
              event.keyCode === UP_ARROW)
          );
        })
      )
    );
  }

  static ngAcceptInputType_multiYearSelector: BooleanInput;
  static ngAcceptInputType_twelvehour: BooleanInput;
  static ngAcceptInputType_touchUi: BooleanInput;
  static ngAcceptInputType_disabled: BooleanInput;
  static ngAcceptInputType_openOnFocus: BooleanInput;
}
