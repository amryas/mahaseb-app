import { useVirtualizer } from '@tanstack/react-virtual';
import { logSystemEvent } from '../services/monitoring';

/**
 * Windowed tbody rows; keeps thead + table chrome unchanged. Parent scroll container must have bounded maxHeight + overflow:auto.
 *
 * @param {{
 *   parentRef: React.RefObject<HTMLElement|null>,
 *   items: unknown[],
 *   rowHeight?: number,
 *   colCount: number,
 *   renderRow: (item: unknown, index: number) => React.ReactNode,
 * }} props
 */
export default function VirtualTableBody({ parentRef, items, rowHeight = 54, colCount, renderRow }) {
  const scrollEl = parentRef.current;
  const clientHeight = scrollEl?.clientHeight || 0;
  const visibleRows = clientHeight ? Math.max(1, Math.ceil(clientHeight / rowHeight)) : 12;
  const MAX_VIRTUAL_ROWS = 220;
  // Dynamic overscan tuning: reduce DOM node counts under very large lists / large scroll containers.
  const computedOverscan = Math.max(2, Math.min(10, Math.floor((MAX_VIRTUAL_ROWS - visibleRows) / 2)));
  if (computedOverscan <= 3 && items?.length > 0) {
    void logSystemEvent('perf_virtual_overscan_capped', 'Virtual overscan capped to keep DOM bounded', {
      overscan: computedOverscan,
      visibleRows,
      itemsLength: items.length,
    });
  }

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: computedOverscan,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <tbody>
      {paddingTop > 0 && (
        <tr aria-hidden="true">
          <td
            colSpan={colCount}
            style={{
              height: paddingTop,
              padding: 0,
              border: 'none',
              lineHeight: 0,
              fontSize: 0,
            }}
          />
        </tr>
      )}
      {virtualRows.map((vr) => renderRow(items[vr.index], vr.index))}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td
            colSpan={colCount}
            style={{
              height: paddingBottom,
              padding: 0,
              border: 'none',
              lineHeight: 0,
              fontSize: 0,
            }}
          />
        </tr>
      )}
    </tbody>
  );
}
