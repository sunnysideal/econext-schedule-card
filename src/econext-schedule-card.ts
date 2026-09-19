import { LitElement, html, nothing, type CSSResultGroup, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';

import type {
  HomeAssistant,
  EconextScheduleCardConfig,
  DayKey,
  DaySchedule,
} from './types';
import { combineAmPm, toggleBit } from './bitfield';
import {
  DAYS_ORDER,
  DAY_LABELS,
  SLOTS_PER_DAY,
  getCurrentSlotIndex,
  getCurrentDay,
  slotToTime,
  isAmSlot,
  slotToBitIndex,
  DEFAULT_ACTIVE_COLOR,
  DEFAULT_INACTIVE_COLOR,
} from './constants';

import { cardStyles } from './styles';

@customElement('econext-schedule-card')
export class EconextScheduleCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @state() private _config?: EconextScheduleCardConfig;
  @state() private _selectedDay: DayKey = getCurrentDay();
  @state() private _pendingValues: Map<string, number> = new Map();
  @state() private _errorEntityIds: Set<string> = new Set();

  private _debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _sendQueue: string[] = [];
  private _queueProcessing = false;
  private _inFlight: Map<string, number> = new Map();
  private _ackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static readonly ACK_TIMEOUT_MS = 15000;

  private static readonly DEBOUNCE_MS = 500;
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_BASE_MS = 1000;
  private static readonly INTER_CALL_DELAY_MS = 3000;

  static get styles(): CSSResultGroup {
    return cardStyles;
  }

  public setConfig(config: EconextScheduleCardConfig): void {
    if (!config.schedule_entity_prefix) {
      throw new Error('Please define schedule_entity_prefix');
    }

    this._config = {
      editable: true,
      show_time_labels: true,
      highlight_current_day: true,
      highlight_current_slot: true,
      active_color: DEFAULT_ACTIVE_COLOR,
      inactive_color: DEFAULT_INACTIVE_COLOR,
      ...config,
    };
  }

  public getCardSize(): number {
    // Title + tabs + schedule row + time labels + padding
    return this._config?.title ? 9 : 8;
  }

  public getLayoutOptions() {
    return {
      grid_rows: this._config?.title ? 9 : 8,
      grid_min_rows: this._config?.title ? 9 : 8,
    };
  }

  public static getStubConfig(): Partial<EconextScheduleCardConfig> {
    return {
      schedule_entity_prefix: 'number.econext_dhw_schedule',
      title: 'Schedule',
    };
  }

  private _getEntityId(day: DayKey, period: 'am' | 'pm'): string {
    return `${this._config!.schedule_entity_prefix}_${day}_${period}`;
  }

  private _getEntityValue(entityId: string): number | null {
    const entity = this.hass?.states[entityId];
    if (!entity) return null;
    const value = parseFloat(entity.state);
    return isNaN(value) ? null : value;
  }

  private _getEffectiveValue(entityId: string): number | null {
    const pending = this._pendingValues.get(entityId);
    if (pending !== undefined) return pending;
    return this._getEntityValue(entityId);
  }

  private _buildDaySchedule(day: DayKey): DaySchedule | null {
    const amEntityId = this._getEntityId(day, 'am');
    const pmEntityId = this._getEntityId(day, 'pm');
    const amValue = this._getEffectiveValue(amEntityId);
    const pmValue = this._getEffectiveValue(pmEntityId);

    if (amValue === null || pmValue === null) {
      return null;
    }

    return {
      day,
      amEntityId,
      pmEntityId,
      amValue,
      pmValue,
      slots: combineAmPm(amValue, pmValue),
    };
  }

  private _handleCellClick(day: DayKey, slotIndex: number): void {
    if (!this._config?.editable || !this.hass) return;

    const isAm = isAmSlot(slotIndex);
    const bitIndex = slotToBitIndex(slotIndex);
    const entityId = this._getEntityId(day, isAm ? 'am' : 'pm');

    const currentBitfield = this._pendingValues.get(entityId) ?? this._getEntityValue(entityId);
    if (currentBitfield === null) return;

    const newValue = toggleBit(currentBitfield, bitIndex);
    this._errorEntityIds = new Set([...this._errorEntityIds].filter(id => id !== entityId));

    this._pendingValues = new Map(this._pendingValues);
    this._pendingValues.set(entityId, newValue);

    const ackTimer = this._ackTimers.get(entityId);
    if (ackTimer) clearTimeout(ackTimer);
    this._ackTimers.delete(entityId);
    this._scheduleSend(entityId);
  }

  private _scheduleSend(entityId: string): void {
    const existing = this._debounceTimers.get(entityId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this._enqueueFlush(entityId);
    }, EconextScheduleCard.DEBOUNCE_MS);

    this._debounceTimers.set(entityId, timer);
  }

  private _enqueueFlush(entityId: string): void {
    this._debounceTimers.delete(entityId);

    const value = this._pendingValues.get(entityId);
    if (value === undefined) return;

    if (!this._sendQueue.includes(entityId)) {
      this._sendQueue.push(entityId);
    }

    this._processQueue();
  }

  private async _processQueue(): Promise<void> {
    if (this._queueProcessing) return;
    this._queueProcessing = true;
    try {
      while (this._sendQueue.length > 0) {
        const entityId = this._sendQueue.shift()!;
        const value = this._pendingValues.get(entityId);
        if (value === undefined) continue;
        this._inFlight.set(entityId, value);
        const success = await this._executeServiceCall(entityId, value);
        this._inFlight.delete(entityId);
        const latest = this._pendingValues.get(entityId);
        if (!success) {
          if (latest === value) {
            const updated = new Map(this._pendingValues);
            updated.delete(entityId);
            this._pendingValues = updated;
          }
          this._showError(entityId);
        } else if (latest === value && !this._debounceTimers.has(entityId)) {
          this._awaitAcknowledgement(entityId, value);
        } else if (latest !== undefined && latest !== value) {
          if (!this._sendQueue.includes(entityId) && !this._debounceTimers.has(entityId)) {
            this._sendQueue.push(entityId);
          }
        }
        if (this._sendQueue.length > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, EconextScheduleCard.INTER_CALL_DELAY_MS));
        }
      }
    } finally {
      this._queueProcessing = false;
      if (this._sendQueue.length > 0) void this._processQueue();
    }
  }

  private async _executeServiceCall(entityId: string, value: number): Promise<boolean> {
    for (let attempt = 0; attempt <= EconextScheduleCard.MAX_RETRIES; attempt++) {
      try {
        await this.hass.callService('number', 'set_value', { entity_id: entityId, value });
        return true;
      } catch (error) {
        console.error('Failed to update schedule', entityId, attempt + 1, error);
        if (attempt < EconextScheduleCard.MAX_RETRIES) {
          await new Promise<void>(resolve => setTimeout(resolve, EconextScheduleCard.RETRY_BASE_MS * 2 ** attempt));
        }
      }
    }
    return false;
  }

  private _awaitAcknowledgement(entityId: string, value: number): void {
    const existing = this._ackTimers.get(entityId);
    if (existing) clearTimeout(existing);
    if (this._getEntityValue(entityId) === value) {
      this._clearAcknowledged(entityId, value);
      return;
    }
    const timer = setTimeout(() => {
      this._ackTimers.delete(entityId);
      if (this._pendingValues.get(entityId) !== value || this._inFlight.has(entityId) || this._sendQueue.includes(entityId) || this._debounceTimers.has(entityId)) return;
      if (this._getEntityValue(entityId) === value) {
        this._clearAcknowledged(entityId, value);
        return;
      }
      const updated = new Map(this._pendingValues);
      updated.delete(entityId);
      this._pendingValues = updated;
      this._showError(entityId);
    }, EconextScheduleCard.ACK_TIMEOUT_MS);
    this._ackTimers.set(entityId, timer);
  }

  private _clearAcknowledged(entityId: string, value: number): void {
    if (this._pendingValues.get(entityId) !== value) return;
    const timer = this._ackTimers.get(entityId);
    if (timer) clearTimeout(timer);
    this._ackTimers.delete(entityId);
    const updated = new Map(this._pendingValues);
    updated.delete(entityId);
    this._pendingValues = updated;
  }

  private _showError(entityId: string): void {
    this._errorEntityIds = new Set([...this._errorEntityIds, entityId]);

    setTimeout(() => {
      const updated = new Set(this._errorEntityIds);
      updated.delete(entityId);
      this._errorEntityIds = updated;
    }, 5000);
  }

  private _hasErrorForDay(day: DayKey): boolean {
    const amId = this._getEntityId(day, 'am');
    const pmId = this._getEntityId(day, 'pm');
    return this._errorEntityIds.has(amId) || this._errorEntityIds.has(pmId);
  }

  protected override willUpdate(changedProperties: PropertyValues): void {
    super.willUpdate(changedProperties);

    // When hass state updates, clear pending values that HA has confirmed
    if (changedProperties.has('hass') && this._pendingValues.size > 0) {
      const toRemove: string[] = [];
      for (const [entityId, pendingValue] of this._pendingValues) {
        if (!this._debounceTimers.has(entityId) && !this._inFlight.has(entityId) && !this._sendQueue.includes(entityId)) {
          const haValue = this._getEntityValue(entityId);
          if (haValue === pendingValue) {
            toRemove.push(entityId);
            const timer = this._ackTimers.get(entityId);
            if (timer) clearTimeout(timer);
            this._ackTimers.delete(entityId);
          }
        }
      }
      if (toRemove.length > 0) {
        const updated = new Map(this._pendingValues);
        for (const id of toRemove) {
          updated.delete(id);
        }
        this._pendingValues = updated;
      }
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
    this._sendQueue = [];
    this._inFlight.clear();
    for (const timer of this._ackTimers.values()) clearTimeout(timer);
    this._ackTimers.clear();
  }

  protected render(): TemplateResult {
    if (!this._config || !this.hass) {
      return html``;
    }

    const currentDay = getCurrentDay();
    const currentSlot = getCurrentSlotIndex();
    const selectedDaySchedule = this._buildDaySchedule(this._selectedDay);

    // Check if entities exist
    if (!selectedDaySchedule) {
      // Try to find any valid day
      const anyValidDay = DAYS_ORDER.find(day => this._buildDaySchedule(day) !== null);
      if (!anyValidDay) {
        return html`
          <ha-card>
            <div class="warning">
              No schedule entities found for prefix:
              ${this._config.schedule_entity_prefix}
            </div>
          </ha-card>
        `;
      }
    }

    const activeColor = this._config.active_color || DEFAULT_ACTIVE_COLOR;
    const inactiveColor = this._config.inactive_color || DEFAULT_INACTIVE_COLOR;

    return html`
      <ha-card>
        ${this._config.title
          ? html`
              <div class="card-header">
                <div class="title">${this._config.title}</div>
              </div>
            `
          : nothing}

        <!-- Day tabs -->
        <div class="day-tabs">
          ${DAYS_ORDER.map(day => html`
            <button
              class="day-tab ${classMap({
                active: day === this._selectedDay,
                'current-day': this._config!.highlight_current_day !== false && day === currentDay,
                error: this._hasErrorForDay(day),
              })}"
              @click=${() => { this._selectedDay = day; }}
            >
              ${DAY_LABELS[day]}
            </button>
          `)}
        </div>

        ${this._hasErrorForDay(this._selectedDay)
          ? html`
              <div class="error-banner">
                Failed to save schedule. Changes were reverted.
              </div>
            `
          : nothing}

        <!-- Schedule row -->
        <div class="schedule-container">
          <div class="schedule-row-wrapper">
            ${selectedDaySchedule
              ? this._renderScheduleRow(
                  selectedDaySchedule,
                  this._selectedDay === currentDay,
                  currentSlot,
                  activeColor,
                  inactiveColor
                )
              : this._renderEmptyRow()}

            ${this._config.show_time_labels !== false
              ? this._renderTimeLabels()
              : nothing}
          </div>
        </div>
      </ha-card>
    `;
  }

  private _renderTimeLabels(): TemplateResult {
    return html`
      <div class="time-labels">
        ${Array.from({ length: SLOTS_PER_DAY }, (_, i) => {
          const hour = Math.floor(i / 2);
          const isHalfHour = i % 2 !== 0;

          return html`
            <div class="time-label">
              ${isHalfHour ? '' : hour}
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderScheduleRow(
    daySchedule: DaySchedule,
    isCurrentDay: boolean,
    currentSlot: number,
    activeColor: string,
    inactiveColor: string
  ): TemplateResult {
    const editable = this._config?.editable !== false;

    return html`
      <div class="schedule-row">
        ${daySchedule.slots.map((active, slotIndex) => {
          const isCurrentSlotHighlight =
            this._config?.highlight_current_slot !== false &&
            isCurrentDay &&
            slotIndex === currentSlot;

          return html`
            <button
              type="button"
              ?disabled=${!editable}
              aria-label="${slotToTime(slotIndex)} ${active ? "active" : "inactive"}"
              data-time=${slotIndex % 2 === 0 ? slotToTime(slotIndex) : nothing}
              aria-pressed=${active}
              class="schedule-cell ${classMap({
                active,
                inactive: !active,
                'current-slot': isCurrentSlotHighlight,
                readonly: !editable,
              })}"
              style=${styleMap({
                backgroundColor: active ? activeColor : inactiveColor,
              })}
              title="${slotToTime(slotIndex)} - ${active ? 'Active' : 'Inactive'}"
              @click=${() =>
                this._handleCellClick(daySchedule.day, slotIndex)}
            ></button>
          `;
        })}
      </div>
    `;
  }

  private _renderEmptyRow(): TemplateResult {
    return html`
      <div class="schedule-row">
        ${Array.from({ length: SLOTS_PER_DAY }, () => html`
          <div
            class="schedule-cell inactive readonly"
            data-time=${nothing}
            style="opacity: 0.3"
            title="No data"
          ></div>
        `)}
      </div>
    `;
  }
}

// Register with custom card picker
declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      description: string;
      preview?: boolean;
      documentationURL?: string;
    }>;
  }
  interface HTMLElementTagNameMap {
    'econext-schedule-card': EconextScheduleCard;
  }
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'econext-schedule-card',
  name: 'ecoNEXT Schedule Card',
  description: 'Display and edit weekly schedules from ecoNEXT integration',
  preview: true,
});
