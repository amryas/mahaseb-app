import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedSync } from './syncDebounce';

describe('syncDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onSync once after delay when debouncedSync is called', () => {
    const onSync = vi.fn();
    const debouncedSync = createDebouncedSync(onSync);

    debouncedSync('acc1', 'sales', []);
    expect(onSync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3000);
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenCalledWith('acc1', 'sales', []);
  });

  it('merges multiple rapid calls into one', () => {
    const onSync = vi.fn();
    const debouncedSync = createDebouncedSync(onSync);

    debouncedSync('acc1', 'sales', [{ id: '1' }]);
    debouncedSync('acc1', 'sales', [{ id: '1' }, { id: '2' }]);
    debouncedSync('acc1', 'sales', [{ id: '1' }, { id: '2' }, { id: '3' }]);

    vi.advanceTimersByTime(3000);
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSync).toHaveBeenLastCalledWith('acc1', 'sales', [{ id: '1' }, { id: '2' }, { id: '3' }]);
  });
});
