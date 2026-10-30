/* oxlint-disable react/react-compiler -- SSR harness exercises rendered editor callbacks across React state updates. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noop = () => {};
const property = {
  id: 'labels',
  name: 'Labels',
  type: 'multiSelect',
  options: [],
};
const database = {
  id: 'option-editor-test',
  title: 'Tasks',
  properties: [],
  records: [],
  view: { id: 'table', name: 'Table', type: 'table' },
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
};

function elements(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => elements(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...elements(tree.props.children, predicate),
  ];
}
const byLabel = (tree, label) => {
  const matches = elements(
    tree,
    (element) => element.props['aria-label'] === label,
  );
  assert.equal(matches.length, 1, `Expected one control labeled "${label}"`);
  return matches[0];
};
const button = (tree, text) => {
  const matches = elements(
    tree,
    (element) => element.props.onClick && element.props.children === text,
  );
  assert.equal(matches.length, 1, `Expected one button "${text}"`);
  return matches[0];
};
const input = (tree) => byLabel(tree, 'New option name');
const open = (tree) =>
  byLabel(tree, 'Add an option').props.onClick({
    currentTarget: { focus: noop },
  });
const type = (tree, value) => input(tree).props.onChange({ target: { value } });
const key = (tree, value, extras = {}) =>
  input(tree).props.onKeyDown({
    key: value,
    nativeEvent: { isComposing: false, keyCode: 0, ...extras },
    currentTarget: { value: input(tree).props.value },
    preventDefault: noop,
    stopPropagation: noop,
  });

void test('property options can be added repeatedly without leaving the editor', async (context) => {
  const temporary = await mkdtemp(
    join(root, 'tests', '.database-property-editor-'),
  );
  try {
    const entry = join(temporary, 'entry.ts');
    await writeFile(
      entry,
      "export { DatabasePropertyEditor } from '../../app/database-property-editor.tsx';",
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': root } },
      build: {
        ssr: entry,
        outDir: temporary,
        emptyOutDir: false,
        minify: false,
        rolldownOptions: {
          output: { format: 'es', entryFileNames: 'editor.mjs' },
        },
      },
    });
    const { DatabasePropertyEditor } = await import(
      pathToFileURL(join(temporary, 'editor.mjs')).href
    );

    function run(steps, draft = property, currentDatabase = database) {
      let step = 0;
      const saved = [];
      let closed = 0;
      let back = 0;
      const result = {
        saved,
        get closed() {
          return closed;
        },
        get back() {
          return back;
        },
      };
      function Harness() {
        const tree = DatabasePropertyEditor({
          database: currentDatabase,
          property: draft,
          onSave: (value) => saved.push(value),
          onClose: () => {
            closed++;
          },
          onBack: () => {
            back++;
          },
          onDelete: noop,
        });
        steps[step++]?.(tree, result);
        return tree;
      }
      renderToStaticMarkup(React.createElement(Harness));
      assert.equal(step, steps.length, 'All interaction steps were rendered');
      return result;
    }

    await context.test(
      'closing a blank new field discards it without validation',
      () => {
        for (const name of ['', '  ']) {
          const result = run(
            [
              (tree) =>
                byLabel(tree, 'Close property settings').props.onClick(),
            ],
            { id: 'new', name, type: 'text' },
          );
          assert.equal(result.closed, 1);
          assert.equal(result.saved.length, 0);
        }
      },
    );

    await context.test('closing a named new field still saves it', () => {
      const result = run([
        (tree) => byLabel(tree, 'Close property settings').props.onClick(),
        noop,
      ]);
      assert.equal(result.closed, 1);
      assert.equal(result.saved[0].name, property.name);
    });

    await context.test(
      'an existing field cannot be saved with an empty name',
      () => {
        const result = run(
          [
            (tree) =>
              byLabel(tree, 'Property name').props.onChange({
                target: { value: '' },
              }),
            (tree) => byLabel(tree, 'Close property settings').props.onClick(),
            (tree) =>
              assert.ok(
                elements(
                  tree,
                  (element) =>
                    element.props.children === 'Enter a property name.',
                ).length,
              ),
          ],
          property,
          { ...database, properties: [property] },
        );
        assert.equal(result.closed, 0);
        assert.equal(result.saved.length, 0);
      },
    );

    await context.test(
      'Enter appends trimmed names, keeps input open, and saves stable option IDs',
      () => {
        const result = run([
          open,
          (tree) => type(tree, '  Research  '),
          (tree) => key(tree, 'Enter'),
          (tree) => {
            assert.equal(tree.props['aria-label'], 'New property');
            assert.equal(input(tree).props.value, '');
            byLabel(tree, 'Edit option: Research');
            type(tree, 'Design');
          },
          (tree) => key(tree, 'Enter'),
          (tree) => {
            byLabel(tree, 'Edit option: Research');
            byLabel(tree, 'Edit option: Design');
            assert.equal(input(tree).props.value, '');
            button(tree, 'Save').props.onClick();
          },
          (_tree, result) => {
            assert.equal(result.saved.length, 1);
            assert.equal(result.back, 1);
          },
        ]);
        assert.deepEqual(
          result.saved[0].options.map((option) => option.name),
          ['Research', 'Design'],
        );
        assert.equal(
          new Set(result.saved[0].options.map((option) => option.id)).size,
          2,
        );
        assert.deepEqual(property.options, []);
      },
    );

    await context.test(
      'empty and duplicate names stay inline with a useful error',
      () => {
        const result = run(
          [
            open,
            (tree) => key(tree, 'Enter'),
            (tree) => {
              assert.equal(input(tree).props['aria-invalid'], true);
              assert.ok(
                elements(
                  tree,
                  (element) =>
                    element.props.children === 'Enter an option name.',
                ).length,
              );
              type(tree, ' research ');
            },
            (tree) => key(tree, 'Enter'),
            (tree) => {
              assert.equal(input(tree).props['aria-invalid'], true);
              assert.ok(
                elements(
                  tree,
                  (element) =>
                    element.props.children ===
                    'An option with this name already exists.',
                ).length,
              );
              key(tree, 'Escape');
            },
            (tree) => button(tree, 'Save').props.onClick(),
            noop,
          ],
          {
            ...property,
            options: [{ id: 'research', name: 'Research', color: 'blue' }],
          },
        );
        assert.equal(result.saved[0].options.length, 1);
      },
    );

    await context.test(
      'IME Enter is ignored and Escape cancels only the inline input',
      () => {
        const result = run([
          open,
          (tree) => type(tree, '知识点'),
          (tree) => {
            key(tree, 'Enter', { isComposing: true });
            key(tree, 'Enter', { keyCode: 229 });
            key(tree, 'Escape');
          },
          (tree, result) => {
            assert.equal(
              elements(
                tree,
                (element) => element.props['aria-label'] === 'New option name',
              ).length,
              0,
            );
            assert.equal(
              elements(
                tree,
                (element) =>
                  element.props.className === 'database-property-option-open',
              ).length,
              0,
            );
            assert.equal(result.closed, 0);
            button(tree, 'Save').props.onClick();
          },
          noop,
        ]);
        assert.equal(result.saved[0].options.length, 0);
      },
    );

    await context.test(
      'only the option arrow opens details, preserving color and default editing',
      () => {
        const result = run(
          [
            (tree) => {
              const content = elements(
                tree,
                (element) =>
                  element.props.className ===
                  'database-property-option-content',
              )[0];
              assert.equal(content.type, 'div');
              assert.equal(content.props.onClick, undefined);
              byLabel(tree, 'Edit option: Research').props.onClick();
            },
            (tree) => {
              assert.equal(
                byLabel(tree, 'Option name').props.value,
                'Research',
              );
              button(tree, 'Set as default').props.onClick();
            },
            (tree) => button(tree, 'Color').props.onClick(),
            (tree) => button(tree, 'Purple').props.onClick(),
            (tree) => byLabel(tree, 'Back').props.onClick(),
            (tree) => button(tree, 'Save').props.onClick(),
            noop,
          ],
          {
            ...property,
            options: [{ id: 'research', name: 'Research', color: 'gray' }],
          },
        );
        assert.deepEqual(result.saved[0].defaultValue, ['research']);
        assert.equal(result.saved[0].options[0].color, 'purple');
      },
    );

    await context.test(
      'status options are added to their selected group',
      () => {
        const result = run(
          [
            (tree) =>
              byLabel(tree, 'Add option to In progress').props.onClick({
                currentTarget: { focus: noop },
              }),
            (tree) => type(tree, 'Review'),
            (tree) => key(tree, 'Enter'),
            (tree) => button(tree, 'Save').props.onClick(),
            noop,
          ],
          { ...property, type: 'status' },
        );
        assert.deepEqual(
          result.saved[0].options.map(({ name, color, group }) => ({
            name,
            color,
            group,
          })),
          [{ name: 'Review', color: 'blue', group: 'progress' }],
        );
      },
    );

    await context.test(
      'unconfirmed text cannot be silently lost on save; cancel discards the draft',
      () => {
        const result = run([
          open,
          (tree) => type(tree, 'Unconfirmed'),
          (tree) => button(tree, 'Save').props.onClick(),
          (tree, result) => {
            assert.equal(result.saved.length, 0);
            assert.equal(input(tree).props.value, 'Unconfirmed');
            assert.equal(input(tree).props['aria-invalid'], true);
            key(tree, 'Enter');
          },
          (tree) => button(tree, 'Cancel').props.onClick(),
        ]);
        assert.equal(result.saved.length, 0);
        assert.equal(result.closed, 1);
        assert.deepEqual(property.options, []);
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
