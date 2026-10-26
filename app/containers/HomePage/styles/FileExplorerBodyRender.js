import { mixins } from '../../../styles/js';

export const styles = (theme) => ({
  root: {
    width: '100%',
    position: 'relative',
    ...mixins({ theme }).noselect,
  },
  readingOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
  },
  tableWrapper: {
    ...mixins({ theme }).noOutline,
    height: `calc(100vh - 120px)`,
    overflowY: 'auto',
    overflowX: 'auto',
    borderBottom: `solid 1px ${theme.palette.fileExplorerThinLineDividerColor}`,
    borderLeft: `solid 1px ${theme.palette.fileExplorerThinLineDividerColor}`,
    [`&.onHoverDropZone`]: {
      backgroundColor: theme.palette.fileDrop,
    },
    [`&.statusBarActive`]: {
      height: `calc(100vh - 150px) !important`,
    },
  },
});
