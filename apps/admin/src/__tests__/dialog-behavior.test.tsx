import * as React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

function ControlledDialog({ closeButtonAriaLabel }: { closeButtonAriaLabel?: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeButtonAriaLabel={closeButtonAriaLabel}>
          <DialogTitle>Settings</DialogTitle>
          Dialog body
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ConditionalDialogHandle {
  remove(): void;
}

const ConditionallyMountedDialog = React.forwardRef<ConditionalDialogHandle>((_, ref) => {
  const [mounted, setMounted] = React.useState(true);
  const [open, setOpen] = React.useState(false);

  React.useImperativeHandle(ref, () => ({ remove: () => setMounted(false) }));

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open conditional dialog
      </button>
      {mounted && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Conditional settings</DialogTitle>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
});

describe('Dialog behavior', () => {
  it('names dialog from its title and exposes a stable close-label fallback', async () => {
    render(<ControlledDialog />);

    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    const title = screen.getByRole('heading', { name: 'Settings' });
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
  });

  it('uses caller-provided close control accessible label', async () => {
    render(<ControlledDialog closeButtonAriaLabel="Dismiss settings" />);

    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(await screen.findByRole('button', { name: 'Dismiss settings' })).toBeInTheDocument();
  });

  it('closes on Escape and restores focus to element active before opening', async () => {
    const user = userEvent.setup();
    render(<ControlledDialog />);

    const trigger = screen.getByRole('button', { name: 'Open settings' });
    trigger.focus();
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('restores focus when an open dialog unmounts while prior element remains connected', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<ConditionalDialogHandle>();
    render(<ConditionallyMountedDialog ref={ref} />);

    const trigger = screen.getByRole('button', { name: 'Open conditional dialog' });
    trigger.focus();
    await user.click(trigger);

    await act(async () => ref.current?.remove());

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
