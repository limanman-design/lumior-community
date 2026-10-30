import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { databasePropertyTypes } from '../app/database-model.ts';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};

void test('the actual record drawer renders complete details without entering edit mode', async (context) => {
  const temporary = await mkdtemp(
    join(root, 'tests', '.database-record-drawer-'),
  );
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: join(root, 'app', 'database-record-drawer.tsx'),
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'record-drawer.mjs' },
        },
      },
    });
    const { DatabaseRecordDrawer } = await import(
      pathToFileURL(join(temporary, 'record-drawer.mjs')).href
    );
    const longText = [
      '通知原文：应完整保留每个段落。',
      ...Array.from(
        { length: 40 },
        (_, index) =>
          `第 ${index + 1} 段：这是用于检验完整展示的长文本，含中文、English 和换行。`,
      ),
      '最终段落：末尾内容必须完整展示，不能被省略。',
    ].join('\n\n');
    const record = {
      id: 'record-a',
      title: '00 通知概况与三专业答辩时间',
      createdAt: '2026-10-16T12:05:51.000Z',
      updatedAt: '2026-10-18T02:20:30.000Z',
      values: {
        body: longText,
        count: 42.5,
        category: 'research',
        tags: ['urgent', 'review'],
        stage: 'progress',
        deadline: '2026-11-16',
        accepted: true,
        attachments: [
          {
            name: 'Original notice.pdf',
            url: 'blob:drawer-test-attachment',
            type: 'application/pdf',
            size: 1024,
          },
        ],
      },
    };
    const properties = [
      { id: 'body', name: 'Notice original', type: 'text' },
      { id: 'count', name: 'Participant count', type: 'number' },
      {
        id: 'category',
        name: 'Category',
        type: 'select',
        options: [
          { id: 'research', name: 'Research materials', color: 'blue' },
        ],
      },
      {
        id: 'tags',
        name: 'Labels',
        type: 'multiSelect',
        options: [
          { id: 'urgent', name: 'Urgent notice', color: 'red' },
          { id: 'review', name: 'Needs review', color: 'yellow' },
        ],
      },
      {
        id: 'stage',
        name: 'Stage',
        type: 'status',
        options: [
          {
            id: 'progress',
            name: 'Preparing defence',
            color: 'green',
            group: 'progress',
          },
        ],
      },
      { id: 'deadline', name: 'Defence date', type: 'date', dateFormat: 'iso' },
      {
        id: 'accepted',
        name: 'Acknowledged',
        type: 'checkbox',
        checkboxLabel: 'Notice read',
      },
      { id: 'created', name: 'Created automatically', type: 'createdAt' },
      { id: 'updated', name: 'Updated automatically', type: 'updatedAt' },
      { id: 'attachments', name: 'Source attachments', type: 'files' },
    ];
    assert.deepEqual(
      new Set(properties.map((property) => property.type)),
      new Set(databasePropertyTypes),
    );
    const database = {
      id: 'drawer-database',
      title: '2026 答辩通知资料',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      properties,
      records: [record],
      view: { type: 'table' },
    };
    const props = {
      database,
      record,
      saveStatus: 'saved',
      editError: '',
      onClose: noop,
      onPatch: noop,
      onDuplicate: noop,
      onDelete: noop,
      onEditProperty: noop,
      onUpload: async () => {},
    };
    const render = (patch) =>
      renderToStaticMarkup(
        React.createElement(DatabaseRecordDrawer, { ...props, ...patch }),
      );

    await context.test(
      'uses a native nonmodal dialog without a modal backdrop or initial text editor',
      () => {
        const html = render();
        assert.match(html, /<dialog\b[^>]*\bopen=""/);
        assert.match(html, /<dialog\b[^>]*aria-modal="false"/);
        assert.match(html, /aria-label="Record details"/);
        assert.match(html, /aria-label="Close record details"/);
        assert.doesNotMatch(
          html,
          /dialog-overlay|data-slot="dialog-content"|aria-modal="true"/,
        );
        assert.doesNotMatch(html, /<textarea\b|\bautofocus(?:=|\s|>)/i);
        assert.match(html, /aria-label="Edit record name"/);
      },
    );

    await context.test(
      'retains every paragraph of long text, including the final paragraph',
      () => {
        const html = render();
        assert.ok(html.includes(longText));
        assert.match(html, /第 40 段：这是用于检验完整展示的长文本/);
        assert.match(html, /最终段落：末尾内容必须完整展示，不能被省略。/);
        assert.match(html, /database-record-long-text-content/);
        assert.doesNotMatch(html, /通知原文[^<]*…|通知原文[^<]*\.\.\./);
      },
    );

    await context.test(
      'renders existing values and labels for all ten property types',
      () => {
        const html = render();
        for (const property of properties)
          assert.ok(
            html.includes(property.name),
            `Missing property: ${property.type}`,
          );
        for (const value of [
          '42.5',
          'Research materials',
          'Urgent notice',
          'Needs review',
          'Preparing defence',
          '2026-11-16',
          'Notice read',
          'Original notice.pdf',
        ])
          assert.ok(html.includes(value), `Missing supplied value: ${value}`);
        assert.match(html, /type="checkbox"[^>]*checked=""/);
        assert.equal(
          (html.match(/class="database-system-value"/g) || []).length,
          2,
        );
        assert.match(html, /Automatically maintained by Lumior/);
        assert.match(html, /<time dateTime="2026-10-16T12:05:51.000Z"/);
        assert.match(html, /<time dateTime="2026-10-18T02:20:30.000Z"/);
      },
    );

    await context.test(
      'the header has one back control and no routine save indicator; failures remain visible',
      () => {
        for (const saveStatus of ['saved', 'saving', 'loading']) {
          const html = render({ saveStatus });
          assert.doesNotMatch(html, /<output\b|aria-label="Close details"/);
          assert.equal(
            (html.match(/aria-label="Close record details"/g) || []).length,
            1,
          );
        }
        assert.match(
          render({ saveStatus: 'error' }),
          /role="alert">Save failed · check Settings<\/p>/,
        );
      },
    );

    await context.test(
      'missing text remains empty while system dates stay read only',
      () => {
        const html = render({
          record: { ...record, values: { ...record.values, body: '' } },
        });
        assert.match(
          html,
          /database-record-long-text-content database-record-value-empty">Empty<\/div>/,
        );
        assert.doesNotMatch(
          html,
          /最终段落|<input\b[^>]*type="(?:date|datetime-local)"/,
        );
        assert.equal(
          (html.match(/class="database-system-value"/g) || []).length,
          2,
        );
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
