// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DecimalInput, IntegerInput } from './NumberInputs';

afterEach(cleanup);

function Int({ start = 12, min = 1, max = 600, emptyWhenZero = false }) {
  const [v, setV] = useState(start);
  return (
    <>
      <IntegerInput
        aria-label="parcelas"
        value={v}
        onChange={setV}
        min={min}
        max={max}
        emptyWhenZero={emptyWhenZero}
      />
      <output data-testid="value">{v}</output>
    </>
  );
}

function Dec({ start = 50 }) {
  const [v, setV] = useState(start);
  return (
    <>
      <DecimalInput aria-label="percentual" value={v} onChange={setV} />
      <output data-testid="value">{v}</output>
    </>
  );
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const value = () => screen.getByTestId('value').textContent;

describe('IntegerInput', () => {
  it('lets you erase everything and type 21 (no stuck minimum)', async () => {
    const user = userEvent.setup();
    render(<Int />);
    const input = field('parcelas');
    await user.click(input);
    await user.keyboard('{Backspace}{Backspace}');
    expect(input.value).toBe('');
    await user.keyboard('21');
    expect(input.value).toBe('21');
    expect(value()).toBe('21');
  });

  it('selects the number on focus so typing replaces it', async () => {
    const user = userEvent.setup();
    render(<Int start={12} />);
    await user.click(field('parcelas'));
    await user.keyboard('36');
    expect(value()).toBe('36');
  });

  it('uses a numeric keypad and drops non-digits', async () => {
    const user = userEvent.setup();
    render(<Int />);
    const input = field('parcelas');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.type).toBe('text');
    await user.click(input);
    await user.keyboard('{Backspace}{Backspace}1a,2');
    expect(input.value).toBe('12');
  });

  it('keeps the last valid value when left empty or below the minimum', async () => {
    const user = userEvent.setup();
    render(<Int start={12} />);
    const input = field('parcelas');
    await user.click(input);
    await user.keyboard('{Backspace}{Backspace}');
    await user.tab();
    expect(input.value).toBe('12');
    expect(value()).toBe('12');
    await user.click(input);
    await user.keyboard('0');
    expect(value()).toBe('12');
    await user.tab();
    expect(input.value).toBe('12');
  });

  it('caps at the maximum', async () => {
    const user = userEvent.setup();
    render(<Int start={5} max={120} />);
    await user.click(field('parcelas'));
    await user.keyboard('999');
    expect(value()).toBe('120');
    expect(field('parcelas').value).toBe('120');
  });

  it('supports optional fields that show empty for zero', async () => {
    const user = userEvent.setup();
    render(<Int start={0} min={0} emptyWhenZero />);
    const input = field('parcelas');
    expect(input.value).toBe('');
    await user.click(input);
    await user.keyboard('24');
    expect(value()).toBe('24');
    await user.keyboard('{Backspace}{Backspace}');
    expect(value()).toBe('0');
  });
});

describe('DecimalInput', () => {
  it('accepts comma or dot and ignores letters', async () => {
    const user = userEvent.setup();
    render(<Dec start={50} />);
    const input = field('percentual');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    await user.click(input);
    await user.keyboard('{Backspace}{Backspace}33,5x');
    expect(input.value).toBe('33,5');
    expect(value()).toBe('33.5');
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}60.25');
    expect(value()).toBe('60.25');
  });

  it('ignores values above 100 and restores on blur', async () => {
    const user = userEvent.setup();
    render(<Dec start={40} />);
    const input = field('percentual');
    await user.click(input);
    await user.keyboard('150');
    expect(value()).toBe('15');
    await user.tab();
    expect(input.value).toBe('15');
  });
});
