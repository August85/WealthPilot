import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@wealthpilot/contracts';
import { scrubProps } from '@wealthpilot/shared';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '@/app/providers';
import { useApiMutation } from '@/lib/hooks';
import { createAppQueryClient } from '@/lib/query';
import { createMockApi, renderWithApi } from '@/test/mockApi';

const problem = (status: number, code: string) => ({ type: 'about:blank', title: code, status, code, detail: `${code} detail` });

function SaveButton({ withConflict = true }: { withConflict?: boolean }) {
  const m = useApiMutation((api) => api.accounts.update('a1', { name: 'New', version: 3 }), {
    conflict: withConflict ? { entity: 'this account' } : undefined,
  });
  return (
    <button type="button" data-testid="save" onClick={() => m.mutate()}>
      {m.isError ? 'failed' : 'idle'}
    </button>
  );
}

describe('API client wiring', () => {
  it('sends the bearer token and versioned PATCH bodies', async () => {
    const { api, calls } = createMockApi([{ method: 'PATCH', path: '/accounts/a1', body: { id: 'a1' } }]);
    await api.accounts.update('a1', { name: 'New', version: 3 });
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/accounts/a1',
      body: { name: 'New', version: 3 },
      headers: { Authorization: 'Bearer dev:test-user:test@example.com' },
    });
  });

  it('shows the resolve prompt on 409 VERSION_CONFLICT and never retries (no last-write-wins)', async () => {
    const { calls } = renderWithApi(<SaveButton />, [
      { method: 'PATCH', path: '/accounts/a1', status: 409, body: problem(409, 'VERSION_CONFLICT') },
    ]);
    fireEvent.click(screen.getByTestId('save'));
    expect(await screen.findByTestId('conflict-dialog')).toBeInTheDocument();
    expect(screen.getByText(/nothing was overwritten/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('conflict-keep'));
    await waitFor(() => expect(screen.queryByTestId('conflict-dialog')).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('routes 402 PLAN_LIMIT to the plan-limit handler and unhandled 409s to the global handler', async () => {
    const onPlanLimit = vi.fn();
    const onVersionConflict = vi.fn();
    const client = createAppQueryClient({ onPlanLimit, onVersionConflict });
    client.setDefaultOptions({ mutations: { gcTime: Infinity, retry: false }, queries: { gcTime: Infinity, retry: false } });
    const { api } = createMockApi([
      { method: 'POST', path: '/accounts', status: 402, body: problem(402, 'PLAN_LIMIT') },
      { method: 'PATCH', path: '/accounts/a1', status: 409, body: problem(409, 'VERSION_CONFLICT') },
    ]);
    function AddButton() {
      const m = useApiMutation((a) => a.accounts.create({ kind: 'asset', type: 'cash', name: 'x', country: 'US', currency: 'USD' }));
      return <button type="button" data-testid="add" onClick={() => m.mutate()} />;
    }
    render(
      <TestProviders client={client} api={api}>
        <AddButton />
        <SaveButton withConflict={false} />
      </TestProviders>,
    );
    fireEvent.click(screen.getByTestId('add'));
    await waitFor(() => expect(onPlanLimit).toHaveBeenCalledTimes(1));
    const err = onPlanLimit.mock.calls[0]?.[0] as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('PLAN_LIMIT');

    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(onVersionConflict).toHaveBeenCalledTimes(1));
    client.clear();
  });

  it('turns a plan-limit event into a redirect to the subscription page', async () => {
    const { nav } = await import('@/test/setup');
    const { Providers } = await import('@/app/providers');
    render(
      <Providers>
        <span>app</span>
      </Providers>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('wp:plan-limit', { detail: 'accounts' }));
    });
    expect(nav.router.push).toHaveBeenCalledWith('/subscription?reason=accounts');
  });
});

describe('analytics', () => {
  it('drops amounts and PII even if a caller bypasses the types', () => {
    const scrubbed = scrubProps({
      screen: 'overview',
      currency: 'USD',
      ...({ balance: '1000', email: 'a@b.com', account_id: 'x', reason: 'user@example.com', note: '123456' } as object),
    });
    expect(scrubbed).toEqual({ screen: 'overview', currency: 'USD' });
  });
});
