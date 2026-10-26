/* eslint import/no-dynamic-require: off, global-require: off */
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const babel = require('@babel/core');

const babelOptions = {
  babelrc: false,
  configFile: false,
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-react',
  ],
};

require('@babel/register')({
  ...babelOptions,
  extensions: ['.js', '.jsx'],
  cache: false,
});
const directory = require('../../app/containers/HomePage/utils/directoryView');
const virtual = require('../../app/containers/HomePage/utils/virtualWindow');
const enums = require('../../app/enums');

// Load the actual controller while isolating Electron, native MTP and Redux wiring.
// No controller method is copied or reimplemented in the tests.
const filename = path.resolve(
  __dirname,
  '../../app/containers/HomePage/components/FileExplorer.jsx'
);
const source = babel.transformFileSync(filename, babelOptions).code;
const identityWrapper = () => (component) => component;
const noop = () => {};
const fallback = new Proxy(
  {},
  { get: (_, key) => (key === '__esModule' ? true : noop) }
);
const context = {
  exports: {},
  require: (id) => {
    if (id === 'react') return require('react');
    if (id === 'path') return path;
    if (id === '../utils/directoryView') return directory;
    if (id === '../../../enums') return enums;
    if (id.endsWith('/funcs'))
      return {
        undefinedOrNull: (value) => value === undefined || value === null,
        isArray: Array.isArray,
        isNumber: (value) => typeof value === 'number',
        isInt: Number.isInteger,
        isFloat: (value) =>
          typeof value === 'number' && !Number.isInteger(value),
      };
    if (id.endsWith('/files')) return { pathInfo: path.parse };
    if (id.endsWith('/remoteWindowHelpers'))
      return { getRemoteWindow: () => ({ Menu: class {} }) };
    if (id.endsWith('/windowHelper'))
      return { getMainWindowRendererProcess: noop };
    if (id.endsWith('/withReducer')) return { withReducer: identityWrapper };
    if (id === 'react-redux') return { connect: identityWrapper };
    if (id === '@material-ui/core/styles')
      return { withStyles: identityWrapper };

    return fallback;
  },
};

vm.runInNewContext(`${source}\nexports.TestExplorer = FileExplorer;`, context, {
  filename,
});
const Explorer = context.exports.TestExplorer;

Explorer.prototype._createDragIcon = noop;

