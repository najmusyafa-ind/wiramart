'use client';

import { useState, useCallback } from 'react';

export interface TableSelectionState {
  selectedIds: ReadonlySet<string>;
  selectedCount: number;
  isSelected: (id: string) => boolean;
  toggleRow: (id: string) => void;
  toggleAll: (visibleIds: readonly string[]) => void;
  allVisibleSelected: (visibleIds: readonly string[]) => boolean;
  someVisibleSelected: (visibleIds: readonly string[]) => boolean;
  getSelectedRows: <T>(rows: readonly T[], getId: (row: T) => string) => T[];
  clearSelection: () => void;
  pruneToValidIds: (validIds: readonly string[]) => void;
}

/**
 * Hook untuk mengelola seleksi baris (checkbox) secara real-time di client
 * tanpa mutasi database, lengkap dengan tri-state "Pilih Semua" baris terlihat.
 */
export function useTableSelection(): TableSelectionState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback((visibleIds: readonly string[]) => {
    if (visibleIds.length === 0) return;
    setSelectedIds((prev) => {
      const allChecked = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }, []);

  const allVisibleSelected = useCallback(
    (visibleIds: readonly string[]) =>
      visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const someVisibleSelected = useCallback(
    (visibleIds: readonly string[]) =>
      visibleIds.some((id) => selectedIds.has(id)) &&
      !visibleIds.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const getSelectedRows = useCallback(
    <T,>(rows: readonly T[], getId: (row: T) => string): T[] =>
      rows.filter((row) => selectedIds.has(getId(row))),
    [selectedIds],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const pruneToValidIds = useCallback((validIds: readonly string[]) => {
    const validSet = new Set(validIds);
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    isSelected,
    toggleRow,
    toggleAll,
    allVisibleSelected,
    someVisibleSelected,
    getSelectedRows,
    clearSelection,
    pruneToValidIds,
  };
}

