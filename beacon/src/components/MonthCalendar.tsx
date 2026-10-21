import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  addDays,
  addMinutes,
  eachDayOfInterval,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  differenceInCalendarDays,
} from 'date-fns';
import { CalendarEvent, getPastelColor, getFullColor } from '../types';
import { EventDetailsPopover } from './EventDetailsPopover';
import { useTranslation } from '../i18n';

export type CalendarMode = 'week' | 'month';

interface CalendarModeToggleProps {
  mode: CalendarMode;
  onChange: (mode: CalendarMode) => void;
}

/** Segmented Week | Month switch shown in the calendar header. */
export function CalendarModeToggle({ mode, onChange }: CalendarModeToggleProps) {
  const { t } = useTranslation();
  return (
    <div className="calendar-mode-toggle" role="group" aria-label={t('calendarMode.label')}>
      {(['week', 'month'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`calendar-mode-btn ${mode === m ? 'calendar-mode-btn--active' : ''}`}
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
        >
          {t(m === 'week' ? 'calendarMode.week' : 'calendarMode.month')}
        </button>
      ))}
    </div>
  );
}

interface MonthCalendarProps {
  events: CalendarEvent[];
  hiddenCalendars: Set<string>;
  /** Open the edit modal for an event (called from the details popover). */
  onEventClick: (event: CalendarEvent) => void;
  /** Tap on the empty part of a day: add an event on that date (yyyy-MM-dd). */
  onDayClick: (date: string) => void;
  /** Tap on a day number or "+N more": show that day's week in week view. */
  onOpenWeek: (day: Date) => void;
  /** Reports the full visible grid range [start, end) so events can be fetched. */
  onVisibleRangeChange?: (start: Date, end: Date) => void;
  weekStartsOn: 0 | 1;
  /** Extra controls rendered at the right of the header (the view toggle). */
  headerExtra?: React.ReactNode;
}

// Approximate pixel sizes used to work out how many events fit in a day cell.
const DAY_NUMBER_HEIGHT = 30;
const EVENT_ROW_HEIGHT = 21;
const CELL_PADDING = 6;

function dayKey(day: Date): string {
  return format(day, 'yyyy-MM-dd');
}

