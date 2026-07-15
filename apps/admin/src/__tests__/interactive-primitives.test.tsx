import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

describe('interactive primitives', () => {
  it('opens Select by keyboard, skips disabled options, selects, and restores trigger focus', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select value="one" onValueChange={onValueChange}>
        <SelectTrigger aria-label="Choose status"><SelectValue placeholder="Choose" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
          <SelectItem value="two" disabled>Two</SelectItem>
          <SelectItem value="three">Three</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox', { name: 'Choose status' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');

    const listbox = await screen.findByRole('listbox');
    expect(trigger).toHaveAttribute('aria-controls', listbox.id);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: 'Two' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'One' })).toHaveFocus();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('three');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('opens DropdownMenu by keyboard, skips disabled items, activates item, and restores focus', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>First</DropdownMenuItem>
          <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
          <DropdownMenuItem onClick={onSelect}>Last</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');

    const menu = await screen.findByRole('menu');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Disabled' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('uses roving tabs with linked tabpanels and keyboard navigation', async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="one">
        <TabsList aria-label="Sections">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two" disabled>Two</TabsTrigger>
          <TabsTrigger value="three">Three</TabsTrigger>
        </TabsList>
        <TabsContent value="one">Panel one</TabsContent>
        <TabsContent value="three">Panel three</TabsContent>
      </Tabs>,
    );

    const one = screen.getByRole('tab', { name: 'One' });
    const three = screen.getByRole('tab', { name: 'Three' });
    expect(one).toHaveAttribute('tabindex', '0');
    expect(three).toHaveAttribute('tabindex', '-1');
    expect(one).toHaveAttribute('aria-selected', 'true');
    expect(one).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', one.id);

    one.focus();
    await user.keyboard('{ArrowRight}');
    expect(three).toHaveFocus();
    expect(three).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel three');

    await user.keyboard('{Home}');
    expect(one).toHaveFocus();
    expect(one).toHaveAttribute('aria-selected', 'true');
  });

  it('uses logical popup alignment for RTL Select and DropdownMenu', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });

    const { unmount } = render(
      <div dir="rtl">
        <Select><SelectTrigger aria-label="RTL select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one">One</SelectItem></SelectContent></Select>
        <DropdownMenu><DropdownMenuTrigger>RTL menu</DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem>Item</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>,
    );
    const selectTrigger = screen.getByRole('combobox', { name: 'RTL select' });
    const menuTrigger = screen.getByRole('button', { name: 'RTL menu' });
    const rect = { bottom: 40, left: 100, right: 300, width: 200, top: 20, height: 20, x: 100, y: 20, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(selectTrigger, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(menuTrigger, 'getBoundingClientRect').mockReturnValue(rect);

    await user.click(selectTrigger);
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toHaveStyle({ insetInlineStart: '700px' });
    expect(listbox).toHaveAttribute('dir', 'rtl');
    await user.keyboard('{Escape}');
    await user.click(menuTrigger);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveStyle({ insetInlineStart: '700px' });
    expect(menu).toHaveAttribute('dir', 'rtl');
    unmount();
  });
});
