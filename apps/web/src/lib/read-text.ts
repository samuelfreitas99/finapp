/** Lê um arquivo de texto: UTF-8 e, se não for válido, Windows-1252 (extratos antigos de banco). */
export async function readTextFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
