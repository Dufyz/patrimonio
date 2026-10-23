/**
 * Os arquivos da exportação, montados no navegador: CSV por tabela dentro de um
 * zip sem compressão (o método "stored" do formato), e o JSON como veio.
 * Nenhuma dependência: um zip sem compressão são cabeçalhos e bytes.
 */

type Table = readonly Record<string, unknown>[];

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const BOM = String.fromCharCode(0xfeff);

export const toCsv = (rows: Table): string => {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }
  const lines = [columns.join(',')];
  for (const row of rows)
    lines.push(columns.map((column) => cell(row[column])).join(','));
  // BOM: sem ele o Excel abre o UTF-8 como Latin-1 e estraga os acentos.
  return BOM + lines.join('\r\n') + '\r\n';
};

/** Um documento de exportação vira um CSV por tabela. */
export const csvFiles = (
  document: string,
): readonly { readonly name: string; readonly content: string }[] => {
  const parsed = JSON.parse(document) as { tables?: Record<string, Table> };
  return Object.entries(parsed.tables ?? {}).map(([name, rows]) => ({
    name: `${name}.csv`,
    content: toCsv(rows),
  }));
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export const zipStore = (
  files: readonly { readonly name: string; readonly content: string }[],
  now: Date = new Date(),
): Uint8Array => {
  const encoder = new TextEncoder();
  const dosDate =
    ((Math.max(now.getFullYear(), 1980) - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const header = (size: number): { view: DataView; bytes: Uint8Array } => {
    const bytes = new Uint8Array(size);
    return { view: new DataView(bytes.buffer), bytes };
  };

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const local = header(30 + name.length);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true);
    local.view.setUint16(10, 0, true);
    local.view.setUint16(12, dosDate, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    local.bytes.set(name, 30);

    const entry = header(46 + name.length);
    entry.view.setUint32(0, 0x02014b50, true);
    entry.view.setUint16(4, 20, true);
    entry.view.setUint16(6, 20, true);
    entry.view.setUint16(8, 0x0800, true);
    entry.view.setUint16(14, dosDate, true);
    entry.view.setUint32(16, crc, true);
    entry.view.setUint32(20, data.length, true);
    entry.view.setUint32(24, data.length, true);
    entry.view.setUint16(28, name.length, true);
    entry.view.setUint32(42, offset, true);
    entry.bytes.set(name, 46);

    chunks.push(local.bytes, data);
    central.push(entry.bytes);
    offset += local.bytes.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);

  const all = [...chunks, ...central, end.bytes];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of all) {
    out.set(part, position);
    position += part.length;
  }
  return out;
};

/** Entrega o conteúdo ao navegador como um download. */
export const saveFile = (name: string, content: BlobPart, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const exportName = (extension: string, now: Date = new Date()): string =>
  `patrimonio-${now.toISOString().slice(0, 10)}.${extension}`;
