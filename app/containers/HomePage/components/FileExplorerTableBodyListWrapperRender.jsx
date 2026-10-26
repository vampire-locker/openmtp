import React from 'react';
import FileExplorerVirtualWindow from './FileExplorerVirtualWindow';

export default function FileExplorerTableBodyListWrapperRender(props) {
  return <FileExplorerVirtualWindow {...props} grid={false} />;
}
