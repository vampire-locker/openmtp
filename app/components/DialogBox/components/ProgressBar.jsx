import React, { PureComponent, Fragment } from 'react';
import classnames from 'classnames';
import { withStyles } from '@material-ui/core/styles';
import LinearProgress from '@material-ui/core/LinearProgress';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import Button from '@material-ui/core/Button';
import Tooltip from '@material-ui/core/Tooltip';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import LiveHelpIcon from '@material-ui/icons/LiveHelp';
import { styles } from '../styles/ProgressBar';
import { checkIf } from '../../../utils/checkIf';

class ProgressBar extends PureComponent {
  render() {
    const {
      classes: styles,

      /**
       *  [{
       *    percentage,
       *    variant,
       *    bodyText1,
       *    bodyText2,
       *  }]
       */
      values,
      trigger,
      titleText,
      fullWidthDialog,
      maxWidthDialog,
      helpText,
      children,
      bottomText,
      canCancel,
      cancelling,
      onCancel,
    } = this.props;

    checkIf(values, 'array');

    return (
      <Dialog
        disableBackdropClick
        disableEscapeKeyDown
        className={styles.root}
        open={trigger}
        fullWidth={fullWidthDialog}
        maxWidth={maxWidthDialog}
        aria-labelledby="progressbar-dialogbox"
      >
        <DialogTitle>
          <span className={styles.dialogTitleInnerWrapper}>
            <span className={styles.titleText}>{titleText}</span>
            {helpText && (
              <span>
                <Tooltip title={helpText}>
                  <LiveHelpIcon className={styles.helpText} />
                </Tooltip>
              </span>
            )}
          </span>
        </DialogTitle>
        {canCancel && (
          <DialogActions>
            <Button
              onClick={onCancel}
              disabled={cancelling}
              color="secondary"
              variant="outlined"
            >
              {cancelling ? 'Stopping…' : 'Stop copying'}
            </Button>
          </DialogActions>
        )}

        <DialogContent>
          {cancelling && (
            <DialogContentText role="status">
              Stopping… waiting for the phone to respond. Completed files will
              be kept.
            </DialogContentText>
          )}
          {values.map((a, index) => {
            return (
              // eslint-disable-next-line react/no-array-index-key
              <Fragment key={index}>
                <DialogContentText
                  className={classnames(styles.dialogContentTextTop, {
                    [styles.dialogFixMultipleProgressPadding]: index > 0,
                  })}
                >
                  {a.bodyText1 ?? ''}
                </DialogContentText>

                <LinearProgress
                  color="secondary"
                  variant={a.variant ?? 'determinate'}
                  value={a.percentage}
                />

                <DialogContentText className={styles.dialogContentTextBottom}>
                  {a.bodyText2 ?? ''}
                </DialogContentText>
              </Fragment>
            );
          })}

          {bottomText && <div className={styles.bottomText}>{bottomText}</div>}
          {children && <div className={styles.childrenWrapper}>{children}</div>}
        </DialogContent>
      </Dialog>
    );
  }
}

export default withStyles(styles)(ProgressBar);