export function MonthCalendar({
  events,
  hiddenCalendars,
  onEventClick,
  onDayClick,
  onOpenWeek,
  onVisibleRangeChange,
  weekStartsOn,
  headerExtra,
}: MonthCalendarProps) {
  const { t, dateLocale } = useTranslation();
  const today = new Date();

  // Month navigation: offset in months from the current month
  const [monthOffset, setMonthOffset] = useState(0);
  const monthStart = useMemo(
    () => startOfMonth(addMonths(today, monthOffset)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthOffset],
  );

  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn }), [monthStart, weekStartsOn]);
  const gridEnd = useMemo(
    () => endOfWeek(endOfMonth(monthStart), { weekStartsOn }),
    [monthStart, weekStartsOn],
  );
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);
  const weekCount = Math.ceil(days.length / 7);

  // Tell the parent which dates are on screen so it can fetch their events
  useEffect(() => {
    onVisibleRangeChange?.(gridStart, addDays(gridEnd, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridStart.toISOString(), gridEnd.toISOString()]);

  const weekdayNames = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(gridStart, i), 'EEE', { locale: dateLocale })),
    [gridStart, dateLocale],
  );

  // Group visible events by the days they cover
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days) map.set(dayKey(day), []);

    for (const event of events) {
      if (hiddenCalendars.has(event.calendarId)) continue;
      const start = parseISO(event.start);
      const rawEnd = parseISO(event.end);
      const end = rawEnd > start ? rawEnd : addMinutes(start, 1);

      const firstIndex = Math.max(0, differenceInCalendarDays(start, gridStart));
      const lastIndex = Math.min(days.length - 1, differenceInCalendarDays(end, gridStart));
      for (let i = firstIndex; i <= lastIndex; i++) {
        const day = days[i];
        if (start < addDays(day, 1) && end > day) {
          map.get(dayKey(day))?.push(event);
        }
      }
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        const aAllDay = a.allDay || differenceInCalendarDays(parseISO(a.end), parseISO(a.start)) >= 1;
        const bAllDay = b.allDay || differenceInCalendarDays(parseISO(b.end), parseISO(b.start)) >= 1;
        if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
        const cmp = a.start.localeCompare(b.start);
        return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
      });
    }
    return map;
  }, [days, events, hiddenCalendars, gridStart]);

  // Work out how many event rows fit in a day cell for the current screen size
  const gridRef = useRef<HTMLDivElement>(null);
  const [maxRows, setMaxRows] = useState(3);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const cellHeight = el.clientHeight / weekCount;
      const fit = Math.floor((cellHeight - DAY_NUMBER_HEIGHT - CELL_PADDING) / EVENT_ROW_HEIGHT);
      setMaxRows(Math.max(1, fit));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [weekCount]);

  // Event details popover (same behaviour as the week view)
  const [expanded, setExpanded] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const expandedEvent = useMemo(
    () => (expanded ? events.find((ev) => ev.id === expanded.id) ?? null : null),
    [expanded, events],
  );
  const closeExpanded = useCallback(() => setExpanded(null), []);
  useEffect(() => setExpanded(null), [monthOffset]);

  // Swipe left/right to change month on touch screens
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      setMonthOffset((o) => (dx < 0 ? o + 1 : o - 1));
    }
  }, []);

  const formatTime = useCallback(
    (iso: string) => {
      const label = format(parseISO(iso), 'p', { locale: dateLocale });
      // Compact 12-hour times ("3:00 PM" -> "3pm", "3:30 PM" -> "3:30pm")
      if (/[ap]\.?m\.?$/i.test(label)) {
        return label.replace(':00', '').replace(/\s+/g, '').toLowerCase();
      }
      return label;
    },
    [dateLocale],
  );

  const isCurrentMonth = monthOffset === 0;
  const now = Date.now();

  return (
    <div className="week-calendar month-calendar" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="week-nav">
        <div className="week-nav-controls">
          <button
            type="button"
            className="week-nav-btn"
            onClick={() => setMonthOffset((o) => o - 1)}
            aria-label={t('monthCalendar.previousMonth')}
          >
            &lsaquo;
          </button>
          <button
            type="button"
            className={`week-nav-today ${isCurrentMonth ? 'week-nav-today--active' : ''}`}
            onClick={() => setMonthOffset(0)}
            disabled={isCurrentMonth}
            aria-label={t('monthCalendar.jumpToCurrentMonth')}
          >
            {t('common.today')}
          </button>
          <button
            type="button"
            className="week-nav-btn"
            onClick={() => setMonthOffset((o) => o + 1)}
            aria-label={t('monthCalendar.nextMonth')}
          >
            &rsaquo;
          </button>
        </div>
        <div className="week-nav-label">{format(monthStart, 'LLLL yyyy', { locale: dateLocale })}</div>
        {headerExtra}
      </div>

      <div className="month-weekdays">
        {weekdayNames.map((name, i) => (
          <div key={i} className="month-weekday">{name}</div>
        ))}
      </div>

      <div
        ref={gridRef}
        className="month-grid"
        style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}
      >
        {days.map((day) => {
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          const outside = !isSameMonth(day, monthStart);
          // When not everything fits, give the last row to a "+N more" line
          const shown = dayEvents.length > maxRows ? dayEvents.slice(0, maxRows - 1) : dayEvents;
          const hiddenCount = dayEvents.length - shown.length;
          const dateLabel = format(day, 'PPPP', { locale: dateLocale });

          return (
            <div
              key={key}
              className={`month-day ${outside ? 'month-day--outside' : ''} ${isToday ? 'month-day--today' : ''}`}
              onClick={() => onDayClick(key)}
              title={t('monthCalendar.addEventOn', { date: dateLabel })}
            >
              <button
                type="button"
                className="month-day-number"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenWeek(day);
                }}
                aria-label={t('monthCalendar.openWeek', { date: dateLabel })}
              >
                {format(day, 'd', { locale: dateLocale })}
              </button>

              <div className="month-day-events">
                {shown.map((event) => {
                  const spansDays =
                    event.allDay || differenceInCalendarDays(parseISO(event.end), parseISO(event.start)) >= 1;
                  const isPast = parseISO(event.end).getTime() < now;
                  const full = getFullColor(event.color);
                  return (
                    <button
                      key={`${event.id}-${key}`}
                      type="button"
                      className={`month-event ${spansDays ? 'month-event--allday' : ''} ${isPast ? 'month-event--past' : ''}`}
                      style={spansDays ? { backgroundColor: getPastelColor(event.color), borderLeftColor: full } : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        const anchor = e.currentTarget.getBoundingClientRect();
                        setExpanded((prev) => (prev?.id === event.id ? null : { id: event.id, anchor }));
                      }}
                      title={event.title}
                    >
                      {!spansDays && <span className="month-event-dot" style={{ backgroundColor: full }} />}
                      {!spansDays && <span className="month-event-time">{formatTime(event.start)}</span>}
                      <span className="month-event-title">{event.title}</span>
                    </button>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    className="month-day-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenWeek(day);
                    }}
                  >
                    {t('monthCalendar.more', { n: hiddenCount })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {expandedEvent && expanded && (
        <EventDetailsPopover
          event={expandedEvent}
          anchor={expanded.anchor}
          onClose={closeExpanded}
          onEdit={() => {
            const ev = expandedEvent;
            closeExpanded();
            onEventClick(ev);
          }}
        />
      )}
    </div>
  );
}
