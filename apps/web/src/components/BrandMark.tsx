import { Wallet } from 'lucide-react';

export function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <span className="auth__mark" style={{ width: size, height: size }} aria-hidden="true">
      <Wallet size={size / 2} strokeWidth={2} />
    </span>
  );
}