for (const count of [10000, 50000]) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    path: `/files/${index}`,
    name: `file-${String(index).padStart(5, '0')}.txt`,
    size: index,
    isFolder: index % 10 === 0,
  }));
  const selected = nodes.map((item) => item.path);
  const getSelected = directory.createSelectedPaths();
  const selectedPaths = getSelected(selected);

  assert.strictEqual(getSelected(selected), selectedPaths);
  assert.strictEqual(selectedPaths.size, count);
  assert.strictEqual(
    directory.selectedNodeInSort(nodes, selectedPaths).index,
    count - 1
  );
  assert.strictEqual(
    directory.selectedNodeInSort(nodes, selectedPaths, true).index,
    0
  );
  assert.strictEqual(directory.selectedNodeInSort(nodes, new Set()).index, -1);

  const deviceType = enums.DEVICE_TYPE.local;
  const props = {
    deviceType,
    directoryLists: {
      [deviceType]: {
        nodes,
        order: 'asc',
        orderBy: 'name',
        queue: { selected: [] },
      },
    },
    currentBrowsePath: { [deviceType]: '/files' },
    focussedFileExplorerDeviceType: { value: deviceType },
    fileExplorerListingType: {
      [deviceType]: enums.FILE_EXPLORER_VIEW_TYPE.list,
    },
    showDirectoriesFirst: false,
    mtpDevice: { isAvailable: true },
  };
  const explorer = new Explorer(props);
  const updateSelected = ({ selected: nextSelected }) => {
    props.directoryLists = {
      [deviceType]: {
        ...props.directoryLists[deviceType],
        queue: { selected: nextSelected },
      },
    };
  };

  props.actionCreateTableClick = updateSelected;
  props.actionCreateSelectAllClick = (selection, checked) =>
    updateSelected(checked ? selection : { selected: [] });
  const sorted = explorer.tableSort(props.directoryLists[deviceType]);

  explorer._handleSelectAllClick(deviceType);
  assert.strictEqual(
    props.directoryLists[deviceType].queue.selected.length,
    count
  );
  assert.strictEqual(
    explorer.tableSort(props.directoryLists[deviceType]),
    sorted
  );
  assert.strictEqual(explorer.sortDirectory.recomputations(), 1);
  explorer._handleSelectAllClick(deviceType, { target: { checked: false } });
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 0);

  let revealed;
  let prevented = 0;
  const event = {
    type: 'keydown',
    preventDefault: () => {
      prevented += 1;
    },
  };
  const activate = (type) =>
    explorer._handleAcceleratorActivation({
      type,
      data: { deviceType, event },
    });

  explorer._handleVirtualWindow({
    scrollToPath: (target) => {
      revealed = target;
    },
  });
  updateSelected({ selected: [sorted[500].path] });
  activate('navigationDown');
  assert.strictEqual(revealed, sorted[501].path);
  assert.strictEqual(
    props.directoryLists[deviceType].queue.selected[0],
    sorted[501].path
  );
  activate('multipleSelectDown');
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 2);
  assert.strictEqual(revealed, sorted[502].path);
  activate('multipleSelectUp');
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 1);
  activate('navigationUp');
  assert.strictEqual(revealed, sorted[500].path);
  assert.strictEqual(prevented, 4);
  props.fileExplorerListingType[deviceType] =
    enums.FILE_EXPLORER_VIEW_TYPE.grid;
  activate('navigationRight');
  assert.strictEqual(revealed, sorted[501].path);
  activate('multipleSelectRight');
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 2);
  activate('multipleSelectLeft');
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 1);
  activate('navigationLeft');
  assert.strictEqual(revealed, sorted[500].path);
  assert.strictEqual(explorer.sortDirectory.recomputations(), 1);

  // Mouse toggling and grid shift-click keep the existing semantics.
  explorer._handleTableClick(sorted[10].path, deviceType, { type: 'click' });
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 2);
  explorer.keyedAcceleratorList.shift = true;
  explorer._handleTableClick(
    sorted[11].path,
    deviceType,
    { type: 'click' },
    true,
    true
  );
  assert.strictEqual(props.directoryLists[deviceType].queue.selected.length, 3);

  assert.notStrictEqual(
    explorer.tableSort({ ...props.directoryLists[deviceType], order: 'desc' }),
    sorted
  );
  props.showDirectoriesFirst = true;
  assert.strictEqual(
    explorer.tableSort(props.directoryLists[deviceType])[0].isFolder,
    true
  );
  const beforeFieldChange = explorer.sortDirectory.recomputations();
  const bySize = explorer.tableSort({
    ...props.directoryLists[deviceType],
    orderBy: 'size',
  });

  assert.strictEqual(
    explorer.sortDirectory.recomputations(),
    beforeFieldChange + 1
  );
  assert.strictEqual(
    explorer.tableSort({
      ...props.directoryLists[deviceType],
      orderBy: 'size',
    }),
    bySize
  );
  const newDirectory = nodes.map((item) => ({
    ...item,
    path: `/new${item.path}`,
  }));
  const newSorted = explorer.tableSort({
    nodes: newDirectory,
    order: 'asc',
    orderBy: 'size',
  });

  assert.notStrictEqual(newSorted, bySize);
  assert(newSorted.every((item) => item.path.startsWith('/new/')));
  assert.strictEqual(
    explorer.tableSort({ nodes: [], order: 'asc', orderBy: 'name' }).length,
    0
  );

  for (const columns of [1, 4, 9]) {
    const rowHeight =
      columns === 1 ? virtual.LIST_ROW_HEIGHT : virtual.GRID_ROW_HEIGHT;

    for (const top of [0, 5000, Math.ceil(count / columns) * rowHeight - 600]) {
      const range = virtual.getVirtualWindow({
        count,
        columns,
        rowHeight,
        top,
        height: 600,
      });

      assert(
        range.end - range.start <= (Math.ceil(600 / rowHeight) + 7) * columns
      );
      assert.strictEqual(
        range.before +
          Math.ceil((range.end - range.start) / columns) * rowHeight +
          range.after,
        range.totalHeight
      );
    }
  }

  console.info(`PASS controller/cache/range: ${count} files`);
}
