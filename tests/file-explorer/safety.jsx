import React from 'react';
import ReactDOM from 'react-dom';
import ProgressBar from '../../app/components/DialogBox/components/ProgressBar';

const root = document.getElementById('root');
const settle = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
let requests = 0;

function Fixture({ canCancel }) {
  const [cancelling, setCancelling] = React.useState(false);

  return (
    <ProgressBar
      trigger
      values={[]}
      titleText="Copying files to Computer…"
      canCancel={canCancel}
      cancelling={cancelling}
      onCancel={() => {
        requests += 1;
        setCancelling(true);
      }}
    />
  );
}

async function run() {
  ReactDOM.render(<Fixture canCancel />, root);
  await settle();
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent === 'Stop copying'
  );

  if (!button || button.disabled)
    throw new Error('Stop button missing or disabled');
  button.click();
  await settle();
  if (!button.disabled || button.textContent !== 'Stopping…' || requests !== 1)
    throw new Error('Stopping state incorrect');
  button.click();
  if (requests !== 1 || !document.querySelector('[role="status"]'))
    throw new Error('Duplicate cancellation or no stopping status');
  ReactDOM.unmountComponentAtNode(root);
  ReactDOM.render(<Fixture canCancel={false} />, root);
  await settle();
  if (
    [...document.querySelectorAll('button')].some((node) =>
      /Stop/.test(node.textContent)
    )
  )
    throw new Error('Unsupported transfer exposes stop control');
  ReactDOM.unmountComponentAtNode(root);

  return {
    status: 'passed',
    checks: [
      'stop button',
      'disabled while stopping',
      'status text',
      'unsupported kernel',
    ],
  };
}

window.testPromise = run();
