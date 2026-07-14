import { fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ContactsPage from '@/app/dashboard/contacts/page';
import { api } from '@/lib/api';
import { renderWithI18n } from './test-utils';

Object.assign(api, {
  createContact: vi.fn(),
  deleteContact: vi.fn(),
  syncContactsFromWhatsApp: vi.fn(),
  updateContact: vi.fn(),
});

const contacts = [
  {
    id: 'alice',
    profileId: 'profile-1',
    name: 'Alice',
    phone: '111',
    tags: ['vip'],
    metadata: { email: 'alice@example.com', source: 'import', tagColors: { vip: '#22c55e' } },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'bob',
    profileId: 'profile-1',
    name: 'Bob',
    phone: '222',
    tags: ['customer'],
    metadata: { contactColor: '#ec4899' },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('Contacts behavior', () => {
  beforeEach(() => {
    vi.mocked(api.createContact).mockReset();
    vi.mocked(api.deleteContact).mockReset();
    vi.mocked(api.getContacts).mockReset();
    vi.mocked(api.getProfiles).mockReset();
    vi.mocked(api.syncContactsFromWhatsApp).mockReset();
    vi.mocked(api.updateContact).mockReset();

    vi.mocked(api.createContact).mockResolvedValue({ data: contacts[0], status: 201 } as never);
    vi.mocked(api.deleteContact).mockResolvedValue({ data: undefined, status: 204 } as never);
    vi.mocked(api.getContacts).mockResolvedValue({
      data: { contacts, total: contacts.length, limit: 50, offset: 0 },
      status: 200,
    } as never);
    vi.mocked(api.getProfiles).mockResolvedValue({
      data: [{ id: 'profile-1', name: 'Primary', status: 'connected' }],
      status: 200,
    } as never);
    vi.mocked(api.syncContactsFromWhatsApp).mockResolvedValue({ data: undefined, status: 200 } as never);
    vi.mocked(api.updateContact).mockResolvedValue({ data: contacts[0], status: 200 } as never);
  });

  it('uses filtered dataset in both contact layouts', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ContactsPage />);
    await screen.findAllByText('Alice');

    await user.type(screen.getByRole('textbox', { name: 'Search contacts...' }), 'alice');

    await waitFor(() => expect(screen.queryByText('Bob')).not.toBeInTheDocument());
    expect(screen.getAllByText('Alice')).toHaveLength(2);
  });

  it('persists selected contact color while retaining selected tag color', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ContactsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add Contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add New Contact' });
    await user.type(within(dialog).getByLabelText('Name *'), 'Carol');
    await user.type(within(dialog).getByLabelText('Phone *'), '333');
    await user.type(within(dialog).getByTestId('tag-input'), 'vip:#22c55e{enter}');
    await user.click(within(dialog).getByRole('radio', { name: '#ec4899' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Contact' }));

    await waitFor(() => expect(api.createContact).toHaveBeenCalledTimes(1));
    expect(api.createContact).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        contactColor: '#ec4899',
        tagColors: expect.objectContaining({ vip: '#22c55e' }),
      }),
    }));
  });

  it('preserves email, source, and tag colors when updating contact color', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ContactsPage />);
    await screen.findAllByText('Alice');

    await user.click(screen.getAllByRole('button', { name: 'Edit Alice' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Edit Contact' });
    await user.click(within(dialog).getByRole('radio', { name: '#ec4899' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.updateContact).toHaveBeenCalledTimes(1));
    expect(api.updateContact).toHaveBeenCalledWith('alice', expect.objectContaining({
      metadata: expect.objectContaining({
        email: 'alice@example.com',
        source: 'import',
        tagColors: expect.objectContaining({ vip: '#22c55e' }),
        contactColor: '#ec4899',
      }),
    }));
  });

  it('filters contacts by persisted contact-level color', async () => {
    renderWithI18n(<ContactsPage />);
    await screen.findAllByText('Bob');

    fireEvent.click(screen.getByRole('button', { name: 'Filter by color #ec4899' }));

    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    expect(screen.getAllByText('Bob')).toHaveLength(2);
  });
});
