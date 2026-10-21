import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { format } from 'date-fns';
import { MonthCalendar, CalendarModeToggle } from './MonthCalendar';
import type { CalendarEvent } from '../types';

// Thursday, Sept 24 2026. September 2026 starts on a Tuesday.
const TODAY = new Date('2026-09-24T12:00:00');

function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    title: 'Event',
    start: '2026-09-10T15:00:00',
    end: '2026-09-10T16:00:00',
    allDay: false,
    calendarId: 'cal.family',
    calendarName: 'Family',
    color: '#3b82f6',
    ...overrides,
  };
}

function renderMonth(events: CalendarEvent[] = [], extra: Partial<Parameters<typeof MonthCalendar>[0]> = {}) {
  const props = {
    events,
    hiddenCalendars: new Set<string>(),
    onEventClick: vi.fn(),
    onDayClick: vi.fn(),
    onOpenWeek: vi.fn(),
    onVisibleRangeChange: vi.fn(),
    weekStartsOn: 0 as const,
    ...extra,
  };
  const utils = render(<MonthCalendar {...props} />);
  return { ...utils, props };
}

function dayCell(container: HTMLElement, label: string) {
  const button = within(container).getAllByRole('button', { name: new RegExp(`Open week of .*${label}`) })[0];
  return button.closest('.month-day') as HTMLElement;
}

describe('MonthCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the current month and reports the full grid range (Sunday start)', () => {
    const { props } = renderMonth();
    expect(screen.getByText('September 2026')).toBeTruthy();
    const [start, end] = props.onVisibleRangeChange.mock.calls.at(-1)!;
    expect(format(start, 'yyyy-MM-dd')).toBe('2026-08-30');
    expect(format(end, 'yyyy-MM-dd')).toBe('2026-10-04');
  });

  it('starts the grid on Monday when weekStartsOn is 1', () => {
    const { props } = renderMonth([], { weekStartsOn: 1 });
    const [start] = props.onVisibleRangeChange.mock.calls.at(-1)!;
    expect(format(start, 'yyyy-MM-dd')).toBe('2026-08-31');
  });

  it('moves to the next month and back to today', () => {
    const { props } = renderMonth();
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('October 2026')).toBeTruthy();
    const [start] = props.onVisibleRangeChange.mock.calls.at(-1)!;
    expect(format(start, 'yyyy-MM-dd')).toBe('2026-09-27');
    fireEvent.click(screen.getByRole('button', { name: 'Jump to current month' }));
    expect(screen.getByText('September 2026')).toBeTruthy();
  });

  it('puts events on their day and hides calendars that are filtered out', () => {
    const { container } = renderMonth(
      [
        makeEvent({ id: 'a', title: 'Dentist' }),
        makeEvent({ id: 'b', title: 'Secret', calendarId: 'cal.hidden' }),
      ],
      { hiddenCalendars: new Set(['cal.hidden']) },
    );
    const cell = dayCell(container, 'September 10th');
    expect(within(cell).getByText('Dentist')).toBeTruthy();
    expect(within(cell).getByText('3pm')).toBeTruthy();
    expect(screen.queryByText('Secret')).toBeNull();
  });

  it('shows a multi-day all-day event on every day it covers', () => {
    const { container } = renderMonth([
      makeEvent({ id: 'trip', title: 'Beach trip', allDay: true, start: '2026-09-11', end: '2026-09-14' }),
    ]);
    for (const day of ['September 11th', 'September 12th', 'September 13th']) {
      expect(within(dayCell(container, day)).getByText('Beach trip')).toBeTruthy();
    }
    expect(within(dayCell(container, 'September 14th')).queryByText('Beach trip')).toBeNull();
  });

  it('collapses extra events into "+N more", which opens that week', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `e${i}`, title: `Event ${i}`, start: `2026-09-15T0${i + 1}:00:00`, end: `2026-09-15T0${i + 1}:30:00` }),
    );
    const { container, props } = renderMonth(events);
    const cell = dayCell(container, 'September 15th');
    // jsdom has no layout, so the default of 3 rows applies: 2 events + "+3 more"
    expect(within(cell).getAllByRole('button').filter((b) => b.classList.contains('month-event'))).toHaveLength(2);
    fireEvent.click(within(cell).getByText('+3 more'));
    expect(format(props.onOpenWeek.mock.calls[0][0], 'yyyy-MM-dd')).toBe('2026-09-15');
    expect(props.onDayClick).not.toHaveBeenCalled();
  });

  it('adds an event when tapping empty space, opens the week when tapping the date', () => {
    const { container, props } = renderMonth();
    const cell = dayCell(container, 'September 18th');
    fireEvent.click(cell);
    expect(props.onDayClick).toHaveBeenCalledWith('2026-09-18');
    fireEvent.click(within(cell).getByRole('button', { name: /Open week of/ }));
    expect(format(props.onOpenWeek.mock.calls[0][0], 'yyyy-MM-dd')).toBe('2026-09-18');
    expect(props.onDayClick).toHaveBeenCalledTimes(1);
  });
});

describe('CalendarModeToggle', () => {
  it('marks the active mode and reports changes', () => {
    const onChange = vi.fn();
    render(<CalendarModeToggle mode="week" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });
});
