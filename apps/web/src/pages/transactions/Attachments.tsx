import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { useToast } from '../../components/Toast';
import { spacePath } from '../../lib/api';
import { prepareReceipt } from '../../lib/image-prepare';
import { useAttachmentMutations, useAttachments, useSpaceId } from '../../lib/queries';
import { errorText } from './EntryForm';

const size = (bytes: number) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;

/** Comprovantes (foto ou PDF) de um lançamento. */
export function Attachments({ transactionId }: { transactionId: string }) {
  const spaceId = useSpaceId();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const list = useAttachments(transactionId);
  const { upload, remove } = useAttachmentMutations(transactionId);
  const items = list.data ?? [];
  const error = upload.error ?? remove.error;

  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const { blob, name } = await prepareReceipt(file);
    upload.mutate(
      { file: blob, name },
      { onSuccess: () => toast({ text: 'Comprovante anexado.' }) },
    );
    if (input.current) input.current.value = '';
  };

  return (
    <section className="card card--pad stack" aria-labelledby="att-title">
      <h2 id="att-title">Comprovantes</h2>
      {error && (
        <p className="alert alert--error" role="alert">
          {errorText(error)}
        </p>
      )}
      {items.length === 0 && list.isSuccess && (
        <p className="muted">Nenhum comprovante. Tire uma foto ou anexe um PDF.</p>
      )}
      <ul className="attachments">
        {items.map((a) => {
          const href = spacePath(spaceId, `/attachments/${a.id}/file`);
          return (
            <li key={a.id} className="attachments__item">
              <a href={href} target="_blank" rel="noreferrer" className="attachments__link">
                {a.mime === 'application/pdf' ? (
                  <span className="attachments__thumb attachments__thumb--pdf">
                    <FileText size={24} aria-hidden="true" />
                  </span>
                ) : (
                  <img className="attachments__thumb" src={href} alt="" loading="lazy" />
                )}
                <span>
                  <strong>{a.fileName}</strong>
                  <span className="muted">{size(a.size)}</span>
                </span>
              </a>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remover ${a.fileName}`}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(a.id, { onSuccess: () => toast({ text: 'Comprovante removido.' }) })
                }
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        hidden
        onChange={(e) => void pick(e.target.files)}
      />
      <button
        type="button"
        className="btn"
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={18} aria-hidden="true" />
        {upload.isPending ? 'Enviando…' : 'Anexar foto ou PDF'}
      </button>
    </section>
  );
}
