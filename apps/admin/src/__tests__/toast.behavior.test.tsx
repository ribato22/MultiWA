import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/use-toast';

describe('toast behavior', () => {
  it('announces toast content and dismisses it from its visible close control', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<Toaster />);

    act(() => {
      toast({
        title: 'Changes saved',
        description: 'Your profile changes are now live.',
      });
    });

    // Assert
    const announcement = await screen.findByRole('status');
    expect(announcement).toHaveTextContent('Changes saved');
    expect(announcement).toHaveTextContent('Your profile changes are now live.');

    const closeControl = screen.getByRole('button', { name: 'Close' });
    expect(closeControl).toBeVisible();

    await user.click(closeControl);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
