'use client';
import { useState } from 'react';
import { FileText, Image } from 'lucide-react';
import { useI18n } from './i18n';
import type { DatabaseFile, DatabaseValue } from './database-model';

const isImage = (file: DatabaseFile) =>
  /^image\/(png|jpeg|gif|webp|avif)$/.test(file.type);

export function galleryPreviewFile(value: DatabaseValue | undefined) {
  if (!Array.isArray(value)) return undefined;
  const files = value.filter(
    (item): item is DatabaseFile => typeof item === 'object' && item !== null,
  );
  return (
    files.find((file) => isImage(file) || file.type.startsWith('video/')) ||
    files[0]
  );
}

export function DatabaseGalleryPreview({
  file,
  fitMedia = true,
}: {
  file?: DatabaseFile;
  fitMedia?: boolean;
}) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usable = file && file.url !== failedUrl;
  return (
    <div className="database-gallery-preview" data-fit-media={fitMedia}>
      {usable && isImage(file) ? (
        // Local attachment URLs are resolved by the workspace repository.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(file.url)}
        />
      ) : usable && file.type.startsWith('video/') ? (
        <video
          src={file.url}
          aria-label={file.name}
          preload="metadata"
          muted
          playsInline
          onError={() => setFailedUrl(file.url)}
        />
      ) : (
        <div className="database-gallery-preview-fallback">
          {file ? <FileText size={28} /> : <Image size={28} />}
          <span>{file?.name || t('No media', '暂无媒体')}</span>
        </div>
      )}
    </div>
  );
}
