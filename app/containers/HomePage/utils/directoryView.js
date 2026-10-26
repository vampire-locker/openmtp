import sortBy from 'lodash/sortBy';
import { createSelector } from 'reselect';

// One cache per explorer: selection changes retain the nodes array identity.
export const createDirectorySorter = (sortValue) =>
  createSelector(
    (nodes) => nodes,
    (_, order) => order,
    (_, __, orderBy) => orderBy,
    (_, __, ___, directoriesFirst) => directoriesFirst,
    (nodes, order, orderBy, directoriesFirst) => {
      const sorted = sortBy(nodes || [], (value) =>
        sortValue({ value, orderBy })
      );

      if (order !== 'asc') sorted.reverse();
      if (!directoriesFirst) return sorted;

      const folders = [];
      const files = [];

      sorted.forEach((item) => (item.isFolder ? folders : files).push(item));

      return folders.concat(files);
    }
  );

export const createSelectedPaths = () =>
  createSelector(
    (selected) => selected,
    (selected) => new Set(selected)
  );

export function selectedNodeInSort(nodes, selectedPaths, reverse = false) {
  for (
    let index = reverse ? 0 : nodes.length - 1;
    reverse ? index < nodes.length : index >= 0;
    index += reverse ? 1 : -1
  ) {
    if (selectedPaths.has(nodes[index].path)) {
      return { index, item: nodes[index] };
    }
  }

  return { index: -1, item: [] };
}
