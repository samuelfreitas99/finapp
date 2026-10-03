const MAX_SIDE = 1800;
const SHRINK_ABOVE = 1_500_000;

/**
 * Reduz foto grande do celular (máx. 1800 px, JPEG) antes de enviar; PDFs e imagens
 * pequenas vão como estão. Se algo falhar, envia o original.
 */
export async function prepareReceipt(file: File): Promise<{ blob: Blob; name: string }> {
  const isPhoto = /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!isPhoto || file.size <= SHRINK_ABOVE) return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82),
    );
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
  } catch {
    return { blob: file, name: file.name };
  }
}
