import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@wealthpilot/contracts';
import { Pressable, Text } from 'react-native';

import { useUiStore } from '@/store/ui';
import { createMockApi, renderWithApi } from '@/test/mockApi';

import { scrubProps } from '../analytics';
import { useApiMutation } from '../hooks';
import { TestProviders } from '../providers';
import { createAppQueryClient } from '../query';

const problem = (status: number, code: string) => ({ type: 'about:blank', title: code, status, code, detail: `${code} detail` });

function SaveButton({ withConflict = true }: { withConflict?: boolean }) {
  const m = useApiMutation((api) => api.accounts.update('a1', { name: 'New', version: 3 }), {
    conflict: withConflict ? { entity: 'this account' } : undefined,
  });
  return (
    <Pressable testID="save" onPress={() => m.mutate()}>
      <Text>{m.isError ? 'failed' : 'idle'}</Text>
    </Pressable>
  );
}

beforeEach(() => useUiStore.getState().reset());

describe('API client in the app', () => {
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

  it('shows the resolve prompt on 409 VERSION_CONFLICT instead of overwriting', async () => {
    const { calls } = await renderWithApi(<SaveButton />, [
      { method: 'PATCH', path: '/accounts/a1', status: 409, body: problem(409, 'VERSION_CONFLICT') },
    ]);
    await fireEvent.press(screen.getByTestId('save'));
    expect(await screen.findByTestId('conflict-dialog')).toBeTruthy();
    expect(screen.getByText(/nothing was overwritten/)).toBeTruthy();
    // Exactly one write attempt; no automatic retry with a newer version.
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('conflict-keep'));
    await waitFor(() => expect(screen.queryByTestId('conflict-dialog')).toBeNull());
  });

  it('routes 402 PLAN_LIMIT to the plan-limit handler and 409 without a local handler to the global one', async () => {
    const onPlanLimit = jest.fn();
    const onVersionConflict = jest.fn();
    const client = createAppQueryClient({ onPlanLimit, onVersionConflict });
    client.setDefaultOptions({ mutations: { gcTime: Infinity }, queries: { gcTime: Infinity } });
    const { api } = createMockApi([
      { method: 'POST', path: '/accounts', status: 402, body: problem(402, 'PLAN_LIMIT') },
      { method: 'PATCH', path: '/accounts/a1', status: 409, body: problem(409, 'VERSION_CONFLICT') },
    ]);
    function AddButton() {
      const m = useApiMutation((a) =>
        a.accounts.create({ kind: 'asset', type: 'cash', name: 'x', country: 'US', currency: 'USD' }),
      );
      return <Pressable testID="add" onPress={() => m.mutate()} />;
    }
    await render(
      <TestProviders client={client} api={api}>
        <AddButton />
        <SaveButton withConflict={false} />
      </TestProviders>,
    );
    await fireEvent.press(screen.getByTestId('add'));
    await waitFor(() => expect(onPlanLimit).toHaveBeenCalledTimes(1));
    expect(onPlanLimit.mock.calls[0]![0]).toBeInstanceOf(ApiError);
    expect((onPlanLimit.mock.calls[0]![0] as ApiError).code).toBe('PLAN_LIMIT');

    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => expect(onVersionConflict).toHaveBeenCalledTimes(1));
    client.clear();
  });

  it('keeps query provider usable without a network (sanity)', async () => {
    const client = createAppQueryClient();
    await render(
      <QueryClientProvider client={client}>
        <Text>ok</Text>
      </QueryClientProvider>,
    );
    expect(screen.getByText('ok')).toBeTruthy();
    client.clear();
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
