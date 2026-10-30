/* eslint-disable no-control-regex -- Reject control characters in project paths. */
'use client';
import JSZip from 'jszip';
import { pdfPageText } from './document-reading';
import {
  thesisPath,
  type ThesisFile,
  type ThesisProject,
} from '@/lib/thesis/model';

export async function importThesisFile(
  file: File,
  directory: string,
  progress: (message: string) => void,
): Promise<ThesisFile> {
  const name = file.name.replace(/[\\/\x00-\x1f]/g, '_'),
    path = thesisPath(`${directory}/${name}`);
  if (file.size > 80 * 1024 * 1024)
    throw new Error(`${name} 超过 80 MB，请拆分后导入。`);
  let text = '',
    pages: number | undefined;
  if (/\.pdf$/i.test(name)) {
    const { openPdf } = await import('./pdf-runtime'),
      url = URL.createObjectURL(file),
      task = openPdf(url);
    try {
      const pdf = await task.promise;
      pages = pdf.numPages;
      if (pages > 500) throw new Error('PDF 超过 500 页，请拆分。');
      for (let n = 1; n <= pages; n++) {
        progress(`正在本地读取 ${name} · ${n}/${pages} 页`);
        const page = await pdf.getPage(n),
          content = await page.getTextContent();
        text += `=== PDF p.${n} ===\n${pdfPageText(content.items.filter((item) => 'str' in item))}\n\n`;
        page.cleanup();
        if (text.length > 2000000) throw new Error('PDF 文字过多，请拆分。');
      }
      if (text.replace(/=== PDF p\.\d+ ===/g, '').trim().length < 30)
        throw new Error(
          '这份 PDF 没有可读取的文字。请先做 OCR，再导入；当前不支持扫描件识别。',
        );
    } finally {
      await task.destroy();
      URL.revokeObjectURL(url);
    }
  } else if (/\.docx$/i.test(name)) {
    const mammoth = await import('mammoth/mammoth.browser.js');
    text = (
      await mammoth.default.extractRawText({
        arrayBuffer: await file.arrayBuffer(),
      })
    ).value;
  } else if (/\.(txt|md|csv)$/i.test(name)) text = await file.text();
  else throw new Error('请导入 PDF、DOCX、TXT、MD 或 CSV。CAJ 请先转成 PDF。');
  if (!text.trim() || text.length > 2000000)
    throw new Error('文件没有可读文字或超过 200 万字，请检查后重试。');
  return {
    path,
    text,
    pages,
    uploaded: true,
    mediaType: file.type,
    modifiedAt: Date.now(),
    blob: file,
  };
}
export function downloadThesisBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const xml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
/** A portable Word document; plain Markdown markers are removed, all words and citations retained. */
export async function exportThesisWord(file: ThesisFile) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const paragraphs = file.text
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,6})\s/.exec(line);
      return `<w:p>${heading ? `<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>` : ''}<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="宋体"/><w:sz w:val="${heading ? 32 : 24}"/>${heading ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(line.replace(/^#{1,6}\s|^>\s/g, '').replace(/\*\*/g, ''))}</w:t></w:r></w:p>`;
    })
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  downloadThesisBlob(
    await zip.generateAsync({ type: 'blob' }),
    file.path.split('/').at(-1)!.replace(/\.md$/, '.docx'),
  );
}
export async function exportThesisProject(project: ThesisProject) {
  const zip = new JSZip();
  for (const file of Object.values(project.files))
    zip.file(file.path, file.blob ? await file.blob.arrayBuffer() : file.text);
  zip.file(
    'lumior-project.json',
    JSON.stringify(
      {
        ...project,
        files: Object.fromEntries(
          Object.entries(project.files).map(
            ([path, { blob: _blob, ...file }]) => [path, file],
          ),
        ),
      },
      null,
      2,
    ),
  );
  downloadThesisBlob(
    await zip.generateAsync({ type: 'blob' }),
    `${project.title}-论文备份.zip`,
  );
}
export async function restoreThesisProject(file: File): Promise<ThesisProject> {
  if (file.size > 200 * 1024 * 1024) throw new Error('备份超过 200 MB。');
  const zip = await JSZip.loadAsync(file),
    entry = zip.file('lumior-project.json');
  if (!entry) throw new Error('请选择 Lumior 导出的论文备份。');
  const value = JSON.parse(await entry.async('string')) as ThesisProject;
  if (
    value.version !== 1 ||
    !value.files ||
    !Array.isArray(value.sessions) ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.directories)
  )
    throw new Error('备份格式无效。');
  value.directories.forEach(thesisPath);
  let size = 0;
  for (const [path, item] of Object.entries(value.files)) {
    if (
      thesisPath(path) !== path ||
      item.path !== path ||
      typeof item.text !== 'string' ||
      (size += item.text.length) > 16000000
    )
      throw new Error('备份包含无效文件。');
    if (item.uploaded) {
      const original = zip.file(path);
      if (!original) throw new Error('备份缺少上传原件。');
      item.blob = await original.async('blob');
    }
  }
  return {
    ...value,
    id: crypto.randomUUID(),
    title: `${value.title}（恢复）`,
    revision: 0,
    consentAt: undefined,
    updatedAt: Date.now(),
  };
}
