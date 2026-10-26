/* eslint no-await-in-loop: off, no-inner-declarations: off */
import React from 'react';
import ReactDOM from 'react-dom';
import CssBaseline from '@material-ui/core/CssBaseline';
import { ThemeProvider, createMuiTheme } from '@material-ui/core/styles';
import { materialUiTheme } from '../../app/containers/App/styles';
import FileExplorerTableBodyRender from '../../app/containers/HomePage/components/FileExplorerTableBodyRender';
import { createDirectorySorter } from '../../app/containers/HomePage/utils/directoryView';
import { DEVICE_TYPE, FILE_EXPLORER_VIEW_TYPE } from '../../app/enums';
import {
  LIST_ROW_HEIGHT,
  GRID_ROW_HEIGHT,
} from '../../app/containers/HomePage/utils/virtualWindow';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const settle = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
const root = document.getElementById('root');
const deviceType = DEVICE_TYPE.local;
const report = [];
const theme = createMuiTheme(materialUiTheme({ appThemeMode: 'light' }));
const errors = [];
const originalError = console.error;

console.error = (...args) => {
  errors.push(args.map(String).join(' '));
  originalError(...args);
};

async function run() {
  for (const count of [10000, 50000]) {
    for (const mode of [
      FILE_EXPLORER_VIEW_TYPE.list,
      FILE_EXPLORER_VIEW_TYPE.grid,
    ]) {
      const nodes = Array.from({ length: count }, (_, index) => ({
        path: `/files/${index}`,
        name: `file-${String(index).padStart(5, '0')}.txt`,
        size: index,
        isFolder: index % 10 === 0,
        dateAdded: '2026-10-21',
      }));
      const scrollContainerRef = React.createRef();
      const sortDirectory = createDirectorySorter(
        ({ value, orderBy }) => value[orderBy]
      );
      let view;
      let clickCount = 0;
      let dragSelection;
      let menuPath;
      let openedPath;
      let props = {
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
        fileExplorerListingType: { [deviceType]: mode },
        hideColList:
          mode === FILE_EXPLORER_VIEW_TYPE.list ? [] : ['size', 'dateAdded'],
        mtpDevice: { isAvailable: true },
        tableData: { path: '/files' },
        tableSort: ({ nodes: entries, order, orderBy }) =>
          sortDirectory(entries, order, orderBy, false),
        onVirtualWindow: (instance) => {
          view = instance;
        },
        onIsDraggable: () => true,
        onDragStart: () => {
          dragSelection = props.directoryLists[deviceType].queue.selected;
        },
        onContextMenuClick: (event, item) => {
          event.stopPropagation();
          menuPath = item.path;
        },
        onTableDoubleClick: (item) => {
          openedPath = item.path;
        },
        onTableClick: (path, _, event, replace = false) => {
          clickCount += 1;
          const { selected } = props.directoryLists[deviceType].queue;

          setSelected(
            replace
              ? [path]
              : selected.includes(path)
              ? selected.filter((entry) => entry !== path)
              : [...selected, path]
          );
        },
        onSelectAllClick: (_, event) =>
          setSelected(
            event.target.checked
              ? props.directoryLists[deviceType].nodes.map((item) => item.path)
              : []
          ),
        onRequestSort: (_, orderBy) => {
          props.directoryLists = {
            [deviceType]: {
              ...props.directoryLists[deviceType],
              orderBy,
              order: 'desc',
            },
          };
          render();
        },
      };

      function render() {
        ReactDOM.render(
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <div
              data-file-explorer-scroll
              ref={scrollContainerRef}
              style={{ height: 600, width: 800, overflow: 'auto' }}
            >
              <FileExplorerTableBodyRender {...props} />
            </div>
          </ThemeProvider>,
          root
        );
      }

      function setSelected(selected) {
        props = {
          ...props,
          directoryLists: {
            [deviceType]: {
              ...props.directoryLists[deviceType],
              queue: { selected },
            },
          },
        };
        render();
      }

      const mounted = () => [...root.querySelectorAll('[data-file-path]')];
      const selectedMounted = () =>
        mounted().filter(
          (item) => item.getAttribute('aria-checked') === 'true'
        );
      const isList = mode === FILE_EXPLORER_VIEW_TYPE.list;
      const limit = isList ? 20 : 100;
      const rowHeight = isList ? LIST_ROW_HEIGHT : GRID_ROW_HEIGHT;
      const verifyBound = () =>
        assert(
          mounted().length > 0 && mounted().length <= limit,
          `${count}/${mode}: mounted ${mounted().length}`
        );

      render();
      await settle();
      verifyBound();
      const initialCount = mounted().length;
      const host = scrollContainerRef.current;
      const first = mounted()[0];

      assert(
        Math.abs(first.getBoundingClientRect().height - rowHeight) < 1,
        `${mode}: actual row height ${
          first.getBoundingClientRect().height
        }, expected ${rowHeight}`
      );
      assert(host.scrollHeight > 100000, `${mode}: full scroll extent missing`);
      root.querySelector('thead input').click();
      await settle();
      assert(
        props.directoryLists[deviceType].queue.selected.length === count,
        'select all omitted offscreen files'
      );
      assert(
        selectedMounted().length === mounted().length,
        'visible selection did not update'
      );
      assert(sortDirectory.recomputations() === 1, 'selection reran sorting');
      const selectedScroll = host.scrollTop;

      setSelected([nodes[5000].path]);
      await settle();
      assert(
        host.scrollTop === selectedScroll,
        'ordinary selection unexpectedly scrolled'
      );
      view.scrollToPath(nodes[5000].path);
      await settle();
      verifyBound();
      const target = mounted().find(
        (item) => item.dataset.filePath === nodes[5000].path
      );
      const headerBottom = root
        .querySelector('thead')
        .getBoundingClientRect().bottom;

      assert(
        target && target.getAttribute('aria-checked') === 'true',
        'offscreen target not mounted/selected'
      );
      assert(
        target.getBoundingClientRect().top >= headerBottom - 1,
        'navigation target hidden behind header'
      );
      assert(
        target.getBoundingClientRect().bottom <=
          host.getBoundingClientRect().bottom + 1,
        'navigation target below viewport'
      );
      host.scrollTop = host.scrollHeight;
      await settle();
      verifyBound();
      assert(
        mounted().some(
          (item) => item.dataset.filePath === nodes[count - 1].path
        ),
        'scrolling missed final file'
      );
      setSelected([nodes[10].path]);
      view.scrollToPath(nodes[10].path);
      await settle();
      const upwardTarget = mounted().find(
        (item) => item.dataset.filePath === nodes[10].path
      );

      assert(
        upwardTarget?.getAttribute('aria-checked') === 'true',
        'upward offscreen navigation lost selection'
      );
      assert(
        upwardTarget.getBoundingClientRect().top >=
          root.querySelector('thead th').getBoundingClientRect().bottom - 1,
        'upward navigation hid target behind sticky header'
      );
      host.scrollTop = Math.floor(host.scrollHeight / 2);
      await settle();
      verifyBound();
      const beforeSelection = mounted()[0];

      if (isList) beforeSelection.querySelector('input').click();
      else beforeSelection.querySelector('label').click();
      await settle();
      assert(clickCount === 1, 'click handler not preserved');
      assert(selectedMounted().length > 0, 'clicked file not selected');
      const menuTarget = isList
        ? mounted()[1].querySelector('.nameCell')
        : mounted()[1];

      menuTarget.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true })
      );
      assert(
        menuPath === mounted()[1].dataset.filePath,
        'context menu got wrong file'
      );
      const doubleTarget = isList
        ? mounted()[1].querySelector('.nameCell')
        : mounted()[1];

      doubleTarget.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      assert(
        openedPath === mounted()[1].dataset.filePath,
        'double click got wrong file'
      );
      const dragTarget = mounted()[2];
      const dragPath = dragTarget.dataset.filePath;

      dragTarget.dispatchEvent(new Event('dragstart', { bubbles: true }));
      assert(
        dragSelection?.includes(dragPath),
        'drag did not include newly selected file'
      );
      setSelected(nodes.map((item) => item.path));
      await settle();
      mounted()[0].dispatchEvent(new Event('dragstart', { bubbles: true }));
      assert(
        dragSelection.length === count,
        'drag selection omitted offscreen files'
      );

      for (const width of [350, 1000, 800]) {
        host.style.width = `${width}px`;
        host.style.height = width === 350 ? '320px' : '600px';
        await settle();
        await settle();
        if (!isList) {
          assert(
            view.dimensions().columns ===
              Math.floor((host.clientWidth - 10) / 100),
            `grid columns did not follow width ${width}: ${
              view.dimensions().columns
            }`
          );
          assert(
            host.scrollWidth <= host.clientWidth + 1,
            'grid resize caused horizontal overflow'
          );
        }

        assert(
          mounted().length <= (isList ? 20 : 130),
          'resize mounted too many items'
        );
        view.scrollToPath(nodes[count - 1].path);
        await settle();
        assert(
          mounted().some(
            (item) => item.dataset.filePath === nodes[count - 1].path
          ),
          'resize navigation missed final file'
        );
      }

      // Sort identity changes and directory replacement reset old scroll state.
      props.onRequestSort(deviceType, 'name');
      await settle();
      assert(host.scrollTop === 0, 'sort did not reset scroll');
      assert(
        mounted()[0].dataset.filePath === nodes[count - 1].path,
        'sort not reflected'
      );
      host.scrollTop = host.scrollHeight;
      await settle();
      const replacement = Array.from({ length: 7 }, (_, index) => ({
        ...nodes[index],
        path: `/other/${index}`,
      }));

      props = {
        ...props,
        currentBrowsePath: { [deviceType]: '/other' },
        directoryLists: {
          [deviceType]: {
            nodes: replacement,
            order: 'asc',
            orderBy: 'name',
            queue: { selected: [] },
          },
        },
      };
      render();
      await settle();
      assert(host.scrollTop === 0, 'directory did not reset scroll');
      assert(
        mounted().length === 7,
        'small directory has stale or missing rows'
      );
      assert(
        mounted().every((item) => item.dataset.filePath.startsWith('/other/')),
        'old directory rows leaked'
      );
      assert(
        selectedMounted().length === 0,
        'selection leaked across directories'
      );
      props.directoryLists = {
        [deviceType]: { ...props.directoryLists[deviceType], nodes: [] },
      };
      render();
      await settle();
      assert(
        mounted().length === 0 && view === null,
        'empty directory did not unmount virtual window'
      );
      props.directoryLists = {
        [deviceType]: { ...props.directoryLists[deviceType], nodes },
      };
      render();
      await settle();
      verifyBound();
      assert(
        host.scrollTop === 0,
        'returning to large directory retained stale offset'
      );
      // Exercise wrapper replacement while an animation frame may be pending.
      host.scrollTop = 2000;
      host.dispatchEvent(new Event('scroll'));
      props.fileExplorerListingType = {
        [deviceType]: isList
          ? FILE_EXPLORER_VIEW_TYPE.grid
          : FILE_EXPLORER_VIEW_TYPE.list,
      };
      render();
      await settle();
      assert(view && host.scrollTop === 0, 'view mode switch did not reset');
      ReactDOM.unmountComponentAtNode(root);
      await settle();
      assert(view === null, 'unmount left a stale navigation handle');
      report.push({
        count,
        mode,
        initialMounted: initialCount,
        status: 'passed',
      });
    }
  }

  assert(errors.length === 0, `React console errors: ${errors.join('\n')}`);

  return report;
}

window.testPromise = run();
