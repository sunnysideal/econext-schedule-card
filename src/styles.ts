import { css } from 'lit';

export const cardStyles = css`
  :host {
    --cell-height: 40px;
    --cell-gap: 1px;
    --active-color: var(--schedule-active-color, #00bcd4);
    --inactive-color: var(--schedule-inactive-color, #e0e0e0);
    --current-day-color: var(--primary-color, #03a9f4);
    --current-slot-outline: rgba(0, 188, 212, 0.8);
    --border-radius: 3px;
    display: block;
  }

  ha-card {
    padding: 16px;
    height: 100%;
    box-sizing: border-box;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
  }

  .card-header .title {
    font-size: 1.1em;
    font-weight: 500;
    color: var(--primary-text-color);
  }

  /* Day tabs */
  .day-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--divider-color, #e0e0e0);
    padding-bottom: 8px;
  }

  .day-tab {
    flex: 1;
    padding: 8px 4px;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    color: var(--secondary-text-color);
    background: none;
    border: none;
    border-radius: var(--border-radius) var(--border-radius) 0 0;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: capitalize;
  }

  .day-tab:hover {
    background-color: var(--secondary-background-color, #f5f5f5);
    color: var(--primary-text-color);
  }

  .day-tab.active {
    color: var(--current-day-color);
    border-bottom: 2px solid var(--current-day-color);
    font-weight: 600;
  }

  .day-tab.current-day {
    color: var(--current-day-color);
  }

  .day-tab.current-day::after {
    content: '';
    display: block;
    width: 4px;
    height: 4px;
    background-color: var(--current-day-color);
    border-radius: 50%;
    margin: 4px auto 0;
  }

  .day-tab.active.current-day::after {
    display: none;
  }

  /* Schedule row container */
  .schedule-container {
    width: 100%;
    container-type: inline-size;
  }

  .schedule-row-wrapper {
    width: 100%;
  }

  /* Schedule cells row */
  .schedule-row {
    display: grid;
    grid-template-columns: repeat(24, minmax(0, 1fr));
    column-gap: var(--cell-gap);
    row-gap: 22px;
    width: 100%;
  }

  .schedule-cell {
    min-width: 0;
    min-height: 48px;
    height: var(--cell-height);
    padding: 0;
    border: 0;
    touch-action: manipulation;
    border-radius: var(--border-radius);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    cursor: pointer;
    position: relative;
  }

  .schedule-cell[data-time]::after {
    content: attr(data-time);
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 100%;
    color: var(--secondary-text-color);
    font-size: 10px;
    font-weight: normal;
    text-align: left;
    pointer-events: none;
  }

  .schedule-cell:focus-visible { outline: 3px solid var(--primary-color); outline-offset: 1px; }

  .schedule-cell.active {
    background-color: var(--active-color);
  }

  .schedule-cell.inactive {
    background-color: var(--inactive-color);
  }

  .schedule-cell:hover {
    transform: scaleY(1.2);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    z-index: 10;
    position: relative;
  }

  .schedule-cell.current-slot {
    outline: 2px solid var(--current-slot-outline);
    outline-offset: -1px;
  }

  .schedule-cell.readonly {
    cursor: default;
  }

  .schedule-cell.readonly:hover {
    transform: none;
    box-shadow: none;
  }

  /* Time labels below schedule */
  .time-labels {
    display: none;
    grid-template-columns: repeat(24, minmax(0, 1fr));
    gap: var(--cell-gap);
    margin-top: 6px;
    width: 100%;
  }

  .time-label {
    min-width: 0;
    font-size: 10px;
    color: var(--secondary-text-color);
    text-align: center;
    overflow: hidden;
  }


  /* Warning/error states */
  .warning {
    padding: 16px;
    color: var(--error-color, #db4437);
    text-align: center;
  }

  .error-banner {
    padding: 8px 12px;
    margin-bottom: 12px;
    background-color: var(--error-color, #db4437);
    color: #fff;
    border-radius: var(--border-radius);
    font-size: 13px;
    text-align: center;
    animation: fade-in 0.2s ease;
  }

  @keyframes fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .day-tab.error {
    color: var(--error-color, #db4437);
  }

  /* Respond to the actual Lovelace card width, not the browser viewport. */
  @container (max-width: 600px) {
    .schedule-row {
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }
    .schedule-cell { min-height: 48px; }
    .time-label { font-size: 10px; }
    .time-label:nth-child(even) { visibility: hidden; }
  }

  @container (max-width: 340px) {
    .schedule-row {
      grid-template-columns: repeat(8, minmax(0, 1fr));
    }
    .time-label:nth-child(odd) { visibility: hidden; }
    .time-label:nth-child(6n + 1) { visibility: visible; }
  }

  @media (max-width: 600px) {
    .day-tab { font-size: 11px; padding: 6px 2px; }
    ha-card { padding: 12px; }
  }
`;
