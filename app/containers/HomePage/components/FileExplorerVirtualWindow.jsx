import React, { PureComponent } from 'react';
import TableRow from '@material-ui/core/TableRow';
import TableCell from '@material-ui/core/TableCell';
import FileExplorerTableBodyListRender from './FileExplorerTableBodyListRender';
import FileExplorerTableBodyGridRender from './FileExplorerTableBodyGridRender';
import {
  LIST_ROW_HEIGHT,
  GRID_ROW_HEIGHT,
  GRID_ITEM_WIDTH,
  getVirtualWindow,
  getScrollTopForIndex,
} from '../utils/virtualWindow';

const spacerStyle = { padding: 0, border: 0, lineHeight: 0 };

export default class FileExplorerVirtualWindow extends PureComponent {
  constructor(props) {
    super(props);
    this.anchor = React.createRef();
    this.state = {
      scrollTop: 0,
      height: 0,
      width: 0,
      offset: 0,
      headerHeight: 0,
    };
    this.frame = null;
    this.indexedNodes = null;
    this.pathIndices = new Map();
  }

  componentDidMount() {
    const { onVirtualWindow } = this.props;

    // Ancestor refs attach after child componentDidMount in React 17.
    this.scroller = this.anchor.current.closest('[data-file-explorer-scroll]');
    this.scroller.addEventListener('scroll', this.scheduleMeasure, {
      passive: true,
    });
    this.resizeObserver = new ResizeObserver(this.scheduleMeasure);
    this.resizeObserver.observe(this.scroller);
    this.scroller.scrollTop = 0;
    this.measure();
    onVirtualWindow(this);
  }

  componentDidUpdate(prevProps) {
    const { tableSort, currentBrowsePath, deviceType } = this.props;

    if (
      prevProps.tableSort !== tableSort ||
      prevProps.currentBrowsePath[deviceType] !== currentBrowsePath[deviceType]
    ) {
      // A new directory or sort order must not reuse the old viewport.
      this.indexedNodes = null;
      this.pathIndices.clear();
      this.scroller.scrollTop = 0;
      this.measure();
    }
  }

  componentWillUnmount() {
    const { onVirtualWindow } = this.props;

    this.scroller.removeEventListener('scroll', this.scheduleMeasure);
    this.resizeObserver.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    onVirtualWindow(null);
  }

  scheduleMeasure = () => {
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.measure();
      });
    }
  };

  measure = () => {
    const { grid } = this.props;
    const anchor = this.anchor.current;
    const host = this.scroller;
    const header = anchor.closest('table').tHead;

    this.setState({
      scrollTop: host.scrollTop,
      height: host.clientHeight,
      width: grid ? anchor.clientWidth : host.clientWidth,
      offset:
        anchor.getBoundingClientRect().top -
        host.getBoundingClientRect().top -
        host.clientTop +
        host.scrollTop,
      headerHeight: header ? header.getBoundingClientRect().height : 0,
    });
  };

  dimensions = () => {
    const { grid } = this.props;
    const { width } = this.state;

    return {
      columns: grid ? Math.max(1, Math.floor(width / GRID_ITEM_WIDTH)) : 1,
      rowHeight: grid ? GRID_ROW_HEIGHT : LIST_ROW_HEIGHT,
    };
  };

  // Public navigation API registered with FileExplorer.
  // eslint-disable-next-line react/no-unused-class-component-methods
  scrollToPath = (path) => {
    const { tableSort } = this.props;

    if (this.indexedNodes !== tableSort) {
      this.indexedNodes = tableSort;
      this.pathIndices = new Map(
        tableSort.map((item, index) => [item.path, index])
      );
    }

    const index = this.pathIndices.get(path);

    if (index === undefined) return;
    this.scroller.scrollTop = getScrollTopForIndex({
      ...this.state,
      ...this.dimensions(),
      scrollTop: this.scroller.scrollTop,
      index,
    });
    // Render the destination even when it has no DOM element yet.
    this.measure();
  };

  render() {
    const { grid, tableSort, selectedPaths, ...rowProps } = this.props;
    const { scrollTop, height, offset, headerHeight } = this.state;
    const { columns, rowHeight } = this.dimensions();
    const range = getVirtualWindow({
      count: tableSort.length,
      columns,
      rowHeight,
      top: scrollTop + headerHeight - offset,
      height: Math.max(0, height - headerHeight),
    });
    const Row = grid
      ? FileExplorerTableBodyGridRender
      : FileExplorerTableBodyListRender;
    const items = tableSort
      .slice(range.start, range.end)
      .map((item) => (
        <Row
          {...rowProps}
          key={item.path}
          item={item}
          isSelected={selectedPaths.has(item.path)}
        />
      ));

    if (grid) {
      return (
        <TableRow>
          <TableCell colSpan={6} style={{ padding: '0 5px', border: 0 }}>
            <div
              ref={this.anchor}
              style={{ height: range.totalHeight, position: 'relative' }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: range.before,
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, ${GRID_ITEM_WIDTH}px)`,
                  gridAutoRows: GRID_ROW_HEIGHT,
                }}
              >
                {items}
              </div>
            </div>
          </TableCell>
        </TableRow>
      );
    }

    return (
      <>
        <tr ref={this.anchor} aria-hidden="true">
          <td colSpan={6} style={{ ...spacerStyle, height: range.before }} />
        </tr>
        {items}
        <tr aria-hidden="true">
          <td colSpan={6} style={{ ...spacerStyle, height: range.after }} />
        </tr>
      </>
    );
  }
}
